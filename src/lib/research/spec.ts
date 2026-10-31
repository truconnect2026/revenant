// The spec sheet: a snapshot of the dataset, every channel's measured
// performance and the latest trained models. Built from the same pure analysis
// functions the lab uses, so the server (background training) and the lab
// produce identical numbers. Aggregates only — no session, place name or
// contributor is identifiable from it.

import type { Channel } from "../types";
import { CHANNELS } from "../types";
import {
  calibrationMatrix, locationEffect, overview, subjectiveTest, thresholdSweep,
  type CalibrationMatrix, type LabSession, type SeriesMap,
} from "../lab/analysis";
import { recommendThreshold } from "../lab/sweep";
import type { ClassMetrics, ModelVersion } from "../lab/model";
import { DEFAULT_THRESHOLDS } from "../lab/thresholds";

export interface ModelSummary {
  id: string;
  version: number;
  trainedAt: number;
  nSamples: number;
  nClasses: number;
  nSessions: number;
  classes: string[];
  predLabels: string[];
  confusion: number[][];
  perClass: ClassMetrics[];
  cvAccuracy: number;
  baselineAccuracy: number;
  rejectRate: number;
  residue: number;
  featureSet: string[];
}

export interface ChannelSpec {
  threshold: number;
  nullHours: number;
  nStimuli: number;
  atThreshold: { detectionRate: number; detLo: number; detHi: number; detected: number; fpPerHour: number; fpLo: number; fpHi: number; falseTrips: number } | null;
  recommended: { threshold: number; detectionRate: number; fpPerHour: number } | null;
  model: ModelSummary | null;
}

export interface SpecSheet {
  id: string;
  kind: "spec";
  source: "community" | "lab";
  generatedAt: number;
  dataset: {
    sessions: number;
    byType: Record<string, number>;
    contributors?: number;
    events: number;
    eventsByStatus: Record<string, number>;
    labeledPct: number;
    hours: Record<"investigation" | "null" | "calibration", number>;
    stimuli: number;
    felt: number;
    platforms: Record<string, number>;
  };
  channels: Record<Channel, ChannelSpec>;
  calibration: Pick<CalibrationMatrix, "rows" | "cells" | "totalStimuli">;
  places: { group: string; channel: Channel; rateA: number; rateB: number; ratio: number; pAdj: number; countA: number; hoursA: number; countB: number; hoursB: number; verdict: string }[];
  felt: { marks: number; observed: number; chance: number; p: number } | null;
  gear: { device: string; stimulus: { k: number; n: number }; control: { k: number; n: number } }[];
  methods: string[];
  limitations: string[];
}

export const MAX_FP_PER_HOUR = 1;

const METHODS = [
  "Each channel compares every reading with a rolling robust baseline (median and MAD) and records the deviation in σ.",
  "Control sessions are recorded where nobody reports activity; their trip rate is the false-alarm rate.",
  "Calibration sessions mark known physical events (knocks, voices, magnets); detection rate is how often a channel logged an event from 2 s before to 4 s after a mark.",
  "Rates carry 95% intervals (Wilson for proportions, exact Poisson for counts). Comparisons between places use an exact conditional test with Benjamini–Hochberg correction.",
  "Source models are k-nearest-neighbour classifiers on measured event features, scored leave-one-session-out, with an 'unknown' answer when nothing similar has been seen.",
  "Felt-something marks are compared with 1,000 random re-timings within the same sessions.",
];

function summarizeModel(v: ModelVersion | undefined): ModelSummary | null {
  if (!v) return null;
  return {
    id: v.id, version: v.version, trainedAt: v.trainedAt, nSamples: v.nSamples, nClasses: v.nClasses, nSessions: v.nSessions,
    classes: v.classes, predLabels: v.predLabels, confusion: v.confusion, perClass: v.perClass, cvAccuracy: v.cvAccuracy,
    baselineAccuracy: v.baselineAccuracy, rejectRate: v.rejectRate, residue: v.residue, featureSet: v.featureSet,
  };
}

export interface SpecInput {
  sessions: LabSession[];
  series: SeriesMap;
  versions: ModelVersion[];
  gear?: { device: string; trialType: string; triggered: boolean }[];
  thresholds?: Partial<Record<Channel, number>>;
  source: "community" | "lab";
  contributors?: number;
  now?: number;
}

