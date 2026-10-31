import { describe, expect, it } from "vitest";
import {
  benjaminiHochberg, binomialTwoSided, compareRates, mulberry32, poissonCI, wilson,
} from "./stats";
import { countTrips, recommendThreshold, sweep, windowMax } from "./sweep";
import { CHUNK_SLOTS, ScoreRecorder, assembleScores, observedHours } from "./scoreLog";
import { axisFeatures, runAroundPeak, soundFeatures, welchPower, spectralFeatures } from "./features";
import { UNKNOWN, crossValidate, fitKnn, fitScaler, predict, readiness, scale, type Row } from "./model";
import { applyStimulusLabels } from "./sources";
import { pca2 } from "./pca";
import { subjectiveTest, trainChannel, type LabSession } from "./analysis";
import { decodeFloat32, encodeFloat32, mergeSessions } from "./dataset";
import type { AnomalyEvent, StimulusMark } from "../types";

describe("stats", () => {
  it("wilson matches the textbook interval", () => {
    const ci = wilson(5, 10);
    expect(ci.lo).toBeCloseTo(0.2366, 3);
    expect(ci.hi).toBeCloseTo(0.7634, 3);
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 1 });
    expect(wilson(0, 20).lo).toBe(0);
  });

  it("poisson exact CI matches Garwood", () => {
    const z = poissonCI(0);
    expect(z.lo).toBe(0);
    expect(z.hi).toBeCloseTo(3.689, 2);
    const t = poissonCI(10);
    expect(t.lo).toBeCloseTo(4.795, 2);
    expect(t.hi).toBeCloseTo(18.39, 1);
  });

  it("binomial two-sided p", () => {
    expect(binomialTwoSided(9, 10, 0.5)).toBeCloseTo(0.02148, 4);
    expect(binomialTwoSided(5, 10, 0.5)).toBeCloseTo(1, 6);
  });

  it("compareRates finds no difference for equal rates and a big one for unequal", () => {
    expect(compareRates(10, 1, 10, 1).p).toBeCloseTo(1, 6);
    const r = compareRates(40, 1, 5, 1);
    expect(r.ratio).toBe(8);
    expect(r.p).toBeLessThan(0.001);
  });

  it("benjamini-hochberg", () => {
    const adj = benjaminiHochberg([0.01, 0.04, 0.03, 0.005]);
    expect(adj.map((v) => +v.toFixed(4))).toEqual([0.02, 0.04, 0.04, 0.02]);
  });

  it("seeded rng is reproducible", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("score log + sweep", () => {
  it("records max per 100 ms slot and leaves unobserved slots NaN", () => {
    const rec = new ScoreRecorder("s", 0);
    rec.record("sound", 10, 1);
    rec.record("sound", 60, 3);
    rec.record("sound", 250, 2);
    rec.record("sound", 300, null);
    const series = assembleScores(rec.takeDirty());
    expect(series[0]).toBe(3);
    expect(Number.isNaN(series[1])).toBe(true);
    expect(series[2]).toBe(2);
    expect(series.length).toBe(3);
    expect(observedHours(series)).toBeCloseTo(2 / 10 / 3600, 10);
  });

  it("assembles chunks across the chunk boundary", () => {
    const rec = new ScoreRecorder("s", 0);
    rec.record("emf", 0, 1);
    rec.record("emf", CHUNK_SLOTS * 100 + 5, 9);
    const series = assembleScores(rec.takeDirty());
    expect(series[CHUNK_SLOTS]).toBe(9);
  });

  it("counts trips with cooldown like the live detector", () => {
    const s = new Float32Array(100).fill(0);
    s[10] = 5; s[11] = 5; s[12] = 5; // one burst → one trip
    s[50] = 5; // separate trip
    expect(countTrips(s, 4)).toBe(2);
    expect(countTrips(s, 6)).toBe(0);
  });

  it("window max ignores unobserved slots", () => {
    const s = new Float32Array(100).fill(NaN);
    expect(Number.isNaN(windowMax(s, 50))).toBe(true);
    s[55] = 7;
    expect(windowMax(s, 50)).toBe(7);
  });

  it("sweep and recommendation trade off false trips against detection", () => {
    const quiet = new Float32Array(36000).fill(1); // 1 h observed
    quiet[100] = 3.5; // one false trip at thresholds ≤ 3.5
    const res = sweep({ nullSeries: [quiet], stimulusPeaks: [3, 5, 6, 9] }, [2, 3, 4, 5]);
    expect(res.nullHours).toBeCloseTo(1, 6);
    expect(res.points.map((p) => p.falseTrips)).toEqual([1, 1, 0, 0]);
    expect(res.points.map((p) => p.detected)).toEqual([4, 4, 3, 3]);
    expect(recommendThreshold(res.points, 0)?.threshold).toBe(5);
    expect(recommendThreshold(res.points, 1)?.threshold).toBe(3);
  });
});

describe("features", () => {
  it("finds the dominant frequency of a tone", () => {
    const sr = 48000;
    const x = new Float32Array(sr / 2);
    for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sr);
    const f = spectralFeatures(welchPower(x, 2048), sr, 2048);
    expect(Math.abs(f.dominantFreqHz - 1000)).toBeLessThan(30);
    expect(f.spectralFlatness).toBeLessThan(0.1);
    expect(f.bandDb).toHaveLength(8);
  });

  it("white noise is spectrally flat", () => {
    const rnd = mulberry32(3);
    const x = new Float32Array(24000).map(() => rnd() * 2 - 1);
    const f = spectralFeatures(welchPower(x, 2048), 48000, 2048);
    expect(f.spectralFlatness).toBeGreaterThan(0.4);
  });

  it("measures duration and rise of a run around the peak", () => {
    const s = [0, 0, 5, 6, 9, 4, 0, 0];
    const r = runAroundPeak(s, 4, 50, 3, 3)!;
    expect(r.durationMs).toBe(200); // indices 2..5
    expect(r.riseTimeMs).toBe(100); // 2 → 4
    expect(runAroundPeak([0, 1, 0], 4, 50, 1, 1)).toBeNull();
  });

  it("measures a burst inside a sound clip", () => {
    const sr = 8000;
    const clip = new Float32Array(sr * 2).fill(0.001);
    for (let i = sr; i < sr + 800; i++) clip[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr);
    const f = soundFeatures(clip, sr, sr, -30, 8);
    expect(f.durationMs).toBeGreaterThanOrEqual(90);
    expect(f.durationMs).toBeLessThanOrEqual(110);
    expect(Math.abs((f.dominantFreqHz ?? 0) - 440)).toBeLessThan(10);
  });

  it("axis deviation picks the axis that moved", () => {
    const recent: [number, number, number][] = Array.from({ length: 10 }, () => [0, 0, 9.8]);
    const f = axisFeatures(recent, [0.1, 3, 9.8], 6);
    expect(f.dominantAxis).toBe("y");
    expect(f.axisDev).toEqual([0.1, 3, 0]);
  });
});

