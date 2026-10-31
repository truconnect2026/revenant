// Threshold sweep: replay the logged σ scores at many thresholds to see the
// trade-off between catching known stimuli and tripping on nothing (null
// sessions). Mimics the live detector's cooldown so counts are comparable.

import { SCORE_HZ, observedHours } from "./scoreLog";
import { poissonCI, wilson, type Interval } from "./stats";

export const COOLDOWN_SLOTS = Math.round(1.5 * SCORE_HZ); // matches live 1.5 s cooldown
/** Window around a stimulus tap in which a detection counts (s before, s after). */
export const STIMULUS_WINDOW_S: [number, number] = [-2, 4];

/** Number of trips the detector would make at `threshold` (with cooldown). */
export function countTrips(scores: ArrayLike<number>, threshold: number, cooldown = COOLDOWN_SLOTS): number {
  let n = 0;
  let last = -Infinity;
  for (let i = 0; i < scores.length; i++) {
    const s = scores[i];
    if (s >= threshold && i - last > cooldown) {
      n++;
      last = i;
    }
  }
  return n;
}

/** Highest score inside the stimulus window, or NaN if the window was unobserved. */
export function windowMax(scores: ArrayLike<number>, stimulusSlot: number, window = STIMULUS_WINDOW_S): number {
  const a = Math.max(0, stimulusSlot + Math.round(window[0] * SCORE_HZ));
  const b = Math.min(scores.length - 1, stimulusSlot + Math.round(window[1] * SCORE_HZ));
  let m = NaN;
  for (let i = a; i <= b; i++) {
    const s = scores[i];
    if (!Number.isNaN(s)) m = Number.isNaN(m) ? s : Math.max(m, s);
  }
  return m;
}

export interface SweepInput {
  /** Score series from null (control) sessions for this channel. */
  nullSeries: ArrayLike<number>[];
  /** Peak score in each stimulus window (only stimuli expected on this channel, observed). */
  stimulusPeaks: number[];
}

export interface SweepPoint {
  threshold: number;
  falseTrips: number;
  fpPerHour: number;
  fpCI: Interval;
  detected: number;
  detectionRate: number;
  detCI: Interval;
}

export interface SweepResult {
  points: SweepPoint[];
  nullHours: number;
  nStimuli: number;
}

export function thresholdGrid(lo = 2, hi = 8, step = 0.25): number[] {
  const out: number[] = [];
  for (let t = lo; t <= hi + 1e-9; t += step) out.push(Math.round(t * 100) / 100);
  return out;
}

export function sweep(input: SweepInput, grid = thresholdGrid()): SweepResult {
  const nullHours = input.nullSeries.reduce((h, s) => h + observedHours(s), 0);
  const nStim = input.stimulusPeaks.length;
  const points = grid.map((threshold) => {
    const falseTrips = input.nullSeries.reduce((n, s) => n + countTrips(s, threshold), 0);
    const ci = poissonCI(falseTrips);
    const detected = input.stimulusPeaks.filter((p) => p >= threshold).length;
    return {
      threshold,
      falseTrips,
      fpPerHour: nullHours > 0 ? falseTrips / nullHours : NaN,
      fpCI: nullHours > 0 ? { lo: ci.lo / nullHours, hi: ci.hi / nullHours } : { lo: NaN, hi: NaN },
      detected,
      detectionRate: nStim > 0 ? detected / nStim : NaN,
      detCI: wilson(detected, nStim),
    };
  });
  return { points, nullHours, nStimuli: nStim };
}

/**
 * Recommended threshold: the one with the highest detection rate whose false
 * trips stay at or under `maxFpPerHour`. Ties go to the higher (stricter)
 * threshold. Returns null when no threshold meets the budget.
 */
export function recommendThreshold(points: SweepPoint[], maxFpPerHour: number): SweepPoint | null {
  let best: SweepPoint | null = null;
  for (const p of points) {
    if (!(p.fpPerHour <= maxFpPerHour) || Number.isNaN(p.detectionRate)) continue;
    if (!best || p.detectionRate > best.detectionRate || (p.detectionRate === best.detectionRate && p.threshold > best.threshold)) {
      best = p;
    }
  }
  return best;
}
