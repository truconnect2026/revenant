// Export / import the whole lab dataset as one JSON file, so data from several
// phones can be merged into one lab. Score logs and (optionally) audio clips are
// base64-encoded. Import merges by id and never overwrites a human label with
// an older one.

import {
  idbGetAll, idbGetClip, idbLoadStoredSessions, idbPutClips, idbPutMany, idbPutStoredSessions,
  idbSaveScoreChunks, type StoredSession,
} from "../idb";
import type { ScoreChunk } from "./scoreLog";
import {
  base64ToBytes, bytesToBase64, decodeFloat32, encodeFloat32, mergeSessions, type EncodedChunk,
} from "./merge";

export { decodeFloat32, encodeFloat32, mergeSessions };

export const DATASET_FORMAT = "revenant-dataset";

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

// ── Files from the original app ─────────────────────────────────────────────
// Before the lab existed, each past session exported as one JSON file plus one
// audio file per clip, named revenant-<first 8 of session id>-<event ISO time>.
// These helpers bring those files in, so data recorded on another site address
// (IndexedDB is per-address) can follow you to a new one.

interface LegacySessionFile {
  id: string;
  started_at: number;
  ended_at: number | null;
  label: string | null;
  location: StoredSession["location"];
  events: StoredSession["events"];
  type?: StoredSession["type"];
  stimuli?: StoredSession["stimuli"];
  subjective?: StoredSession["subjective"];
}

export function isLegacySession(x: unknown): x is LegacySessionFile {
  const s = x as LegacySessionFile;
  return !!s && typeof s.id === "string" && typeof s.started_at === "number" && Array.isArray(s.events);
}

/** Match an exported clip file name to the event it belongs to. */
export function matchClipFile(name: string, sessions: StoredSession[]): { sessionId: string; eventId: string } | null {
  const m = /^revenant-([0-9a-f]{8})-(.+)\.(wav|webm)$/i.exec(name.replace(/ \(\d+\)(?=\.)/, ""));
  if (!m) return null;
  const [, prefix, stamp] = m;
  for (const s of sessions) {
    if (!s.id.startsWith(prefix)) continue;
    const ev = s.events.find((e) => new Date(e.timestamp).toISOString().replace(/[:.]/g, "-") === stamp);
    if (ev) return { sessionId: s.id, eventId: ev.id };
  }
  return null;
}

export interface FilesSummary {
  datasets: number;
  legacySessions: number;
  clipsMatched: number;
  clipsUnmatched: number;
  skipped: string[];
}

/** Import any mix of dataset files, old per-session JSON files and their audio files. */
export async function importFiles(files: File[]): Promise<FilesSummary> {
  const summary: FilesSummary = { datasets: 0, legacySessions: 0, clipsMatched: 0, clipsUnmatched: 0, skipped: [] };
  const audio: File[] = [];
  for (const f of files) {
    if (/\.(wav|webm)$/i.test(f.name) || f.type.startsWith("audio/")) {
      audio.push(f);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await f.text());
    } catch {
      summary.skipped.push(f.name);
      continue;
    }
    if ((parsed as { format?: string }).format === DATASET_FORMAT) {
      await importDataset(JSON.stringify(parsed));
      summary.datasets++;
    } else if (isLegacySession(parsed)) {
      const existing = (await idbLoadStoredSessions()).find((s) => s.id === parsed.id);
      const incoming: StoredSession = {
        ...parsed,
        type: parsed.type ?? "investigation",
        stimuli: parsed.stimuli ?? [],
        subjective: parsed.subjective ?? [],
        schema: 1,
      };
      await idbPutStoredSessions([existing ? mergeSessions(existing, incoming) : incoming]);
      summary.legacySessions++;
    } else {
      summary.skipped.push(f.name);
    }
  }
  if (audio.length) {
    const sessions = await idbLoadStoredSessions();
    const touched = new Map<string, StoredSession>();
    for (const f of audio) {
      const hit = matchClipFile(f.name, sessions);
      if (!hit) {
        summary.clipsUnmatched++;
        continue;
      }
      await idbPutClips([{ id: hit.eventId, blob: new Blob([await f.arrayBuffer()], { type: "audio/wav" }) }]);
      const s = touched.get(hit.sessionId) ?? sessions.find((x) => x.id === hit.sessionId)!;
      touched.set(hit.sessionId, { ...s, events: s.events.map((e) => (e.id === hit.eventId ? { ...e, clipId: hit.eventId } : e)) });
      summary.clipsMatched++;
    }
    await idbPutStoredSessions(Array.from(touched.values()));
  }
  return summary;
}
