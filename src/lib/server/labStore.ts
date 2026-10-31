// Server-side storage. Two namespaces share one schema shape:
//  - "lab": your own phones' private synced data (passcode-gated).
//  - "community": anonymised contributions from the public (see lib/community).
// Two implementations behind one interface:
//  - Neon Postgres (+ Vercel Blob for audio) when DATABASE_URL / POSTGRES_URL
//    and BLOB_READ_WRITE_TOKEN are set — the production path.
//  - In-memory, used by the unit tests.
// Nothing here runs in the browser.

import type { StoredSession } from "../idb";
import { mergeSessions, type EncodedChunk } from "../lab/merge";

export type DocKind = "gear" | "model" | "meta" | "post" | "spec" | "contributor" | "config";
export type StoreNamespace = "lab" | "community";

export interface ChunkRef {
  id: string;
  fp: number;
}

export interface ClipData {
  body: ReadableStream<Uint8Array> | Uint8Array;
  contentType: string;
  size?: number;
}

export interface LabStore {
  upsertSessions(sessions: StoredSession[]): Promise<{ added: number; merged: number }>;
  listSessions(): Promise<StoredSession[]>;
  putChunks(chunks: (EncodedChunk & { fp: number })[]): Promise<number>;
  chunkIndex(): Promise<ChunkRef[]>;
  getChunks(ids: string[]): Promise<EncodedChunk[]>;
  upsertDocs(kind: DocKind, docs: { id: string }[]): Promise<void>;
  listDocs(kind: DocKind): Promise<{ id: string }[]>;
  putClip(id: string, bytes: Uint8Array, contentType: string): Promise<void>;
  clipIds(): Promise<string[]>;
  getClip(id: string): Promise<ClipData | null>;
  deleteDoc(kind: DocKind, id: string): Promise<void>;
  /** Remove every session (and its score logs and clips) a contributor sent. */
  deleteByContributor(contributorId: string): Promise<{ sessions: number }>;
}

type WithContributor = StoredSession & { contributor?: { id: string } };

// ── In-memory ───────────────────────────────────────────────────────────────

export function memoryStore(): LabStore {
  const sessions = new Map<string, StoredSession>();
  const chunks = new Map<string, EncodedChunk & { fp: number }>();
  const docs = new Map<string, Map<string, { id: string }>>();
  const clips = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    async upsertSessions(list) {
      let added = 0;
      let merged = 0;
      for (const s of list) {
        const cur = sessions.get(s.id);
        if (cur) { sessions.set(s.id, mergeSessions(cur, s)); merged++; } else { sessions.set(s.id, s); added++; }
      }
      return { added, merged };
    },
    async listSessions() { return Array.from(sessions.values()); },
    async putChunks(list) {
      let n = 0;
      for (const c of list) {
        const cur = chunks.get(c.id);
        if (!cur || c.fp >= cur.fp) { chunks.set(c.id, c); n++; }
      }
      return n;
    },
    async chunkIndex() { return Array.from(chunks.values()).map((c) => ({ id: c.id, fp: c.fp })); },
    async getChunks(ids) {
      const out: EncodedChunk[] = [];
      for (const id of ids) {
        const c = chunks.get(id);
        if (!c) continue;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { fp: _fp, ...rest } = c;
        out.push(rest);
      }
      return out;
    },
    async upsertDocs(kind, list) {
      const m = docs.get(kind) ?? new Map();
      list.forEach((d) => m.set(d.id, d));
      docs.set(kind, m);
    },
    async listDocs(kind) { return Array.from(docs.get(kind)?.values() ?? []); },
    async putClip(id, bytes, contentType) { clips.set(id, { bytes, contentType }); },
    async clipIds() { return Array.from(clips.keys()); },
    async getClip(id) {
      const c = clips.get(id);
      return c ? { body: c.bytes, contentType: c.contentType, size: c.bytes.length } : null;
    },
    async deleteDoc(kind, id) { docs.get(kind)?.delete(id); },
    async deleteByContributor(contributorId) {
      const ids = Array.from(sessions.values()).filter((s) => (s as WithContributor).contributor?.id === contributorId).map((s) => s.id);
      for (const id of ids) {
        const sess = sessions.get(id)!;
        sess.events.forEach((e) => e.clipId && clips.delete(e.clipId));
        sessions.delete(id);
        Array.from(chunks.keys()).filter((k) => chunks.get(k)!.sessionId === id).forEach((k) => chunks.delete(k));
      }
      return { sessions: ids.length };
    },
  };
}

