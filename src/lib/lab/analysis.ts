// Lab analyses over the whole dataset. Each function takes plain data and
// returns plain numbers plus the sample sizes behind them, so the UI can show
// "not enough data" instead of a misleading chart.

import type { AnomalyEvent, Channel, SessionData, StimulusMark } from "../types";
import { CHANNELS } from "../types";
import { SCORE_HZ, SLOT_MS, observedHours } from "./scoreLog";
import { STIMULUS_WINDOW_S, sweep, windowMax, type SweepResult } from "./sweep";
import { benjaminiHochberg, compareRates, mulberry32, wilson, type Interval } from "./stats";
import { STIMULUS_TYPES } from "./sources";
import {
  UNKNOWN, crossValidate, featureVector, fitKnn, predict, readiness, trainingRows,
  FEATURE_NAMES, type ModelVersion, type Readiness, type Row, type Evaluation,
} from "./model";

/** Stored sessions use the same shape as live ones for analysis purposes. */
export type LabSession = Omit<SessionData, "events"> & { events: (AnomalyEvent & { clipId?: string })[] };

/** Score series keyed `${sessionId}:${channel}`. */
export type SeriesMap = Map<string, Float32Array>;

export const seriesKey = (sessionId: string, ch: Channel) => `${sessionId}:${ch}`;

function channelUsed(s: LabSession, ch: Channel, series: SeriesMap): boolean {
  if (s.channels) return s.channels[ch];
  return series.has(seriesKey(s.id, ch));
}

// ── Overview ────────────────────────────────────────────────────────────────

export interface Overview {
  sessionsByType: Record<string, number>;
  eventsByStatus: Record<string, number>;
  totalEvents: number;
  labeledPct: number;
  hoursByTypeChannel: Record<string, Record<Channel, number>>;
  legacySessions: number;
  stimuli: number;
  felt: number;
}

export function overview(sessions: LabSession[], series: SeriesMap): Overview {
  const sessionsByType: Record<string, number> = { investigation: 0, null: 0, calibration: 0 };
  const eventsByStatus: Record<string, number> = { unlabeled: 0, explained: 0, injected: 0, unexplained: 0 };
  const hoursByTypeChannel: Record<string, Record<Channel, number>> = {};
  let total = 0;
  let legacy = 0;
  let stimuli = 0;
  let felt = 0;
  for (const s of sessions) {
    const t = s.type ?? "investigation";
    sessionsByType[t] = (sessionsByType[t] ?? 0) + 1;
    if ((s.schema ?? 1) < 2) legacy++;
    stimuli += s.stimuli?.length ?? 0;
    felt += s.subjective?.length ?? 0;
    hoursByTypeChannel[t] ??= { emf: 0, sound: 0, motion: 0 };
    for (const ch of CHANNELS) {
      const ser = series.get(seriesKey(s.id, ch));
      if (ser) hoursByTypeChannel[t][ch] += observedHours(ser);
    }
    for (const e of s.events) {
      const st = e.label?.status ?? "unlabeled";
      eventsByStatus[st] = (eventsByStatus[st] ?? 0) + 1;
      total++;
    }
  }
  return {
    sessionsByType,
    eventsByStatus,
    totalEvents: total,
    labeledPct: total ? (total - eventsByStatus.unlabeled) / total : NaN,
    hoursByTypeChannel,
    legacySessions: legacy,
    stimuli,
    felt,
  };
}

// ── Calibration detection matrix ────────────────────────────────────────────

export interface DetectionCell {
  hits: number;
  n: number;
  rate: number;
  ci: Interval;
  meanLatencyMs: number;
  expected: boolean;
}

export interface CalibrationMatrix {
  rows: string[];
  cells: Record<string, Record<Channel, DetectionCell>>;
  totalStimuli: number;
}

