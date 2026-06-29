"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RollingBaseline } from "@/lib/anomaly";
import { AnomalyEvent, SensorReading, SensorStatus } from "@/lib/types";

const SAMPLE_HZ = 20;
const WINDOW_SIZE = 200;
const WARMUP = 60;
const THRESHOLD = 3;
const EMA_ALPHA = 0.3;
// Skip 15 samples (~750ms) after a trip so the clap's body and reverb tail
// never get learned into the baseline. Half the cooldown, so the floor still
// adapts to genuine ambient drift between events.
const POST_TRIP_SKIP = 15;
const COOLDOWN_MS = 1500;
const HISTORY_LEN = 80;
const FFT_SIZE = 256;
// Robust-baseline σ floor, in dBFS. Stops the quiet floor from collapsing to a
// hair-trigger in a dead-silent room; with THRESHOLD=3 the effective trip point
// sits ~6 dB above the median floor when the room is silent.
const MIN_SIGMA_DB = 2;

// Visual state updates throttled to ~5Hz (every 4th detection tick)
const VISUAL_EVERY = 4;

// Pre-roll: 30 chunks × 100ms = 3s before the anomaly
// Post-roll: 20 chunks × 100ms = 2s after the anomaly
const CHUNK_MS = 100;
const PRE_ROLL_CHUNKS = 30;
const POST_ROLL_CHUNKS = 20;

// Spectrogram: keep rolling window of 20 downsampled FFT frames
const SPEC_BINS = 32;
const SPEC_HISTORY = 20;

function rmsToDbfs(rms: number): number {
  if (rms <= 0) return -100;
  return 20 * Math.log10(rms);
}

interface CaptureState {
  pre: Blob[];
  post: Blob[];
  remaining: number;
  resolve: (result: { url: string; blob: Blob } | undefined) => void;
}

