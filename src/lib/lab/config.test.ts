import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, describeChanges, normalizeConfig } from "./config";
import { crossValidate, featureImportance, featureMask, kSweep, type Row } from "./model";
import { countTrips } from "./sweep";
import { mulberry32 } from "./stats";

function rows(noiseFeature = true): Row[] {
  const rnd = mulberry32(5);
  const out: Row[] = [];
  for (let s = 0; s < 4; s++) for (let i = 0; i < 6; i++) {
    // Feature 0 separates the classes; feature 1 is pure noise.
    out.push({ id: `a${s}${i}`, sessionId: `s${s}`, y: "Knock", x: [rnd() * 0.3, noiseFeature ? rnd() * 10 : 0] });
    out.push({ id: `b${s}${i}`, sessionId: `s${s}`, y: "Voice", x: [5 + rnd() * 0.3, noiseFeature ? rnd() * 10 : 0] });
  }
  return out;
}

describe("learning config", () => {
  it("clamps and fills bad values", () => {
    const c = normalizeConfig({ k: 999, rejectPercentile: 7, cooldownS: -1, stimulusWindow: [5, -3] as [number, number] });
    expect(c.k).toBe(25);
    expect(c.rejectPercentile).toBe(1);
    expect(c.cooldownS).toBe(0.2);
    expect(c.stimulusWindow).toEqual([0, 0.5]);
    expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig({ rejectPercentile: null }).rejectPercentile).toBeNull();
  });

  it("describes what was changed", () => {
    expect(describeChanges(DEFAULT_CONFIG)).toEqual([]);
    expect(describeChanges({ ...DEFAULT_CONFIG, k: 3 })).toEqual(["k = 3"]);
  });

  it("feature mask drops disabled features but never empties the model", () => {
    expect(featureMask("emf", { disabledFeatures: { emf: ["dev x"], sound: [], motion: [] } })).toEqual([0, 2, 3, 4, 5]);
    const all = ["log σ", "dev x", "dev y", "dev z", "duration s", "rise s"];
    expect(featureMask("emf", { disabledFeatures: { emf: all, sound: [], motion: [] } })).toHaveLength(6);
  });

  it("turning the reject option off means the model always answers", () => {
    const strict = crossValidate(rows(), { k: 5, weighting: "distance", rejectPercentile: 0.5 });
    const never = crossValidate(rows(), { k: 5, weighting: "distance", rejectPercentile: null });
    expect(never.rejectRate).toBe(0);
    expect(strict.rejectRate).toBeGreaterThan(0);
  });

  it("importance ranks the informative feature first", () => {
    const r = featureImportance(rows(), ["signal", "noise"], DEFAULT_CONFIG);
    expect(r.items[0].feature).toBe("signal");
    expect(r.items[0].drop).toBeGreaterThan(r.items[1].drop);
  });

  it("k sweep returns one point per k", () => {
    const s = kSweep(rows(false), DEFAULT_CONFIG, [1, 3, 5]);
    expect(s.map((p) => p.k)).toEqual([1, 3, 5]);
    expect(s.every((p) => p.accuracy > 0.8)).toBe(true);
  });

  it("a longer cooldown merges nearby trips", () => {
    const sc = new Float32Array(100).fill(0);
    sc[10] = 5; sc[30] = 5;
    expect(countTrips(sc, 4, 15)).toBe(2);
    expect(countTrips(sc, 4, 25)).toBe(1);
  });
});
