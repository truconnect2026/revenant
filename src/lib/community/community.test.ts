import { describe, expect, it } from "vitest";
import { CONSENT_VERSION, sanitizeRegion, shiftTimes, stripIdentifying, toContribution, platformOf } from "./privacy";
import { memoryStore } from "../server/labStore";
import { Forbidden, canUploadClip, handleContribute, handleWithdraw } from "../server/community";
import { BadRequest } from "../server/syncHandlers";
import { runCommunityTraining } from "../server/research";
import { buildSpec } from "../research/spec";
import { draftPost, postToMarkdown, socialText } from "../research/writer";
import type { StoredSession } from "../idb";

const T0 = Date.UTC(2026, 9, 31, 21, 37, 12, 345);
const ev = (id: string, ts: number, extra: Record<string, unknown> = {}) => ({
  id, channel: "sound" as const, value: -20, unit: "dBFS", sigma: 5, mean: -60, stddev: 7, timestamp: ts, ...extra,
});
const session = (id: string, extra: Partial<StoredSession> = {}): StoredSession => ({
  id, started_at: T0, ended_at: T0 + 600_000, label: "123 Elm St basement", location: { lat: 35.2536, lng: -80.645 },
  device: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", id: "device-abc" },
  type: "investigation", place: { type: "Home", region: "NC 28105" },
  events: [ev("e1", T0 + 5_000, { clipId: "e1", label: { status: "explained", source: "HVAC", labeledBy: "human", labeledAt: 1, modelPrediction: { source: "HVAC", confidence: 1, distance: 0, modelVersion: "x" } } })],
  stimuli: [], subjective: [{ id: "m1", timestamp: T0 + 6_000, blind: true }],
  ...extra,
});
const creds = { id: "contrib-0001", token: "t".repeat(64) };

describe("privacy filter", () => {
  it("removes GPS, the location name, device details and exact time", () => {
    const c = toContribution(session("sess-0001"), creds.id, false);
    expect(c.location).toBeNull();
    expect(c.label).toBeNull();
    expect(c.device).toEqual({ userAgent: "", platform: "iOS" });
    expect(c.started_at % 3_600_000).toBe(0);
    expect(c.events[0].timestamp - c.started_at).toBe(5_000); // gaps kept exactly
    expect(c.subjective![0].timestamp - c.started_at).toBe(6_000);
    expect(c.contributor).toEqual({ id: creds.id });
    expect(JSON.stringify(c)).not.toMatch(/Elm|35\.25|device-abc|iPhone OS/);
  });

  it("keeps clips only with audio consent, and drops model suggestions", () => {
    expect(toContribution(session("sess-0001"), creds.id, false).events[0].clipId).toBeUndefined();
    const withAudio = toContribution(session("sess-0001"), creds.id, true);
    expect(withAudio.events[0].clipId).toBe("e1");
    expect(withAudio.events[0].label?.modelPrediction).toBeUndefined();
    expect(withAudio.events[0].label?.source).toBe("HVAC");
  });

  it("region keeps words only, place type must be from the list", () => {
    expect(sanitizeRegion("NC 28105")).toBe("NC");
    expect(sanitizeRegion("12 Main St, Ohio")).toBe("Main St, Ohio");
    expect(stripIdentifying(session("s", { place: { type: "My house at 5 Oak" } }), "c", false).place).toEqual(undefined);
  });

  it("is idempotent, so the server can run it again", () => {
    const once = toContribution(session("sess-0001"), creds.id, true);
    expect(stripIdentifying(once, creds.id, true)).toEqual(once);
    expect(shiftTimes(once)).toEqual(once);
    expect(platformOf("iOS")).toBe("iOS");
  });
});

const body = (sessions: StoredSession[], extra = {}) => ({ contributor: creds, consentVersion: CONSENT_VERSION, audio: true, sessions, ...extra });

describe("community contribution API", () => {
  it("stores only de-identified sessions even if a client sends raw ones", async () => {
    const store = memoryStore();
    await handleContribute(store, body([session("sess-0001")]));
    const [s] = await store.listSessions();
    expect(s.location).toBeNull();
    expect(s.label).toBeNull();
    expect(s.device?.id).toBeUndefined();
  });

  it("requires current consent and the right token", async () => {
    const store = memoryStore();
    await expect(handleContribute(store, { ...body([]), consentVersion: 0 })).rejects.toBeInstanceOf(BadRequest);
    await handleContribute(store, body([session("sess-0001")]));
    await expect(handleContribute(store, { ...body([]), contributor: { id: creds.id, token: "x".repeat(64) } })).rejects.toBeInstanceOf(Forbidden);
  });

  it("won't let one contributor overwrite another's session", async () => {
    const store = memoryStore();
    await handleContribute(store, body([session("sess-0001")]));
    await expect(
      handleContribute(store, { ...body([session("sess-0001")]), contributor: { id: "contrib-0002", token: "u".repeat(64) } })
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it("audio upload only for own clips with audio on; withdraw deletes everything", async () => {
    const store = memoryStore();
    await handleContribute(store, body([session("sess-0001")]));
    expect(await canUploadClip(store, creds, "e1")).toBe(true);
    expect(await canUploadClip(store, creds, "nope")).toBe(false);
    await store.putClip("e1", new Uint8Array([1, 2]), "audio/wav");
    const r = await handleWithdraw(store, creds);
    expect(r.sessions).toBe(1);
    expect(await store.listSessions()).toHaveLength(0);
    expect(await store.clipIds()).toHaveLength(0);
    expect(await store.listDocs("contributor")).toHaveLength(0);
  });
});

describe("spec sheet and research log", () => {
  it("background run trains, builds a spec and leaves a draft (not published)", async () => {
    const store = memoryStore();
    const events = Array.from({ length: 12 }, (_, i) =>
      ev(`e${i}`, T0 + i * 1000, {
        features: {
          peakSigma: 4, peakDbfs: i % 2 ? -10 : -40, dominantFreqHz: i % 2 ? 3000 : 120, spectralCentroidHz: i % 2 ? 3500 : 300,
          spectralFlatness: 0.2, zeroCrossingRate: 0.1, durationMs: 100, riseTimeMs: 20, bandDb: [0, 0, 0, 0, 0, 0, 0, 0],
        },
        label: { status: "explained", source: i % 2 ? "Clap" : "HVAC", labeledBy: "human", labeledAt: 1 },
      })
    );
    await handleContribute(store, body([session("sess-00a1", { events: events.slice(0, 6) }), session("sess-00a2", { events: events.slice(6) })]));
    const r = await runCommunityTraining(store);
    expect(r.trained).toContain("sound-v1");
    const posts = await store.listDocs("post");
    expect(posts).toHaveLength(1);
    expect((posts[0] as unknown as { status: string }).status).toBe("draft");
    expect((await store.listDocs("spec")).map((d) => d.id)).toContain("latest");
  });

  it("findings carry sample sizes; social post fits on X", () => {
    const spec = buildSpec({ sessions: [session("x")] as never, series: new Map(), versions: [], source: "community", contributors: 1 });
    const post = draftPost(spec, T0);
    expect(post.findings[0].headline).toMatch(/1 sessions from 1 contributor/);
    expect(post.limitations.join(" ")).toMatch(/does not detect or test for anything paranormal/);
    const s = socialText(post).short;
    expect(s.replace("{url}", "x".repeat(23)).length).toBeLessThanOrEqual(280);
    expect(postToMarkdown(post, "https://example.com/research/x")).toMatch(/^# Research log/);
    expect(JSON.stringify(spec)).not.toMatch(/Elm|35\.25/);
  });
});
