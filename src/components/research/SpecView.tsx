import type { Channel } from "@/lib/types";
import { CHANNELS } from "@/lib/types";
import type { SpecSheet } from "@/lib/research/spec";
import { HeatMatrix, HeatLegend } from "@/components/lab/charts";

const CH: Record<Channel, string> = { emf: "EMF", sound: "Sound", motion: "Motion" };
const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : "—");
const n1 = (v: number) => (Number.isFinite(v) ? (v < 10 ? v.toFixed(1) : v.toFixed(0)) : "—");
const hrs = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`);

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-sm font-semibold uppercase tracking-[0.15em] text-zinc-200 mt-2">{children}</h2>;
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded bg-black/25 px-3 py-2 spec-box">
      <div className="text-[11px] font-mono text-zinc-500">{label}</div>
      <div className="text-xl font-mono text-zinc-100 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] font-mono text-zinc-500">{sub}</div>}
    </div>
  );
}

/** The model spec sheet: dataset, channel performance, models, method and limits. */
export function SpecView({ spec }: { spec: SpecSheet }) {
  const d = spec.dataset;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Sessions" value={d.sessions} sub={d.contributors ? `${d.contributors} contributor${d.contributors === 1 ? "" : "s"}` : spec.source} />
        <Stat label="Control recording" value={hrs(d.hours.null)} sub="false-alarm baseline" />
        <Stat label="Calibration marks" value={d.stimuli} sub="known test events" />
        <Stat label="Events labeled" value={pct(d.labeledPct)} sub={`of ${d.events}`} />
      </div>

      <H2>Channel performance</H2>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] font-mono tabular-nums">
          <thead className="text-zinc-500 text-left">
            <tr><th className="font-normal py-1">Channel</th><th className="font-normal">Threshold</th><th className="font-normal">Stimuli caught</th><th className="font-normal">False alarms/h</th><th className="font-normal">Suggested</th></tr>
          </thead>
          <tbody className="text-zinc-300">
            {CHANNELS.map((ch) => {
              const c = spec.channels[ch];
              const a = c.atThreshold;
              return (
                <tr key={ch} className="border-t border-zinc-800/80 align-top">
                  <td className="py-1.5">{CH[ch]}</td>
                  <td>{c.threshold}σ</td>
                  <td>{a && c.nStimuli ? <>{pct(a.detectionRate)} <span className="text-zinc-500">{a.detected}/{c.nStimuli}<br />{pct(a.detLo)}–{pct(a.detHi)}</span></> : <span className="text-zinc-600">no tests</span>}</td>
                  <td>{a && c.nullHours ? <>{n1(a.fpPerHour)} <span className="text-zinc-500">in {hrs(c.nullHours)}<br />{n1(a.fpLo)}–{n1(a.fpHi)}</span></> : <span className="text-zinc-600">no control</span>}</td>
                  <td>{c.recommended ? `${c.recommended.threshold}σ` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-1 text-[11px] font-mono text-zinc-500">Ranges are 95% intervals. Suggested = most detections with at most 1 false alarm per hour.</p>
      </div>

      <H2>What each sensor catches</H2>
      {spec.calibration.totalStimuli === 0 ? (
        <p className="text-zinc-500 font-mono text-[12px]">No calibration marks yet.</p>
      ) : (
        <>
          <HeatMatrix
            rows={spec.calibration.rows}
            cols={CHANNELS.map((c) => CH[c])}
            rowHeader="Stimulus"
            colHeader="Channel"
            cells={spec.calibration.rows.map((r) => CHANNELS.map((ch) => {
              const c = spec.calibration.cells[r][ch];
              return { text: c.n ? pct(c.rate) : "—", sub: c.n ? `${c.hits}/${c.n}` : "off", intensity: c.n ? c.rate : NaN, emphasis: c.expected };
            }))}
          />
          <HeatLegend lo="0% caught" hi="100%" />
        </>
      )}

      <H2>Source models</H2>
      {CHANNELS.every((ch) => !spec.channels[ch].model) ? (
        <p className="text-zinc-500 font-mono text-[12px]">Not enough labeled events to train a model yet.</p>
      ) : (
        CHANNELS.map((ch) => {
          const m = spec.channels[ch].model;
          if (!m) return null;
          return (
            <div key={ch} className="flex flex-col gap-2">
              <div className="font-mono text-[12px] text-zinc-300">
                {CH[ch]} · {m.id} · trained {new Date(m.trainedAt).toISOString().slice(0, 10)} · {m.nSamples} events, {m.nSessions} sessions
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Accuracy" value={pct(m.cvAccuracy)} sub={`baseline ${pct(m.baselineAccuracy)}`} />
                <Stat label="Said unknown" value={pct(m.rejectRate)} />
                <Stat label="Unexplained residue" value={pct(m.residue)} />
              </div>
              <HeatMatrix
                rows={m.classes}
                cols={m.predLabels}
                rowHeader="Actual"
                colHeader="Model said"
                cells={m.confusion.map((row, i) => {
                  const sum = row.reduce((a, b) => a + b, 0);
                  return row.map((c, j) => ({ text: String(c), intensity: sum ? c / sum : 0, emphasis: m.predLabels[j] === m.classes[i] }));
                })}
              />
              <p className="text-[11px] font-mono text-zinc-500">
                k-nearest-neighbours (k=5) on {m.featureSet.length} measured features: {m.featureSet.join(", ")}. Scored leave-one-session-out.
              </p>
            </div>
          );
        })
      )}

      {spec.places.length > 0 && (
        <>
          <H2>Place types vs control</H2>
          <table className="w-full text-[12px] font-mono tabular-nums">
            <thead className="text-zinc-500 text-left"><tr><th className="font-normal py-1">Place</th><th className="font-normal">Channel</th><th className="font-normal">Rate</th><th className="font-normal">Control</th><th className="font-normal">Adj. p</th></tr></thead>
            <tbody className="text-zinc-300">
              {spec.places.map((p) => (
                <tr key={p.group + p.channel} className="border-t border-zinc-800/80">
                  <td className="py-1">{p.group}</td><td>{CH[p.channel]}</td><td>{n1(p.rateA)}/h</td><td>{n1(p.rateB)}/h</td><td>{p.pAdj.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {spec.felt && (
        <>
          <H2>Felt something vs sensors</H2>
          <p className="text-zinc-400">
            {pct(spec.felt.observed)} of {spec.felt.marks} blind marks had a sensor event within 3 s; chance level {pct(spec.felt.chance)} (permutation p = {spec.felt.p.toFixed(3)}).
          </p>
        </>
      )}

      {spec.gear.length > 0 && (
        <>
          <H2>Other gear tested</H2>
          <table className="w-full text-[12px] font-mono tabular-nums">
            <thead className="text-zinc-500 text-left"><tr><th className="font-normal py-1">Device</th><th className="font-normal">On known stimuli</th><th className="font-normal">In control</th></tr></thead>
            <tbody className="text-zinc-300">
              {spec.gear.map((g) => (
                <tr key={g.device} className="border-t border-zinc-800/80">
                  <td className="py-1">{g.device}</td>
                  <td>{g.stimulus.n ? `${pct(g.stimulus.k / g.stimulus.n)} (${g.stimulus.k}/${g.stimulus.n})` : "—"}</td>
                  <td>{g.control.n ? `${pct(g.control.k / g.control.n)} (${g.control.k}/${g.control.n})` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <H2>Method</H2>
      <ul className="list-disc pl-5 text-zinc-400 leading-relaxed flex flex-col gap-1">{spec.methods.map((m, i) => <li key={i}>{m}</li>)}</ul>
      <H2>Limitations</H2>
      <ul className="list-disc pl-5 text-zinc-400 leading-relaxed flex flex-col gap-1">{spec.limitations.map((m, i) => <li key={i}>{m}</li>)}</ul>
      <p className="text-[11px] font-mono text-zinc-500">
        Generated {new Date(spec.generatedAt).toISOString().replace("T", " ").slice(0, 16)} UTC from the {spec.source} dataset · {spec.id}
      </p>
    </div>
  );
}