/** For every stimulus type × channel: how often a real event followed. */
export function calibrationMatrix(sessions: LabSession[], series: SeriesMap): CalibrationMatrix {
  const types = STIMULUS_TYPES.map((s) => s.type);
  const acc: Record<string, Record<Channel, { hits: number; n: number; lat: number[] }>> = {};
  let total = 0;
  const [w0, w1] = STIMULUS_WINDOW_S;
  for (const s of sessions) {
    for (const st of s.stimuli ?? []) {
      total++;
      if (!types.includes(st.type)) types.push(st.type);
      acc[st.type] ??= { emf: { hits: 0, n: 0, lat: [] }, sound: { hits: 0, n: 0, lat: [] }, motion: { hits: 0, n: 0, lat: [] } };
      for (const ch of CHANNELS) {
        if (!channelUsed(s, ch, series)) continue;
        const cell = acc[st.type][ch];
        cell.n++;
        const hit = s.events
          .filter((e) => e.channel === ch)
          .map((e) => e.timestamp - st.timestamp)
          .filter((dt) => dt >= w0 * 1000 && dt <= w1 * 1000)
          .sort((a, b) => Math.abs(a) - Math.abs(b))[0];
        if (hit !== undefined) {
          cell.hits++;
          cell.lat.push(hit);
        }
      }
    }
  }
  const rows = types.filter((t) => acc[t]);
  const cells: CalibrationMatrix["cells"] = {};
  for (const t of rows) {
    const exp = STIMULUS_TYPES.find((x) => x.type === t)?.expected ?? [];
    cells[t] = {} as Record<Channel, DetectionCell>;
    for (const ch of CHANNELS) {
      const c = acc[t][ch];
      cells[t][ch] = {
        hits: c.hits,
        n: c.n,
        rate: c.n ? c.hits / c.n : NaN,
        ci: wilson(c.hits, c.n),
        meanLatencyMs: c.lat.length ? c.lat.reduce((a, b) => a + b, 0) / c.lat.length : NaN,
        expected: exp.includes(ch),
      };
    }
  }
  return { rows, cells, totalStimuli: total };
}

// ── Threshold sweep ─────────────────────────────────────────────────────────

function stimulusSlot(s: LabSession, st: StimulusMark): number {
  return Math.round((st.timestamp - s.started_at) / SLOT_MS);
}

export function thresholdSweep(channel: Channel, sessions: LabSession[], series: SeriesMap): SweepResult {
  const nullSeries: Float32Array[] = [];
  const stimulusPeaks: number[] = [];
  for (const s of sessions) {
    const ser = series.get(seriesKey(s.id, channel));
    if (!ser) continue;
    if (s.type === "null") nullSeries.push(ser);
    for (const st of s.stimuli ?? []) {
      if (!st.expected.includes(channel)) continue;
      const peak = windowMax(ser, stimulusSlot(s, st));
      if (!Number.isNaN(peak)) stimulusPeaks.push(peak);
    }
  }
  return sweep({ nullSeries, stimulusPeaks });
}

// ── Location effect (control vs investigation) ──────────────────────────────

export interface EffectRow {
  channel: Channel;
  group: string; // "All investigations" or a location label
  countA: number;
  hoursA: number;
  countB: number; // control
  hoursB: number;
  rateA: number;
  rateB: number;
  ciA: Interval;
  ciB: Interval;
  ratio: number;
  p: number;
  pAdj: number;
  verdict: string;
}

/**
 * Events per observed hour in investigations vs control sessions, per channel
 * and per location. Test events (injected) are excluded — they were made on
 * purpose. Only sessions with an observation log count, since an hour that
 * wasn't recorded can't be counted as quiet.
 */
