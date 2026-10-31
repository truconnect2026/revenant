"use client";
import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Channel } from "@/lib/types";
import type { LabSession } from "@/lib/lab/analysis";
import { thresholdSweep } from "@/lib/lab/analysis";
import { DEFAULT_CONFIG, describeChanges, loadConfig, normalizeConfig, saveConfig, type LearningConfig } from "@/lib/lab/config";
import { FEATURE_NAMES, crossValidate, featureImportance, featureMask, kSweep, readiness, trainingRows } from "@/lib/lab/model";
import { loadThresholds } from "@/lib/lab/thresholds";
import { idbGetAll, idbPut } from "@/lib/idb";
import { ImportanceBars, LearningCurve, NeedMore, fmt, pct } from "./charts";
import { Panel } from "./panels";
import type { LabData } from "./useLabData";

const FEATURE_HINTS: Record<string, string> = {
  "log σ": "how far above baseline",
  "peak dBFS": "loudness",
  "log dom. freq": "main pitch",
  "log centroid": "brightness",
  flatness: "noise-like vs tonal",
  ZCR: "hiss / sharpness",
  "duration s": "how long it lasted",
  "rise s": "how fast it started",
  "dev x": "x-axis change",
  "dev y": "y-axis change",
  "dev z": "z-axis change",
  "rot peak": "rotation",
};

