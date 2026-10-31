import type { Channel } from "@/lib/types";

/** Score stream for the learning loop. `score` is null while not scoring. */
export type ScoreListener = (channel: Channel, ts: number, score: number | null, mode: "normal" | "sentry") => void;

export interface SensorOptions {
  /** Override the default trip threshold (σ). Applied live. */
  threshold?: number;
  /** Called on every detection tick with the raw score. */
  onScore?: ScoreListener;
}
