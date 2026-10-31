// Feature extraction for anomaly events. Pure functions only: every number is
// computed from recorded samples, so the same input always gives the same output.

import type { EventFeatures } from "../types";

export const BAND_EDGES_HZ = (() => {
  // 8 log-spaced bands between 50 Hz and 8 kHz → 9 edges.
  const lo = Math.log(50);
  const hi = Math.log(8000);
  return Array.from({ length: 9 }, (_, i) => Math.exp(lo + ((hi - lo) * i) / 8));
})();

/** In-place iterative radix-2 FFT. `re` and `im` must have a power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length || (n & (n - 1)) !== 0) throw new Error("fft: length must be a power of two");
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/**
 * Welch power spectrum: mean |FFT|² of Hann-windowed frames with 50% overlap.
 * Returns power per bin for bins 0..frameSize/2 (bin width = sampleRate/frameSize).
 */
export function welchPower(samples: Float32Array, frameSize = 2048): Float64Array {
  const half = frameSize / 2;
  const out = new Float64Array(half + 1);
  if (samples.length < frameSize) {
    // Zero-pad a short signal into one frame rather than refusing.
    const padded = new Float32Array(frameSize);
    padded.set(samples);
    samples = padded;
  }
  const win = new Float64Array(frameSize);
  for (let i = 0; i < frameSize; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameSize - 1));
  const re = new Float64Array(frameSize);
  const im = new Float64Array(frameSize);
  let frames = 0;
  for (let start = 0; start + frameSize <= samples.length; start += half) {
    for (let i = 0; i < frameSize; i++) {
      re[i] = samples[start + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k <= half; k++) out[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  for (let k = 0; k <= half; k++) out[k] /= frames;
  return out;
}

const dB = (p: number) => 10 * Math.log10(Math.max(p, 1e-20));

/** Spectral features of a power spectrum. Ignores DC and anything below 20 Hz. */
export function spectralFeatures(power: Float64Array, sampleRate: number, frameSize: number) {
  const binHz = sampleRate / frameSize;
  const minBin = Math.max(1, Math.ceil(20 / binHz));
  const maxBin = Math.min(power.length - 1, Math.floor(Math.min(sampleRate / 2, 16000) / binHz));

  let peakBin = minBin;
  let total = 0;
  let weighted = 0;
  let logSum = 0;
  let count = 0;
  for (let k = minBin; k <= maxBin; k++) {
    const p = power[k];
    if (p > power[peakBin]) peakBin = k;
    total += p;
    weighted += p * k * binHz;
    logSum += Math.log(Math.max(p, 1e-20));
    count++;
  }
  const mean = total / Math.max(count, 1);
  const geo = Math.exp(logSum / Math.max(count, 1));

  const bandDb = BAND_EDGES_HZ.slice(0, -1).map((lo, i) => {
    const hi = BAND_EDGES_HZ[i + 1];
    const a = Math.max(minBin, Math.ceil(lo / binHz));
    const b = Math.min(maxBin, Math.floor(hi / binHz));
    if (b < a) {
      // Band narrower than one bin: take the bin containing its centre.
      const k = Math.min(maxBin, Math.max(minBin, Math.round(Math.sqrt(lo * hi) / binHz)));
      return round1(dB(power[k]));
    }
    let s = 0;
    for (let k = a; k <= b; k++) s += power[k];
    return round1(dB(s / (b - a + 1)));
  });

  return {
    dominantFreqHz: Math.round(peakBin * binHz),
    spectralCentroidHz: total > 0 ? Math.round(weighted / total) : 0,
    spectralFlatness: mean > 0 ? round3(geo / mean) : 0,
    bandDb,
  };
}

export function zeroCrossingRate(samples: Float32Array): number {
  if (samples.length < 2) return 0;
  let z = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i - 1] >= 0) !== (samples[i] >= 0)) z++;
  }
  return round3(z / (samples.length - 1));
}

/**
 * RMS envelope in dBFS, one value per `hopMs` frame.
 */
export function rmsEnvelopeDb(samples: Float32Array, sampleRate: number, hopMs = 10): number[] {
  const hop = Math.max(1, Math.round((sampleRate * hopMs) / 1000));
  const env: number[] = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let s = 0;
    for (let j = i; j < i + hop; j++) s += samples[j] * samples[j];
    const rms = Math.sqrt(s / hop);
    env.push(rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100);
  }
  return env;
}