// ── Neon Postgres + Vercel Blob ─────────────────────────────────────────────

export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || undefined;
}

/**
 * Local testing only: LAB_SYNC_MEMORY=1 keeps sync data in this server
 * process's memory (lost on restart). Ignored on Vercel, where each function
 * instance has its own memory.
 */
function memoryMode(): boolean {
  return process.env.LAB_SYNC_MEMORY === "1" && !process.env.VERCEL;
}

export function syncConfig(): { configured: boolean; missing: string[] } {
  if (memoryMode()) return { configured: true, missing: [] };
  const missing: string[] = [];
  if (!databaseUrl()) missing.push("DATABASE_URL (add a Neon Postgres database)");
  if (!process.env.BLOB_READ_WRITE_TOKEN) missing.push("BLOB_READ_WRITE_TOKEN (add a Vercel Blob store)");
  return { configured: missing.length === 0, missing };
}


const g = globalThis as unknown as { __revenantMemStores?: Partial<Record<StoreNamespace, LabStore>> };
const neonPromises: Partial<Record<StoreNamespace, Promise<LabStore>>> = {};

export function getLabStore(ns: StoreNamespace = "lab"): Promise<LabStore> {
  if (memoryMode()) {
    g.__revenantMemStores ??= {};
    return Promise.resolve((g.__revenantMemStores[ns] ??= memoryStore()));
  }
  neonPromises[ns] ??= createNeonStore(ns).catch((e) => {
    delete neonPromises[ns];
    throw e;
  });
  return neonPromises[ns]!;
}