export function locationEffect(sessions: LabSession[], series: SeriesMap): { rows: EffectRow[]; excludedLegacy: number } {
  type Agg = { count: number; hours: number };
  const control: Record<Channel, Agg> = { emf: { count: 0, hours: 0 }, sound: { count: 0, hours: 0 }, motion: { count: 0, hours: 0 } };
  const groups = new Map<string, Record<Channel, Agg>>();
  let excludedLegacy = 0;
  const bump = (g: string) => {
    if (!groups.has(g)) groups.set(g, { emf: { count: 0, hours: 0 }, sound: { count: 0, hours: 0 }, motion: { count: 0, hours: 0 } });
    return groups.get(g)!;
  };
  for (const s of sessions) {
    const t = s.type ?? "investigation";
    if (t === "calibration") continue;
    let any = false;
    for (const ch of CHANNELS) {
      const ser = series.get(seriesKey(s.id, ch));
      if (!ser) continue;
      any = true;
      const hours = observedHours(ser);
      const count = s.events.filter((e) => e.channel === ch && e.label?.status !== "injected" && !e.sentry).length;
      if (t === "null") {
        control[ch].count += count;
        control[ch].hours += hours;
      } else {
        const all = bump("All investigations")[ch];
        all.count += count;
        all.hours += hours;
        const loc = (s.label ?? "").trim();
        if (loc) {
          const g = bump(loc)[ch];
          g.count += count;
          g.hours += hours;
        }
      }
    }
    if (!any) excludedLegacy++;
  }
  const rows: EffectRow[] = [];
  groups.forEach((agg, group) => {
    for (const ch of CHANNELS) {
      const a = agg[ch];
      const b = control[ch];
      if (a.hours <= 0 || b.hours <= 0) continue;
      const cmp = compareRates(a.count, a.hours, b.count, b.hours);
      rows.push({
        channel: ch, group,
        countA: a.count, hoursA: a.hours, countB: b.count, hoursB: b.hours,
        rateA: cmp.rateA, rateB: cmp.rateB, ciA: cmp.ciA, ciB: cmp.ciB,
        ratio: cmp.ratio, p: cmp.p, pAdj: 1, verdict: "",
      });
    }
  });
  const adj = benjaminiHochberg(rows.map((r) => r.p));
  rows.forEach((r, i) => {
    r.pAdj = adj[i];
    if (r.pAdj >= 0.05) r.verdict = "No difference from control";
    else if (r.rateA > r.rateB) r.verdict = "Higher than control — check its unexplained events";
    else r.verdict = "Lower than control";
  });
  rows.sort((a, b) => (a.group === "All investigations" ? -1 : 0) - (b.group === "All investigations" ? -1 : 0) || a.pAdj - b.pAdj);
  return { rows, excludedLegacy };
}

// ── Subjective vs sensor ────────────────────────────────────────────────────

export interface SubjectiveResult {
  marks: number;
  blindMarks: number;
  observed: number; // fraction of marks with a sensor event within ±window
  null: number[]; // fraction under each shuffle
  p: number;
  windowS: number;
  iterations: number;
}

/**
 * Do "felt something" marks line up with sensor events more than chance?
 * Chance is estimated by moving each mark to a random time in its own session
 * (1,000 shuffles, fixed seed so the result is reproducible).
 */
export function subjectiveTest(
  sessions: LabSession[],
  { blindOnly = true, windowS = 3, iterations = 1000, seed = 1 } = {}
): SubjectiveResult {
  const items: { start: number; end: number; marks: number[]; events: number[] }[] = [];
  let blindMarks = 0;
  let all = 0;
  for (const s of sessions) {
    const marks = (s.subjective ?? []).filter((m) => (blindOnly ? m.blind : true));
    blindMarks += (s.subjective ?? []).filter((m) => m.blind).length;
    if (!marks.length || s.ended_at == null) continue;
    all += marks.length;
    items.push({
      start: s.started_at,
      end: s.ended_at,
      marks: marks.map((m) => m.timestamp),
      events: s.events.filter((e) => e.label?.status !== "injected").map((e) => e.timestamp).sort((a, b) => a - b),
    });
  }
  const w = windowS * 1000;
  const near = (events: number[], t: number) => events.some((e) => Math.abs(e - t) <= w);
  const frac = (pick: (it: (typeof items)[number], t: number) => number) => {
    let hit = 0;
    let n = 0;
    for (const it of items) for (const t of it.marks) {
      if (near(it.events, pick(it, t))) hit++;
      n++;
    }
    return n ? hit / n : NaN;
  };
  const observed = frac((_, t) => t);
  const rnd = mulberry32(seed);
  const nullDist: number[] = [];
  if (all > 0) {
    for (let i = 0; i < iterations; i++) nullDist.push(frac((it) => it.start + rnd() * (it.end - it.start)));
  }
  const ge = nullDist.filter((v) => v >= observed - 1e-12).length;
  return {
    marks: all,
    blindMarks,
    observed,
    null: nullDist,
    p: all > 0 ? (ge + 1) / (iterations + 1) : NaN,
    windowS,
    iterations,
  };
}