function rows(): Row[] {
  const rnd = mulberry32(11);
  const out: Row[] = [];
  for (let s = 0; s < 4; s++) {
    for (let i = 0; i < 6; i++) {
      out.push({ id: `a${s}${i}`, sessionId: `s${s}`, y: "Knock", x: [rnd() * 0.2, rnd() * 0.2] });
      out.push({ id: `b${s}${i}`, sessionId: `s${s}`, y: "Voice", x: [5 + rnd() * 0.2, 5 + rnd() * 0.2] });
    }
  }
  return out;
}

describe("model", () => {
  it("z-scores and fills missing values with the median", () => {
    const sc = fitScaler([[1, NaN], [3, 4], [5, 6]]);
    expect(sc.fill[1]).toBe(5);
    const z = scale(sc, [3, NaN]);
    expect(z[0]).toBeCloseTo(0, 6);
  });

  it("separates clear clusters and rejects far-away points", () => {
    const model = fitKnn(rows());
    expect(predict(model, [0.1, 0.1]).source).toBe("Knock");
    expect(predict(model, [5.1, 5.1]).source).toBe("Voice");
    expect(predict(model, [40, -40]).source).toBe(UNKNOWN);
  });

  it("leave-one-session-out never tests on a training session", () => {
    const ev = crossValidate(rows());
    expect(ev.folds).toBe(4);
    expect(ev.n).toBe(48);
    expect(ev.accuracy).toBeGreaterThan(0.9);
    expect(ev.baselineAccuracy).toBeCloseTo(0.5, 6);
    const total = ev.confusion.flat().reduce((a, b) => a + b, 0);
    expect(total).toBe(48);
  });

  it("reports what is missing before it will train", () => {
    const r = readiness(rows().slice(0, 3));
    expect(r.ok).toBe(false);
    expect(r.missing.join(" ")).toMatch(/labeled events/);
  });
});

const ev = (id: string, ts: number, extra: Partial<AnomalyEvent> = {}): AnomalyEvent => ({
  id, channel: "sound", value: -20, unit: "dBFS", sigma: 5, mean: -60, stddev: 7, timestamp: ts, ...extra,
});