export function buildSpec(input: SpecInput): SpecSheet {
  const { sessions, series } = input;
  const now = input.now ?? Date.now();
  const o = overview(sessions, series);
  const maxH = (t: string) => {
    const h = o.hoursByTypeChannel[t];
    return h ? Math.max(h.emf, h.sound, h.motion) : 0;
  };
  const platforms: Record<string, number> = {};
  for (const s of sessions) {
    const p = s.device?.platform ?? "Unknown";
    platforms[p] = (platforms[p] ?? 0) + 1;
  }

  const channels = {} as Record<Channel, ChannelSpec>;
  for (const ch of CHANNELS) {
    const threshold = input.thresholds?.[ch] ?? DEFAULT_THRESHOLDS[ch];
    const sw = thresholdSweep(ch, sessions, series);
    const at = sw.points.reduce<(typeof sw.points)[number] | null>(
      (best, p) => (!best || Math.abs(p.threshold - threshold) < Math.abs(best.threshold - threshold) ? p : best), null);
    const rec = sw.nullHours > 0 && sw.nStimuli > 0 ? recommendThreshold(sw.points, MAX_FP_PER_HOUR) : null;
    const latest = input.versions.filter((v) => v.channel === ch).sort((a, b) => b.trainedAt - a.trainedAt)[0];
    channels[ch] = {
      threshold,
      nullHours: sw.nullHours,
      nStimuli: sw.nStimuli,
      atThreshold: at && (sw.nullHours > 0 || sw.nStimuli > 0)
        ? {
            detectionRate: at.detectionRate, detLo: at.detCI.lo, detHi: at.detCI.hi, detected: at.detected,
            fpPerHour: at.fpPerHour, fpLo: at.fpCI.lo, fpHi: at.fpCI.hi, falseTrips: at.falseTrips,
          }
        : null,
      recommended: rec ? { threshold: rec.threshold, detectionRate: rec.detectionRate, fpPerHour: rec.fpPerHour } : null,
      model: summarizeModel(latest),
    };
  }

  // Public output groups places by type only — never by a free-text label.
  const places = locationEffect(sessions, series, (s) => s.place?.type).rows.map((r) => ({
    group: r.group, channel: r.channel, rateA: r.rateA, rateB: r.rateB, ratio: r.ratio, pAdj: r.pAdj,
    countA: r.countA, hoursA: r.hoursA, countB: r.countB, hoursB: r.hoursB, verdict: r.verdict,
  }));

  const st = subjectiveTest(sessions, { blindOnly: true });
  const felt = st.marks >= 3
    ? { marks: st.marks, observed: st.observed, chance: st.null.reduce((a, b) => a + b, 0) / Math.max(st.null.length, 1), p: st.p }
    : null;

  const gearMap = new Map<string, { stimulus: { k: number; n: number }; control: { k: number; n: number } }>();
  for (const g of input.gear ?? []) {
    const e = gearMap.get(g.device) ?? { stimulus: { k: 0, n: 0 }, control: { k: 0, n: 0 } };
    const slot = g.trialType === "stimulus" ? e.stimulus : g.trialType === "null" ? e.control : null;
    if (slot) { slot.n++; if (g.triggered) slot.k++; }
    gearMap.set(g.device, e);
  }

  const cal = calibrationMatrix(sessions, series);
  const limitations: string[] = [];
  const nullH = Math.max(...CHANNELS.map((c) => channels[c].nullHours));
  if (nullH < 1) limitations.push(`Only ${(nullH * 60).toFixed(0)} minutes of control recording so far, so false-alarm rates are rough.`);
  if (cal.totalStimuli < 30) limitations.push(`Only ${cal.totalStimuli} calibration marks so far, so detection rates have wide intervals.`);
  limitations.push("Contributors label their own events; labels are not independently checked.");
  limitations.push("Phones, browsers and rooms differ; results are pooled across all of them.");
  limitations.push("Revenant measures environmental deviation from a baseline. It does not detect or test for anything paranormal.");

  return {
    id: `spec-${now}`,
    kind: "spec",
    source: input.source,
    generatedAt: now,
    dataset: {
      sessions: sessions.length,
      byType: o.sessionsByType,
      contributors: input.contributors,
      events: o.totalEvents,
      eventsByStatus: o.eventsByStatus,
      labeledPct: o.labeledPct,
      hours: { investigation: maxH("investigation"), null: maxH("null"), calibration: maxH("calibration") },
      stimuli: o.stimuli,
      felt: o.felt,
      platforms,
    },
    channels,
    calibration: { rows: cal.rows, cells: cal.cells, totalStimuli: cal.totalStimuli },
    places,
    felt,
    gear: Array.from(gearMap.entries()).map(([device, v]) => ({ device, ...v })),
    methods: METHODS,
    limitations,
  };
}
