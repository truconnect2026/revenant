// Two-way sync between this browser's IndexedDB and the server (Phase 3).
// Push: everything the server is missing or has an older copy of. Pull: the
// merged result back, so every phone ends up with the same dataset. Merging is
// by id and never replaces a newer human label with an older one.

import {
  idbGetAll, idbGetClip, idbLoadStoredSessions, idbPutClips, idbPutMany, idbPutStoredSessions,
  idbSaveScoreChunks, type StoredSession,
} from "../idb";
import type { ScoreChunk } from "./scoreLog";
import { chunkFingerprint, decodeChunk, encodeChunk, mergeSessions, sameSession, type EncodedChunk } from "./merge";
import { getDeviceId } from "./device";

export interface ChunkRef {
  id: string;
  fp: number;
}

interface Snapshot {
  sessions: StoredSession[];
  chunkIndex: ChunkRef[];
  docs: { gear: { id: string }[]; model: { id: string }[]; meta: { id: string }[] };
  clipIds: string[];
}

export interface SyncSummary {
  sessionsPushed: number;
  chunksPushed: number;
  clipsPushed: number;
  sessionsPulled: number;
  chunksPulled: number;
}

const BATCH_BYTES = 2.5 * 1024 * 1024;

// ── Pure planning helpers (unit-tested) ─────────────────────────────────────

/** Ids where `from` has a fuller copy than `to` (or `to` has none). */
export function newerChunks(from: ChunkRef[], to: ChunkRef[]): string[] {
  const have = new Map(to.map((c) => [c.id, c.fp]));
  return from.filter((c) => !have.has(c.id) || c.fp > (have.get(c.id) ?? -1)).map((c) => c.id);
}

/** Split items into batches whose JSON stays under `maxBytes` (a single huge item gets its own batch). */
export function batchBySize<T>(items: T[], maxBytes = BATCH_BYTES): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let size = 0;
  for (const it of items) {
    const n = JSON.stringify(it).length;
    if (cur.length && size + n > maxBytes) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(it);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Local sessions the server copy would change (new on the server, or merged differently). */
export function sessionsToPush(local: StoredSession[], remote: StoredSession[]): StoredSession[] {
  const r = new Map(remote.map((s) => [s.id, s]));
  return local.filter((s) => {
    const cur = r.get(s.id);
    return !cur || !sameSession(cur, s);
  });
}

/** Local copies after folding in the server's sessions; returns only those that changed. */
export function mergePulled(local: StoredSession[], remote: StoredSession[]): StoredSession[] {
  const l = new Map(local.map((s) => [s.id, s]));
  const changed: StoredSession[] = [];
  for (const s of remote) {
    const cur = l.get(s.id);
    if (!cur) changed.push(s);
    else if (!sameSession(cur, s)) changed.push(mergeSessions(cur, s));
  }
  return changed;
}

// ── Network ─────────────────────────────────────────────────────────────────

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { credentials: "same-origin", ...init });
  const body = (await r.json().catch(() => ({}))) as T & { error?: string; missing?: string[] };
  if (!r.ok) {
    const extra = body.missing?.length ? ` Missing: ${body.missing.join(", ")}.` : "";
    throw new Error(`${body.error ?? `Server returned ${r.status}`}.${extra}`);
  }
  return body;
}

export async function syncStatus(): Promise<{ configured: boolean; missing: string[] }> {
  return api("/api/lab/sync/status");
}

export async function fetchServerClip(clipId: string): Promise<Blob | null> {
  const r = await fetch(`/api/lab/clip?id=${encodeURIComponent(clipId)}`, { credentials: "same-origin" }).catch(() => null);
  if (!r || !r.ok) return null;
  const blob = await r.blob();
  // Cache it locally so it plays offline next time.
  await idbPutClips([{ id: clipId, blob }]).catch(() => {});
  return blob;
}

