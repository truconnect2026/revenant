"use client";
import { useCallback, useRef, useState } from "react";
import { AnomalyEvent, SessionData } from "@/lib/types";
import { useMagnetometer } from "@/hooks/useMagnetometer";
import { useMicrophone } from "@/hooks/useMicrophone";
import { useMotion } from "@/hooks/useMotion";
import { useGeolocation } from "@/hooks/useGeolocation";
import { SensorPanel } from "./SensorPanel";
import { EventLog } from "./EventLog";

export function Dashboard() {
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<AnomalyEvent[]>([]);
  const [sessionLabel, setSessionLabel] = useState("");
  const sessionIdRef = useRef<string>("");
  const startedAtRef = useRef<number>(0);

  const addEvent = useCallback((ev: AnomalyEvent) => {
    setEvents((prev) => [...prev, ev]);
  }, []);

  const emf = useMagnetometer(running, addEvent);
  const sound = useMicrophone(running, addEvent);
  const motion = useMotion(running, addEvent);
  const coords = useGeolocation(running);

  const startSession = async () => {
    sessionIdRef.current = crypto.randomUUID();
    startedAtRef.current = Date.now();
    setEvents([]);

    // Enable sensors — these are user-gesture-triggered
    emf.enable();
    await sound.enable();
    await motion.enable();

    setRunning(true);
  };

  const stopSession = async () => {
    setRunning(false);

    const session: SessionData = {
      id: sessionIdRef.current,
      started_at: startedAtRef.current,
      ended_at: Date.now(),
      label: sessionLabel || null,
      location: coords,
      events,
    };

    try {
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(session),
      });
    } catch {
      // Offline — session was captured in events state already
    }
  };

  return (
    <div className="min-h-screen bg-scope text-zinc-100">
      {/* Graticule overlay */}
      <div className="graticule fixed inset-0 pointer-events-none z-0" />

      <div className="relative z-10 max-w-4xl mx-auto px-4 py-6">
        {/* Header */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-100">
              REVENANT
            </h1>
            <p className="text-[11px] font-mono text-zinc-500 mt-0.5">
              Environmental Sensor Readout &middot; Real Data Only
            </p>
          </div>
          <div className="flex items-center gap-3">
            {!running && (
              <input
                type="text"
                placeholder="Session label (optional)"
                value={sessionLabel}
                onChange={(e) => setSessionLabel(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 w-48"
              />
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <SensorPanel
            title="EMF"
            channelId="magnetometer"
            reading={emf}
            onEnable={emf.enable}
            color="#22d3ee"
            noChannelMessage="Magnetometer is not exposed by this browser. Available in Chrome/Edge on Android over HTTPS. On iPhone, pair an external Bluetooth magnetometer via a native app."
          />
          <SensorPanel
            title="Sound"
            channelId="microphone"
            reading={sound}
            onEnable={sound.enable}
            color="#34d399"
          />
          <SensorPanel
            title="Motion"
            channelId="accelerometer"
            reading={motion}
            onEnable={motion.enable}
            color="#fbbf24"
          />
        </div>

        {/* Event Log */}
        <section>
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-2">
            Event Log
          </h2>
          <EventLog events={events} />
        </section>

        {/* Footer */}
        <footer className="mt-8 text-center text-[10px] font-mono text-zinc-600">
          Revenant reads real device sensors. It does not synthesize, randomize, or simulate data.
          <br />
          It does not detect the paranormal. It reports environmental deviation from baseline.
        </footer>
      </div>
    </div>
  );
}
