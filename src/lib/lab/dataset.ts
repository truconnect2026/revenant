// Export / import the whole lab dataset as one JSON file, so data from several
// phones can be merged into one lab. Score logs and (optionally) audio clips are
// base64-encoded. Import merges by id and never overwrites a human label with
// an older one.

import {
  idbGetAll, idbGetClip, idbLoadStoredSessions, idbPutClips, idbPutMany, idbPutStoredSessions,
  idbSaveScoreChunks, type StoredSession,
} from "../idb";
import type { ScoreChunk } from "./scoreLog";

export const DATASET_FORMAT = "revenant-dataset";

interface EncodedChunk extends Omit<ScoreChunk, "data"> {
  data: string; // base64 Float32 little-endian
}

interface Dataset {
  format: typeof DATASET_FORMAT;
  version: 2;
  exportedAt: number;
  sessions: StoredSession[];
  scoreLogs: EncodedChunk[];
  gearTrials: { id: string }[];
  modelVersions: { id: string }[];
  labMeta: { id: string }[];
  clips?: { id: string; type: string; data: string }[];
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode(...Array.from(bytes.subarray(i, i + step)));
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
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

export async function exportDataset(includeAudio: boolean): Promise<Blob> {
  const [sessions, chunks, gearTrials, modelVersions, labMeta] = await Promise.all([
    idbLoadStoredSessions(),
    idbGetAll<ScoreChunk>("scoreLogs"),
    idbGetAll<{ id: string }>("gearTrials"),
    idbGetAll<{ id: string }>("modelVersions"),
    idbGetAll<{ id: string }>("labMeta"),
  ]);
  const ds: Dataset = {
    format: DATASET_FORMAT,
    version: 2,
    exportedAt: Date.now(),
    sessions,
    scoreLogs: chunks.map((c) => ({ ...c, data: encodeFloat32(c.data) })),
    gearTrials,
    modelVersions,
    labMeta,
  };
  if (includeAudio) {
    ds.clips = [];
    for (const s of sessions) for (const e of s.events) {
      if (!e.clipId) continue;
      const blob = await idbGetClip(e.clipId);
      if (blob) ds.clips.push({ id: e.clipId, type: blob.type || "audio/wav", data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) });
    }
  }
  return new Blob([JSON.stringify(ds)], { type: "application/json" });
}

type StoredEventT = StoredSession["events"][number];

function newerLabel(a: StoredEventT, b: StoredEventT): StoredEventT {
  const ta = a.label?.labeledAt ?? 0;
  const tb = b.label?.labeledAt ?? 0;
  return tb > ta ? { ...a, label: b.label } : a;
}

/** Merge two copies of a session: union of events/marks by id, newest label wins. */
export function mergeSessions(a: StoredSession, b: StoredSession): StoredSession {
  const events = new Map(a.events.map((e) => [e.id, e]));
  for (const e of b.events) events.set(e.id, events.has(e.id) ? newerLabel(events.get(e.id)!, e) : e);
  const byId = <T extends { id: string }>(x: T[] = [], y: T[] = []) => Array.from(new Map([...x, ...y].map((m) => [m.id, m])).values());
  return {
    ...a,
    ended_at: a.ended_at ?? b.ended_at,
    events: Array.from(events.values()).sort((p, q) => p.timestamp - q.timestamp),
    stimuli: byId(a.stimuli, b.stimuli),
    subjective: byId(a.subjective, b.subjective),
  };
}

export interface ImportSummary {
  sessionsAdded: number;
  sessionsMerged: number;
  scoreChunks: number;
  clips: number;
  gearTrials: number;
}

export async function importDataset(text: string): Promise<ImportSummary> {
  const ds = JSON.parse(text) as Dataset;
  if (ds.format !== DATASET_FORMAT) throw new Error("Not a Revenant dataset file");
  const existing = new Map((await idbLoadStoredSessions()).map((s) => [s.id, s]));
  let added = 0;
  let merged = 0;
  const out: StoredSession[] = [];
  for (const s of ds.sessions ?? []) {
    const cur = existing.get(s.id);
    if (cur) {
      merged++;
      out.push(mergeSessions(cur, s));
    } else {
      added++;
      out.push(s);
    }
  }
  await idbPutStoredSessions(out);
  const chunks: ScoreChunk[] = (ds.scoreLogs ?? []).map((c) => ({ ...c, data: decodeFloat32(c.data) }));
  await idbSaveScoreChunks(chunks);
  if (ds.clips?.length) {
    await idbPutClips(ds.clips.map((c) => ({ id: c.id, blob: new Blob([base64ToBytes(c.data)], { type: c.type }) })));
  }
  await idbPutMany("gearTrials", ds.gearTrials ?? []);
  await idbPutMany("labMeta", ds.labMeta ?? []);
  // Model versions are re-derivable; import them so learning-curve history carries over.
  await idbPutMany("modelVersions", ds.modelVersions ?? []);
  return { sessionsAdded: added, sessionsMerged: merged, scoreChunks: chunks.length, clips: ds.clips?.length ?? 0, gearTrials: ds.gearTrials?.length ?? 0 };
}
