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

export function useMagnetometer(
  active: boolean,
  onEvent: (e: AnomalyEvent) => void
): SensorReading & { enable: () => void } {
  const [status, setStatus] = useState<SensorStatus>("standby");
  const [value, setValue] = useState<number | null>(null);
  const [sigma, setSigma] = useState(0);
  const [mean, setMean] = useState(0);
  const [stddev, setStddev] = useState(0);
  const [history, setHistory] = useState<number[]>([]);

  const baselineRef = useRef(new RollingBaseline(WINDOW_SIZE, WARMUP));
  const sensorRef = useRef<Magnetometer | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTripRef = useRef(0);
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

  // Sampling interval
  useEffect(() => {
    if (!active || status === "standby" || status === "no-channel" || status === "blocked") {
      return;
    }

    intervalRef.current = setInterval(() => {
      const r = latestReading.current;
      if (!r) return;

      const magnitude = Math.hypot(r.x, r.y, r.z);
      const baseline = baselineRef.current;
      const s = baseline.score(magnitude);

      // Score before insert
      if (baseline.isWarmedUp) {
        setStatus("live");
        const now = Date.now();
        if (s >= THRESHOLD && now - lastTripRef.current > COOLDOWN_MS) {
          lastTripRef.current = now;
          onEventRef.current({
            id: crypto.randomUUID(),
            channel: "emf",
            value: Math.round(magnitude * 100) / 100,
            unit: "uT",
            sigma: Math.round(s * 100) / 100,
            mean: Math.round(baseline.mean * 100) / 100,
            stddev: Math.round(baseline.stddev * 100) / 100,
            timestamp: now,
          });
        }
      }

      baseline.push(magnitude);
      setValue(Math.round(magnitude * 100) / 100);
      setSigma(Math.round(s * 100) / 100);
      setMean(Math.round(baseline.mean * 100) / 100);
      setStddev(Math.round(baseline.stddev * 100) / 100);

      historyRef.current = [...historyRef.current.slice(-(HISTORY_LEN - 1)), magnitude];
      setHistory(historyRef.current);
    }, 1000 / SAMPLE_HZ);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [active, status]);

  // Cleanup on unmount or stop
  useEffect(() => {
    if (!active && sensorRef.current) {
      sensorRef.current.stop();
      sensorRef.current = null;
      if (intervalRef.current) clearInterval(intervalRef.current);
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
    unit: "\u00B5T",
    sigma,
    mean,
    stddev,
    history,
    threshold: THRESHOLD,
    enable,
  };
}
