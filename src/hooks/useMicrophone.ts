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
const FFT_SIZE = 256;
const CLIP_DURATION_MS = 3000;

function rmsToDbfs(rms: number): number {
  if (rms <= 0) return -100;
  return 20 * Math.log10(rms);
}

export function useMicrophone(
  active: boolean,
  onEvent: (e: AnomalyEvent) => void
): SensorReading & { enable: () => Promise<void> } {
  const [status, setStatus] = useState<SensorStatus>("standby");
  const [value, setValue] = useState<number | null>(null);
  const [sigma, setSigma] = useState(0);
  const [mean, setMean] = useState(0);
  const [stddev, setStddev] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [spectrum, setSpectrum] = useState<number[]>([]);

  const baselineRef = useRef(new RollingBaseline(WINDOW_SIZE, WARMUP));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTripRef = useRef(0);
  const historyRef = useRef<number[]>([]);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingRef = useRef(false);

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
      setStatus("settling");
      baselineRef.current.reset();
    } catch {
      setStatus("blocked");
    }
  }, []);

  const recordClip = useCallback((): Promise<string | undefined> => {
    const stream = streamRef.current;
    if (!stream || recordingRef.current) return Promise.resolve(undefined);
    recordingRef.current = true;

    return new Promise((resolve) => {
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
      recorderRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      rec.onstop = () => {
        recordingRef.current = false;
        recorderRef.current = null;
        if (chunks.length > 0) {
          const blob = new Blob(chunks, { type: "audio/webm" });
          resolve(URL.createObjectURL(blob));
        } else {
          resolve(undefined);
        }
      };
      rec.start();
      setTimeout(() => {
        if (rec.state === "recording") rec.stop();
      }, CLIP_DURATION_MS);
    });
  }, []);

  // Sampling interval
  useEffect(() => {
    if (!active || status === "standby" || status === "no-channel" || status === "blocked") {
      return;
    }

    const timeDomain = new Float32Array(FFT_SIZE);
    const freqData = new Uint8Array(FFT_SIZE / 2);

    intervalRef.current = setInterval(() => {
      const analyser = analyserRef.current;
      if (!analyser) return;

      analyser.getFloatTimeDomainData(timeDomain);
      analyser.getByteFrequencyData(freqData);

      // RMS
      let sumSq = 0;
      for (let i = 0; i < timeDomain.length; i++) {
        sumSq += timeDomain[i] * timeDomain[i];
      }
      const rms = Math.sqrt(sumSq / timeDomain.length);
      const dbfs = rmsToDbfs(rms);

      const baseline = baselineRef.current;
      const s = baseline.score(dbfs);

      if (baseline.isWarmedUp) {
        setStatus("live");
        const now = Date.now();
        if (s >= THRESHOLD && now - lastTripRef.current > COOLDOWN_MS) {
          lastTripRef.current = now;
          // Fire event, record clip in background
          const eventBase = {
            id: crypto.randomUUID(),
            channel: "sound" as const,
            value: Math.round(dbfs * 10) / 10,
            unit: "dBFS",
            sigma: Math.round(s * 100) / 100,
            mean: Math.round(baseline.mean * 10) / 10,
            stddev: Math.round(baseline.stddev * 10) / 10,
            timestamp: now,
          };
          recordClip().then((clipUrl) => {
            onEventRef.current({ ...eventBase, clipUrl });
          });
        }
      }

      baseline.push(dbfs);
      setValue(Math.round(dbfs * 10) / 10);
      setSigma(Math.round(s * 100) / 100);
      setMean(Math.round(baseline.mean * 10) / 10);
      setStddev(Math.round(baseline.stddev * 10) / 10);

      historyRef.current = [...historyRef.current.slice(-(HISTORY_LEN - 1)), dbfs];
      setHistory(historyRef.current);

      // Spectrum: normalize 0-255 to 0-1
      setSpectrum(Array.from(freqData).map((v) => v / 255));
    }, 1000 / SAMPLE_HZ);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [active, status, recordClip]);

  // Cleanup
  useEffect(() => {
    if (!active) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      ctxRef.current?.close();
      ctxRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      analyserRef.current = null;
      setStatus("standby");
    }
  }, [active]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
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
    enable,
  };
}