export function useMicrophone(
  active: boolean,
  onEvent: (e: AnomalyEvent, blob?: Blob) => void
): SensorReading & { enable: () => Promise<void>; recalibrate: () => void } {
  const [status, setStatus] = useState<SensorStatus>("standby");
  const [value, setValue] = useState<number | null>(null);
  const [sigma, setSigma] = useState(0);
  const [mean, setMean] = useState(0);
  const [stddev, setStddev] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [spectrum, setSpectrum] = useState<number[]>([]);
  const [warmupProgress, setWarmupProgress] = useState(0);

  const baselineRef = useRef(
    new RollingBaseline(WINDOW_SIZE, WARMUP, { robust: true, minSigma: MIN_SIGMA_DB })
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTripRef = useRef(0);
  const skipCountRef = useRef(0);
  const historyRef = useRef<number[]>([]);
  const emaRef = useRef<number | null>(null);
  const visualTickRef = useRef(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  // Pre-roll circular buffer
  const preRollRef = useRef<Blob[]>([]);
  const captureRef = useRef<CaptureState | null>(null);

  // Spectrogram history
  const fftHistoryRef = useRef<number[][]>([]);

  // Preferred MIME type, detected once
  const mimeRef = useRef<string>("");

  const enable = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Pick MIME type once
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
      mimeRef.current = mime;

      // Continuous pre-roll recorder
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      rec.ondataavailable = (e) => {
        if (e.data.size === 0) return;

        // Always update pre-roll ring buffer
        preRollRef.current.push(e.data);
        if (preRollRef.current.length > PRE_ROLL_CHUNKS) {
          preRollRef.current.shift();
        }

        // Collect post-roll chunks for active capture
        const cap = captureRef.current;
        if (cap) {
          cap.post.push(e.data);
          cap.remaining--;
          if (cap.remaining <= 0) {
            const allChunks = [...cap.pre, ...cap.post];
            const blob = new Blob(allChunks, { type: mime || "audio/webm" });
            cap.resolve({ url: URL.createObjectURL(blob), blob });
            captureRef.current = null;
          }
        }
      };
      rec.start(CHUNK_MS);
      recorderRef.current = rec;

      setStatus("settling");
      baselineRef.current.reset();
    } catch {
      setStatus("blocked");
    }
  }, []);

  // Snapshot pre-roll + collect 2s post-roll
  const triggerCapture = useCallback((): Promise<{ url: string; blob: Blob } | undefined> => {
    if (captureRef.current) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      captureRef.current = {
        pre: [...preRollRef.current],
        post: [],
        remaining: POST_ROLL_CHUNKS,
        resolve,
      };
    });
  }, []);

  const recalibrate = useCallback(() => {
    historyRef.current = [];
    skipCountRef.current = 0;
    emaRef.current = null;
    visualTickRef.current = 0;
    fftHistoryRef.current = [];
    baselineRef.current.reset();
    setHistory([]);
    setSpectrum([]);
    setSigma(0);
    setMean(0);
    setStddev(0);
    setWarmupProgress(0);
    setStatus("settling");
  }, []);

  // Suspend/resume AudioContext on page backgrounding
  useEffect(() => {
    if (!active) return;
    const handleVisibility = () => {
      if (!ctxRef.current) return;
      if (document.visibilityState === "hidden") {
        ctxRef.current.suspend().catch(() => {});
      } else {
        ctxRef.current.resume().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [active]);

  // Detection interval — 20Hz
  useEffect(() => {
    if (!active || status === "standby" || status === "no-channel" || status === "blocked") {
      return;
    }

    const timeDomain = new Float32Array(FFT_SIZE);
    const freqData = new Uint8Array(FFT_SIZE / 2);
    const step = Math.floor(freqData.length / SPEC_BINS);

    intervalRef.current = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

      const analyser = analyserRef.current;
      if (!analyser) return;

      analyser.getFloatTimeDomainData(timeDomain);
      analyser.getByteFrequencyData(freqData);

      // RMS → dBFS (instantaneous — this is what detection scores against, so a
      // sharp clap keeps its full amplitude instead of being averaged away).
      let sumSq = 0;
      for (let i = 0; i < timeDomain.length; i++) sumSq += timeDomain[i] * timeDomain[i];
      const rawDbfs = rmsToDbfs(Math.sqrt(sumSq / timeDomain.length));

      // EMA smoothing (~150ms time constant). The smoothed value feeds the
      // baseline only — it tracks the slow ambient floor without chasing spikes.
      if (emaRef.current === null) emaRef.current = rawDbfs;
      emaRef.current = EMA_ALPHA * rawDbfs + (1 - EMA_ALPHA) * emaRef.current;
      const dbfs = emaRef.current;

      // Rolling spectrogram frame (downsampled)
      const specFrame = Array.from({ length: SPEC_BINS }, (_, i) => {
        let sum = 0;
        for (let j = i * step; j < (i + 1) * step; j++) sum += freqData[j] ?? 0;
        return (sum / step) / 255;
      });
      fftHistoryRef.current.push(specFrame);
      if (fftHistoryRef.current.length > SPEC_HISTORY) fftHistoryRef.current.shift();

      const baseline = baselineRef.current;
      // Detect on the instantaneous dBFS; the robust median/MAD baseline keeps σ
      // tied to the quiet floor so a clap reads as the many-σ event it is.
      const s = baseline.score(rawDbfs);

      // Status transition (immediate — not throttled)
      if (baseline.isWarmedUp && status !== "live") {
        setStatus("live");
      }

      if (baseline.isWarmedUp) {
        const now = Date.now();
        if (s >= THRESHOLD && now - lastTripRef.current > COOLDOWN_MS) {
          lastTripRef.current = now;
          skipCountRef.current = POST_TRIP_SKIP;
          const specSnap = fftHistoryRef.current.slice();
          const eventBase: AnomalyEvent = {
            id: crypto.randomUUID(),
            channel: "sound",
            value: Math.round(rawDbfs * 10) / 10,
            unit: "dBFS",
            sigma: Math.round(s * 100) / 100,
            mean: Math.round(baseline.mean * 10) / 10,
            stddev: Math.round(baseline.stddev * 10) / 10,
            timestamp: now,
            spectrogram: specSnap,
          };
          triggerCapture().then((result) => {
            onEventRef.current(
              { ...eventBase, clipUrl: result?.url },
              result?.blob
            );
          });
        }
      }

      // Baseline learns the SMOOTHED floor, and only while not in a post-trip
      // skip window — so the transients we just tripped on can't inflate σ.
      if (skipCountRef.current > 0) {
        skipCountRef.current--;
      } else {
        baseline.push(dbfs);
      }

      historyRef.current = [...historyRef.current.slice(-(HISTORY_LEN - 1)), rawDbfs];

      // Throttle visual React state to ~5Hz
      visualTickRef.current++;
      if (visualTickRef.current >= VISUAL_EVERY) {
        visualTickRef.current = 0;
        setValue(Math.round(rawDbfs * 10) / 10);
        setSigma(Math.round(s * 100) / 100);
        setMean(Math.round(baseline.mean * 10) / 10);
        setStddev(Math.round(baseline.stddev * 10) / 10);
        setWarmupProgress(baseline.isWarmedUp ? 1 : Math.min(baseline.sampleCount / WARMUP, 1));
        setHistory(historyRef.current.slice());
        setSpectrum(Array.from(freqData).map((v) => v / 255));
      }
    }, 1000 / SAMPLE_HZ);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [active, status, triggerCapture]);

  // Stop + full reset on session end
  useEffect(() => {
    if (!active) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      recorderRef.current = null;
      ctxRef.current?.close();
      ctxRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      analyserRef.current = null;
      emaRef.current = null;
      historyRef.current = [];
      fftHistoryRef.current = [];
      preRollRef.current = [];
      captureRef.current = null;
      skipCountRef.current = 0;
      visualTickRef.current = 0;
      baselineRef.current.reset();
      setValue(null);
      setSigma(0);
      setMean(0);
      setStddev(0);
      setHistory([]);
      setSpectrum([]);
      setWarmupProgress(0);
      setStatus("standby");
    }
  }, [active]);

  // Unmount cleanup
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      ctxRef.current?.close();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return {
    status,
    value,
    unit: "dBFS",
    sigma,
    mean,
    stddev,
    history,
    spectrum,
    threshold: THRESHOLD,
    warmupProgress,
    enable,
    recalibrate,
  };
}
