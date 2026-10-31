// Pure merge + encoding helpers shared by the browser (import, sync) and the
// server (sync API). No browser or Node-only APIs beyond atob/btoa.

import type { StoredSession } from "../idb";
import type { ScoreChunk } from "./scoreLog";

/** A score chunk with its Float32 data as base64 (little-endian). */
export interface EncodedChunk extends Omit<ScoreChunk, "data"> {
  data: string;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode(...Array.from(bytes.subarray(i, i + step)));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encodeFloat32(a: Float32Array): string {
  return bytesToBase64(new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength)));
}

export function decodeFloat32(b64: string): Float32Array {
  const bytes = base64ToBytes(b64);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

export function encodeChunk(c: ScoreChunk): EncodedChunk {
  return { ...c, data: encodeFloat32(c.data) };
}

export function decodeChunk(c: EncodedChunk): ScoreChunk {
  return { ...c, data: decodeFloat32(c.data) };
}

/**
 * Fingerprint of a chunk = how many slots hold an observation. A chunk only
 * ever gains observations, so a higher count is always the newer copy.
 */
export function chunkFingerprint(data: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < data.length; i++) if (!Number.isNaN(data[i])) n++;
  return n;
}

type StoredEventT = StoredSession["events"][number];

function newerLabel(a: StoredEventT, b: StoredEventT): StoredEventT {
  const ta = a.label?.labeledAt ?? 0;
  const tb = b.label?.labeledAt ?? 0;
  if (tb > ta) return { ...a, label: b.label };
  // Same human label age: keep whichever carries a model suggestion.
  if (tb === ta && !a.label?.modelPrediction && b.label?.modelPrediction) {
    return { ...a, label: { ...(a.label ?? { status: "unlabeled" }), modelPrediction: b.label.modelPrediction } };
  }
  return a;
}

const byId = <T extends { id: string }>(x: T[] = [], y: T[] = []) =>
  Array.from(new Map([...x, ...y].map((m) => [m.id, m])).values());

/**
 * Merge two copies of one session: union of events and marks by id, the newest
 * human label wins, and fields missing on one side are filled from the other.
 */
export function mergeSessions(a: StoredSession, b: StoredSession): StoredSession {
  const events = new Map(a.events.map((e) => [e.id, e]));
  for (const e of b.events) {
    const cur = events.get(e.id);
    events.set(e.id, cur ? { ...e, ...cur, ...newerLabel(cur, e), clipId: cur.clipId ?? e.clipId } : e);
  }
  return {
    ...b,
    ...a,
    ended_at: a.ended_at ?? b.ended_at,
    device: a.device?.id ? a.device : b.device ?? a.device,
    events: Array.from(events.values()).sort((p, q) => p.timestamp - q.timestamp),
    stimuli: byId(a.stimuli, b.stimuli),
    subjective: byId(a.subjective, b.subjective),
  };
}

/** True when folding `b` into `a` adds nothing to `a`. */
export function sameSession(a: StoredSession, b: StoredSession): boolean {
  return JSON.stringify(mergeSessions(a, b)) === JSON.stringify(mergeSessions(a, a));
}
