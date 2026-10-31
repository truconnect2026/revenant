// Continuous log of each channel's raw detection score (σ), so thresholds can be
// re-tested after the fact. Stored at a fixed 10 Hz slot rate keyed to session
// time: each slot keeps the MAX score seen in that 100 ms (peaks survive), and a
// slot nobody scored (warm-up, page hidden, channel off) stays NaN. Observation
// time is therefore exactly the number of non-NaN slots — never assumed.

import type { Channel } from "../types";

export const SCORE_HZ = 10;
export const SLOT_MS = 1000 / SCORE_HZ;
export const CHUNK_SLOTS = 600; // 60 s per stored chunk

export interface ScoreChunk {
  id: string; // `${sessionId}:${channel}:${index}`
  sessionId: string;
  channel: Channel;
  index: number;
  startTs: number; // session start (slot 0)
  hz: number;
  data: Float32Array;
}

export class ScoreRecorder {
  private chunks = new Map<string, ScoreChunk>();
  private dirty = new Set<string>();

  constructor(readonly sessionId: string, readonly startTs: number) {}

  /** Record a score. Pass null while the channel is not scoring (warm-up, Sentry). */
  record(channel: Channel, ts: number, score: number | null): void {
    if (score === null || !Number.isFinite(score)) return;
    const slot = Math.floor((ts - this.startTs) / SLOT_MS);
    if (slot < 0) return;
    const index = Math.floor(slot / CHUNK_SLOTS);
    const id = `${this.sessionId}:${channel}:${index}`;
    let chunk = this.chunks.get(id);
    if (!chunk) {
      chunk = {
        id,
        sessionId: this.sessionId,
        channel,
        index,
        startTs: this.startTs,
        hz: SCORE_HZ,
        data: new Float32Array(CHUNK_SLOTS).fill(NaN),
      };
      this.chunks.set(id, chunk);
    }
    const i = slot % CHUNK_SLOTS;
    const prev = chunk.data[i];
    chunk.data[i] = Number.isNaN(prev) ? score : Math.max(prev, score);
    this.dirty.add(id);
  }

  /** Copies of every chunk changed since the last call. */
  takeDirty(): ScoreChunk[] {
    const out: ScoreChunk[] = [];
    this.dirty.forEach((id) => {
      const c = this.chunks.get(id);
      if (c) out.push({ ...c, data: c.data.slice() });
    });
    this.dirty.clear();
    // Chunks more than two minutes old won't change again; drop them from memory.
    const nowIndex = Math.max(...Array.from(this.chunks.values()).map((c) => c.index), 0);
    this.chunks.forEach((c, id) => {
      if (c.index < nowIndex - 1) this.chunks.delete(id);
    });
    return out;
  }
}

/** Join stored chunks for one session + channel into a single series (NaN gaps). */
export function assembleScores(chunks: ScoreChunk[]): Float32Array {
  if (chunks.length === 0) return new Float32Array(0);
  const maxIndex = Math.max(...chunks.map((c) => c.index));
  const out = new Float32Array((maxIndex + 1) * CHUNK_SLOTS).fill(NaN);
  for (const c of chunks) out.set(c.data, c.index * CHUNK_SLOTS);
  // Trim trailing NaN so the series ends at the last observation.
  let end = out.length;
  while (end > 0 && Number.isNaN(out[end - 1])) end--;
  return out.subarray(0, end);
}

export function observedSlots(scores: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < scores.length; i++) if (!Number.isNaN(scores[i])) n++;
  return n;
}

export function observedHours(scores: ArrayLike<number>, hz = SCORE_HZ): number {
  return observedSlots(scores) / hz / 3600;
}
