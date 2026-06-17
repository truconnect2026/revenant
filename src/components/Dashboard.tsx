"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnomalyEvent, SessionData } from "@/lib/types";
import { idbSaveSession, idbLoadSessions } from "@/lib/idb";
import { useMagnetometer } from "@/hooks/useMagnetometer";
import { useMicrophone } from "@/hooks/useMicrophone";
import { useMotion } from "@/hooks/useMotion";
import { useGeolocation } from "@/hooks/useGeolocation";
import { SensorPanel } from "./SensorPanel";
import { EventLog } from "./EventLog";
import { SessionHistory } from "./SessionHistory";

const MAX_EVENTS = 200;

export function Dashboard() {
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<AnomalyEvent[]>([]);
  const [sessionLabel, setSessionLabel] = useState("");
  const [pastSessions, setPastSessions] = useState<SessionData[]>([]);
  const [transcribeEnabled, setTranscribeEnabled] = useState(false);

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

  const coords = useGeolocation(running);
  const coordsRef = useRef(coords);
  coordsRef.current = coords;

  const addEvent = useCallback((ev: AnomalyEvent, blob?: Blob) => {
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

  const emf = useMagnetometer(running, addEvent);
  const sound = useMicrophone(running, addEvent);
  const motion = useMotion(running, addEvent);

  const startSession = async () => {
    // Revoke any leftover URLs from the previous session
    eventsRef.current.forEach((e) => { if (e.clipUrl) URL.revokeObjectURL(e.clipUrl); });
    eventsRef.current = [];
    clipBlobsRef.current = new Map();

    sessionIdRef.current = crypto.randomUUID();
    startedAtRef.current = Date.now();
    setEvents([]);

    await acquireWakeLock();

    // Call all enable()s synchronously before any await so iOS gesture covers
    // DeviceMotionEvent.requestPermission()
    emf.enable();
    const soundP = sound.enable();
    const motionP = motion.enable();
    await Promise.all([soundP, motionP]).catch(() => {});

    setRunning(true);
  };

  const stopSession = async () => {
    setRunning(false);
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
    emf.recalibrate();
    sound.recalibrate();
    motion.recalibrate();
  };

  return (
    <div className="min-h-screen bg-scope text-zinc-100 flex flex-col">
      <div className="graticule fixed inset-0 pointer-events-none z-0" />

      <div className="relative z-10 max-w-7xl w-full mx-auto px-4 py-6 flex flex-col flex-1">
        {/* Header */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-100">
              REVENANT
            </h1>
            <p className="text-[11px] font-mono text-zinc-500 mt-0.5">
              Environmental Sensor Readout
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {!running && (
              <input
                type="text"
                placeholder="Session label (optional)"
                value={sessionLabel}
                onChange={(e) => setSessionLabel(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 w-44"
              />
            )}
            {running && (
              <button
                onClick={handleRecalibrate}
                className="px-3 py-2 text-xs font-mono uppercase font-semibold rounded border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                title="Clear events and re-establish baselines"
              >
                Recalibrate
              </button>
            )}
            <button
              onClick={running ? stopSession : startSession}
              className={`px-5 py-2 text-xs font-mono uppercase font-semibold rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 ${
                running
                  ? "bg-red-600 hover:bg-red-500 focus-visible:ring-red-500 text-white"
                  : "bg-emerald-600 hover:bg-emerald-500 focus-visible:ring-emerald-500 text-white"
              }`}
            >
              {running ? "Stop Session" : "Start Session"}
            </button>
          </div>
        </header>

        {/* Coordinates */}
        {coords && (
          <div className="text-[10px] font-mono text-zinc-500 mb-4">
            LOC {coords.lat}, {coords.lng}
          </div>
        )}

        {/* Sensor Panels */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6 items-stretch">
          <SensorPanel
            title="EMF"
            channelId="magnetometer"
            reading={emf}
            onEnable={emf.enable}
            color="#22d3ee"
            running={running}
            noChannelMessage="Magnetometer is not exposed by this browser. Available in Chrome/Edge on Android over HTTPS. On iPhone, pair an external Bluetooth magnetometer via a native app."
          />
          <SensorPanel
            title="Sound"
            channelId="microphone"
            reading={sound}
            onEnable={sound.enable}
            color="#34d399"
            running={running}
          />
          <SensorPanel
            title="Motion"
            channelId="accelerometer"
            reading={motion}
            onEnable={motion.enable}
            color="#fbbf24"
            running={running}
          />
        </div>

        {/* Event Log */}
        <section className="flex flex-col flex-1 min-h-0 mb-0">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-2">
            Event Log
          </h2>
          <EventLog
            events={events}
            className="flex-1 min-h-[5rem]"
            transcribeEnabled={transcribeEnabled}
          />
        </section>

        {/* Past sessions */}
        {!running && <SessionHistory sessions={pastSessions} onSessionsChange={setPastSessions} />}

        {/* Footer */}
        <footer className="mt-6 text-center text-[10px] font-mono text-zinc-600">
          Revenant reads real device sensors. It does not synthesize, randomize, or simulate data.
          <br />
          It does not detect the paranormal. It reports environmental deviation from baseline.
        </footer>
      </div>
    </div>
  );
}
