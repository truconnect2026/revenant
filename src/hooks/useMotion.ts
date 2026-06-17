"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RollingBaseline } from "@/lib/anomaly";
import { AnomalyEvent, SensorReading, SensorStatus } from "@/lib/types";

const SAMPLE_HZ = 20;
const WINDOW_SIZE = 200;
const WARMUP = 60;
const THRESHOLD = 4.5;
const COOLDOWN_MS = 1500;
const HISTORY_LEN = 80;
const POST_TRIP_SKIP = 5;

export function useMotion(
  active: boolean,
  onEvent: (e: AnomalyEvent) => void
): SensorReading & { enable: () => Promise<void>; recalibrate: () => void } {
  const [status, setStatus] = useState<SensorStatus>("standby");
  const [value, setValue] = useState<number | null>(null);
  const [secondaryValue, setSecondaryValue] = useState<number | null>(null);
  const [sigma, setSigma] = useState(0);
  const [mean, setMean] = useState(0);
  const [stddev, setStddev] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [warmupProgress, setWarmupProgress] = useState(0);

  const baselineRef = useRef(new RollingBaseline(WINDOW_SIZE, WARMUP));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTripRef = useRef(0);
  const skipCountRef = useRef(0);
  const historyRef = useRef<number[]>([]);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const latestAccel = useRef<{ x: number; y: number; z: number } | null>(null);
  const latestRotation = useRef<{ alpha: number; beta: number; gamma: number } | null>(null);
  const listenerRef = useRef<((e: DeviceMotionEvent) => void) | null>(null);

  const enable = useCallback(async () => {
    const dme = DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    if (dme.requestPermission) {
      try {
        const result = await dme.requestPermission();
        if (result !== "granted") {
          setStatus("blocked");
          return;
        }
      } catch {
        setStatus("blocked");
        return;
      }
    }

    const handler = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (a) latestAccel.current = { x: a.x ?? 0, y: a.y ?? 0, z: a.z ?? 0 };
      const r = e.rotationRate;
      if (r) latestRotation.current = { alpha: r.alpha ?? 0, beta: r.beta ?? 0, gamma: r.gamma ?? 0 };
    };
    window.addEventListener("devicemotion", handler);
    listenerRef.current = handler;
    setStatus("settling");
    baselineRef.current.reset();
  }, []);

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
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

      const a = latestAccel.current;
      if (!a) return;

      const accelMag = Math.hypot(a.x, a.y, a.z);
      const baseline = baselineRef.current;
      const s = baseline.score(accelMag);

      const rot = latestRotation.current;
      const rotMag = rot ? Math.hypot(rot.alpha, rot.beta, rot.gamma) : 0;

      if (baseline.isWarmedUp) {
        setStatus("live");
        const now = Date.now();
        if (s >= THRESHOLD && now - lastTripRef.current > COOLDOWN_MS) {
          lastTripRef.current = now;
          skipCountRef.current = POST_TRIP_SKIP;
          onEventRef.current({
            id: crypto.randomUUID(),
            channel: "motion",
            value: Math.round(accelMag * 100) / 100,
            unit: "m/s²",
            sigma: Math.round(s * 100) / 100,
            mean: Math.round(baseline.mean * 100) / 100,
            stddev: Math.round(baseline.stddev * 100) / 100,
            timestamp: now,
          });
        }
      }

      if (skipCountRef.current > 0) {
        skipCountRef.current--;
      } else {
        baseline.push(accelMag);
      }

      setValue(Math.round(accelMag * 100) / 100);
      setSecondaryValue(Math.round(rotMag * 10) / 10);
      setSigma(Math.round(s * 100) / 100);
      setMean(Math.round(baseline.mean * 100) / 100);
      setStddev(Math.round(baseline.stddev * 100) / 100);
      setWarmupProgress(baseline.isWarmedUp ? 1 : Math.min(baseline.sampleCount / WARMUP, 1));

      historyRef.current = [...historyRef.current.slice(-(HISTORY_LEN - 1)), accelMag];
      setHistory(historyRef.current);
    }, 1000 / SAMPLE_HZ);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [active, status]);

  // Stop + reset all state on session end
  useEffect(() => {
    if (!active) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (listenerRef.current) {
        window.removeEventListener("devicemotion", listenerRef.current);
        listenerRef.current = null;
      }
      latestAccel.current = null;
      latestRotation.current = null;
      historyRef.current = [];
      skipCountRef.current = 0;
      baselineRef.current.reset();
      setValue(null);
      setSecondaryValue(null);
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
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (listenerRef.current) {
        window.removeEventListener("devicemotion", listenerRef.current);
      }
    };
  }, []);

  return {
    status,
    value,
    secondaryValue,
    unit: "m/s²",
    secondaryUnit: "°/s",
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
