"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnomalyEvent, SessionData, SentryLevel } from "@/lib/types";
import { idbSaveSession, idbLoadSessions } from "@/lib/idb";
import { hapticTap, soundTick } from "@/lib/feedback";
import { useMagnetometer } from "@/hooks/useMagnetometer";
import { useMicrophone } from "@/hooks/useMicrophone";
import { useMotion } from "@/hooks/useMotion";
import { useGeolocation } from "@/hooks/useGeolocation";
import { SensorPanel } from "./SensorPanel";
import { EventLog } from "./EventLog";
import { SessionHistory } from "./SessionHistory";
import { SettingsControl } from "./SettingsControl";
import { FirstRunIntro } from "./FirstRunIntro";

const MAX_EVENTS = 200;

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function Dashboard() {
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<AnomalyEvent[]>([]);
  const [sessionLabel, setSessionLabel] = useState("");
  const [pastSessions, setPastSessions] = useState<SessionData[]>([]);
  const [transcribeEnabled, setTranscribeEnabled] = useState(false);
  const [nowTs, setNowTs] = useState(0);
  const [haptics, setHaptics] = useState(true);
  const [soundCue, setSoundCue] = useState(false);
  const [introSeen, setIntroSeen] = useState<boolean | null>(null);
  const [sentryArmed, setSentryArmed] = useState(false);
  const [sentryLevel, setSentryLevel] = useState<SentryLevel>("med");
  // Which channels take part in a session (include/exclude). Default: all on.
  const [channelOn, setChannelOn] = useState({ emf: true, sound: true, motion: true });

  const settingsRef = useRef({ haptics: true, soundCue: false });
  settingsRef.current = { haptics, soundCue };

  const sessionIdRef = useRef<string>("");
  const startedAtRef = useRef<number>(0);
  const eventsRef = useRef<AnomalyEvent[]>([]);
  const sessionLabelRef = useRef<string>("");
  sessionLabelRef.current = sessionLabel;
  const clipBlobsRef = useRef<Map<string, Blob>>(new Map());
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Load past sessions from IndexedDB on first render
  useEffect(() => {
    idbLoadSessions().then(setPastSessions).catch(() => {});
  }, []);

  // Check if transcription is configured
  useEffect(() => {
    fetch("/api/transcribe")
      .then((r) => r.json())
      .then((d: { available?: boolean }) => setTranscribeEnabled(d.available === true))
      .catch(() => {});
  }, []);

  // Load persisted feedback prefs + first-run flag
  useEffect(() => {
    try {
      const h = localStorage.getItem("revenant.haptics");
      const s = localStorage.getItem("revenant.sound");
      const lvl = localStorage.getItem("revenant.sentryLevel");
      if (h !== null) setHaptics(h === "1");
      if (s !== null) setSoundCue(s === "1");
      if (lvl === "low" || lvl === "med" || lvl === "high") setSentryLevel(lvl);
      const ch = localStorage.getItem("revenant.channels");
      if (ch) {
        const p = JSON.parse(ch) as Partial<Record<"emf" | "sound" | "motion", boolean>>;
        setChannelOn({ emf: p.emf !== false, sound: p.sound !== false, motion: p.motion !== false });
      }
      setIntroSeen(localStorage.getItem("revenant.introSeen") === "1");
    } catch {
      setIntroSeen(true);
    }
  }, []);

  const toggleSetting = useCallback((key: "haptics" | "sound", value: boolean) => {
    if (key === "haptics") {
      setHaptics(value);
      try { localStorage.setItem("revenant.haptics", value ? "1" : "0"); } catch {}
    } else {
      setSoundCue(value);
      try { localStorage.setItem("revenant.sound", value ? "1" : "0"); } catch {}
    }
  }, []);

  const dismissIntro = useCallback(() => {
    setIntroSeen(true);
    try { localStorage.setItem("revenant.introSeen", "1"); } catch {}
  }, []);

  const acquireWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLockRef.current = await (navigator as unknown as { wakeLock: { request: (type: string) => Promise<WakeLockSentinel> } }).wakeLock.request("screen");
    } catch {
      // Screen wake lock not available — silently skip
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  // Re-acquire wake lock when page becomes visible again
  useEffect(() => {
    if (!running) return;
    const handler = () => {
      if (document.visibilityState === "visible" && !wakeLockRef.current) {
        acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [running, acquireWakeLock]);

  // Session-elapsed clock — ticks once a second while recording.
  useEffect(() => {
    if (!running) return;
    setNowTs(Date.now());
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  const elapsedMs = running && startedAtRef.current ? nowTs - startedAtRef.current : 0;

  const coords = useGeolocation(running);
  const coordsRef = useRef(coords);
  coordsRef.current = coords;

  const addEvent = useCallback((ev: AnomalyEvent, blob?: Blob) => {
    // Signature anomaly beat: fire hardware feedback in step with the card
    // reaction (driven by pulseId) and the row slide-in.
    if (settingsRef.current.haptics) hapticTap();
    if (settingsRef.current.soundCue) soundTick();

    const newClips = new Map<string, Blob>();
    if (blob) {
      newClips.set(ev.id, blob);
      clipBlobsRef.current.set(ev.id, blob);
    }

    eventsRef.current = [...eventsRef.current, ev];

    setEvents((prev) => {
      let next = [...prev, ev];
      if (next.length > MAX_EVENTS) {
        // Revoke URLs of evicted events to free memory
        const evicted = next.slice(0, next.length - MAX_EVENTS);
        evicted.forEach((e) => { if (e.clipUrl) URL.revokeObjectURL(e.clipUrl); });
        next = next.slice(-MAX_EVENTS);
        eventsRef.current = next;
      }
      return next;
    });

    // Incremental IDB write — crash doesn't lose the night's data
    idbSaveSession(
      {
        id: sessionIdRef.current,
        started_at: startedAtRef.current,
        ended_at: null,
        label: sessionLabelRef.current || null,
        location: coordsRef.current,
        events: eventsRef.current,
      },
      newClips
    ).catch(() => {});
  }, []);

  // Per-channel active = session running AND this channel included. An excluded
  // channel has active=false, so its hook holds no resources and never samples.
  const emf = useMagnetometer(running && channelOn.emf, addEvent);
  const sound = useMicrophone(running && channelOn.sound, addEvent);
  const motion = useMotion(running && channelOn.motion, addEvent, sentryArmed, sentryLevel);

  const toggleSentry = useCallback(() => setSentryArmed((a) => !a), []);
  const changeSentryLevel = useCallback((l: SentryLevel) => {
    setSentryLevel(l);
    try { localStorage.setItem("revenant.sentryLevel", l); } catch {}
  }, []);

  // Include/exclude a channel. Persists, and mid-session turns it on/off cleanly.
  const toggleChannel = useCallback((ch: "emf" | "sound" | "motion") => {
    const turningOn = !channelOn[ch];
    const next = { ...channelOn, [ch]: turningOn };
    setChannelOn(next);
    try { localStorage.setItem("revenant.channels", JSON.stringify(next)); } catch {}
    // Turning ON mid-session: fire enable() in THIS tap so the mic/motion
    // permission request stays inside the user gesture (iOS requirement).
    if (running && turningOn) {
      if (ch === "sound") sound.enable();
      else if (ch === "motion") motion.enable();
      else if (ch === "emf" && emf.status !== "no-channel") emf.enable();
    }
    // Turning OFF: active flips false → that hook tears itself down; others untouched.
  }, [channelOn, running, sound, motion, emf]);

  const startSession = async () => {
    // Revoke any leftover URLs from the previous session
    eventsRef.current.forEach((e) => { if (e.clipUrl) URL.revokeObjectURL(e.clipUrl); });
    eventsRef.current = [];
    clipBlobsRef.current = new Map();

    sessionIdRef.current = crypto.randomUUID();
    startedAtRef.current = Date.now();
    setEvents([]);

    // One-tap start: arm every INCLUDED channel. The permission-triggering calls
    // (mic getUserMedia, motion requestPermission) must fire SYNCHRONOUSLY inside
    // the tap, before any await — iOS auto-denies otherwise. So fire those first,
    // then the sync magnetometer, then anything async. An excluded channel's
    // enable() is never called, so it requests no permission and holds no mic/
    // listener.
    const soundP = channelOn.sound ? sound.enable() : null;
    const motionP = channelOn.motion ? motion.enable() : null;
    if (channelOn.emf && emf.status !== "no-channel") emf.enable();

    // Wake lock is best-effort; fire-and-forget AFTER the enables so its await
    // never severs the gesture chain the permission prompts depend on.
    acquireWakeLock();

    await Promise.all([soundP, motionP].filter(Boolean) as Promise<void>[]).catch(() => {});

    setRunning(true);
  };

  const stopSession = async () => {
    setRunning(false);
    setSentryArmed(false);
    releaseWakeLock();

    const session: SessionData = {
      id: sessionIdRef.current,
      started_at: startedAtRef.current,
      ended_at: Date.now(),
      label: sessionLabelRef.current || null,
      location: coordsRef.current,
      events: eventsRef.current,
    };

    // Final IDB save with ended_at timestamp
    await idbSaveSession(session, new Map()).catch(() => {});
    const loaded = await idbLoadSessions().catch(() => pastSessions);
    setPastSessions(loaded);

    // Optional server sync when Postgres is configured
    try {
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(session),
      });
    } catch {
      // Offline or no Postgres — already in IndexedDB
    }
  };

  const handleRecalibrate = () => {
    setEvents([]);
    eventsRef.current = [];
    if (channelOn.emf) emf.recalibrate();
    if (channelOn.sound) sound.recalibrate();
    if (channelOn.motion) motion.recalibrate();
  };

  // Latest event id per channel — changes drive each card's one-shot reaction.
  const latestByChannel = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of events) m[e.channel] = e.id;
    return m;
  }, [events]);

  return (
    <div className="min-h-screen bg-scope text-zinc-100 flex flex-col">
      <div className="graticule graticule-anim fixed inset-0 pointer-events-none z-0" />
      <div className="vignette fixed inset-0 pointer-events-none z-0" />

      {introSeen === false && <FirstRunIntro onDismiss={dismissIntro} />}

      <div className="relative z-10 max-w-6xl w-full mx-auto px-4 py-4 flex flex-col flex-1 gap-4">
        {/* Header */}
        <header className="flex items-center justify-between gap-3 pb-3 border-b border-zinc-800/80">
          <div className="min-w-0">
            <h1 className="font-display text-lg font-bold tracking-[0.2em] text-zinc-100 leading-none">
              REVENANT
            </h1>
            <div className="mt-1.5 flex items-center gap-2 leading-none">
              {running ? (
                <span className="flex items-center gap-1.5 text-[10px] font-display font-semibold uppercase tracking-[0.18em] text-red-400">
                  <span className="rec-dot inline-block w-2 h-2 rounded-full bg-red-500" />
                  REC
                </span>
              ) : (
                <span className="text-[10px] font-display font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Standby
                </span>
              )}
              <span className="font-mono text-[11px] tabular-nums text-zinc-300">
                {fmtElapsed(elapsedMs)}
              </span>
              {coords && (
                <span className="hidden sm:inline font-mono text-[10px] text-zinc-600">
                  · {coords.lat}, {coords.lng}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!running && (
              <input
                type="text"
                placeholder="Session label"
                value={sessionLabel}
                onChange={(e) => setSessionLabel(e.target.value)}
                className="hidden sm:block bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 w-40"
              />
            )}
            {running && (
              <button
                onClick={handleRecalibrate}
                className="btn-press px-3 py-1.5 text-[10px] font-display uppercase tracking-wider font-semibold rounded border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                title="Clear events and re-establish baselines"
              >
                Recalibrate
              </button>
            )}
            <button
              onClick={running ? stopSession : startSession}
              className={`btn-press px-4 py-1.5 text-[11px] font-display uppercase tracking-wider font-semibold rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 ${
                running
                  ? "bg-red-600 hover:bg-red-500 focus-visible:ring-red-500 text-white"
                  : "bg-emerald-600 hover:bg-emerald-500 focus-visible:ring-emerald-500 text-white"
              }`}
            >
              {running ? "Stop" : "Start Session"}
            </button>
            <SettingsControl haptics={haptics} sound={soundCue} onToggle={toggleSetting} />
          </div>
        </header>

        {/* Sensor strips — all three visible without scrolling on a phone */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
          <SensorPanel
            title="EMF"
            channelId="magnetometer"
            reading={emf}
            onEnable={emf.enable}
            color="#22d3ee"
            pulseId={latestByChannel.emf}
            included={channelOn.emf}
            onToggleInclude={() => toggleChannel("emf")}
            toggleDisabled={emf.status === "no-channel"}
            noChannelMessage="Not exposed by this browser. Use Chrome/Edge on Android over HTTPS, or pair an external Bluetooth magnetometer on iPhone."
          />
          <SensorPanel
            title="Sound"
            channelId="microphone"
            reading={sound}
            onEnable={sound.enable}
            color="#34d399"
            pulseId={latestByChannel.sound}
            included={channelOn.sound}
            onToggleInclude={() => toggleChannel("sound")}
          />
          <SensorPanel
            title="Motion"
            channelId="accelerometer"
            reading={motion}
            onEnable={motion.enable}
            color="#fbbf24"
            pulseId={latestByChannel.motion}
            included={channelOn.motion}
            onToggleInclude={() => toggleChannel("motion")}
            sentry={
              running
                ? {
                    armed: sentryArmed,
                    phase: motion.sentryPhase,
                    level: sentryLevel,
                    onToggle: toggleSentry,
                    onLevel: changeSentryLevel,
                  }
                : undefined
            }
          />
        </div>

        {/* Event Log — the record of the investigation */}
        <section className="flex flex-col flex-1 min-h-[8rem]">
          <div className="panel-card rounded-lg flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/80 shrink-0">
              <h2 className="font-display text-xs font-semibold uppercase tracking-[0.15em] text-zinc-300">
                Event Log
              </h2>
              <span className="text-[10px] font-mono tabular-nums text-zinc-500">
                {events.length} {events.length === 1 ? "event" : "events"}
              </span>
            </div>
            <EventLog
              events={events}
              className="flex-1 min-h-0 p-2"
              transcribeEnabled={transcribeEnabled}
            />
          </div>
        </section>

        {/* Past sessions */}
        {!running && <SessionHistory sessions={pastSessions} onSessionsChange={setPastSessions} />}

        {/* Footer */}
        <footer className="text-center text-[10px] font-mono text-zinc-600 leading-relaxed">
          Reads real device sensors — no synthesized, randomized, or simulated data.
          Reports environmental deviation from baseline, not the paranormal.
        </footer>
      </div>
    </div>
  );
}