describe("stimulus matching", () => {
  it("tags events near a stimulus and never overrides a human", () => {
    const stim: StimulusMark[] = [{ id: "k", type: "Knock", timestamp: 10_000, expected: ["sound"] }];
    const out = applyStimulusLabels(
      [
        ev("near", 11_000),
        ev("far", 30_000),
        ev("human", 10_500, { label: { status: "explained", source: "HVAC", labeledBy: "human" } }),
      ],
      stim
    );
    expect(out[0].label).toMatchObject({ status: "injected", source: "Knock", labeledBy: "auto-stimulus" });
    expect(out[1].label).toBeUndefined();
    expect(out[2].label?.source).toBe("HVAC");
    // Removing the stimulus reverts the auto label
    expect(applyStimulusLabels(out, [])[0].label?.status).toBe("unlabeled");
  });
});

describe("pca", () => {
  it("first component follows the direction of most variance", () => {
    const pts = Array.from({ length: 50 }, (_, i) => [i, i * 0.01]);
    const r = pca2(pts);
    expect(r.explained[0]).toBeGreaterThan(0.99);
    expect(r.points).toHaveLength(50);
  });
});

describe("analysis", () => {
  it("subjective marks that sit on events beat the shuffle", () => {
    const events = Array.from({ length: 10 }, (_, i) => ev(`e${i}`, 100_000 + i * 60_000));
    const s: LabSession = {
      id: "s", started_at: 0, ended_at: 700_000, label: null, location: null, events,
      subjective: events.map((e, i) => ({ id: `m${i}`, timestamp: e.timestamp + 500, blind: true })),
    };
    const r = subjectiveTest([s], { iterations: 200 });
    expect(r.observed).toBe(1);
    expect(r.p).toBeLessThan(0.05);
  });

  it("trains only once there is enough labeled data, and counts residue", () => {
    const sessions: LabSession[] = [0, 1].map((k) => ({
      id: `s${k}`, started_at: 0, ended_at: 1, label: null, location: null,
      events: Array.from({ length: 8 }, (_, i) =>
        ev(`s${k}e${i}`, i, {
          features: {
            peakSigma: 4, peakDbfs: i % 2 ? -10 : -40, dominantFreqHz: i % 2 ? 3000 : 120,
            spectralCentroidHz: i % 2 ? 3500 : 300, spectralFlatness: 0.2, zeroCrossingRate: 0.1,
            durationMs: 100, riseTimeMs: 20, bandDb: [0, 0, 0, 0, 0, 0, 0, 0],
          },
          label: { status: "explained", source: i % 2 ? "Clap" : "HVAC", labeledBy: "human" },
        })
      ).concat([ev(`s${k}x`, 99)]),
    }));
    const out = trainChannel("sound", sessions, []);
    expect(out.readiness.ok).toBe(true);
    expect(out.version?.id).toBe("sound-v1");
    expect(out.version?.cvAccuracy).toBeGreaterThan(0.9);
    // The two unlabeled events have no features → residue 2 of 18
    expect(out.version?.residue).toBeCloseTo(2 / 18, 6);
  });
});

describe("dataset", () => {
  it("round-trips float32 score data", () => {
    const a = new Float32Array([1.5, NaN, -3]);
    const b = decodeFloat32(encodeFloat32(a));
    expect(b[0]).toBe(1.5);
    expect(Number.isNaN(b[1])).toBe(true);
    expect(b[2]).toBe(-3);
  });

  it("merges sessions and keeps the newest label", () => {
    const base = { id: "s", started_at: 0, ended_at: 5, label: null, location: null };
    const a = { ...base, events: [ev("e", 1, { label: { status: "unlabeled" as const, labeledAt: 1 } })] };
    const b = {
      ...base,
      events: [
        ev("e", 1, { label: { status: "explained" as const, source: "Door", labeledBy: "human" as const, labeledAt: 9 } }),
        ev("f", 2),
      ],
    };
    const m = mergeSessions(a, b);
    expect(m.events).toHaveLength(2);
    expect(m.events[0].label?.source).toBe("Door");
  });
});

describe("sound features robustness", () => {
  it("ignores a DC offset", () => {
    const sr = 8000;
    const clip = new Float32Array(sr * 2).fill(0.2);
    for (let i = sr; i < sr + 1600; i++) clip[i] = 0.2 + 0.3 * Math.sin((2 * Math.PI * 600 * i) / sr);
    const f = soundFeatures(clip, sr, sr, -30, 8);
    expect(Math.abs((f.dominantFreqHz ?? 0) - 600)).toBeLessThan(10);
    expect(f.zeroCrossingRate).toBeGreaterThan(0.05);
  });
});
