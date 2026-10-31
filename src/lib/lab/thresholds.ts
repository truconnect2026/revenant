import type { Channel } from "../types";

export const DEFAULT_THRESHOLDS: Record<Channel, number> = { emf: 4, sound: 3, motion: 4.5 };
const KEY = "revenant.thresholds";

/** Live trip thresholds: defaults unless a lab recommendation was applied. */
export function loadThresholds(): Record<Channel, number> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_THRESHOLDS };
    const p = JSON.parse(raw) as Partial<Record<Channel, number>>;
    const ok = (v: unknown, d: number) => (typeof v === "number" && v >= 1 && v <= 20 ? v : d);
    return {
      emf: ok(p.emf, DEFAULT_THRESHOLDS.emf),
      sound: ok(p.sound, DEFAULT_THRESHOLDS.sound),
      motion: ok(p.motion, DEFAULT_THRESHOLDS.motion),
    };
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }
}

export function saveThresholds(t: Record<Channel, number>): void {
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch {}
}

/** Audit record of a threshold change made from the lab (stored in labMeta). */
export interface ThresholdChange {
  id: string; // `threshold:${ts}`
  kind: "threshold";
  ts: number;
  channel: Channel;
  from: number;
  to: number;
  reason: string;
}