export async function syncWithServer(progress: (msg: string) => void = () => {}): Promise<SyncSummary> {
  const status = await syncStatus();
  if (!status.configured) throw new Error(`Server sync isn't set up. Missing: ${status.missing.join(", ")}.`);

  progress("Reading this device…");
  const deviceId = getDeviceId();
  let local = await idbLoadStoredSessions();
  // Sessions recorded here before device ids existed belong to this device.
  const stamped = local
    .filter((s) => !s.device?.id)
    .map((s) => ({ ...s, device: { userAgent: s.device?.userAgent ?? navigator.userAgent, ...s.device, id: deviceId } }));
  if (stamped.length) {
    await idbPutStoredSessions(stamped);
    local = await idbLoadStoredSessions();
  }
  const localChunks = await idbGetAll<ScoreChunk>("scoreLogs");
  const localRefs = localChunks.map((c) => ({ id: c.id, fp: chunkFingerprint(c.data) }));

  progress("Checking the server…");
  const remote = await api<Snapshot>("/api/lab/sync");

  // Push sessions
  const pushSessions = sessionsToPush(local, remote.sessions);
  const sessionBatches = batchBySize(pushSessions);
  for (let i = 0; i < sessionBatches.length; i++) {
    const batch = sessionBatches[i];
    progress(`Uploading sessions (batch ${i + 1} of ${sessionBatches.length})…`);
    await api("/api/lab/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessions: batch }) });
  }

  // Push score chunks
  const pushIds = new Set(newerChunks(localRefs, remote.chunkIndex));
  const toPush = localChunks.filter((c) => pushIds.has(c.id)).map((c) => ({ ...encodeChunk(c), fp: chunkFingerprint(c.data) }));
  const chunkBatches = batchBySize(toPush);
  for (let i = 0; i < chunkBatches.length; i++) {
    const batch = chunkBatches[i];
    progress(`Uploading score logs (batch ${i + 1} of ${chunkBatches.length})…`);
    await api("/api/lab/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chunks: batch }) });
  }

  // Push docs (small; the server upserts by id)
  const [gear, models, meta] = await Promise.all([
    idbGetAll<{ id: string }>("gearTrials"),
    idbGetAll<{ id: string }>("modelVersions"),
    idbGetAll<{ id: string }>("labMeta"),
  ]);
  if (gear.length || models.length || meta.length) {
    progress("Uploading gear trials and model history…");
    await api("/api/lab/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docs: { gear, model: models, meta } }),
    });
  }

  // Push clips the server doesn't have
  const remoteClips = new Set(remote.clipIds);
  const clipIds = Array.from(new Set(local.flatMap((s) => s.events.map((e) => e.clipId).filter((x): x is string => !!x))))
    .filter((id) => !remoteClips.has(id));
  let clipsPushed = 0;
  for (const id of clipIds) {
    const blob = await idbGetClip(id);
    if (!blob) continue;
    progress(`Uploading audio ${clipsPushed + 1} of ${clipIds.length}…`);
    const r = await fetch(`/api/lab/clip?id=${encodeURIComponent(id)}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": blob.type || "audio/wav" },
      body: blob,
    });
    if (r.ok) clipsPushed++;
  }

  // Pull the merged result
  progress("Downloading from the server…");
  const after = await api<Snapshot>("/api/lab/sync");
  const pulled = mergePulled(local, after.sessions);
  await idbPutStoredSessions(pulled);

  const pullIds = newerChunks(after.chunkIndex, localRefs);
  let chunksPulled = 0;
  for (let i = 0; i < pullIds.length; i += 300) {
    progress(`Downloading score logs (${Math.min(i + 300, pullIds.length)} of ${pullIds.length})…`);
    const { chunks } = await api<{ chunks: EncodedChunk[] }>("/api/lab/sync/chunks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: pullIds.slice(i, i + 300) }),
    });
    await idbSaveScoreChunks(chunks.map(decodeChunk));
    chunksPulled += chunks.length;
  }
  await idbPutMany("gearTrials", after.docs.gear);
  await idbPutMany("modelVersions", after.docs.model);
  await idbPutMany("labMeta", after.docs.meta);

  return {
    sessionsPushed: pushSessions.length,
    chunksPushed: toPush.length,
    clipsPushed,
    sessionsPulled: pulled.length,
    chunksPulled,
  };
}
