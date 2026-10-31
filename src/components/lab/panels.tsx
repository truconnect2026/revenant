"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Channel, EventLabel } from "@/lib/types";
import { CHANNELS } from "@/lib/types";
import { idbPut, idbPutStoredSessions, idbDelete, type StoredSession } from "@/lib/idb";
import {
  calibrationMatrix, locationEffect, overview, residueQueue, subjectiveTest, thresholdSweep, trainChannel,
  type LabSession,
} from "@/lib/lab/analysis";
import { UNKNOWN, featureVector, fitScaler, scale } from "@/lib/lab/model";
import { pca2 } from "@/lib/lab/pca";
import { recommendThreshold } from "@/lib/lab/sweep";
import { STIMULUS_TYPES } from "@/lib/lab/sources";
import { DEFAULT_THRESHOLDS, loadThresholds, saveThresholds, type ThresholdChange } from "@/lib/lab/thresholds";
import { wilson } from "@/lib/lab/stats";
import { exportDataset, importFiles } from "@/lib/lab/dataset";
import { syncStatus, syncWithServer } from "@/lib/lab/sync";
import {
  CHANNEL_HEX, HeatLegend, HeatMatrix, LearningCurve, Legend, NeedMore, NullHistogram, OTHER, RateIntervals,
  SERIES, Scatter, SweepCharts, fmt, pct, type MatrixCell,
} from "./charts";
import { EventDetail } from "./EventDetail";
import type { GearTrial, LabData } from "./useLabData";

type LabelFn = (sessionId: string, eventId: string, label: EventLabel) => void;

export function Panel({ title, sub, children, right }: { title: string; sub?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="panel-card rounded-lg p-3 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-xs font-semibold uppercase tracking-[0.15em] text-zinc-200">{title}</h2>
          {sub && <p className="mt-1 text-[11px] font-mono text-zinc-500 leading-relaxed">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded bg-black/25 px-3 py-2">
      <div className="text-[10px] font-mono text-zinc-500">{label}</div>
      <div className="text-lg font-mono text-zinc-100 tabular-nums leading-tight">{value}</div>
      {sub && <div className="text-[10px] font-mono text-zinc-500">{sub}</div>}
    </div>
  );
}

export function ChannelPicker({ value, onChange }: { value: Channel; onChange: (c: Channel) => void }) {
  return (
    <div role="radiogroup" aria-label="Channel" className="flex rounded border border-zinc-700 overflow-hidden shrink-0">
      {CHANNELS.map((c) => (
        <button
          key={c}
          role="radio"
          aria-checked={value === c}
          onClick={() => onChange(c)}
          className={`btn-press px-2.5 py-1 text-[10px] font-display font-semibold uppercase tracking-wider ${
            value === c ? "bg-zinc-200 text-zinc-900" : "text-zinc-400"
          }`}
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ background: CHANNEL_HEX[c] }} />
          {c === "sound" ? "SND" : c === "motion" ? "MOT" : "EMF"}
        </button>
      ))}
    </div>
  );
}