/**
 * Duration and rise time of the above-level run containing the peak nearest
 * `anchorIndex`. Works on any evenly sampled series (envelope, sigma score…).
 */
export function runAroundPeak(
  series: ArrayLike<number>,
  level: number,
  stepMs: number,
  anchorIndex: number,
  searchRadius: number
): { durationMs: number; riseTimeMs: number; peakIndex: number; peak: number } | null {
  const n = series.length;
  if (n === 0) return null;
  const lo = Math.max(0, anchorIndex - searchRadius);
  const hi = Math.min(n - 1, anchorIndex + searchRadius);
  let peakIndex = -1;
  for (let i = lo; i <= hi; i++) {
    const v = series[i];
    if (!Number.isFinite(v)) continue;
    if (peakIndex < 0 || v > series[peakIndex]) peakIndex = i;
  }
  if (peakIndex < 0 || !(series[peakIndex] >= level)) return null;
  let start = peakIndex;
  while (start > 0 && series[start - 1] >= level) start--;
  let end = peakIndex;
  while (end < n - 1 && series[end + 1] >= level) end++;
  return {
    durationMs: (end - start + 1) * stepMs,
    riseTimeMs: (peakIndex - start) * stepMs,
    peakIndex,
    peak: series[peakIndex],
  };
}

/**
 * Sound features from an event's PCM clip. `onsetSample` is where the trigger
 * happened inside the clip (end of the pre-roll). `tripDbfs` is the level the
 * detector needed to trip (baseline mean + threshold × σ).
 */
export function soundFeatures(
  clip: Float32Array,
  sampleRate: number,
  onsetSample: number,
  tripDbfs: number,
  peakSigma: number
): EventFeatures {
  const frameSize = 2048;
  // Analyse a window from 100 ms before the trigger to 400 ms after.
  const a = Math.max(0, onsetSample - Math.round(0.1 * sampleRate));
  const b = Math.min(clip.length, onsetSample + Math.round(0.4 * sampleRate));
  // Remove any DC offset first: many mics sit slightly off zero, which would
  // otherwise leak into the lowest bins and wipe out zero crossings.
  const raw = clip.subarray(a, Math.max(b, a + 1));
  let dc = 0;
  for (let i = 0; i < raw.length; i++) dc += raw[i];
  dc /= raw.length;
  const seg = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) seg[i] = raw[i] - dc;
  const power = welchPower(seg, frameSize);
  const spec = spectralFeatures(power, sampleRate, frameSize);

  const hopMs = 10;
  const env = rmsEnvelopeDb(clip, sampleRate, hopMs);
  const anchor = Math.round((onsetSample / sampleRate) * (1000 / hopMs));
  const run = runAroundPeak(env, tripDbfs, hopMs, anchor, 30);
  let peakDbfs = -100;
  for (let i = Math.max(0, anchor - 30); i < Math.min(env.length, anchor + 30); i++) peakDbfs = Math.max(peakDbfs, env[i]);

  return {
    peakSigma: round2(peakSigma),
    peakDbfs: round1(peakDbfs),
    durationMs: run?.durationMs,
    riseTimeMs: run?.riseTimeMs,
    ...spec,
    zeroCrossingRate: zeroCrossingRate(seg),
  };
}

/**
 * Motion / EMF axis features: each axis's deviation at the trigger from the
 * median of its own recent samples.
 */
export function axisFeatures(
  recent: Array<[number, number, number]>,
  current: [number, number, number],
  peakSigma: number,
  rotPeak?: number
): EventFeatures {
  const med = [0, 1, 2].map((ax) => {
    const v = recent.map((r) => r[ax]).sort((p, q) => p - q);
    if (v.length === 0) return current[ax];
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  });
  const dev: [number, number, number] = [
    round3(Math.abs(current[0] - med[0])),
    round3(Math.abs(current[1] - med[1])),
    round3(Math.abs(current[2] - med[2])),
  ];
  const i = dev[0] >= dev[1] && dev[0] >= dev[2] ? 0 : dev[1] >= dev[2] ? 1 : 2;
  return {
    peakSigma: round2(peakSigma),
    axisDev: dev,
    dominantAxis: (["x", "y", "z"] as const)[i],
    ...(rotPeak !== undefined ? { rotPeak: round2(rotPeak) } : {}),
  };
}

function round1(n: number) { return Math.round(n * 10) / 10; }
function round2(n: number) { return Math.round(n * 100) / 100; }
function round3(n: number) { return Math.round(n * 1000) / 1000; }