async function createNeonStore(ns: StoreNamespace): Promise<LabStore> {
  // Table names come from a fixed two-value union, never from user input.
  const T = {
    sessions: `${ns}_sessions`,
    chunks: `${ns}_score_chunks`,
    docs: `${ns}_docs`,
    clips: `${ns}_clips`,
  };
  const { neon } = await import("@neondatabase/serverless");
  const blob = await import("@vercel/blob");
  const url = databaseUrl();
  if (!url) throw new Error("No database configured");
  const sql = neon(url);
  const q = (text: string, params: unknown[] = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;

  await q(`CREATE TABLE IF NOT EXISTS ${T.sessions} (
    id TEXT PRIMARY KEY, data JSONB NOT NULL, device_id TEXT, updated_at BIGINT NOT NULL)`);
  await q(`ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS contributor_id TEXT`);
  await q(`CREATE TABLE IF NOT EXISTS ${T.chunks} (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, fp INTEGER NOT NULL, data JSONB NOT NULL)`);
  await q(`CREATE TABLE IF NOT EXISTS ${T.docs} (
    kind TEXT NOT NULL, id TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY (kind, id))`);
  await q(`CREATE TABLE IF NOT EXISTS ${T.clips} (
    id TEXT PRIMARY KEY, pathname TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL)`);

  return {
    async upsertSessions(list) {
      if (list.length === 0) return { added: 0, merged: 0 };
      const rows = await q(`SELECT id, data FROM ${T.sessions} WHERE id = ANY($1::text[])`, [list.map((s) => s.id)]);
      const existing = new Map(rows.map((r) => [r.id as string, r.data as StoredSession]));
      let added = 0;
      let merged = 0;
      for (const s of list) {
        const cur = existing.get(s.id);
        const next = cur ? mergeSessions(cur, s) : s;
        if (cur) merged++; else added++;
        await q(
          `INSERT INTO ${T.sessions} (id, data, device_id, updated_at, contributor_id) VALUES ($1, $2::jsonb, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, device_id = EXCLUDED.device_id,
             updated_at = EXCLUDED.updated_at, contributor_id = EXCLUDED.contributor_id`,
          [s.id, JSON.stringify(next), next.device?.id ?? null, Date.now(), (next as WithContributor).contributor?.id ?? null]
        );
      }
      return { added, merged };
    },
    async listSessions() {
      const rows = await q(`SELECT data FROM ${T.sessions} ORDER BY (data->>'started_at')::bigint DESC`);
      return rows.map((r) => r.data as StoredSession);
    },
    async putChunks(list) {
      let n = 0;
      for (const c of list) {
        // A chunk only gains observations; never replace a fuller copy with an emptier one.
        const res = await q(
          `INSERT INTO ${T.chunks} (id, session_id, fp, data) VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (id) DO UPDATE SET fp = EXCLUDED.fp, data = EXCLUDED.data
           WHERE ${T.chunks}.fp <= EXCLUDED.fp RETURNING id`,
          [c.id, c.sessionId, c.fp, JSON.stringify({ ...c, fp: undefined })]
        );
        n += res.length;
      }
      return n;
    },
    async chunkIndex() {
      const rows = await q(`SELECT id, fp FROM ${T.chunks}`);
      return rows.map((r) => ({ id: r.id as string, fp: Number(r.fp) }));
    },
    async getChunks(ids) {
      if (ids.length === 0) return [];
      const rows = await q(`SELECT data FROM ${T.chunks} WHERE id = ANY($1::text[])`, [ids]);
      return rows.map((r) => r.data as EncodedChunk);
    },
    async upsertDocs(kind, list) {
      for (const d of list) {
        await q(
          `INSERT INTO ${T.docs} (kind, id, data) VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (kind, id) DO UPDATE SET data = EXCLUDED.data`,
          [kind, d.id, JSON.stringify(d)]
        );
      }
    },
    async listDocs(kind) {
      const rows = await q(`SELECT data FROM ${T.docs} WHERE kind = $1`, [kind]);
      return rows.map((r) => r.data as { id: string });
    },
    async putClip(id, bytes, contentType) {
      const pathname = `${ns}/clips/${id}.wav`;
      // Private blob: only reachable through the passcode-gated clip route.
      await blob.put(pathname, Buffer.from(bytes), {
        access: "private",
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      await q(
        `INSERT INTO ${T.clips} (id, pathname, content_type, size) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET pathname = EXCLUDED.pathname, content_type = EXCLUDED.content_type, size = EXCLUDED.size`,
        [id, pathname, contentType, bytes.length]
      );
    },
    async clipIds() {
      const rows = await q(`SELECT id FROM ${T.clips}`);
      return rows.map((r) => r.id as string);
    },
    async getClip(id) {
      const rows = await q(`SELECT pathname, content_type FROM ${T.clips} WHERE id = $1`, [id]);
      if (!rows.length) return null;
      const res = await blob.get(rows[0].pathname as string, { access: "private" });
      if (!res || res.statusCode !== 200) return null;
      return { body: res.stream, contentType: (rows[0].content_type as string) || "audio/wav", size: res.blob.size };
    },
    async deleteDoc(kind, id) {
      await q(`DELETE FROM ${T.docs} WHERE kind = $1 AND id = $2`, [kind, id]);
    },
    async deleteByContributor(contributorId) {
      const rows = await q(`SELECT id, data FROM ${T.sessions} WHERE contributor_id = $1`, [contributorId]);
      const ids = rows.map((r) => r.id as string);
      if (!ids.length) return { sessions: 0 };
      const clipIds = rows.flatMap((r) => (r.data as StoredSession).events.map((e) => e.clipId).filter(Boolean) as string[]);
      if (clipIds.length) {
        const clipRows = await q(`SELECT pathname FROM ${T.clips} WHERE id = ANY($1::text[])`, [clipIds]);
        if (clipRows.length) await blob.del(clipRows.map((r) => r.pathname as string));
        await q(`DELETE FROM ${T.clips} WHERE id = ANY($1::text[])`, [clipIds]);
      }
      await q(`DELETE FROM ${T.chunks} WHERE session_id = ANY($1::text[])`, [ids]);
      await q(`DELETE FROM ${T.sessions} WHERE id = ANY($1::text[])`, [ids]);
      return { sessions: ids.length };
    },
  };
}
