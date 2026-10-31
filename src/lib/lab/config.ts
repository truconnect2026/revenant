// Learning settings you can tune in the lab's Tuning tab. Everything that
// shapes how the loop learns and scores lives here, so a change is one saved
// object — recorded on every model version and shown on the spec sheet.

import type { Channel } from "../types";

export interface LearningConfig {
  version: 1;
  /** Neighbours the source model consults. */
  k: number;
  /** Closer neighbours count more ("distance") or every neighbour counts the same ("uniform"). */
  weighting: "distance" | "uniform";
  /**
   * How far from anything known an event may be before the model answers
   * "unknown": the percentile of same-source neighbour distances (0.5–1).
   * null = always guess.
   */
  rejectPercentile: number | null;
  /** Measured features left out of the model, per channel (by name). */
  disabledFeatures: Record<Channel, string[]>;
  /** Minimum labeled data before a model trains. */
  minRows: number;
  minClasses: number;
  minSessions: number;
  /** Replay cooldown for the threshold test, seconds (live detector uses 1.5). */
  cooldownS: number;
  /** Seconds before / after a test mark in which an event counts as caused by it. */
  stimulusWindow: [number, number];
  /** False alarms per hour allowed when recommending a threshold. */
  maxFpPerHour: number;
  updatedAt?: number;
}

export const DEFAULT_CONFIG: LearningConfig = {
  version: 1,
  k: 5,
  weighting: "distance",
  rejectPercentile: 0.95,
  disabledFeatures: { emf: [], sound: [], motion: [] },
  minRows: 10,
  minClasses: 2,
  minSessions: 2,
  cooldownS: 1.5,
  stimulusWindow: [-2, 4],
  maxFpPerHour: 1,
};

const clamp = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

/** Fill missing fields and clamp everything to a sane range. */
export function normalizeConfig(c: Partial<LearningConfig> | null | undefined): LearningConfig {
  const d = DEFAULT_CONFIG;
  const win = Array.isArray(c?.stimulusWindow) ? c!.stimulusWindow : d.stimulusWindow;
  const dis = (c?.disabledFeatures ?? {}) as Partial<Record<Channel, string[]>>;
  return {
    version: 1,
    k: Math.round(clamp(c?.k, 1, 25, d.k)),
    weighting: c?.weighting === "uniform" ? "uniform" : "distance",
    rejectPercentile: c?.rejectPercentile === null ? null : clamp(c?.rejectPercentile, 0.5, 1, d.rejectPercentile!),
    disabledFeatures: {
      emf: Array.isArray(dis.emf) ? dis.emf.map(String) : [],
      sound: Array.isArray(dis.sound) ? dis.sound.map(String) : [],
      motion: Array.isArray(dis.motion) ? dis.motion.map(String) : [],
    },
    minRows: Math.round(clamp(c?.minRows, 4, 500, d.minRows)),
    minClasses: Math.round(clamp(c?.minClasses, 2, 20, d.minClasses)),
    minSessions: Math.round(clamp(c?.minSessions, 2, 50, d.minSessions)),
    cooldownS: clamp(c?.cooldownS, 0.2, 10, d.cooldownS),
    stimulusWindow: [clamp(win[0], -10, 0, d.stimulusWindow[0]), clamp(win[1], 0.5, 15, d.stimulusWindow[1])],
    maxFpPerHour: clamp(c?.maxFpPerHour, 0, 60, d.maxFpPerHour),
    updatedAt: typeof c?.updatedAt === "number" ? c.updatedAt : undefined,
  };
}

const KEY = "revenant.learningConfig";

export function loadConfig(): LearningConfig {
  try {
    const raw = localStorage.getItem(KEY);
    return normalizeConfig(raw ? (JSON.parse(raw) as Partial<LearningConfig>) : null);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(c: LearningConfig): LearningConfig {
  const n = normalizeConfig({ ...c, updatedAt: Date.now() });
  try { localStorage.setItem(KEY, JSON.stringify(n)); } catch {}
  return n;
}

/** Plain-English list of what differs from the defaults. */
export function describeChanges(c: LearningConfig): string[] {
  const d = DEFAULT_CONFIG;
  const out: string[] = [];
  if (c.k !== d.k) out.push(`k = ${c.k}`);
  if (c.weighting !== d.weighting) out.push(`${c.weighting} weighting`);
  if (c.rejectPercentile !== d.rejectPercentile) out.push(c.rejectPercentile === null ? "never says unknown" : `unknown beyond the ${Math.round(c.rejectPercentile * 100)}th percentile`);
  for (const ch of ["emf", "sound", "motion"] as Channel[]) {
    if (c.disabledFeatures[ch].length) out.push(`${ch} without ${c.disabledFeatures[ch].join(", ")}`);
  }
  if (c.cooldownS !== d.cooldownS) out.push(`${c.cooldownS}s cooldown`);
  if (c.stimulusWindow[0] !== d.stimulusWindow[0] || c.stimulusWindow[1] !== d.stimulusWindow[1]) out.push(`test window ${c.stimulusWindow[0]}s to +${c.stimulusWindow[1]}s`);
  if (c.maxFpPerHour !== d.maxFpPerHour) out.push(`${c.maxFpPerHour} false alarms/h budget`);
  if (c.minRows !== d.minRows || c.minClasses !== d.minClasses || c.minSessions !== d.minSessions) {
    out.push(`train after ${c.minRows} events, ${c.minClasses} sources, ${c.minSessions} sessions`);
  }
  return out;
}
