"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RollingBaseline } from "@/lib/anomaly";
import { AnomalyEvent, SensorReading, SensorStatus, SentryLevel, SentryPhase } from "@/lib/types";

const SAMPLE_HZ = 20;
const WINDOW_SIZE = 200;
const WARMUP = 60;
const THRESHOLD = 4.5;
const COOLDOWN_MS = 1500;
const HISTORY_LEN = 80;
const POST_TRIP_SKIP = 5;
const VISUAL_EVERY = 4; // throttle visual setState to ~5Hz
// Accel-magnitude σ floor in m/s². A resting phone has near-zero variance, so
// without this any micro-vibration divides by ~0 and explodes into thousands of
// sigma. 0.5 ignores normal handheld jitter / sensor noise (~0.1–0.3 m/s²); with
// THRESHOLD=4.5 the effective trip point is ~2.25 m/s² of deviation — clear of
// resting noise but reached by a deliberate tap/bump.
const MIN_SIGMA = 0.5;

// ── Sentry Mode ─────────────────────────────────────────────────────────────
// A separate, far more sensitive armed watch. It runs ONLY while armed and fully
// supersedes the normal path; disarming restores normal detection untouched.
//
// Safety against the still-phone σ-collapse: both baselines are robust
// (median + MAD, which ignores the transients we detect) AND floored. Because a
// trip needs score = |dev| / max(MAD-σ, floor) ≥ threshold, and the floor sits
// well ABOVE a resting phone's true noise (~0.01–0.02 m/s²), noise samples score
// a fraction of 1 — a still phone can't trip. A genuine bump/footstep/touch
// clears the floor's absolute trip point (threshold × floor) below.
const SENTRY_THRESHOLDS: Record<SentryLevel, number> = { low: 4.5, med: 3.2, high: 2.2 };
const SENTRY_ACCEL_MIN_SIGMA = 0.06; // m/s² — ~3–6× a resting phone's accel noise
const SENTRY_ROT_MIN_SIGMA = 0.8;    // °/s — ~a resting phone's gyro noise, floored high
const SENTRY_WARMUP = 40;            // ~2s to learn the resting baseline
const SENTRY_SETTLE_MS = 2500;       // no trips for this long after arming
const SENTRY_COOLDOWN_MS = 4000;     // re-arm delay after a trip (no log spam)
const SENTRY_TRIGGER_MS = 2000;      // how long the TRIGGERED state shows
const SENTRY_POST_TRIP_SKIP = 8;     // samples kept out of the baseline after a trip

const round2 = (n: number) => Math.round(n * 100) / 100;