// ── Model training ──────────────────────────────────────────────────────────

export interface TrainOutcome {
  channel: Channel;
  readiness: Readiness;
  evaluation?: Evaluation;
  version?: ModelVersion;
  /** New model predictions for events nobody has explained yet. */
  predictions: Map<string, { source: string; confidence: number; distance: number }>;
  rows: Row[];
}

export function trainChannel(channel: Channel, sessions: LabSession[], previous: ModelVersion[]): TrainOutcome {
  const rows = trainingRows(sessions, channel);
  const ready = readiness(rows);
  const predictions = new Map<string, { source: string; confidence: number; distance: number }>();
  if (!ready.ok) return { channel, readiness: ready, predictions, rows };

  const evaluation = crossValidate(rows);
  const model = fitKnn(rows);
  const versionNo = previous.filter((v) => v.channel === channel).reduce((m, v) => Math.max(m, v.version), 0) + 1;

  let total = 0;
  let residue = 0;
  for (const s of sessions) for (const e of s.events) {
    if (e.channel !== channel) continue;
    total++;
    const st = e.label?.status ?? "unlabeled";
    if (st === "explained" || st === "injected") continue;
    const x = featureVector(e);
    const p = x ? predict(model, x) : null;
    if (p) predictions.set(e.id, p);
    // Residue: not explained by a human, and the model can't place it either.
    if (st === "unexplained" || !p || p.source === UNKNOWN) residue++;
  }

  const version: ModelVersion = {
    id: `${channel}-v${versionNo}`,
    channel,
    version: versionNo,
    trainedAt: Date.now(),
    nSamples: rows.length,
    nClasses: ready.classes,
    nSessions: ready.sessions,
    classes: evaluation.labels,
    cvAccuracy: evaluation.accuracy,
    baselineAccuracy: evaluation.baselineAccuracy,
    rejectRate: evaluation.rejectRate,
    perClass: evaluation.perClass,
    confusion: evaluation.confusion,
    predLabels: evaluation.predLabels,
    featureSet: FEATURE_NAMES[channel],
    rejectDistance: model.rejectDistance,
    residue: total ? residue / total : NaN,
    totalEvents: total,
  };
  return { channel, readiness: ready, evaluation, version, predictions, rows };
}

/** Events the loop hasn't explained yet, loudest first — the next work queue. */
export function residueQueue(sessions: LabSession[], channel?: Channel) {
  const out: { session: LabSession; event: LabSession["events"][number] }[] = [];
  for (const s of sessions) for (const e of s.events) {
    if (channel && e.channel !== channel) continue;
    const st = e.label?.status ?? "unlabeled";
    if (st === "explained" || st === "injected") continue;
    const p = e.label?.modelPrediction;
    if (st === "unlabeled" && p && p.source !== UNKNOWN) continue; // model has a lead; confirm in the log
    out.push({ session: s, event: e });
  }
  return out.sort((a, b) => b.event.sigma - a.event.sigma);
}

export { SCORE_HZ };
