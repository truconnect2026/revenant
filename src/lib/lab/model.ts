// k-nearest-neighbours source classifier with a reject option. Plain TypeScript,
// no ML library, so every step is inspectable. One model per channel — a sound
// event and a motion event aren't described by the same measurements.
//
// Honesty rules baked in:
//  - It only learns from events a human explained or that matched a known
//    stimulus. It never trains on its own predictions.
//  - When an event isn't close to anything it has seen, it says "unknown"
//    rather than forcing a guess.
//  - Accuracy is measured leave-one-SESSION-out: events in one session are
//    correlated, so a random split would flatter the model.

import type { AnomalyEvent, Channel } from "../types";
import { median, percentile } from "./stats";
import { trainingSource } from "./sources";

export const UNKNOWN = "unknown";
export const K = 5;
export const MIN_ROWS = 10;
export const MIN_CLASSES = 2;
export const MIN_SESSIONS = 2;

export const FEATURE_NAMES: Record<Channel, string[]> = {
  sound: [
    "log σ", "peak dBFS", "log dom. freq", "log centroid", "flatness", "ZCR", "duration s", "rise s",
    "band 1", "band 2", "band 3", "band 4", "band 5", "band 6", "band 7", "band 8",
  ],
  motion: ["log σ", "dev x", "dev y", "dev z", "rot peak", "duration s", "rise s"],
  emf: ["log σ", "dev x", "dev y", "dev z", "duration s", "rise s"],
};

const num = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? NaN : v);

/** Feature vector for an event, or null when it carries no measured features. */
export function featureVector(ev: AnomalyEvent): number[] | null {
  const f = ev.features;
  if (!f) return null;
  const logSigma = Math.log1p(Math.max(0, num(f.peakSigma ?? ev.sigma)));
  const dur = num(f.durationMs) / 1000;
  const rise = num(f.riseTimeMs) / 1000;
  if (ev.channel === "sound") {
    if (!f.bandDb || f.bandDb.length !== 8) return null;
    // Band shape relative to the loudest band, so loudness and timbre separate.
    const maxBand = Math.max(...f.bandDb);
    return [
      logSigma,
      num(f.peakDbfs),
      Math.log(Math.max(20, num(f.dominantFreqHz))),
      Math.log(Math.max(20, num(f.spectralCentroidHz))),
      num(f.spectralFlatness),
      num(f.zeroCrossingRate),
      dur,
      rise,
      ...f.bandDb.map((b) => b - maxBand),
    ];
  }
  if (!f.axisDev) return null;
  const [x, y, z] = f.axisDev;
  if (ev.channel === "motion") return [logSigma, x, y, z, num(f.rotPeak), dur, rise];
  return [logSigma, x, y, z, dur, rise];
}

export interface Row {
  id: string;
  sessionId: string;
  x: number[];
  y: string;
}

export function trainingRows(sessions: { id: string; events: AnomalyEvent[] }[], channel: Channel): Row[] {
  const rows: Row[] = [];
  for (const s of sessions) {
    for (const ev of s.events) {
      if (ev.channel !== channel) continue;
      const y = trainingSource(ev);
      const x = featureVector(ev);
      if (y && x) rows.push({ id: ev.id, sessionId: s.id, x, y });
    }
  }
  return rows;
}

export interface Scaler {
  fill: number[]; // per-feature median used for missing values
  mean: number[];
  sd: number[];
}

export function fitScaler(X: number[][]): Scaler {
  const d = X[0]?.length ?? 0;
  const fill: number[] = [];
  const mean: number[] = [];
  const sd: number[] = [];
  for (let j = 0; j < d; j++) {
    const col = X.map((r) => r[j]).filter((v) => !Number.isNaN(v));
    const f = col.length ? median(col) : 0;
    const full = X.map((r) => (Number.isNaN(r[j]) ? f : r[j]));
    const m = full.reduce((a, b) => a + b, 0) / Math.max(full.length, 1);
    const v = full.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(full.length - 1, 1);
    fill.push(f);
    mean.push(m);
    sd.push(Math.sqrt(v) > 1e-9 ? Math.sqrt(v) : 1);
  }
  return { fill, mean, sd };
}

export function scale(s: Scaler, x: number[]): number[] {
  return x.map((v, j) => ((Number.isNaN(v) ? s.fill[j] : v) - s.mean[j]) / s.sd[j]);
}