export function useMotion(
  active: boolean,
  onEvent: (e: AnomalyEvent, blob?: Blob) => void,
  sentryArmed = false,
  sentryLevel: SentryLevel = "med"
): SensorReading & { enable: () => Promise<void>; recalibrate: () => void; sentryPhase: SentryPhase } {
  const [status, setStatus] = useState<SensorStatus>("standby");
  const [value, setValue] = useState<number | null>(null);
  const [secondaryValue, setSecondaryValue] = useState<number | null>(null);
  const [sigma, setSigma] = useState(0);
  const [mean, setMean] = useState(0);
  const [stddev, setStddev] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [warmupProgress, setWarmupProgress] = useState(0);
  const [sentryPhase, setSentryPhase] = useState<SentryPhase>("off");

  const baselineRef = useRef(new RollingBaseline(WINDOW_SIZE, WARMUP, { minSigma: MIN_SIGMA }));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTripRef = useRef(0);
  const skipCountRef = useRef(0);
  const visualTickRef = useRef(0);
  const historyRef = useRef<number[]>([]);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // Sentry state — separate robust baselines so it never disturbs normal tuning.
  const sentryAccelRef = useRef(new RollingBaseline(WINDOW_SIZE, SENTRY_WARMUP, { robust: true, minSigma: SENTRY_ACCEL_MIN_SIGMA }));
  const sentryRotRef = useRef(new RollingBaseline(WINDOW_SIZE, SENTRY_WARMUP, { robust: true, minSigma: SENTRY_ROT_MIN_SIGMA }));
  const armedSinceRef = useRef(0);
  const lastSentryTripRef = useRef(0);
  const sentrySkipRef = useRef(0);
  const sentryPhaseRef = useRef<SentryPhase>("off");
  const sentryArmedRef = useRef(sentryArmed);
  sentryArmedRef.current = sentryArmed;
  const sentryLevelRef = useRef(sentryLevel);
  sentryLevelRef.current = sentryLevel;

  const latestAccel = useRef<{ x: number; y: number; z: number } | null>(null);
  const latestRotation = useRef<{ alpha: number; beta: number; gamma: number } | null>(null);
  const listenerRef = useRef<((e: DeviceMotionEvent) => void) | null>(null);

  const setPhase = useCallback((p: SentryPhase) => {
    if (sentryPhaseRef.current !== p) {
      sentryPhaseRef.current = p;
      setSentryPhase(p);
    }
  }, []);

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
    visualTickRef.current = 0;
    baselineRef.current.reset();
    sentryAccelRef.current.reset();
    sentryRotRef.current.reset();
    armedSinceRef.current = Date.now();
    setHistory([]);
    setSigma(0);
    setMean(0);
    setStddev(0);
    setWarmupProgress(0);
    setStatus("settling");
  }, []);

  // Arm/disarm transition: reset the sentry baselines (learn THIS placement) and
  // start the settle window; on disarm, reset the normal baseline so it re-warms
  // clean before resuming normal detection.
  useEffect(() => {
    if (!active) return;
    if (sentryArmed) {
      sentryAccelRef.current.reset();
      sentryRotRef.current.reset();
      armedSinceRef.current = Date.now();
      lastSentryTripRef.current = 0;
      sentrySkipRef.current = 0;
      setPhase("arming");
      setStatus("settling");
    } else {
      baselineRef.current.reset();
      setPhase("off");
      setStatus("settling");
    }
  }, [sentryArmed, active, setPhase]);

  useEffect(() => {
    if (!active || status === "standby" || status === "no-channel" || status === "blocked") {
      return;
    }

    intervalRef.current = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

      const a = latestAccel.current;
      if (!a) return;

      const accelMag = Math.hypot(a.x, a.y, a.z);
      const rot = latestRotation.current;
      const rotMag = rot ? Math.hypot(rot.alpha, rot.beta, rot.gamma) : 0;
      const now = Date.now();

      let displayScore: number;
      let dispBaseline: RollingBaseline;

      if (sentryArmedRef.current) {
        // ── Sentry path ──────────────────────────────────────────────────────
        const sa = sentryAccelRef.current;
        const sr = sentryRotRef.current;
        const aScore = sa.score(accelMag);
        const rScore = sr.score(rotMag);
        const sScore = Math.max(aScore, rScore);
        const threshold = SENTRY_THRESHOLDS[sentryLevelRef.current];
        const warmed = sa.isWarmedUp && sr.isWarmedUp;
        const settled = warmed && now - armedSinceRef.current >= SENTRY_SETTLE_MS;

        if (warmed && status !== "live") setStatus("live");

        if (settled && sScore >= threshold && now - lastSentryTripRef.current > SENTRY_COOLDOWN_MS) {
          lastSentryTripRef.current = now;
          sentrySkipRef.current = SENTRY_POST_TRIP_SKIP;
          const rotDom = rScore > aScore;
          onEventRef.current({
            id: crypto.randomUUID(),
            channel: "motion",
            value: rotDom ? round2(rotMag) : round2(accelMag),
            unit: rotDom ? "°/s" : "m/s²",
            sigma: round2(sScore),
            mean: rotDom ? round2(sr.mean) : round2(sa.mean),
            stddev: rotDom ? round2(sr.stddev) : round2(sa.stddev),
            timestamp: now,
          });
        }

        // Learn the resting baseline, excluding post-trip transients.
        if (sentrySkipRef.current > 0) {
          sentrySkipRef.current--;
        } else {
          sa.push(accelMag);
          sr.push(rotMag);
        }

        setPhase(
          !settled
            ? "arming"
            : now - lastSentryTripRef.current < SENTRY_TRIGGER_MS
            ? "triggered"
            : "armed"
        );

        displayScore = sScore;
        dispBaseline = sa;
      } else {
        // ── Normal path (unchanged) ──────────────────────────────────────────
        const baseline = baselineRef.current;
        const s = baseline.score(accelMag);

        if (baseline.isWarmedUp && status !== "live") setStatus("live");

        if (baseline.isWarmedUp && s >= THRESHOLD && now - lastTripRef.current > COOLDOWN_MS) {
          lastTripRef.current = now;
          skipCountRef.current = POST_TRIP_SKIP;
          onEventRef.current({
            id: crypto.randomUUID(),
            channel: "motion",
            value: round2(accelMag),
            unit: "m/s²",
            sigma: round2(s),
            mean: round2(baseline.mean),
            stddev: round2(baseline.stddev),
            timestamp: now,
          });
        }

        if (skipCountRef.current > 0) {
          skipCountRef.current--;
        } else {
          baseline.push(accelMag);
        }

        if (sentryPhaseRef.current !== "off") setPhase("off");
        displayScore = s;
        dispBaseline = baseline;
      }

      historyRef.current = [...historyRef.current.slice(-(HISTORY_LEN - 1)), accelMag];

      visualTickRef.current++;
      if (visualTickRef.current >= VISUAL_EVERY) {
        visualTickRef.current = 0;
        const warmupN = sentryArmedRef.current ? SENTRY_WARMUP : WARMUP;
        setValue(round2(accelMag));
        setSecondaryValue(Math.round(rotMag * 10) / 10);
        setSigma(round2(displayScore));
        setMean(round2(dispBaseline.mean));
        setStddev(round2(dispBaseline.stddev));
        setWarmupProgress(dispBaseline.isWarmedUp ? 1 : Math.min(dispBaseline.sampleCount / warmupN, 1));
        setHistory(historyRef.current.slice());
      }
    }, 1000 / SAMPLE_HZ);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [active, status, setPhase]);

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
      sentrySkipRef.current = 0;
      visualTickRef.current = 0;
      baselineRef.current.reset();
      sentryAccelRef.current.reset();
      sentryRotRef.current.reset();
      setPhase("off");
      setValue(null);
      setSecondaryValue(null);
      setSigma(0);
      setMean(0);
      setStddev(0);
      setHistory([]);
      setWarmupProgress(0);
      setStatus("standby");
    }
  }, [active, setPhase]);

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
    threshold: sentryArmed ? SENTRY_THRESHOLDS[sentryLevel] : THRESHOLD,
    warmupProgress,
    enable,
    recalibrate,
    sentryPhase,
  };
}
