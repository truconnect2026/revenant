"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RollingBaseline } from "@/lib/anomaly";
import { AnomalyEvent, SensorReading, SensorStatus } from "@/lib/types";

const SAMPLE_HZ = 20;
const WINDOW_SIZE = 200;
const WARMUP = 60;
const THRESHOLD = 4;
const COOLDOWN_MS = 1500;
const HISTORY_LEN = 80;
// Samples to skip pushing to baseline after a trip, preventing spike inflation
const POST_TRIP_SKIP = 5;

export function useMagnetometer(
  active: boolean,
  onEvent: (e: AnomalyEvent) => void
): SensorReading & { enable: () => void; recalibrate: () => void } {
  const [status, setStatus] = useState<SensorStatus>("standby");
  const [value, setValue] = useState<number | null>(null);
  const [sigma, setSigma] = useState(0);
  const [mean, setMean] = useState(0);
  const [stddev, setStddev] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [warmupProgress, setWarmupProgress] = useState(0);

  const baselineRef = useRef(new RollingBaseline(WINDOW_SIZE, WARMUP));
  const sensorRef = useRef<Magnetometer | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTripRef = useRef(0);
  const skipCountRef = useRef(0);
  const latestReading = useRef<{ x: number; y: number; z: number } | null>(null);
  const historyRef = useRef<number[]>([]);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const available = typeof window !== "undefined" && "Magnetometer" in window;

  const enable = useCallback(() => {
    if (!available) {
      setStatus("no-channel");
      return;
    }
    try {
      const mag = new Magnetometer({ frequency: 60 });
      mag.onreading = () => {
        latestReading.current = {
          x: mag.x ?? 0,
          y: mag.y ?? 0,
          z: mag.z ?? 0,
        };
      };
      mag.onerror = () => setStatus("blocked");
      mag.start();
      sensorRef.current = mag;
      setStatus("settling");
      baselineRef.current.reset();
    } catch {
      setStatus("blocked");
    }
  }, [available]);

  const recalibrate = useCallback(() => {
    historyRef.current = [];
    skipCountRef.current = 0;
    baselineRef.current.reset();
    setHistory([]);
    setSigma(0);
    setMean(0);
    setStddev(0);
    setWarmupProgress(0);
    setStatus("settling");
  }, []);

  // Sampling interval
  useEffect(() => {
    if (!active || status === "standby" || status === "no-channel" || status === "blocked") {
      return;
    }

    intervalRef.current = setInterval(() => {
      // Skip processing while page is backgrounded to prevent baseline poisoning
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

      const r = latestReading.current;
      if (!r) return;

      const magnitude = Math.hypot(r.x, r.y, r.z);
      const baseline = baselineRef.current;
      const s = baseline.score(magnitude);

      if (baseline.isWarmedUp) {
        setStatus("live");
        const now = Date.now();
        if (s >= THRESHOLD && now - lastTripRef.current > COOLDOWN_MS) {
          lastTripRef.current = now;
          skipCountRef.current = POST_TRIP_SKIP;
          onEventRef.current({
            id: crypto.randomUUID(),
            channel: "emf",
            value: Math.round(magnitude * 100) / 100,
            unit: "µT",
            sigma: Math.round(s * 100) / 100,
            mean: Math.round(baseline.mean * 100) / 100,
            stddev: Math.round(baseline.stddev * 100) / 100,
            timestamp: now,
          });
        }
      }

      // Skip pushing anomaly spikes into the baseline
      if (skipCountRef.current > 0) {
        skipCountRef.current--;
      } else {
        baseline.push(magnitude);
      }

      setValue(Math.round(magnitude * 100) / 100);
      setSigma(Math.round(s * 100) / 100);
      setMean(Math.round(baseline.mean * 100) / 100);
      setStddev(Math.round(baseline.stddev * 100) / 100);
      setWarmupProgress(baseline.isWarmedUp ? 1 : Math.min(baseline.sampleCount / WARMUP, 1));

      historyRef.current = [...historyRef.current.slice(-(HISTORY_LEN - 1)), magnitude];
      setHistory(historyRef.current);
    }, 1000 / SAMPLE_HZ);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [active, status]);

  // Stop + reset all state on session end
  useEffect(() => {
    if (!active) {
      if (sensorRef.current) {
        sensorRef.current.stop();
        sensorRef.current = null;
      }
      if (intervalRef.current) clearInterval(intervalRef.current);
      latestReading.current = null;
      historyRef.current = [];
      skipCountRef.current = 0;
      baselineRef.current.reset();
      setValue(null);
      setSigma(0);
      setMean(0);
      setStddev(0);
      setHistory([]);
      setWarmupProgress(0);
      setStatus("standby");
    }
  }, [active]);

  useEffect(() => {
    return () => {
      sensorRef.current?.stop();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return {
    status: available ? status : "no-channel",
    value,
    unit: "µT",
    sigma,
    mean,
    stddev,
    history,
    threshold: THRESHOLD,
    warmupProgress,
    enable,
    recalibrate,
  };
}
