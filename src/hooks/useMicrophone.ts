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
// Robust-baseline σ floor, in dBFS. 2 dB was far too tight for audio: a quiet
// room's measured spread collapses below it, so every ordinary sound read as
// ~20σ above the floor and flooded the log. 7 dB means a trip needs a genuinely
// loud transient — with THRESHOLD=3 the effective trip point sits ~21 dB above
// the baseline room tone.
const MIN_SIGMA_DB = 7;

// Visual state updates throttled to ~5Hz (every 4th detection tick)
const VISUAL_EVERY = 4;

// Clip capture: keep ~3s of raw PCM before the event, plus ~2s after. We hold
// raw samples (not encoded chunks) so each clip is written as a self-contained
// WAV with its own header — MediaRecorder's WebM/Opus init header only lives in
// the FIRST chunk of the recording, so a clip assembled from later ring-buffer
// chunks is headerless and undecodable.
const PRE_ROLL_SEC = 3;
const POST_ROLL_SEC = 2;
const PCM_BLOCK = 4096; // ScriptProcessor buffer size (~85ms at 48kHz)

// Spectrogram: keep rolling window of 20 downsampled FFT frames
const SPEC_BINS = 32;
const SPEC_HISTORY = 20;

// Hard floor for dBFS. Full-scale is 0; true silence diverges toward -inf, so a
// near-zero instantaneous RMS would otherwise yield values like -537 dBFS that
// poison the detection score, the baseline, the readout, and the event value.
const DBFS_FLOOR = -100;

function rmsToDbfs(rms: number): number {
  if (rms <= 0) return DBFS_FLOOR;
  // Clamp to the valid range [DBFS_FLOOR, 0] at the moment of computation, before
  // the value is used anywhere downstream.
  return Math.max(DBFS_FLOOR, Math.min(0, 20 * Math.log10(rms)));
}

// Encode mono Float32 PCM blocks into a standalone 16-bit WAV. A WAV carries its
// full header + true duration, so the resulting file is decodable everywhere and
// its player renders correctly (no NaN/0 duration).
function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  let length = 0;
  for (const c of chunks) length += c.length;

  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono, 16-bit)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, length * 2, true);

  let offset = 44;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      const s = Math.max(-1, Math.min(1, c[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

interface PcmCapture {
  pre: Float32Array[]; // ring snapshot at trigger time (immutable blocks)
  post: Float32Array[]; // accumulates after the trigger
  postRemaining: number; // post-roll samples still to collect
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

  // Raw-PCM capture graph
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sinkRef = useRef<GainNode | null>(null);
  const sampleRateRef = useRef(48000);

  // Pre-roll PCM ring buffer (list of immutable sample blocks + running length)
  const pcmRingRef = useRef<Float32Array[]>([]);
  const pcmRingLenRef = useRef(0);
  // Active captures — an array so overlapping events each get their own clip.
  const capturesRef = useRef<PcmCapture[]>([]);

  // Spectrogram history
  const fftHistoryRef = useRef<number[][]>([]);

  const enable = useCallback(async () => {
    try {
      // Capture RAW room tone. The default speech DSP (noise suppression / AGC /
      // echo cancellation) gates a quiet room down to digital silence, so the
      // baseline collapses onto the dBFS clamp floor (-100) and every ordinary
      // sound reads as a huge deviation. Disabling it lets the baseline learn the
      // true, continuous ambient level so σ is meaningful. Browsers that ignore
      // these hints simply fall back to processed audio.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      sampleRateRef.current = ctx.sampleRate;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Raw-PCM tap for clip capture. ScriptProcessor is deprecated but is the
      // one path that works on Android Chrome AND iOS Safari without shipping a
      // separate AudioWorklet module. Route it through a muted gain node so it
      // stays live in the graph (onaudioprocess only fires when connected to the
      // destination) without feeding the mic back to the speakers.
      pcmRingRef.current = [];
      pcmRingLenRef.current = 0;
      capturesRef.current = [];
      const processor = ctx.createScriptProcessor(PCM_BLOCK, 1, 1);
      const preRollCap = Math.ceil(PRE_ROLL_SEC * ctx.sampleRate);
      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        // Copy — the audio thread reuses the input buffer after this returns.
        const block = new Float32Array(input.length);
        block.set(input);

        // Push into the pre-roll ring, dropping oldest blocks past ~PRE_ROLL_SEC.
        const ring = pcmRingRef.current;
        ring.push(block);
        pcmRingLenRef.current += block.length;
        while (ring.length > 1 && pcmRingLenRef.current - ring[0].length >= preRollCap) {
          pcmRingLenRef.current -= ring.shift()!.length;
        }

        // Feed every in-flight capture's post-roll; finalize the ones that filled.
        const caps = capturesRef.current;
        if (caps.length > 0) {
          const done: PcmCapture[] = [];
          for (const c of caps) {
            c.post.push(block);
            c.postRemaining -= block.length;
            if (c.postRemaining <= 0) done.push(c);
          }
          for (const c of done) {
            const wav = encodeWav([...c.pre, ...c.post], sampleRateRef.current);
            c.resolve({ url: URL.createObjectURL(wav), blob: wav });
          }
          if (done.length > 0) {
            capturesRef.current = caps.filter((c) => !done.includes(c));
          }
        }
      };
      const sink = ctx.createGain();
      sink.gain.value = 0;
      source.connect(processor);
      processor.connect(sink);
      sink.connect(ctx.destination);
      processorRef.current = processor;
      sinkRef.current = sink;

      setStatus("settling");
      baselineRef.current.reset();
    } catch {
      setStatus("blocked");
    }
  }, []);

  // Snapshot the pre-roll ring now, then collect POST_ROLL_SEC of PCM. Every call
  // registers its own capture, so events that overlap a prior capture still get a
  // clip (no more "some rows have a player, some don't").
  const triggerCapture = useCallback((): Promise<{ url: string; blob: Blob } | undefined> => {
    if (!processorRef.current) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      capturesRef.current.push({
        pre: pcmRingRef.current.slice(),
        post: [],
        postRemaining: Math.ceil(POST_ROLL_SEC * sampleRateRef.current),
        resolve,
      });
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
      if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current.onaudioprocess = null;
        processorRef.current = null;
      }
      if (sinkRef.current) {
        sinkRef.current.disconnect();
        sinkRef.current = null;
      }
      // Resolve any in-flight captures so their events still log (clip-less).
      capturesRef.current.forEach((c) => c.resolve(undefined));
      capturesRef.current = [];
      pcmRingRef.current = [];
      pcmRingLenRef.current = 0;
      ctxRef.current?.close();
      ctxRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      analyserRef.current = null;
      emaRef.current = null;
      historyRef.current = [];
      fftHistoryRef.current = [];
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
      if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current.onaudioprocess = null;
      }
      sinkRef.current?.disconnect();
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
