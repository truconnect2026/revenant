// Phone side of community contribution. Membership lives in localStorage:
// a random contributor id and secret token (the server keeps only the token's
// hash), the consent version accepted, the audio choice, and which sessions
// were sent (with a hash, so later label edits are re-sent).

import { idbGetAll, idbGetClip, idbLoadStoredSessions } from "../idb";
import type { ScoreChunk } from "../lab/scoreLog";
import { chunkFingerprint, encodeChunk } from "../lab/merge";
import { batchBySize } from "../lab/sync";
import { CONSENT_VERSION, fnv1a, shiftChunk, timeShift, toContribution } from "./privacy";

const KEY = "revenant.community";

export interface Membership {
  contributorId: string;
  token: string;
  consentVersion: number;
  audio: boolean;
  joinedAt: number;
  /** sessionId → hash of what was last sent */
  sent: Record<string, string>;
}

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function loadMembership(): Membership | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Membership) : null;
  } catch {
    return null;
  }
}

function save(m: Membership | null) {
  try {
    if (m) localStorage.setItem(KEY, JSON.stringify(m));
    else localStorage.removeItem(KEY);
  } catch {}
}

export function join(audio: boolean): Membership {
  const prev = loadMembership();
  const m: Membership = {
    contributorId: prev?.contributorId ?? crypto.randomUUID(),
    token: prev?.token ?? randomHex(32),
    consentVersion: CONSENT_VERSION,
    audio,
    joinedAt: prev?.joinedAt ?? Date.now(),
    sent: prev?.sent ?? {},
  };
  save(m);
  return m;
}

export function setAudio(audio: boolean): Membership | null {
  const m = loadMembership();
  if (!m) return null;
  // Turning audio on re-sends sessions so their clips can be attached.
  const next = { ...m, audio, sent: audio && !m.audio ? {} : m.sent };
  save(next);
  return next;
}

export function needsReconsent(m: Membership | null): boolean {
  return !!m && m.consentVersion !== CONSENT_VERSION;
}

async function post<T>(path: string, body: unknown, method = "POST"): Promise<T> {
  const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? `Server returned ${r.status}`);
  return data;
}

export interface PendingInfo {
  pending: number;
  finished: number;
}

/** Finished sessions that are new or changed since they were last sent. */
export async function pendingSessions(m: Membership) {
  const all = (await idbLoadStoredSessions()).filter((s) => s.ended_at != null);
  return all
    .map((s) => {
      const c = toContribution(s, m.contributorId, m.audio);
      return { original: s, contribution: c, hash: fnv1a(JSON.stringify(c)) };
    })
    .filter((x) => m.sent[x.original.id] !== x.hash);
}

export async function contribute(progress: (msg: string) => void = () => {}) {
  const m = loadMembership();
  if (!m) throw new Error("Join the community dataset first");
  if (needsReconsent(m)) throw new Error("The contributor terms changed — please review and accept them again");
  const pending = await pendingSessions(m);
  if (!pending.length) return { sessions: 0, clips: 0 };

  const ids = new Set(pending.map((p) => p.original.id));
  const shifts = new Map(pending.map((p) => [p.original.id, timeShift(p.original.started_at)]));
  const chunks = (await idbGetAll<ScoreChunk>("scoreLogs"))
    .filter((c) => ids.has(c.sessionId))
    .map((c) => ({ ...encodeChunk(shiftChunk(c, shifts.get(c.sessionId) ?? 0)), fp: chunkFingerprint(c.data) }));

  const creds = { id: m.contributorId, token: m.token };
  const base = { contributor: creds, consentVersion: m.consentVersion, audio: m.audio };
  const sessionBatches = batchBySize(pending.map((p) => p.contribution));
  for (let i = 0; i < sessionBatches.length; i++) {
    progress(`Sending sessions (${i + 1} of ${sessionBatches.length})…`);
    await post("/api/community/contribute", { ...base, sessions: sessionBatches[i] });
  }
  const chunkBatches = batchBySize(chunks);
  for (let i = 0; i < chunkBatches.length; i++) {
    progress(`Sending score logs (${i + 1} of ${chunkBatches.length})…`);
    await post("/api/community/contribute", { ...base, chunks: chunkBatches[i] });
  }

  let clips = 0;
  if (m.audio) {
    const clipIds = pending.flatMap((p) => p.contribution.events.map((e) => e.clipId).filter((x): x is string => !!x));
    for (const id of clipIds) {
      const blob = await idbGetClip(id);
      if (!blob) continue;
      progress(`Sending audio ${clips + 1} of ${clipIds.length}…`);
      const r = await fetch(`/api/community/clip?id=${encodeURIComponent(id)}&cid=${encodeURIComponent(m.contributorId)}`, {
        method: "PUT",
        headers: { "Content-Type": "audio/wav", "x-contributor-token": m.token },
        body: blob,
      });
      if (r.ok) clips++;
    }
  }

  const sent = { ...m.sent };
  pending.forEach((p) => (sent[p.original.id] = p.hash));
  save({ ...m, sent });
  return { sessions: pending.length, clips };
}

/** Delete everything this phone contributed from the server, then leave. */
export async function withdraw(): Promise<number> {
  const m = loadMembership();
  if (!m) return 0;
  const r = await post<{ sessions: number }>("/api/community/contribute", { contributor: { id: m.contributorId, token: m.token } }, "DELETE");
  save(null);
  return r.sessions;
}