const hrs = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`);

// ── 1. Overview ─────────────────────────────────────────────────────────────

export function OverviewPanel({ data }: { data: LabData }) {
  const o = useMemo(() => overview(data.sessions as LabSession[], data.series), [data]);
  const hoursFor = (t: string) => {
    const h = o.hoursByTypeChannel[t];
    return h ? Math.max(h.emf, h.sound, h.motion) : 0;
  };
  return (
    <Panel
      title="Dataset"
      sub="Everything in this lab (this phone, plus anything synced or imported). Hours count only time a channel was actually scoring, so a gap is never counted as quiet."
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Investigations" value={o.sessionsByType.investigation ?? 0} sub={hrs(hoursFor("investigation"))} />
        <Stat label="Control sessions" value={o.sessionsByType.null ?? 0} sub={hrs(hoursFor("null"))} />
        <Stat label="Calibration runs" value={o.sessionsByType.calibration ?? 0} sub={`${o.stimuli} test marks`} />
        <Stat label="Events labeled" value={pct(o.labeledPct)} sub={`${o.totalEvents - (o.eventsByStatus.unlabeled ?? 0)} of ${o.totalEvents}`} />
      </div>
      <div className="grid grid-cols-4 gap-2 text-[10px] font-mono">
        {(["explained", "injected", "unexplained", "unlabeled"] as const).map((k) => (
          <div key={k} className="flex flex-col">
            <span className="text-zinc-500">{k === "injected" ? "test" : k}</span>
            <span className="text-zinc-200 tabular-nums">{o.eventsByStatus[k] ?? 0}</span>
          </div>
        ))}
      </div>
      {o.legacySessions > 0 && (
        <p className="text-[10px] font-mono text-zinc-500">
          {o.legacySessions} older session{o.legacySessions > 1 ? "s were" : " was"} recorded before the learning loop. Their events can be labeled, but they
          have no observation log, so they&apos;re left out of rates and threshold tests.
        </p>
      )}
    </Panel>
  );
}

// ── 2. Model: training, confusion matrix, learning curve, feature map ───────

export function ModelPanel({
  data, channel, setData, onLabel, readOnly = false,
}: {
  data: LabData;
  channel: Channel;
  readOnly?: boolean;
  setData: (fn: (d: LabData) => LabData) => void;
  onLabel: LabelFn;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [normalize, setNormalize] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const versions = data.versions.filter((v) => v.channel === channel);
  const latest = versions[versions.length - 1];

  const train = async () => {
    setBusy(true);
    setNote(null);
    try {
      const out = trainChannel(channel, data.sessions as LabSession[], data.versions);
      if (!out.version) {
        setNote(`Can't train yet: need ${out.readiness.missing.join(", ")}.`);
        return;
      }
      const version = out.version;
      // Store predictions as suggestions only — never as labels.
      const changed: StoredSession[] = [];
      const sessions = data.sessions.map((s) => {
        let touched = false;
        const events = s.events.map((e) => {
          const p = out.predictions.get(e.id);
          if (!p) return e;
          touched = true;
          return {
            ...e,
            label: {
              ...(e.label ?? { status: "unlabeled" as const }),
              modelPrediction: { ...p, modelVersion: version.id },
            },
          };
        });
        if (!touched) return s;
        const ns = { ...s, events };
        changed.push(ns);
        return ns;
      });
      await idbPut("modelVersions", version);
      await idbPutStoredSessions(changed);
      setData((d) => ({ ...d, sessions, versions: [...d.versions, version] }));
      setNote(`Trained ${version.id} on ${version.nSamples} labeled events. ${out.predictions.size} events got a suggestion.`);
    } finally {
      setBusy(false);
    }
  };

  // Feature-space map from all events on this channel that have features.
  const map = useMemo(() => {
    const items: { s: StoredSession; e: StoredSession["events"][number]; x: number[] }[] = [];
    for (const s of data.sessions) for (const e of s.events) {
      if (e.channel !== channel) continue;
      const x = featureVector(e);
      if (x) items.push({ s, e, x });
    }
    if (items.length < 5) return { items, points: [], explained: [0, 0] as [number, number], legend: [] as { name: string; color: string; hollow?: boolean }[] };
    const sc = fitScaler(items.map((i) => i.x));
    const p = pca2(items.map((i) => scale(sc, i.x)));
    // Categorical cap for scatter: the 3 most common sources get a hue; the rest are "Other".
    const counts = new Map<string, number>();
    for (const i of items) {
      const src = i.e.label?.source;
      if (src && (i.e.label?.status === "explained" || i.e.label?.status === "injected")) counts.set(src, (counts.get(src) ?? 0) + 1);
    }
    const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
    const colorOf = (src?: string) => (src && top.includes(src) ? SERIES[top.indexOf(src)] : OTHER);
    const points = items.map((i, k) => {
      const st = i.e.label?.status ?? "unlabeled";
      const known = st === "explained" || st === "injected";
      return {
        id: i.e.id,
        x: p.points[k][0],
        y: p.points[k][1],
        color: known ? colorOf(i.e.label?.source) : OTHER,
        hollow: !known,
        title: `${known ? i.e.label?.source : st} · ${i.e.value} ${i.e.unit} · +${i.e.sigma.toFixed(1)}σ`,
      };
    });
    const legend = [
      ...top.map((t, k) => ({ name: t, color: SERIES[k] })),
      ...(counts.size > 3 ? [{ name: "Other source", color: OTHER }] : []),
      { name: "Not explained", color: OTHER, hollow: true },
    ];
    return { items, points, explained: p.explained, legend };
  }, [data.sessions, channel]);

  const selected = sel ? map.items.find((i) => i.e.id === sel) : undefined;

  const cells: MatrixCell[][] | null = latest
    ? latest.confusion.map((row, i) => {
        const sum = row.reduce((a, b) => a + b, 0);
        return row.map((c, j) => ({
          text: normalize ? pct(sum ? c / sum : NaN) : String(c),
          intensity: sum ? c / sum : 0,
          emphasis: latest.predLabels[j] === latest.classes[i],
          title: `${latest.classes[i]} predicted as ${latest.predLabels[j]}: ${c} of ${sum}`,
        }));
      })
    : null;

  return (
    <>
      <Panel
        title="Source model"
        sub={
          <>
            Learns what each known source looks like from events you explained or tested. Accuracy is measured
            leave-one-session-out, and it says &ldquo;unknown&rdquo; instead of guessing when an event isn&apos;t close to anything it has seen.
          </>
        }
        right={readOnly ? undefined :
          <button
            onClick={train}
            disabled={busy}
            className="btn-press shrink-0 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-display font-semibold uppercase tracking-wider disabled:opacity-50"
          >
            {busy ? "Training…" : "Train model"}
          </button>
        }
      >
        {readOnly && (
          <p className="text-[11px] font-mono text-zinc-400">
            Community models train on the server (daily, or from the Research tab). Showing the latest server run.
          </p>
        )}
        {note && <p className="text-[11px] font-mono text-zinc-300">{note}</p>}
        {!latest ? (
          <NeedMore title="No model yet">
            Label at least 10 {channel} events across 2 sessions with 2 or more different sources, then train.
            Calibration runs are the fastest way to get labeled data.
          </NeedMore>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Accuracy" value={pct(latest.cvAccuracy)} sub={`guess-most-common ${pct(latest.baselineAccuracy)}`} />
              <Stat label="Said unknown" value={pct(latest.rejectRate)} sub="of held-out events" />
              <Stat label="Trained on" value={latest.nSamples} sub={`${latest.nClasses} sources · ${latest.nSessions} sessions`} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[10px] font-display uppercase tracking-[0.15em] text-zinc-400">Confusion matrix · {latest.id}</h3>
              <button onClick={() => setNormalize((n) => !n)} className="text-[10px] font-mono text-zinc-400 underline-offset-2 hover:underline">
                {normalize ? "Show counts" : "Show row %"}
              </button>
            </div>
            {cells && (
              <HeatMatrix rows={latest.classes} cols={latest.predLabels.map((l) => (l === UNKNOWN ? "unknown" : l))} cells={cells} rowHeader="Actual" colHeader="Model said" />
            )}
            <HeatLegend lo="0% of row" hi="100%" />
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] font-mono tabular-nums">
                <thead className="text-zinc-500">
                  <tr><th className="text-left font-normal">Source</th><th className="text-right font-normal">n</th><th className="text-right font-normal">Precision</th><th className="text-right font-normal">Recall</th><th className="text-right font-normal">F1</th></tr>
                </thead>
                <tbody className="text-zinc-300">
                  {latest.perClass.map((c) => (
                    <tr key={c.label} className="border-t border-zinc-800/80">
                      <td className="py-0.5">{c.label}</td>
                      <td className="text-right">{c.support}</td>
                      <td className="text-right">{pct(c.precision)}</td>
                      <td className="text-right">{pct(c.recall)}</td>
                      <td className="text-right">{fmt(c.f1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      <Panel
        title="Learning curve"
        sub="One point per training run. The loop is working when accuracy holds up and the unexplained residue (events neither you nor the model can place) shrinks."
      >
        {versions.length < 2 ? (
          <NeedMore>Train at least twice, labeling more events between runs, to see a trend.</NeedMore>
        ) : (
          <LearningCurve
            xLabels={versions.map((v) => `v${v.version}`)}
            series={[
              { name: "Accuracy", values: versions.map((v) => v.cvAccuracy) },
              { name: "Unknown", values: versions.map((v) => v.rejectRate) },
              { name: "Residue", values: versions.map((v) => v.residue) },
            ]}
          />
        )}
      </Panel>

      <Panel
        title="Feature map"
        sub={
          map.points.length
            ? `Each dot is one ${channel} event, placed by how similar its measurements are (PCA, ${pct(map.explained[0] + map.explained[1])} of variation shown). Tap a dot to inspect and label it.`
            : undefined
        }
      >
        {map.points.length === 0 ? (
          <NeedMore>Need at least 5 {channel} events with measured features ({map.items.length} so far). Events recorded before this update have none.</NeedMore>
        ) : (
          <>
            <Legend items={map.legend} />
            <Scatter points={map.points} selected={sel} onSelect={setSel} />
            {selected && (
              <EventDetail session={selected.s} event={selected.e} readOnly={readOnly} onLabel={(l) => onLabel(selected.s.id, selected.e.id, l)} />
            )}
          </>
        )}
      </Panel>
    </>
  );
}

// ── 3. Calibration detection matrix ─────────────────────────────────────────

export function CalibrationPanel({ data }: { data: LabData }) {
  const m = useMemo(() => calibrationMatrix(data.sessions as LabSession[], data.series), [data]);
  return (
    <Panel
      title="What each sensor catches"
      sub="Every test mark from calibration runs. Each cell: how often that channel logged an event within 2 s before to 4 s after the mark. Outlined cells are the channels that stimulus should reach."
    >
      {m.totalStimuli === 0 ? (
        <NeedMore>Run a Calibrate session and tap test marks (Knock, Voice, Magnet…) as you do them.</NeedMore>
      ) : (
        <>
          <HeatMatrix
            rows={m.rows}
            cols={["EMF", "Sound", "Motion"]}
            rowHeader="Stimulus"
            colHeader="Channel"
            cells={m.rows.map((r) =>
              CHANNELS.map((ch) => {
                const c = m.cells[r][ch];
                return {
                  text: c.n ? pct(c.rate) : "—",
                  sub: c.n ? `${c.hits}/${c.n}` : "off",
                  intensity: c.n ? c.rate : NaN,
                  emphasis: c.expected,
                  title: c.n
                    ? `${r} → ${ch}: ${c.hits} of ${c.n} (95% CI ${pct(c.ci.lo)}–${pct(c.ci.hi)})${Number.isFinite(c.meanLatencyMs) ? `, mean delay ${Math.round(c.meanLatencyMs)} ms` : ""}`
                    : "Channel was off for these marks",
                };
              })
            )}
          />
          <HeatLegend lo="0% caught" hi="100%" />
          <p className="text-[10px] font-mono text-zinc-500">
            {m.totalStimuli} test marks. With few marks per cell the range is wide — a cell showing 3/3 is anywhere from 44% to 100% (95% CI).
          </p>
        </>
      )}
    </Panel>
  );
}

// ── 4. Threshold sweep ──────────────────────────────────────────────────────

export function ThresholdPanel({ data, channel, reload }: { data: LabData; channel: Channel; reload: () => void }) {
  const [maxFp, setMaxFp] = useState(1);
  const [sel, setSel] = useState<number | null>(null);
  const res = useMemo(() => thresholdSweep(channel, data.sessions as LabSession[], data.series), [data, channel]);
  // Read fresh each render: panels only render client-side after data loads.
  const current = (typeof window === "undefined" ? DEFAULT_THRESHOLDS : loadThresholds())[channel];
  const rec = recommendThreshold(res.points, maxFp);
  const shown = res.points.find((p) => p.threshold === (sel ?? rec?.threshold ?? current)) ?? res.points.find((p) => Math.abs(p.threshold - current) < 0.13);
  const ready = res.nullHours > 0 && res.nStimuli >= 3;

  const apply = async () => {
    if (!rec) return;
    if (!window.confirm(`Change the live ${channel} threshold from ${current}σ to ${rec.threshold}σ? You can change it back here any time.`)) return;
    const t = loadThresholds();
    const change: ThresholdChange = {
      id: `threshold:${Date.now()}`, kind: "threshold", ts: Date.now(), channel, from: t[channel], to: rec.threshold,
      reason: `Lab sweep: ${pct(rec.detectionRate)} of ${res.nStimuli} stimuli caught, ${fmt(rec.fpPerHour)} false alarms/h over ${hrs(res.nullHours)} of control (budget ${maxFp}/h)`,
    };
    saveThresholds({ ...t, [channel]: rec.threshold });
    await idbPut("labMeta", change);
    reload();
  };
  const reset = async () => {
    const t = loadThresholds();
    if (t[channel] === DEFAULT_THRESHOLDS[channel]) return;
    const change: ThresholdChange = {
      id: `threshold:${Date.now()}`, kind: "threshold", ts: Date.now(), channel, from: t[channel], to: DEFAULT_THRESHOLDS[channel], reason: "Reset to default",
    };
    saveThresholds({ ...t, [channel]: DEFAULT_THRESHOLDS[channel] });
    await idbPut("labMeta", change);
    reload();
  };

  return (
    <Panel
      title="Threshold test"
      sub="Replays the recorded σ scores at every threshold from 2σ to 8σ: how many known stimuli it would have caught, against how many false alarms it would have raised in control sessions. Bands are 95% intervals."
    >
      {!ready ? (
        <NeedMore>
          Need control-session time and at least 3 test marks on this channel. So far: {hrs(res.nullHours)} of control,
          {" "}{res.nStimuli} usable test marks.
        </NeedMore>
      ) : (
        <>
          <SweepCharts
            points={res.points.map((p) => ({
              threshold: p.threshold, detectionRate: p.detectionRate, detLo: p.detCI.lo, detHi: p.detCI.hi,
              fpPerHour: p.fpPerHour, fpLo: p.fpCI.lo, fpHi: p.fpCI.hi,
            }))}
            color={CHANNEL_HEX[channel]}
            current={current}
            recommended={rec?.threshold ?? null}
            selected={sel}
            onSelect={setSel}
          />
          {shown && (
            <div className="grid grid-cols-3 gap-2">
              <Stat label={`At ${shown.threshold}σ`} value={pct(shown.detectionRate)} sub={`caught ${shown.detected}/${res.nStimuli}`} />
              <Stat label="False alarms" value={`${fmt(shown.fpPerHour, 1)}/h`} sub={`${shown.falseTrips} in ${hrs(res.nullHours)}`} />
              <Stat label="Live now" value={`${current}σ`} sub={rec ? `recommended ${rec.threshold}σ` : "no recommendation"} />
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap text-[11px] font-mono text-zinc-400">
            <label htmlFor="maxfp">False-alarm budget</label>
            <input
              id="maxfp" type="number" min={0} step={0.5} value={maxFp}
              onChange={(e) => setMaxFp(Math.max(0, Number(e.target.value) || 0))}
              className="w-16 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-zinc-200"
            />
            <span>per hour</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={apply}
              disabled={!rec || rec.threshold === current}
              className="btn-press px-3 py-1.5 rounded border border-zinc-500 text-zinc-100 text-[11px] font-mono disabled:opacity-40"
            >
              {rec ? `Apply ${rec.threshold}σ` : "No threshold fits the budget"}
            </button>
            <button onClick={reset} className="btn-press px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 text-[11px] font-mono">
              Reset to {DEFAULT_THRESHOLDS[channel]}σ
            </button>
          </div>
          <p className="text-[10px] font-mono text-zinc-500 leading-relaxed">
            The lab never changes detection on its own. Replay is close to, not identical to, live behaviour: the live
            baseline skips a few samples after each trip, which depends on the threshold in force.
          </p>
        </>
      )}
      {data.thresholdLog.filter((c) => c.channel === channel).length > 0 && (
        <div className="text-[10px] font-mono text-zinc-500 flex flex-col gap-0.5">
          <span className="text-zinc-400">Change log</span>
          {data.thresholdLog.filter((c) => c.channel === channel).map((c) => (
            <span key={c.id}>{new Date(c.ts).toLocaleDateString()} · {c.from}σ → {c.to}σ · {c.reason}</span>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ── 5. Location effect ──────────────────────────────────────────────────────

export function LocationPanel({ data }: { data: LabData }) {
  const { rows, excludedLegacy } = useMemo(() => locationEffect(data.sessions as LabSession[], data.series), [data]);
  return (
    <Panel
      title="Investigation vs control"
      sub="Events per observed hour at investigation sites compared with control sessions, per channel. Test events are left out. p-values are corrected for testing many locations and channels at once (Benjamini–Hochberg)."
    >
      {rows.length === 0 ? (
        <NeedMore>Need observed hours in both an investigation and a control session. Label sessions with a location name to compare sites.</NeedMore>
      ) : (
        <>
          <Legend items={[{ name: "Investigation", color: "#e4e4e7" }, { name: "Control", color: OTHER }]} />
          <div className="flex flex-col divide-y divide-zinc-800/80">
            {rows.map((r) => {
              const max = Math.max(r.ciA.hi, r.ciB.hi, 1e-9) * 1.05;
              return (
                <div key={r.group + r.channel} className="py-2 flex flex-col gap-1 text-[11px] font-mono">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: CHANNEL_HEX[r.channel] }} />
                    <span className="text-zinc-200 truncate">{r.group}</span>
                    <span className="text-zinc-500 uppercase text-[10px] shrink-0">{r.channel}</span>
                  </div>
                  <div className={`text-[10px] ${r.pAdj < 0.05 && r.rateA > r.rateB ? "text-rose-300" : "text-zinc-400"}`}>
                    {r.verdict}
                  </div>
                  <div className="flex items-center gap-3">
                    <RateIntervals
                      a={{ v: r.rateA, lo: r.ciA.lo, hi: r.ciA.hi }}
                      b={{ v: r.rateB, lo: r.ciB.lo, hi: r.ciB.hi }}
                      max={max}
                      colorA="#e4e4e7"
                    />
                    <div className="text-[10px] text-zinc-400 tabular-nums leading-snug">
                      <div>{fmt(r.rateA, 1)}/h <span className="text-zinc-600">({r.countA} in {hrs(r.hoursA)})</span></div>
                      <div>{fmt(r.rateB, 1)}/h <span className="text-zinc-600">({r.countB} in {hrs(r.hoursB)})</span></div>
                    </div>
                    <div className="ml-auto text-right text-[10px] tabular-nums text-zinc-500">
                      <div>×{fmt(r.ratio, 1)}</div>
                      <div>p={fmt(r.pAdj, 3)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {excludedLegacy > 0 && <p className="text-[10px] font-mono text-zinc-500">{excludedLegacy} session(s) without an observation log were left out.</p>}
    </Panel>
  );
}

// ── 6. Felt something vs sensors ────────────────────────────────────────────

export function FeltPanel({ data }: { data: LabData }) {
  const [blindOnly, setBlindOnly] = useState(true);
  const r = useMemo(() => subjectiveTest(data.sessions as LabSession[], { blindOnly }), [data, blindOnly]);
  const mean = r.null.length ? r.null.reduce((a, b) => a + b, 0) / r.null.length : NaN;
  return (
    <Panel
      title="Felt something vs sensors"
      sub={`Do "felt something" marks land within ${r.windowS} s of a sensor event more often than chance? Chance is found by moving each mark to a random time in its own session, ${r.iterations.toLocaleString()} times.`}
      right={
        <button onClick={() => setBlindOnly((b) => !b)} className="shrink-0 text-[10px] font-mono text-zinc-400 underline-offset-2 hover:underline">
          {blindOnly ? "Blind marks only" : "All marks"}
        </button>
      }
    >
      {r.marks < 3 ? (
        <NeedMore>
          Need at least 3 {blindOnly ? "blind " : ""}marks in finished sessions ({r.marks} so far{blindOnly ? `; ${r.blindMarks} blind in total` : ""}).
          Blind marks are the fair test — the screen can&apos;t prompt them.
        </NeedMore>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Marks near an event" value={pct(r.observed)} sub={`${r.marks} marks`} />
            <Stat label="By chance" value={pct(mean)} sub="shuffled average" />
            <Stat label="p" value={fmt(r.p, 3)} sub={r.p < 0.05 ? "above chance" : "not above chance"} />
          </div>
          <NullHistogram values={r.null} observed={r.observed} />
        </>
      )}
    </Panel>
  );
}

// ── 7. Residue queue ────────────────────────────────────────────────────────

export function ResiduePanel({ data, channel, onLabel, readOnly = false }: { data: LabData; channel: Channel; onLabel: LabelFn; readOnly?: boolean }) {
  const [limit, setLimit] = useState(10);
  const [view, setView] = useState<"residue" | "review">("residue");
  const q = useMemo(() => residueQueue(data.sessions as LabSession[], channel), [data, channel]);
  // Unlabeled events the model has a lead on. They don't count as residue, but a
  // human should confirm or correct them — a model suggestion is never a label.
  const review = useMemo(() => {
    const out: { session: StoredSession; event: StoredSession["events"][number] }[] = [];
    for (const s of data.sessions) for (const e of s.events) {
      const p = e.label?.modelPrediction;
      if (e.channel === channel && (e.label?.status ?? "unlabeled") === "unlabeled" && p && p.source !== UNKNOWN) out.push({ session: s, event: e });
    }
    return out.sort((a, b) => (a.event.label?.modelPrediction?.confidence ?? 0) - (b.event.label?.modelPrediction?.confidence ?? 0));
  }, [data.sessions, channel]);
  const list = view === "residue" ? q : review;

  return (
    <Panel
      title={view === "residue" ? "Residue queue" : "Suggestions to confirm"}
      sub={
        view === "residue"
          ? "Events nobody has explained and the model can't place, strongest first. Each one you explain teaches the next training run; whatever survives is what's genuinely unaccounted for."
          : "Unlabeled events the model thinks it recognises, least confident first. Confirm or correct them — only your labels are used for training."
      }
    >
      <div role="radiogroup" aria-label="Queue" className="flex rounded border border-zinc-700 overflow-hidden self-start">
        {([["residue", `Unaccounted (${q.length})`], ["review", `To confirm (${review.length})`]] as const).map(([id, name]) => (
          <button
            key={id}
            role="radio"
            aria-checked={view === id}
            onClick={() => { setView(id); setLimit(10); }}
            className={`btn-press px-2.5 py-1 text-[10px] font-mono ${view === id ? "bg-zinc-200 text-zinc-900" : "text-zinc-400"}`}
          >
            {name}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <NeedMore title="Queue empty">
          {view === "residue" ? `No unaccounted ${channel} events right now.` : `No model suggestions waiting. Train the model to get some.`}
        </NeedMore>
      ) : (
        <div className="flex flex-col gap-2">
          {list.slice(0, limit).map(({ session, event }) => (
            <EventDetail
              key={event.id}
              session={session as StoredSession}
              event={event}
              readOnly={readOnly}
              onLabel={(l) => onLabel(session.id, event.id, l)}
            />
          ))}
          {list.length > limit && (
            <button onClick={() => setLimit((l) => l + 10)} className="btn-press self-center px-3 py-1 rounded border border-zinc-700 text-zinc-400 text-[10px] font-mono">
              Show more ({list.length - limit} left)
            </button>
          )}
        </div>
      )}
    </Panel>
  );
}

// ── 8. Gear test log ────────────────────────────────────────────────────────

export function GearPanel({ data, reload }: { data: LabData; reload: () => void }) {
  const [device, setDevice] = useState("");
  const [trialType, setTrialType] = useState<GearTrial["trialType"]>("stimulus");
  const [stimulus, setStimulus] = useState(STIMULUS_TYPES[0].type);
  const [notes, setNotes] = useState("");
  const devices = Array.from(new Set(data.gear.map((g) => g.device)));

  const log = async (triggered: boolean) => {
    const d = device.trim();
    if (!d) return;
    const t: GearTrial = {
      id: crypto.randomUUID(), ts: Date.now(), device: d, trialType,
      stimulus: trialType === "stimulus" ? stimulus : undefined, triggered, notes: notes.trim() || undefined,
    };
    await idbPut("gearTrials", t);
    setNotes("");
    reload();
  };

  const summary = devices.map((d) => {
    const trials = data.gear.filter((g) => g.device === d);
    const by = (t: GearTrial["trialType"]) => {
      const xs = trials.filter((g) => g.trialType === t);
      const k = xs.filter((g) => g.triggered).length;
      return { k, n: xs.length, ci: wilson(k, xs.length) };
    };
    return { d, stim: by("stimulus"), nul: by("null"), inv: by("investigation") };
  });

  const cell = (c: { k: number; n: number; ci: { lo: number; hi: number } }) =>
    c.n ? (
      <span title={`95% CI ${pct(c.ci.lo)}–${pct(c.ci.hi)}`}>
        {pct(c.k / c.n)} <span className="text-zinc-600">{c.k}/{c.n}</span>
      </span>
    ) : <span className="text-zinc-600">—</span>;

  return (
    <Panel
      title="Gear test log"
      sub="Test other ghost-hunting devices the same way: log each trial on a known stimulus and in a control setting. A useful device triggers on what it claims to sense and stays quiet in control."
    >
      <div className="flex flex-col gap-2 text-[11px] font-mono">
        <input
          list="gear-devices" value={device} onChange={(e) => setDevice(e.target.value)} placeholder="Device (e.g. K-II meter)"
          aria-label="Device name"
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 placeholder:text-zinc-600"
        />
        <datalist id="gear-devices">{devices.map((d) => <option key={d} value={d} />)}</datalist>
        <div className="flex gap-2 flex-wrap">
          <select value={trialType} onChange={(e) => setTrialType(e.target.value as GearTrial["trialType"])} aria-label="Trial type"
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200">
            <option value="stimulus">Known stimulus</option>
            <option value="null">Control (nothing done)</option>
            <option value="investigation">Investigation</option>
          </select>
          {trialType === "stimulus" && (
            <select value={stimulus} onChange={(e) => setStimulus(e.target.value)} aria-label="Stimulus"
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200">
              {STIMULUS_TYPES.map((s) => <option key={s.type}>{s.type}</option>)}
            </select>
          )}
        </div>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" aria-label="Notes"
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 placeholder:text-zinc-600" />
        <div className="flex gap-2">
          <button onClick={() => log(true)} disabled={!device.trim()} className="btn-press flex-1 py-2 rounded border border-zinc-500 text-zinc-100 disabled:opacity-40">It triggered</button>
          <button onClick={() => log(false)} disabled={!device.trim()} className="btn-press flex-1 py-2 rounded border border-zinc-700 text-zinc-300 disabled:opacity-40">It didn&apos;t</button>
        </div>
      </div>
      {summary.length === 0 ? (
        <NeedMore title="No trials yet">Log a few stimulus trials and a few control trials per device.</NeedMore>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] font-mono tabular-nums">
            <thead className="text-zinc-500">
              <tr><th className="text-left font-normal">Device</th><th className="text-right font-normal">Stimulus</th><th className="text-right font-normal">Control</th><th className="text-right font-normal">Investig.</th></tr>
            </thead>
            <tbody className="text-zinc-300">
              {summary.map((s) => (
                <tr key={s.d} className="border-t border-zinc-800/80">
                  <td className="py-1 pr-2">{s.d}</td>
                  <td className="text-right">{cell(s.stim)}</td>
                  <td className="text-right">{cell(s.nul)}</td>
                  <td className="text-right">{cell(s.inv)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[10px] font-mono text-zinc-500">Trigger rate (hits/trials). Tap or hover a rate for its 95% interval.</p>
        </div>
      )}
      {data.gear.length > 0 && (
        <details className="text-[10px] font-mono text-zinc-500">
          <summary className="cursor-pointer">All trials ({data.gear.length})</summary>
          <div className="mt-1 flex flex-col gap-0.5">
            {data.gear.slice(0, 50).map((g) => (
              <div key={g.id} className="flex gap-2">
                <span>{new Date(g.ts).toLocaleDateString()}</span>
                <span className="text-zinc-300">{g.device}</span>
                <span>{g.trialType}{g.stimulus ? `:${g.stimulus}` : ""}</span>
                <span className={g.triggered ? "text-zinc-200" : ""}>{g.triggered ? "triggered" : "quiet"}</span>
                <button onClick={async () => { await idbDelete("gearTrials", g.id); reload(); }} className="ml-auto text-zinc-600 hover:text-zinc-300">remove</button>
              </div>
            ))}
          </div>
        </details>
      )}
    </Panel>
  );
}

// ── 9. Data in / out ────────────────────────────────────────────────────────

export function DataPanel({ reload }: { reload: () => void }) {
  const [audio, setAudio] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [server, setServer] = useState<{ configured: boolean; missing: string[] } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    syncStatus().then(setServer).catch(() => setServer(null));
  }, []);

  const doExport = async () => {
    setMsg("Exporting…");
    const blob = await exportDataset(audio);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `revenant-dataset-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg(`Exported ${(blob.size / 1024 / 1024).toFixed(1)} MB.`);
  };
  const doImport = async (files: File[]) => {
    try {
      setMsg("Importing…");
      const s = await importFiles(files);
      const parts = [
        s.datasets && `${s.datasets} dataset file${s.datasets > 1 ? "s" : ""}`,
        s.legacySessions && `${s.legacySessions} session file${s.legacySessions > 1 ? "s" : ""}`,
        s.clipsMatched && `${s.clipsMatched} audio clip${s.clipsMatched > 1 ? "s" : ""}`,
      ].filter(Boolean);
      const warn = [
        s.clipsUnmatched ? `${s.clipsUnmatched} audio file(s) didn't match a session — import the session's JSON in the same pick` : "",
        s.skipped.length ? `skipped ${s.skipped.join(", ")}` : "",
      ].filter(Boolean);
      setMsg(`Imported ${parts.join(", ") || "nothing"}.${warn.length ? ` ${warn.join("; ")}.` : ""}`);
      reload();
    } catch (e) {
      setMsg(`Import failed: ${String(e instanceof Error ? e.message : e)}`);
    }
  };
  const doSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await syncWithServer(setSyncMsg);
      setSyncMsg(
        `Synced. Sent ${r.sessionsPushed} sessions, ${r.chunksPushed} score logs, ${r.clipsPushed} clips. ` +
          `Received ${r.sessionsPulled} sessions, ${r.chunksPulled} score logs.`
      );
      reload();
    } catch (e) {
      setSyncMsg(`Sync stopped: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <Panel
        title="Server sync"
        sub="Combine the data from every phone on your server, so the lab can analyse all of it. Merging is by id and never replaces a newer label with an older one. Audio from other phones streams on demand."
      >
        {server === null ? (
          <p className="text-[11px] font-mono text-zinc-500">Couldn&apos;t reach the server.</p>
        ) : !server.configured ? (
          <NeedMore title="Not set up on this deployment">
            Add these to the Vercel project, then redeploy: {server.missing.join("; ")}.
          </NeedMore>
        ) : (
          <div className="flex flex-col gap-2">
            <button
              onClick={doSync}
              disabled={syncing}
              className="btn-press self-start px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-display font-semibold uppercase tracking-wider disabled:opacity-50"
            >
              {syncing ? "Syncing…" : "Sync now"}
            </button>
            {syncMsg && <p className="text-[11px] font-mono text-zinc-300">{syncMsg}</p>}
          </div>
        )}
      </Panel>
      <Panel
        title="Files"
        sub="Export a full dataset file, or import one. Import also takes the per-session JSON and audio files from the original app's Past Sessions export — pick them together."
      >
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-zinc-400">
          <button onClick={doExport} className="btn-press px-3 py-1.5 rounded border border-zinc-500 text-zinc-100 text-[10px] font-display uppercase tracking-wider">Export dataset</button>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} /> include audio clips
          </label>
          <button onClick={() => fileRef.current?.click()} className="btn-press px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 text-[10px] font-display uppercase tracking-wider">Import files</button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="application/json,.json,audio/wav,audio/webm,.wav,.webm"
            className="hidden"
            onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) doImport(fs); e.target.value = ""; }}
          />
        </div>
        {msg && <p className="text-[11px] font-mono text-zinc-300">{msg}</p>}
      </Panel>
    </>
  );
}
