import type { AnomalyEvent, SessionData } from "./types";

const DB_NAME = "revenant";
const DB_VERSION = 1;

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
    };
    req.onsuccess = () => resolve(req.result);
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
    result.push({ ...s, events });
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
    const t = db.transaction("sessions", "readwrite");
    t.objectStore("sessions").delete(sessionId);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}
