// What leaves the phone when someone contributes to the community dataset.
// Pure functions, run on the phone before upload AND again on the server, so a
// modified client still can't store identifying fields.
//
// Never shared: GPS, the free-text location label, device id or browser
// details, exact clock time. Audio only with its own separate opt-in.

import type { StoredSession } from "../idb";
import type { ScoreChunk } from "../lab/scoreLog";

/** Bump when the consent text changes; older consent must be re-confirmed. */
export const CONSENT_VERSION = 1;

export const PLACE_TYPES = [
  "Home",
  "Business",
  "Historic site",
  "Cemetery",
  "Church",
  "Hospital or asylum",
  "Outdoors",
  "Other",
] as const;

const PLATFORMS = ["iOS", "Android", "Desktop", "Other"];

export function platformOf(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  if (PLATFORMS.includes(ua)) return ua;
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return "Desktop";
  return "Other";
}

/** Region is a state or country only: digits (house numbers, ZIPs) and symbols are removed. */
export function sanitizeRegion(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const clean = text.replace(/[^A-Za-z\u00C0-\u024F\s,.'-]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  return clean || undefined;
}

function cleanPlace(p: StoredSession["place"]): StoredSession["place"] {
  const type = p?.type && (PLACE_TYPES as readonly string[]).includes(p.type) ? p.type : undefined;
  const region = sanitizeRegion(p?.region);
  return type || region ? { ...(type ? { type } : {}), ...(region ? { region } : {}) } : undefined;
}

const cut = (s: string | undefined, n: number) => (s === undefined ? undefined : String(s).slice(0, n));

/**
 * Remove everything identifying from a session. Idempotent — safe to run on
 * the phone and again on the server.
 */
export function stripIdentifying(s: StoredSession, contributorId: string, audio: boolean): StoredSession {
  return {
    id: s.id,
    started_at: s.started_at,
    ended_at: s.ended_at,
    label: null,
    location: null,
    type: s.type ?? "investigation",
    channels: s.channels,
    thresholds: s.thresholds,
    schema: s.schema,
    device: { userAgent: "", platform: platformOf(s.device?.platform ?? s.device?.userAgent) },
    place: cleanPlace(s.place),
    contributor: { id: contributorId },
    stimuli: (s.stimuli ?? []).slice(0, 2000).map((m) => ({ ...m, type: cut(m.type, 32)! })),
    subjective: (s.subjective ?? []).slice(0, 2000),
    events: s.events.slice(0, 5000).map((e) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { clipId, ...rest } = e as typeof e & { clipUrl?: string };
      delete (rest as { clipUrl?: string }).clipUrl;
      return {
        ...rest,
        ...(audio && clipId ? { clipId } : {}),
        label: e.label
          ? {
              ...e.label,
              source: cut(e.label.source, 32),
              // A model suggestion belongs to whoever trained it; don't publish it as data.
              modelPrediction: undefined,
            }
          : undefined,
      };
    }),
  };
}

/** Offset that moves a session's start to the top of its hour (hides exact clock time). */
export function timeShift(startedAt: number): number {
  return startedAt % 3_600_000;
}

/** Phone-side: shift every timestamp so only the date and hour remain, keeping all gaps exact. */
export function shiftTimes(s: StoredSession): StoredSession {
  const d = timeShift(s.started_at);
  if (d === 0) return s;
  return {
    ...s,
    started_at: s.started_at - d,
    ended_at: s.ended_at == null ? s.ended_at : s.ended_at - d,
    events: s.events.map((e) => ({ ...e, timestamp: e.timestamp - d })),
    stimuli: (s.stimuli ?? []).map((m) => ({ ...m, timestamp: m.timestamp - d })),
    subjective: (s.subjective ?? []).map((m) => ({ ...m, timestamp: m.timestamp - d })),
  };
}

export function shiftChunk(c: ScoreChunk, shift: number): ScoreChunk {
  return { ...c, startTs: c.startTs - shift };
}

/** The exact copy of a session that would be uploaded. */
export function toContribution(s: StoredSession, contributorId: string, audio: boolean): StoredSession {
  return stripIdentifying(shiftTimes(s), contributorId, audio);
}

/** Small stable hash, used to notice when a contributed session changed (e.g. new labels). */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
