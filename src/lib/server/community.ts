// Community contribution handlers, written against LabStore so they can be
// unit-tested with the in-memory store. Contributors are a random id plus a
// secret token kept on their phone; the server stores only the token's hash.

import type { StoredSession } from "../idb";
import type { EncodedChunk } from "../lab/merge";
import { CONSENT_VERSION, stripIdentifying } from "../community/privacy";
import type { LabStore } from "./labStore";
import { BadRequest } from "./syncHandlers";

export interface ContributorDoc {
  id: string;
  tokenHash: string;
  consentVersion: number;
  audio: boolean;
  joinedAt: number;
  lastContributionAt?: number;
}

export interface ContributeBody {
  contributor: { id: string; token: string };
  consentVersion: number;
  audio: boolean;
  sessions?: StoredSession[];
  chunks?: (EncodedChunk & { fp: number })[];
}

export class Forbidden extends Error {}

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function findContributor(store: LabStore, id: string): Promise<ContributorDoc | undefined> {
  return (await store.listDocs("contributor")).find((d) => d.id === id) as ContributorDoc | undefined;
}

/** Check the contributor's token; returns their record (or null if they've never contributed). */
export async function verifyContributor(store: LabStore, c: { id?: unknown; token?: unknown }): Promise<ContributorDoc | null> {
  if (typeof c?.id !== "string" || !ID_RE.test(c.id) || typeof c.token !== "string" || c.token.length < 32) {
    throw new BadRequest("Bad contributor credentials");
  }
  const doc = await findContributor(store, c.id);
  if (!doc) return null;
  if (doc.tokenHash !== (await sha256Hex(c.token))) throw new Forbidden("Contributor token doesn't match");
  return doc;
}

export async function handleContribute(store: LabStore, body: ContributeBody) {
  if (body.consentVersion !== CONSENT_VERSION) {
    throw new BadRequest(`Please review and accept the current contributor terms (version ${CONSENT_VERSION})`);
  }
  const existing = await verifyContributor(store, body.contributor);
  const cid = body.contributor.id;
  const audio = body.audio === true;
  const record: ContributorDoc = {
    id: cid,
    tokenHash: existing?.tokenHash ?? (await sha256Hex(body.contributor.token)),
    consentVersion: CONSENT_VERSION,
    audio,
    joinedAt: existing?.joinedAt ?? Date.now(),
    lastContributionAt: Date.now(),
  };
  await store.upsertDocs("contributor", [record]);

  const incoming = body.sessions ?? [];
  if (incoming.length > 200) throw new BadRequest("Too many sessions in one batch");
  const current = new Map((await store.listSessions()).map((s) => [s.id, s]));
  for (const s of incoming) {
    if (typeof s?.id !== "string" || !ID_RE.test(s.id) || typeof s.started_at !== "number" || !Array.isArray(s.events)) {
      throw new BadRequest("Malformed session");
    }
    const owner = current.get(s.id)?.contributor?.id;
    if (owner && owner !== cid) throw new Forbidden("That session belongs to another contributor");
  }
  // Re-run the privacy filter server-side: a modified app still can't store GPS or labels.
  const clean = incoming.map((s) => stripIdentifying(s, cid, audio));
  const r = await store.upsertSessions(clean);

  const owned = new Set([...clean.map((s) => s.id), ...Array.from(current.values()).filter((s) => s.contributor?.id === cid).map((s) => s.id)]);
  const chunks = (body.chunks ?? []).filter((c) => owned.has(c.sessionId) && typeof c.data === "string" && typeof c.fp === "number");
  const chunksStored = await store.putChunks(chunks);
  return { sessionsAdded: r.added, sessionsUpdated: r.merged, chunksStored };
}

/** Delete everything a contributor sent, and their contributor record. */
export async function handleWithdraw(store: LabStore, contributor: { id?: unknown; token?: unknown }) {
  const doc = await verifyContributor(store, contributor);
  if (!doc) return { sessions: 0 };
  const r = await store.deleteByContributor(doc.id);
  await store.deleteDoc("contributor", doc.id);
  return r;
}

/** May this contributor upload audio for this clip id? */
export async function canUploadClip(store: LabStore, contributor: { id?: unknown; token?: unknown }, clipId: string) {
  const doc = await verifyContributor(store, contributor);
  if (!doc) throw new Forbidden("Contribute a session before its audio");
  if (!doc.audio) throw new Forbidden("Audio sharing is off for this contributor");
  const sessions = await store.listSessions();
  return sessions.some((s) => s.contributor?.id === doc.id && s.events.some((e) => e.clipId === clipId));
}
