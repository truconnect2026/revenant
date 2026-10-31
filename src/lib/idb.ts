import type { AnomalyEvent, SessionData } from "./types";
import type { ScoreChunk } from "./lab/scoreLog";

const DB_NAME = "revenant";
// v2 (learning loop): adds scoreLogs, gearTrials, modelVersions, labMeta. Old
// sessions need no rewrite — missing fields are filled on read (normalizeSession).
const DB_VERSION = 2;

export type LabStore = "scoreLogs" | "gearTrials" | "modelVersions" | "labMeta";

let _dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("no-idb"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("clips")) {
        db.createObjectStore("clips", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("scoreLogs")) {
        const st = db.createObjectStore("scoreLogs", { keyPath: "id" });
        st.createIndex("sessionId", "sessionId", { unique: false });
      }
      for (const name of ["gearTrials", "modelVersions", "labMeta"]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Let a newer tab upgrade the schema instead of being blocked by this one.
      db.onversionchange = () => {
        db.close();
        _dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      _dbPromise = null;
      reject(req.error);
    };
  });
  return _dbPromise;
}

// Events as stored: no live object URL, just a clipId reference
interface StoredEvent extends Omit<AnomalyEvent, "clipUrl"> {
  clipId?: string;
}
interface StoredSession extends Omit<SessionData, "events"> {
  events: StoredEvent[];
}
interface StoredClip {
  id: string;
  blob: Blob;
}

export type { StoredSession, StoredEvent };

