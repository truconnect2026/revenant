// Request handlers for /api/lab/sync and /api/lab/clip, written against the
// LabStore interface so they can be unit-tested with the in-memory store.

import type { StoredSession } from "../idb";
import type { EncodedChunk } from "../lab/merge";
import type { DocKind, LabStore } from "./labStore";

export const MAX_BODY_BYTES = 4 * 1024 * 1024; // under Vercel's 4.5 MB function limit
const ID_RE = /^[A-Za-z0-9:_-]{1,128}$/;
const DOC_KINDS: DocKind[] = ["gear", "model", "meta"];

export interface PushBody {
  sessions?: StoredSession[];
  chunks?: (EncodedChunk & { fp: number })[];
  docs?: Partial<Record<DocKind, { id: string }[]>>;
}

export interface Snapshot {
  sessions: StoredSession[];
  chunkIndex: { id: string; fp: number }[];
  docs: Record<DocKind, { id: string }[]>;
  clipIds: string[];
}

export class BadRequest extends Error {}

function validId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

/** Merge pushed data into the store. Rejects malformed records instead of storing them. */
export async function handlePush(store: LabStore, body: PushBody) {
  const sessions = body.sessions ?? [];
  const chunks = body.chunks ?? [];
  for (const s of sessions) {
    if (!validId(s?.id) || typeof s.started_at !== "number" || !Array.isArray(s.events)) {
      throw new BadRequest("Malformed session");
    }
  }
  for (const c of chunks) {
    if (!validId(c?.id) || !validId(c.sessionId) || typeof c.data !== "string" || typeof c.fp !== "number") {
      throw new BadRequest("Malformed score chunk");
    }
  }
  const s = await store.upsertSessions(sessions);
  const chunksStored = await store.putChunks(chunks);
  let docs = 0;
  for (const kind of DOC_KINDS) {
    const list = (body.docs?.[kind] ?? []).filter((d) => validId(d?.id));
    if (list.length) {
      await store.upsertDocs(kind, list);
      docs += list.length;
    }
  }
  return { sessionsAdded: s.added, sessionsMerged: s.merged, chunksStored, docs };
}

export async function handleSnapshot(store: LabStore): Promise<Snapshot> {
  const [sessions, chunkIndex, gear, model, meta, clipIds] = await Promise.all([
    store.listSessions(),
    store.chunkIndex(),
    store.listDocs("gear"),
    store.listDocs("model"),
    store.listDocs("meta"),
    store.clipIds(),
  ]);
  return { sessions, chunkIndex, docs: { gear, model, meta }, clipIds };
}

export async function handleGetChunks(store: LabStore, ids: unknown) {
  if (!Array.isArray(ids) || ids.length > 500 || !ids.every(validId)) throw new BadRequest("Bad chunk id list");
  return store.getChunks(ids);
}

export function validClipId(id: string | null): id is string {
  return !!id && /^[A-Za-z0-9-]{8,64}$/.test(id);
}
