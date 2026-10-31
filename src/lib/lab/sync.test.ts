import { describe, expect, it } from "vitest";
import { batchBySize, mergePulled, newerChunks, sessionsToPush } from "./sync";
import { chunkFingerprint, mergeSessions } from "./merge";
import { matchClipFile, isLegacySession } from "./dataset";
import { memoryStore } from "../server/labStore";
import { BadRequest, handleGetChunks, handlePush, handleSnapshot } from "../server/syncHandlers";
import type { StoredSession } from "../idb";

const sess = (id: string, extra: Partial<StoredSession> = {}): StoredSession => ({
  id, started_at: 1_700_000_000_000, ended_at: null, label: null, location: null, events: [], ...extra,
});
const ev = (id: string, ts: number, label?: StoredSession["events"][number]["label"]) => ({
  id, channel: "sound" as const, value: -20, unit: "dBFS", sigma: 5, mean: -60, stddev: 7, timestamp: ts, label,
});

describe("sync planning", () => {
  it("pushes chunks the other side lacks or has fewer observations of", () => {
    const local = [{ id: "a", fp: 10 }, { id: "b", fp: 5 }, { id: "c", fp: 3 }];
    const remote = [{ id: "a", fp: 10 }, { id: "b", fp: 7 }];
    expect(newerChunks(local, remote)).toEqual(["c"]);
    expect(newerChunks(remote, local)).toEqual(["b"]);
  });

  it("fingerprint counts observed slots", () => {
    expect(chunkFingerprint(new Float32Array([1, NaN, 2, NaN]))).toBe(2);
  });

  it("batches by JSON size", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ i, pad: "x".repeat(100) }));
    const batches = batchBySize(items, 350);
    expect(batches.flat()).toHaveLength(10);
    expect(batches.every((b) => JSON.stringify(b).length < 450)).toBe(true);
  });

  it("only pushes sessions the server copy would change", () => {
    const a = sess("a", { events: [ev("e1", 1)] });
    const b = sess("b");
    expect(sessionsToPush([a, b], [a]).map((s) => s.id)).toEqual(["b"]);
    const relabeled = sess("a", { events: [ev("e1", 1, { status: "explained", source: "HVAC", labeledBy: "human", labeledAt: 5 })] });
    expect(sessionsToPush([relabeled], [a]).map((s) => s.id)).toEqual(["a"]);
  });

  it("pulls new and changed sessions", () => {
    const local = [sess("a", { events: [ev("e1", 1)] })];
    const remote = [sess("a", { events: [ev("e1", 1), ev("e2", 2)] }), sess("b")];
    const out = mergePulled(local, remote);
    expect(out.map((s) => s.id).sort()).toEqual(["a", "b"]);
    expect(out.find((s) => s.id === "a")!.events).toHaveLength(2);
  });

  it("merge keeps the device id from whichever side has it", () => {
    const a = sess("a");
    const b = sess("a", { device: { userAgent: "x", id: "phone-2" } });
    expect(mergeSessions(a, b).device?.id).toBe("phone-2");
  });
});

describe("server handlers (in-memory store)", () => {
  it("merges pushes from two phones and serves a snapshot", async () => {
    const store = memoryStore();
    await handlePush(store, { sessions: [sess("s1", { events: [ev("e1", 1)] })] });
    const r = await handlePush(store, {
      sessions: [sess("s1", { events: [ev("e1", 1, { status: "explained", source: "Door", labeledBy: "human", labeledAt: 9 }), ev("e2", 2)] })],
      chunks: [{ id: "s1:sound:0", sessionId: "s1", channel: "sound", index: 0, startTs: 0, hz: 10, data: "AAAA", fp: 3 }],
      docs: { gear: [{ id: "g1" }] },
    });
    expect(r).toMatchObject({ sessionsAdded: 0, sessionsMerged: 1, chunksStored: 1, docs: 1 });
    const snap = await handleSnapshot(store);
    expect(snap.sessions[0].events).toHaveLength(2);
    expect(snap.sessions[0].events[0].label?.source).toBe("Door");
    expect(snap.chunkIndex).toEqual([{ id: "s1:sound:0", fp: 3 }]);
    expect(snap.docs.gear).toHaveLength(1);
  });

  it("never replaces a fuller score chunk with an emptier one", async () => {
    const store = memoryStore();
    const base = { id: "s:sound:0", sessionId: "s", channel: "sound" as const, index: 0, startTs: 0, hz: 10 };
    await handlePush(store, { chunks: [{ ...base, data: "full", fp: 9 }] });
    await handlePush(store, { chunks: [{ ...base, data: "less", fp: 2 }] });
    expect((await handleGetChunks(store, ["s:sound:0"]))[0].data).toBe("full");
  });

  it("rejects malformed records", async () => {
    const store = memoryStore();
    await expect(handlePush(store, { sessions: [{ id: "bad id!" } as unknown as StoredSession] })).rejects.toBeInstanceOf(BadRequest);
    await expect(handleGetChunks(store, "nope")).rejects.toBeInstanceOf(BadRequest);
  });
});

describe("original-app file import", () => {
  it("recognises an old per-session export", () => {
    expect(isLegacySession({ id: "x", started_at: 1, events: [] })).toBe(true);
    expect(isLegacySession({ format: "revenant-dataset" })).toBe(false);
  });

  it("matches clip file names to their events, including browser duplicate suffixes", () => {
    const ts = Date.UTC(2026, 5, 30, 21, 53, 39, 120);
    const s = sess("0f3a9c2e-1111-2222-3333-444444444444", { events: [ev("evt-1", ts)] });
    const stamp = new Date(ts).toISOString().replace(/[:.]/g, "-");
    expect(matchClipFile(`revenant-0f3a9c2e-${stamp}.webm`, [s])).toEqual({ sessionId: s.id, eventId: "evt-1" });
    expect(matchClipFile(`revenant-0f3a9c2e-${stamp} (1).webm`, [s])).toEqual({ sessionId: s.id, eventId: "evt-1" });
    expect(matchClipFile("holiday.wav", [s])).toBeNull();
  });
});