// Upsert a session. newClips should contain only clips added since the last save.
export async function idbSaveSession(
  session: SessionData,
  newClips: Map<string, Blob>
): Promise<void> {
  const db = await openDB().catch(() => null);
  if (!db) return;

  const storedEvents: StoredEvent[] = session.events.map(({ clipUrl, ...rest }) =>
    clipUrl ? { ...rest, clipId: rest.id } : rest
  );

  await new Promise<void>((res, rej) => {
    const t = db.transaction("sessions", "readwrite");
    t.objectStore("sessions").put({ ...session, events: storedEvents });
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });

  if (newClips.size > 0) {
    await new Promise<void>((res, rej) => {
      const t = db.transaction("clips", "readwrite");
      const store = t.objectStore("clips");
      newClips.forEach((blob, id) => store.put({ id, blob } as StoredClip));
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  }
}

export async function idbLoadSessions(): Promise<SessionData[]> {
  const db = await openDB().catch(() => null);
  if (!db) return [];

  const stored = await new Promise<StoredSession[]>((res, rej) => {
    const t = db.transaction("sessions", "readonly");
    const req = t.objectStore("sessions").getAll();
    req.onsuccess = () => res(req.result as StoredSession[]);
    req.onerror = () => rej(req.error);
  });

  stored.sort((a, b) => b.started_at - a.started_at);

  const result: SessionData[] = [];
  for (const s of stored) {
    const events: AnomalyEvent[] = [];
    for (const ev of s.events) {
      const { clipId, ...rest } = ev;
      if (clipId) {
        const clip = await new Promise<StoredClip | undefined>((res2) => {
          const t = db.transaction("clips", "readonly");
          const req = t.objectStore("clips").get(clipId);
          req.onsuccess = () => res2(req.result as StoredClip | undefined);
          req.onerror = () => res2(undefined);
        });
        events.push(clip ? { ...rest, clipUrl: URL.createObjectURL(clip.blob) } : rest);
      } else {
        events.push(rest);
      }
    }
    result.push(normalizeSession({ ...s, events }));
  }

  return result;
}

// Returns session metadata + blobs for export
export async function idbGetSessionForExport(
  sessionId: string
): Promise<{ session: StoredSession; blobs: Map<string, Blob> } | null> {
  const db = await openDB().catch(() => null);
  if (!db) return null;

  const session = await new Promise<StoredSession | undefined>((res, rej) => {
    const t = db.transaction("sessions", "readonly");
    const req = t.objectStore("sessions").get(sessionId);
    req.onsuccess = () => res(req.result as StoredSession | undefined);
    req.onerror = () => rej(req.error);
  });
  if (!session) return null;

  const blobs = new Map<string, Blob>();
  for (const ev of session.events) {
    if (!ev.clipId) continue;
    const clip = await new Promise<StoredClip | undefined>((res2) => {
      const t = db.transaction("clips", "readonly");
      const req = t.objectStore("clips").get(ev.clipId!);
      req.onsuccess = () => res2(req.result as StoredClip | undefined);
      req.onerror = () => res2(undefined);
    });
    if (clip) blobs.set(ev.clipId, clip.blob);
  }

  return { session, blobs };
}

export async function idbDeleteSession(sessionId: string): Promise<void> {
  const db = await openDB().catch(() => null);
  if (!db) return;
  await new Promise<void>((res, rej) => {
    const t = db.transaction(["sessions", "scoreLogs"], "readwrite");
    t.objectStore("sessions").delete(sessionId);
    const idx = t.objectStore("scoreLogs").index("sessionId");
    const req = idx.openKeyCursor(IDBKeyRange.only(sessionId));
    req.onsuccess = () => {
      const c = req.result;
      if (c) {
        t.objectStore("scoreLogs").delete(c.primaryKey);
        c.continue();
      }
    };
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

// ── Learning-loop storage ───────────────────────────────────────────────────

/** Fill fields that sessions recorded before schema v2 don't have. */
export function normalizeSession<T extends Omit<SessionData, "events"> & { events: StoredEvent[] | AnomalyEvent[] }>(s: T): T {
  return {
    ...s,
    type: s.type ?? "investigation",
    stimuli: s.stimuli ?? [],
    subjective: s.subjective ?? [],
    schema: s.schema ?? 1,
  };
}

function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

/** All sessions as stored (no audio loaded), newest first, normalized. */
export async function idbLoadStoredSessions(): Promise<StoredSession[]> {
  const db = await openDB().catch(() => null);
  if (!db) return [];
  const all = await reqP(db.transaction("sessions", "readonly").objectStore("sessions").getAll() as IDBRequest<StoredSession[]>);
  return all.map(normalizeSession).sort((a, b) => b.started_at - a.started_at);
}

export async function idbPutStoredSessions(sessions: StoredSession[]): Promise<void> {
  const db = await openDB().catch(() => null);
  if (!db || sessions.length === 0) return;
  await new Promise<void>((res, rej) => {
    const t = db.transaction("sessions", "readwrite");
    const st = t.objectStore("sessions");
    sessions.forEach((s) => st.put(s));
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

export async function idbGetClip(clipId: string): Promise<Blob | undefined> {
  const db = await openDB().catch(() => null);
  if (!db) return undefined;
  const c = await reqP(db.transaction("clips", "readonly").objectStore("clips").get(clipId) as IDBRequest<StoredClip | undefined>).catch(() => undefined);
  return c?.blob;
}

export async function idbPutClips(clips: { id: string; blob: Blob }[]): Promise<void> {
  const db = await openDB().catch(() => null);
  if (!db || clips.length === 0) return;
  await new Promise<void>((res, rej) => {
    const t = db.transaction("clips", "readwrite");
    clips.forEach((c) => t.objectStore("clips").put(c));
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

export async function idbSaveScoreChunks(chunks: ScoreChunk[]): Promise<void> {
  const db = await openDB().catch(() => null);
  if (!db || chunks.length === 0) return;
  await new Promise<void>((res, rej) => {
    const t = db.transaction("scoreLogs", "readwrite");
    chunks.forEach((c) => t.objectStore("scoreLogs").put(c));
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

export async function idbGetAll<T>(store: LabStore | "clips"): Promise<T[]> {
  const db = await openDB().catch(() => null);
  if (!db) return [];
  return reqP(db.transaction(store, "readonly").objectStore(store).getAll() as IDBRequest<T[]>).catch(() => []);
}

export async function idbPut<T extends { id: string }>(store: LabStore, value: T): Promise<void> {
  const db = await openDB().catch(() => null);
  if (!db) return;
  await new Promise<void>((res, rej) => {
    const t = db.transaction(store, "readwrite");
    t.objectStore(store).put(value);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

export async function idbPutMany<T extends { id: string }>(store: LabStore, values: T[]): Promise<void> {
  const db = await openDB().catch(() => null);
  if (!db || values.length === 0) return;
  await new Promise<void>((res, rej) => {
    const t = db.transaction(store, "readwrite");
    values.forEach((v) => t.objectStore(store).put(v));
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

export async function idbDelete(store: LabStore, id: string): Promise<void> {
  const db = await openDB().catch(() => null);
  if (!db) return;
  await new Promise<void>((res, rej) => {
    const t = db.transaction(store, "readwrite");
    t.objectStore(store).delete(id);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}