function dist(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

export interface FittedKnn {
  scaler: Scaler;
  X: number[][]; // scaled
  y: string[];
  rejectDistance: number;
}

/**
 * Fit: scale features, then learn how far apart same-source events usually are.
 * The reject distance is the 95th percentile of each training event's distance
 * to its nearest same-source neighbour.
 */
export function fitKnn(rows: Row[]): FittedKnn {
  const scaler = fitScaler(rows.map((r) => r.x));
  const X = rows.map((r) => scale(scaler, r.x));
  const y = rows.map((r) => r.y);
  const nn: number[] = [];
  for (let i = 0; i < X.length; i++) {
    let best = Infinity;
    for (let j = 0; j < X.length; j++) {
      if (i !== j && y[i] === y[j]) best = Math.min(best, dist(X[i], X[j]));
    }
    if (Number.isFinite(best)) nn.push(best);
  }
  // With no same-class pairs there is no basis for "close enough": reject nothing
  // by distance, but confidence will still be low.
  const rejectDistance = nn.length ? percentile(nn, 0.95) : Infinity;
  return { scaler, X, y, rejectDistance };
}

export interface Prediction {
  source: string;
  confidence: number;
  distance: number;
}

export function predict(model: FittedKnn, x: number[], k = K): Prediction {
  const q = scale(model.scaler, x);
  const nbrs = model.X.map((p, i) => ({ d: dist(p, q), y: model.y[i] }))
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.min(k, model.X.length));
  if (nbrs.length === 0) return { source: UNKNOWN, confidence: 0, distance: Infinity };
  const nearest = nbrs[0].d;
  const votes = new Map<string, number>();
  let total = 0;
  for (const n of nbrs) {
    const w = 1 / (n.d + 1e-6);
    votes.set(n.y, (votes.get(n.y) ?? 0) + w);
    total += w;
  }
  let best = "";
  let bestW = -1;
  votes.forEach((w, y) => {
    if (w > bestW || (w === bestW && y < best)) {
      best = y;
      bestW = w;
    }
  });
  const confidence = Math.round((bestW / total) * 1000) / 1000;
  const distance = Math.round(nearest * 1000) / 1000;
  if (nearest > model.rejectDistance) return { source: UNKNOWN, confidence, distance };
  return { source: best, confidence, distance };
}

export interface Readiness {
  ok: boolean;
  rows: number;
  classes: number;
  sessions: number;
  /** Human-readable list of what's still missing. */
  missing: string[];
}

export function readiness(rows: Row[]): Readiness {
  const classes = new Set(rows.map((r) => r.y)).size;
  const sessions = new Set(rows.map((r) => r.sessionId)).size;
  const missing: string[] = [];
  if (rows.length < MIN_ROWS) missing.push(`${MIN_ROWS - rows.length} more labeled events`);
  if (classes < MIN_CLASSES) missing.push(`${MIN_CLASSES - classes} more distinct source${MIN_CLASSES - classes > 1 ? "s" : ""}`);
  if (sessions < MIN_SESSIONS) missing.push(`${MIN_SESSIONS - sessions} more session${MIN_SESSIONS - sessions > 1 ? "s" : ""} with labels`);
  return { ok: missing.length === 0, rows: rows.length, classes, sessions, missing };
}

export interface ClassMetrics {
  label: string;
  support: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface Evaluation {
  labels: string[]; // true-label rows
  predLabels: string[]; // prediction columns (labels + "unknown")
  /** confusion[i][j] = count with true labels[i] predicted predLabels[j] */
  confusion: number[][];
  perClass: ClassMetrics[];
  accuracy: number;
  /** Accuracy of always guessing the most common source, for comparison. */
  baselineAccuracy: number;
  rejectRate: number;
  n: number;
  folds: number;
}

/** Leave-one-session-out cross-validation. */
export function crossValidate(rows: Row[]): Evaluation {
  const sessions = Array.from(new Set(rows.map((r) => r.sessionId)));
  const labels = Array.from(new Set(rows.map((r) => r.y))).sort();
  const predLabels = [...labels, UNKNOWN];
  const confusion = labels.map(() => predLabels.map(() => 0));
  let correct = 0;
  let rejected = 0;
  let baselineCorrect = 0;
  let evaluated = 0;
  let folds = 0;

  for (const s of sessions) {
    const train = rows.filter((r) => r.sessionId !== s);
    const test = rows.filter((r) => r.sessionId === s);
    if (train.length === 0 || test.length === 0) continue;
    folds++;
    const model = fitKnn(train);
    const counts = new Map<string, number>();
    for (const r of train) counts.set(r.y, (counts.get(r.y) ?? 0) + 1);
    const majority = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    for (const r of test) {
      const p = predict(model, r.x);
      const i = labels.indexOf(r.y);
      const j = predLabels.indexOf(p.source);
      confusion[i][j >= 0 ? j : predLabels.length - 1]++;
      if (p.source === r.y) correct++;
      if (p.source === UNKNOWN) rejected++;
      if (majority === r.y) baselineCorrect++;
      evaluated++;
    }
  }

  const perClass = labels.map((label, i) => {
    const tp = confusion[i][i];
    const support = confusion[i].reduce((a, b) => a + b, 0);
    const predicted = confusion.reduce((a, row) => a + row[i], 0);
    const precision = predicted > 0 ? tp / predicted : 0;
    const recall = support > 0 ? tp / support : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    return { label, support, precision, recall, f1 };
  });

  return {
    labels,
    predLabels,
    confusion,
    perClass,
    accuracy: evaluated ? correct / evaluated : NaN,
    baselineAccuracy: evaluated ? baselineCorrect / evaluated : NaN,
    rejectRate: evaluated ? rejected / evaluated : NaN,
    n: evaluated,
    folds,
  };
}

export interface ModelVersion {
  id: string; // `${channel}-v${n}`
  channel: Channel;
  version: number;
  trainedAt: number;
  nSamples: number;
  nClasses: number;
  nSessions: number;
  classes: string[];
  cvAccuracy: number;
  baselineAccuracy: number;
  rejectRate: number;
  perClass: ClassMetrics[];
  confusion: number[][];
  predLabels: string[];
  featureSet: string[];
  rejectDistance: number;
  /** Share of ALL events on this channel still unexplained after this run. */
  residue: number;
  totalEvents: number;
}