function Slider({
  label, hint, value, min, max, step, format, onChange,
}: {
  label: string; hint?: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-mono">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-zinc-200">{label}</span>
        <span className="text-zinc-100 tabular-nums">{format(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-emerald-500" />
      {hint && <span className="text-[10px] text-zinc-500 leading-snug">{hint}</span>}
    </label>
  );
}

function Delta({ now, before, invert = false }: { now: number; before: number; invert?: boolean }) {
  if (!Number.isFinite(now) || !Number.isFinite(before)) return null;
  const d = (now - before) * 100;
  if (Math.abs(d) < 0.05) return <span className="text-zinc-500">no change</span>;
  const good = invert ? d < 0 : d > 0;
  return <span className={good ? "text-emerald-300" : "text-amber-300"}>{d > 0 ? "+" : ""}{d.toFixed(1)} pts</span>;
}

function Box({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded bg-black/25 px-3 py-2">
      <div className="text-[10px] font-mono text-zinc-500">{label}</div>
      <div className="text-lg font-mono text-zinc-100 tabular-nums leading-tight">{value}</div>
      {sub && <div className="text-[10px] font-mono">{sub}</div>}
    </div>
  );
}

interface ConfigChange {
  id: string;
  kind: "config-change";
  ts: number;
  summary: string[];
}

export function TuningPanel({
  data, channel, onSaved,
}: {
  data: LabData;
  channel: Channel;
  onSaved: () => void;
}) {
  const [saved, setSaved] = useState<LearningConfig>(DEFAULT_CONFIG);
  const [draft, setDraft] = useState<LearningConfig>(DEFAULT_CONFIG);
  const [toServer, setToServer] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<{ ks: ReturnType<typeof kSweep>; imp: ReturnType<typeof featureImportance> } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [log, setLog] = useState<ConfigChange[]>([]);

  useEffect(() => {
    const c = loadConfig();
    setSaved(c);
    setDraft(c);
    idbGetAll<ConfigChange>("labMeta").then((m) => setLog(m.filter((x) => x.kind === "config-change").sort((a, b) => b.ts - a.ts))).catch(() => {});
  }, []);
  useEffect(() => setAnalysis(null), [channel, data]);

  const live = useDeferredValue(draft);
  const set = (patch: Partial<LearningConfig>) => setDraft((d) => normalizeConfig({ ...d, ...patch }));
  const dirty = JSON.stringify({ ...draft, updatedAt: 0 }) !== JSON.stringify({ ...saved, updatedAt: 0 });

  // Live re-scoring: same data, saved settings vs the ones you're trying.
  const score = useMemo(() => {
    const sessions = data.sessions as LabSession[];
    const rowsNow = trainingRows(sessions, channel, live);
    const rowsBefore = trainingRows(sessions, channel, saved);
    const ready = readiness(rowsNow, live);
    if (!ready.ok) return { ready, now: null, before: null };
    return { ready, now: crossValidate(rowsNow, live), before: crossValidate(rowsBefore, saved) };
  }, [data, channel, live, saved]);

  const detection = useMemo(() => {
    const th = loadThresholds()[channel];
    const pick = (c: LearningConfig) => {
      const sw = thresholdSweep(channel, data.sessions as LabSession[], data.series, c);
      const p = sw.points.reduce((b, q) => (Math.abs(q.threshold - th) < Math.abs(b.threshold - th) ? q : b), sw.points[0]);
      return { sw, p };
    };
    return { th, now: pick(live), before: pick(saved) };
  }, [data, channel, live, saved]);

  const analyze = () => {
    setAnalyzing(true);
    setTimeout(() => {
      const rows = trainingRows(data.sessions as LabSession[], channel, live);
      const names = featureMask(channel, live).map((i) => FEATURE_NAMES[channel][i]);
      setAnalysis({ ks: kSweep(rows, live), imp: featureImportance(rows, names, live) });
      setAnalyzing(false);
    }, 30);
  };

  const save = async () => {
    const next = saveConfig(draft);
    const summary = describeChanges(next);
    const change: ConfigChange = { id: `config:${Date.now()}`, kind: "config-change", ts: Date.now(), summary: summary.length ? summary : ["defaults"] };
    await idbPut("labMeta", change).catch(() => {});
    setLog((l) => [change, ...l]);
    setSaved(next);
    setDraft(next);
    let serverNote = "";
    if (toServer) {
      const r = await fetch("/api/research/config", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) }).catch(() => null);
      serverNote = r?.ok ? " Server training will use them from the next run." : " (Server not set up, so only this lab uses them.)";
    }
    setMsg(`Saved.${serverNote}`);
    onSaved();
  };

  const features = FEATURE_NAMES[channel];
  const off = new Set(draft.disabledFeatures[channel]);
  const toggleFeature = (f: string) => {
    const list = off.has(f) ? draft.disabledFeatures[channel].filter((x) => x !== f) : [...draft.disabledFeatures[channel], f];
    if (list.length >= features.length) return; // keep at least one
    set({ disabledFeatures: { ...draft.disabledFeatures, [channel]: list } });
  };

  return (
    <>
      <Panel
        title="Tuning"
        sub="Change how the loop learns and scores, and see the effect on your data before saving. Saved settings are used everywhere: model training, the sensor matrix, the threshold test, live test-mark tagging and the spec sheet."
      >
        <div className="grid grid-cols-3 gap-2">
          <Box
            label={`${channel} accuracy`}
            value={score.now ? pct(score.now.accuracy) : "—"}
            sub={score.now && score.before ? <Delta now={score.now.accuracy} before={score.before.accuracy} /> : <span className="text-zinc-500">needs data</span>}
          />
          <Box
            label="Says unknown"
            value={score.now ? pct(score.now.rejectRate) : "—"}
            sub={score.now && score.before ? <Delta now={score.now.rejectRate} before={score.before.rejectRate} invert /> : null}
          />
          <Box
            label={`Caught at ${detection.th}σ`}
            value={detection.now.sw.nStimuli ? pct(detection.now.p.detectionRate) : "—"}
            sub={detection.now.sw.nStimuli ? <Delta now={detection.now.p.detectionRate} before={detection.before.p.detectionRate} /> : <span className="text-zinc-500">no test marks</span>}
          />
        </div>
        {!score.ready.ok && (
          <NeedMore>To score the model with these settings: {score.ready.missing.join(", ")}.</NeedMore>
        )}
        <div className="flex flex-wrap gap-2">
          <button onClick={save} disabled={!dirty} className="btn-press px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-display font-semibold uppercase tracking-wider disabled:opacity-40">
            Save settings
          </button>
          <button onClick={() => setDraft(saved)} disabled={!dirty} className="btn-press px-3 py-1.5 rounded border border-zinc-600 text-zinc-300 text-[10px] font-display uppercase tracking-wider disabled:opacity-40">
            Undo changes
          </button>
          <button onClick={() => setDraft(DEFAULT_CONFIG)} className="btn-press px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 text-[10px] font-display uppercase tracking-wider">
            Defaults
          </button>
          <label className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-400">
            <input type="checkbox" checked={toServer} onChange={(e) => setToServer(e.target.checked)} /> use for server training too
          </label>
        </div>
        {msg && <p className="text-[11px] font-mono text-zinc-300">{msg}</p>}
      </Panel>

      <Panel title="Source model" sub="How the model decides what caused an event.">
        <Slider
          label="Neighbours (k)" value={draft.k} min={1} max={25} step={1} format={(v) => String(v)}
          hint="How many similar past events it compares against. Low = sharp but jumpy; high = steady but blurry."
          onChange={(k) => set({ k })}
        />
        <div className="flex flex-col gap-1 text-[11px] font-mono">
          <span className="text-zinc-200">Voting</span>
          <div role="radiogroup" className="flex rounded border border-zinc-700 overflow-hidden self-start">
            {(["distance", "uniform"] as const).map((w) => (
              <button key={w} role="radio" aria-checked={draft.weighting === w} onClick={() => set({ weighting: w })}
                className={`btn-press px-3 py-1 text-[10px] ${draft.weighting === w ? "bg-zinc-200 text-zinc-900" : "text-zinc-400"}`}>
                {w === "distance" ? "Closer counts more" : "Equal votes"}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-[11px] font-mono text-zinc-200">
          <input type="checkbox" checked={draft.rejectPercentile !== null} onChange={(e) => set({ rejectPercentile: e.target.checked ? 0.95 : null })} />
          Say &ldquo;unknown&rdquo; when nothing similar has been seen
        </label>
        {draft.rejectPercentile !== null && (
          <Slider
            label="Unknown cut-off" value={Math.round(draft.rejectPercentile * 100)} min={50} max={100} step={1} format={(v) => `${v}th pct`}
            hint="Lower = more cautious (more 'unknown'); higher = guesses more often."
            onChange={(v) => set({ rejectPercentile: v / 100 })}
          />
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-mono text-zinc-200">Features used for {channel}</span>
          <div className="flex flex-wrap gap-1">
            {features.map((f) => (
              <button
                key={f}
                onClick={() => toggleFeature(f)}
                aria-pressed={!off.has(f)}
                title={FEATURE_HINTS[f] ?? (f.startsWith("band") ? "energy in one pitch band" : f)}
                className={`btn-press px-2 py-1 rounded border text-[10px] font-mono ${off.has(f) ? "border-zinc-800 text-zinc-600 line-through" : "border-zinc-500 text-zinc-200"}`}
              >
                {f}
              </button>
            ))}
          </div>
          <span className="text-[10px] font-mono text-zinc-500">Tap to switch a measurement off. Use the feature check below to see which ones help.</span>
        </div>
      </Panel>

      <Panel
        title="What helps the model"
        sub="Re-runs the full cross-validation for every k, and once with each feature left out. Takes a moment on big datasets."
        right={
          <button onClick={analyze} disabled={analyzing || !score.ready.ok} className="btn-press shrink-0 px-3 py-1.5 rounded border border-zinc-500 text-zinc-100 text-[10px] font-display uppercase tracking-wider disabled:opacity-40">
            {analyzing ? "Running…" : "Run check"}
          </button>
        }
      >
        {!analysis ? (
          <NeedMore title="Not run yet">{score.ready.ok ? "Tap Run check." : `Needs ${score.ready.missing.join(", ")}.`}</NeedMore>
        ) : (
          <>
            <h3 className="text-[10px] font-display uppercase tracking-[0.15em] text-zinc-400">Accuracy by k</h3>
            <LearningCurve
              xLabels={analysis.ks.map((p) => `k${p.k}`)}
              series={[
                { name: "Accuracy", values: analysis.ks.map((p) => p.accuracy) },
                { name: "Unknown", values: analysis.ks.map((p) => p.rejectRate) },
              ]}
            />
            <p className="text-[10px] font-mono text-zinc-500">
              Best k here: {analysis.ks.reduce((b, p) => (p.accuracy > b.accuracy ? p : b), analysis.ks[0]).k}. Small datasets make this jumpy — prefer a k that is good across its neighbours, not a lone spike.
            </p>
            <h3 className="mt-1 text-[10px] font-display uppercase tracking-[0.15em] text-zinc-400">Feature check (baseline {pct(analysis.imp.base)})</h3>
            {analysis.imp.items.length ? (
              <ImportanceBars items={analysis.imp.items} />
            ) : (
              <p className="text-[10px] font-mono text-zinc-500">Needs at least two features switched on.</p>
            )}
          </>
        )}
      </Panel>

      <Panel title="Detection and testing" sub="How events are counted when the lab replays the recorded scores.">
        <Slider
          label="Replay cooldown" value={draft.cooldownS} min={0.5} max={5} step={0.5} format={(v) => `${v} s`}
          hint="Trips closer together than this count once. The live detector uses 1.5 s."
          onChange={(cooldownS) => set({ cooldownS })}
        />
        <Slider
          label="Test-mark window: before" value={Math.abs(draft.stimulusWindow[0])} min={0} max={5} step={0.5} format={(v) => `${v} s`}
          hint="How early an event may come before you tapped the mark."
          onChange={(v) => set({ stimulusWindow: [-v, draft.stimulusWindow[1]] })}
        />
        <Slider
          label="Test-mark window: after" value={draft.stimulusWindow[1]} min={1} max={10} step={0.5} format={(v) => `${v} s`}
          hint="How late it may come after. Wider catches more but risks tagging unrelated events."
          onChange={(v) => set({ stimulusWindow: [draft.stimulusWindow[0], v] })}
        />
        <Slider
          label="False-alarm budget" value={draft.maxFpPerHour} min={0} max={10} step={0.5} format={(v) => `${v}/h`}
          hint="Used when suggesting thresholds and on the spec sheet."
          onChange={(maxFpPerHour) => set({ maxFpPerHour })}
        />
        <div className="text-[10px] font-mono text-zinc-500">
          At {detection.th}σ with these settings: {detection.now.sw.nStimuli ? `${pct(detection.now.p.detectionRate)} of ${detection.now.sw.nStimuli} test marks caught` : "no test marks yet"}
          {detection.now.sw.nullHours > 0 ? `, ${fmt(detection.now.p.fpPerHour, 1)} false alarms/h` : ""}.
        </div>
      </Panel>

      <Panel title="When to train" sub="Minimum labeled data before a model is trained. Lower trains sooner on thinner evidence.">
        <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
          {([["minRows", "Events", 4, 500], ["minClasses", "Sources", 2, 20], ["minSessions", "Sessions", 2, 50]] as const).map(([key, label, lo, hi]) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="text-zinc-400">{label}</span>
              <input
                type="number" min={lo} max={hi} value={draft[key]}
                onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<LearningConfig>)}
                className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100"
              />
            </label>
          ))}
        </div>
      </Panel>

      {log.length > 0 && (
        <Panel title="Settings history">
          <div className="flex flex-col gap-1 text-[10px] font-mono text-zinc-500">
            {log.slice(0, 20).map((c) => (
              <div key={c.id}><span className="text-zinc-400">{new Date(c.ts).toLocaleString()}</span> · {c.summary.join("; ")}</div>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}
