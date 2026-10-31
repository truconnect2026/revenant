"use client";
// Small, dependency-free SVG/HTML charts for the lab. Dark surface only (the
// app is dark-only). Colors: channel identity uses the app's channel hues;
// multi-series charts use the validated categorical slots below (checked with
// the dataviz validator against the panel surface, all-pairs, dark mode).
import { useMemo, useRef, useState, type ReactNode } from "react";

export const SERIES = ["#3987e5", "#d95926", "#199e70"] as const;
export const OTHER = "#71717a";
export const GRID = "rgba(255,255,255,0.07)";
export const AXIS = "rgba(255,255,255,0.18)";
export const INK = { primary: "#f4f4f5", secondary: "#a1a1aa", muted: "#71717a" };
export const CHANNEL_HEX = { emf: "#22d3ee", sound: "#34d399", motion: "#fbbf24" } as const;

const W = 360;

export function pct(v: number, digits = 0): string {
  return Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : "—";
}
export function fmt(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return v === Infinity ? "∞" : "—";
  return v.toFixed(digits);
}

// ── Empty state ─────────────────────────────────────────────────────────────

export function NeedMore({ title = "Not enough data yet", children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded border border-dashed border-zinc-700 px-3 py-4 text-center">
      <p className="text-[11px] font-display uppercase tracking-[0.15em] text-zinc-400">{title}</p>
      <div className="mt-1 text-[11px] font-mono text-zinc-500 leading-relaxed">{children}</div>
    </div>
  );
}

// ── Heat matrix (confusion matrix, detection matrix) ────────────────────────

export interface MatrixCell {
  text: string;
  sub?: string;
  /** 0–1 intensity for the single-hue sequential fill. */
  intensity: number;
  title?: string;
  emphasis?: boolean; // outline (e.g. the diagonal, or an expected channel)
}

/** Single-hue (blue) sequential fill: low values recede toward the surface. */
function heat(i: number): string {
  const a = Number.isFinite(i) ? 0.06 + Math.max(0, Math.min(1, i)) * 0.74 : 0.02;
  return `rgba(57,135,229,${a.toFixed(3)})`;
}

export function HeatMatrix({
  rows, cols, cells, rowHeader, colHeader, onCell,
}: {
  rows: string[];
  cols: string[];
  cells: MatrixCell[][];
  rowHeader?: string;
  colHeader?: string;
  onCell?: (r: number, c: number) => void;
}) {
  return (
    <div className="overflow-x-auto scrollbar-thin">
      {colHeader && (
        <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 mb-1" style={{ paddingLeft: 72 }}>
          {colHeader} →
        </div>
      )}
      <div
        className="grid gap-[2px] text-[10px] font-mono"
        style={{ gridTemplateColumns: `68px repeat(${cols.length}, minmax(34px, 1fr))` }}
      >
        <div className="text-[9px] uppercase tracking-wider text-zinc-500 self-end pb-1">{rowHeader ?? ""}</div>
        {cols.map((c) => (
          <div key={c} className="text-zinc-400 text-center truncate self-end pb-1" title={c}>{c}</div>
        ))}
        {rows.map((r, i) => (
          <MatrixRow key={r} label={r} cells={cells[i]} onCell={onCell ? (c) => onCell(i, c) : undefined} />
        ))}
      </div>
    </div>
  );
}

function MatrixRow({ label, cells, onCell }: { label: string; cells: MatrixCell[]; onCell?: (c: number) => void }) {
  return (
    <>
      <div className="text-zinc-300 truncate self-center pr-1" title={label}>{label}</div>
      {cells.map((cell, j) => (
        <button
          key={j}
          type="button"
          onClick={onCell ? () => onCell(j) : undefined}
          title={cell.title}
          className={`rounded-[3px] px-1 py-1.5 text-center tabular-nums ${onCell ? "btn-press" : "cursor-default"}`}
          style={{
            background: heat(cell.intensity),
            boxShadow: cell.emphasis ? "inset 0 0 0 1px rgba(255,255,255,0.45)" : undefined,
          }}
        >
          <div className="text-zinc-100 leading-tight">{cell.text}</div>
          {cell.sub && <div className="text-[9px] text-zinc-300/80 leading-tight">{cell.sub}</div>}
        </button>
      ))}
    </>
  );
}

export function HeatLegend({ lo, hi }: { lo: string; hi: string }) {
  return (
    <div className="flex items-center gap-2 text-[9px] font-mono text-zinc-500">
      <span>{lo}</span>
      <span className="h-2 w-24 rounded-sm" style={{ background: `linear-gradient(90deg, ${heat(0)}, ${heat(1)})` }} />
      <span>{hi}</span>
    </div>
  );
}

// ── Threshold sweep: two small multiples sharing the threshold axis ─────────

export interface SweepPointView {
  threshold: number;
  detectionRate: number;
  detLo: number;
  detHi: number;
  fpPerHour: number;
  fpLo: number;
  fpHi: number;
}

export function SweepCharts({
  points, color, current, recommended, selected, onSelect,
}: {
  points: SweepPointView[];
  color: string;
  current: number;
  recommended: number | null;
  selected: number | null;
  onSelect: (t: number) => void;
}) {
  const H = 120;
  const TOP = 14; // row for the "now" / "rec" marker labels
  const pad = { l: 34, r: 10, t: 16, b: 18 };
  const xs = points.map((p) => p.threshold);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const x = (t: number) => pad.l + ((t - x0) / Math.max(x1 - x0, 1e-9)) * (W - pad.l - pad.r);
  const fpMax = useMemo(() => {
    const m = Math.max(...points.map((p) => (Number.isFinite(p.fpHi) ? p.fpHi : 0)), 1);
    return niceCeil(Math.min(m, 60));
  }, [points]);
  const svgRef = useRef<SVGSVGElement>(null);

  const pick = (clientX: number) => {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vx = ((clientX - rect.left) / rect.width) * W;
    let best = points[0].threshold;
    for (const p of points) if (Math.abs(x(p.threshold) - vx) < Math.abs(x(best) - vx)) best = p.threshold;
    onSelect(best);
  };

  const panel = (
    key: string,
    top: number,
    title: string,
    yMax: number,
    yTicks: number[],
    yLabel: (v: number) => string,
    val: (p: SweepPointView) => number,
    lo: (p: SweepPointView) => number,
    hi: (p: SweepPointView) => number
  ) => {
    const y = (v: number) => top + pad.t + (1 - Math.min(v, yMax) / yMax) * (H - pad.t - pad.b);
    const ok = points.filter((p) => Number.isFinite(val(p)));
    const line = ok.map((p, i) => `${i ? "L" : "M"}${x(p.threshold).toFixed(1)},${y(val(p)).toFixed(1)}`).join("");
    const band =
      ok.length > 1
        ? ok.map((p, i) => `${i ? "L" : "M"}${x(p.threshold).toFixed(1)},${y(hi(p)).toFixed(1)}`).join("") +
          [...ok].reverse().map((p) => `L${x(p.threshold).toFixed(1)},${y(lo(p)).toFixed(1)}`).join("") + "Z"
        : "";
    return (
      <g key={key}>
        <text x={pad.l} y={top + 10} fill={INK.secondary} fontSize={10} stroke="#1b1e24" strokeWidth={4} paintOrder="stroke">{title}</text>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} />
            <text x={pad.l - 4} y={y(t) + 3} fill={INK.muted} fontSize={9} textAnchor="end">{yLabel(t)}</text>
          </g>
        ))}
        {band && <path d={band} fill={color} opacity={0.14} />}
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        {selected !== null && ok.find((p) => p.threshold === selected) && (
          <circle
            cx={x(selected)}
            cy={y(val(ok.find((p) => p.threshold === selected)!))}
            r={4}
            fill={color}
            stroke="#14171c"
            strokeWidth={2}
          />
        )}
      </g>
    );
  };

  const total = H * 2 + 14 + TOP;
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${total}`}
      width="100%"
      role="img"
      aria-label="Detection rate and false alarms per hour at each threshold"
      onPointerDown={(e) => pick(e.clientX)}
      onPointerMove={(e) => { if (e.buttons || e.pointerType === "mouse") pick(e.clientX); }}
      style={{ touchAction: "pan-y", cursor: "crosshair" }}
    >
      {panel("det", TOP, "Known stimuli caught", 1, [0, 0.5, 1], (v) => `${v * 100}%`, (p) => p.detectionRate, (p) => p.detLo, (p) => p.detHi)}
      {panel("fp", TOP + H, "False alarms per hour (control)", fpMax, [0, fpMax / 2, fpMax], (v) => fmt(v, v < 10 ? 1 : 0), (p) => p.fpPerHour, (p) => p.fpLo, (p) => p.fpHi)}
      {/* shared x axis */}
      {[2, 3, 4, 5, 6, 7, 8].filter((t) => t >= x0 && t <= x1).map((t) => (
        <text key={t} x={x(t)} y={total - 2} fill={INK.muted} fontSize={9} textAnchor="middle">{t}σ</text>
      ))}
      {recommended === current ? (
        <Marker x={x(current)} top={0} bottom={total - 12} label="now = rec" color={color} />
      ) : (
        <>
          <Marker x={x(current)} top={0} bottom={total - 12} label="now" color={INK.secondary} />
          {recommended !== null && <Marker x={x(recommended)} top={0} bottom={total - 12} label="rec" color={color} />}
        </>
      )}
      {selected !== null && <line x1={x(selected)} x2={x(selected)} y1={TOP + 4} y2={total - 12} stroke="rgba(255,255,255,0.25)" />}
    </svg>
  );
}

function Marker({ x, top, bottom, label, color }: { x: number; top: number; bottom: number; label: string; color: string }) {
  return (
    <g>
      <line x1={x} x2={x} y1={top + 13} y2={bottom} stroke={color} strokeWidth={1} />
      <text x={x} y={top + 10} fill={color} fontSize={9} textAnchor="middle">{label}</text>
    </g>
  );
}

function niceCeil(v: number): number {
  if (v <= 1) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

// ── Learning curve: up to 3 percentage series over model versions ───────────

export function LearningCurve({
  series, xLabels,
}: {
  series: { name: string; values: number[] }[];
  xLabels: string[];
}) {
  const H = 170;
  const pad = { l: 34, r: 36, t: 10, b: 20 };
  const n = xLabels.length;
  const x = (i: number) => pad.l + (n <= 1 ? (W - pad.l - pad.r) / 2 : (i / (n - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v) * (H - pad.t - pad.b);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const onMove = (clientX: number) => {
    const el = svgRef.current;
    if (!el || n === 0) return;
    const rect = el.getBoundingClientRect();
    const vx = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 0; i < n; i++) if (Math.abs(x(i) - vx) < Math.abs(x(best) - vx)) best = i;
    setHover(best);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Legend items={series.map((s, i) => ({ name: s.name, color: SERIES[i] }))} />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Model accuracy, reject rate and unexplained residue across training runs"
        onPointerDown={(e) => onMove(e.clientX)}
        onPointerMove={(e) => onMove(e.clientX)}
        onPointerLeave={() => setHover(null)}
        style={{ touchAction: "pan-y" }}
      >
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} />
            <text x={pad.l - 4} y={y(t) + 3} fill={INK.muted} fontSize={9} textAnchor="end">{t * 100}%</text>
          </g>
        ))}
        {xLabels.map((l, i) => (
          <text key={l + i} x={x(i)} y={H - 4} fill={INK.muted} fontSize={9} textAnchor="middle">{l}</text>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="rgba(255,255,255,0.22)" />}
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => ({ v, i })).filter((p) => Number.isFinite(p.v));
          const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
          const last = pts[pts.length - 1];
          return (
            <g key={s.name}>
              <path d={d} fill="none" stroke={SERIES[si]} strokeWidth={2} strokeLinejoin="round" />
              {pts.map((p) => (
                <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={hover === p.i ? 4.5 : 3} fill={SERIES[si]} stroke="#14171c" strokeWidth={2} />
              ))}
              {last && (
                <text x={x(last.i) + 8} y={y(last.v) + 3} fill={INK.secondary} fontSize={9}>
                  {pct(last.v)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="text-[10px] font-mono text-zinc-400 flex flex-wrap gap-x-3">
          <span className="text-zinc-300">{xLabels[hover]}</span>
          {series.map((s, i) => (
            <span key={s.name}>
              <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: SERIES[i] }} />
              {s.name} {pct(s.values[hover])}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string; hollow?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono text-zinc-400">
      {items.map((it) => (
        <span key={it.name} className="flex items-center gap-1">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={it.hollow ? { boxShadow: `inset 0 0 0 1.5px ${it.color}` } : { background: it.color }}
          />
          {it.name}
        </span>
      ))}
    </div>
  );
}

// ── Scatter (feature-space map) ─────────────────────────────────────────────

export interface ScatterPoint {
  id: string;
  x: number;
  y: number;
  color: string;
  hollow?: boolean;
  title: string;
}

export function Scatter({ points, selected, onSelect }: { points: ScatterPoint[]; selected: string | null; onSelect: (id: string) => void }) {
  const H = 260;
  const pad = 14;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (v: number) => pad + ((v - x0) / Math.max(x1 - x0, 1e-9)) * (W - 2 * pad);
  const sy = (v: number) => H - pad - ((v - y0) / Math.max(y1 - y0, 1e-9)) * (H - 2 * pad);
  // Draw filled (labeled) points on top of hollow (unlabeled) ones.
  const ordered = [...points].sort((a, b) => Number(!!b.hollow) - Number(!!a.hollow));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Events plotted by similarity of their measured features">
      <rect x={0.5} y={0.5} width={W - 1} height={H - 1} fill="none" stroke={GRID} />
      {ordered.map((p) => (
        <g key={p.id} onClick={() => onSelect(p.id)} style={{ cursor: "pointer" }}>
          <circle cx={sx(p.x)} cy={sy(p.y)} r={11} fill="transparent" />
          <circle
            cx={sx(p.x)}
            cy={sy(p.y)}
            r={selected === p.id ? 6 : 4}
            fill={p.hollow ? "transparent" : p.color}
            stroke={p.hollow ? p.color : selected === p.id ? "#f4f4f5" : "#14171c"}
            strokeWidth={p.hollow ? 1.5 : 2}
          >
            <title>{p.title}</title>
          </circle>
        </g>
      ))}
    </svg>
  );
}

// ── Histogram with an observed-value marker ─────────────────────────────────

export function NullHistogram({ values, observed, bins = 20 }: { values: number[]; observed: number; bins?: number }) {
  const H = 130;
  const pad = { l: 10, r: 10, t: 14, b: 18 };
  const lo = Math.min(0, ...values, observed);
  const hi = Math.max(1e-9, ...values, observed);
  const width = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - lo) / width))]++;
  const max = Math.max(...counts, 1);
  const x = (v: number) => pad.l + ((v - lo) / Math.max(hi - lo, 1e-9)) * (W - pad.l - pad.r);
  const bw = (W - pad.l - pad.r) / bins;
  const base = H - pad.b;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Shuffled-chance distribution with the observed value marked">
      <line x1={pad.l} x2={W - pad.r} y1={base} y2={base} stroke={AXIS} />
      {counts.map((c, i) => {
        const h = (c / max) * (H - pad.t - pad.b);
        if (h <= 0) return null;
        const bx = pad.l + i * bw + 1;
        const w = Math.max(bw - 2, 1);
        const r = Math.min(4, w / 2, h);
        return (
          <path
            key={i}
            d={`M${bx},${base}V${base - h + r}Q${bx},${base - h} ${bx + r},${base - h}H${bx + w - r}Q${bx + w},${base - h} ${bx + w},${base - h + r}V${base}Z`}
            fill={SERIES[0]}
          >
            <title>{`${pct(lo + i * width)}–${pct(lo + (i + 1) * width)}: ${c} shuffles`}</title>
          </path>
        );
      })}
      <line x1={x(observed)} x2={x(observed)} y1={pad.t - 4} y2={base} stroke="#f4f4f5" strokeWidth={2} />
      <text
        x={x(observed) > W * 0.6 ? x(observed) - 6 : x(observed) + 6}
        y={pad.t + 6}
        fill={INK.primary}
        fontSize={10}
        textAnchor={x(observed) > W * 0.6 ? "end" : "start"}
      >
        observed {pct(observed)}
      </text>
      <text x={pad.l} y={H - 4} fill={INK.muted} fontSize={9}>{pct(lo)}</text>
      <text x={W - pad.r} y={H - 4} fill={INK.muted} fontSize={9} textAnchor="end">{pct(hi)}</text>
    </svg>
  );
}

// ── Interval glyph: two rates with CIs on a shared row scale ────────────────

export function RateIntervals({
  a, b, max, colorA,
}: {
  a: { v: number; lo: number; hi: number };
  b: { v: number; lo: number; hi: number };
  max: number;
  colorA: string;
}) {
  const w = 120;
  const h = 22;
  const x = (v: number) => 4 + (Math.min(v, max) / Math.max(max, 1e-9)) * (w - 8);
  const row = (r: typeof a, y: number, c: string) => (
    <g>
      <line x1={x(r.lo)} x2={x(r.hi)} y1={y} y2={y} stroke={c} strokeWidth={2} strokeLinecap="round" opacity={0.6} />
      <circle cx={x(r.v)} cy={y} r={3.5} fill={c} stroke="#14171c" strokeWidth={1.5} />
    </g>
  );
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden>
      <line x1={4} x2={w - 4} y1={h / 2} y2={h / 2} stroke={GRID} />
      {row(a, 7, colorA)}
      {row(b, 15, OTHER)}
    </svg>
  );
}

// ── Feature importance: bars around zero (helps → right, hurts → left) ──────

export function ImportanceBars({ items }: { items: { feature: string; drop: number }[] }) {
  const rowH = 22;
  const labelW = 96;
  const H = items.length * rowH + 22;
  const max = Math.max(0.02, ...items.map((i) => Math.abs(i.drop)));
  const zero = labelW + (W - labelW - 44) / 2;
  const half = (W - labelW - 44) / 2;
  const x = (v: number) => zero + (v / max) * half;
  return (
    <div className="flex flex-col gap-1.5">
      <Legend items={[{ name: "Helps accuracy", color: SERIES[0] }, { name: "Hurts accuracy", color: SERIES[1] }]} />
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="How much accuracy drops when each feature is left out">
        <line x1={zero} x2={zero} y1={4} y2={H - 16} stroke={AXIS} />
        {items.map((it, i) => {
          const y = 6 + i * rowH;
          const x0 = Math.min(zero, x(it.drop));
          const w = Math.max(Math.abs(x(it.drop) - zero), 1);
          return (
            <g key={it.feature}>
              <text x={labelW - 6} y={y + 12} fill={INK.secondary} fontSize={10} textAnchor="end">{it.feature}</text>
              <rect x={x0} y={y + 3} width={w} height={rowH - 8} rx={3} fill={it.drop >= 0 ? SERIES[0] : SERIES[1]}>
                <title>{`${it.feature}: leaving it out changes accuracy by ${(-it.drop * 100).toFixed(1)} points`}</title>
              </rect>
              <text x={it.drop >= 0 ? x0 + w + 4 : zero + 4} y={y + 12} fill={INK.muted} fontSize={9} textAnchor="start">
                {(it.drop * 100 >= 0 ? "+" : "") + (it.drop * 100).toFixed(1)}
              </text>
            </g>
          );
        })}
        <text x={zero} y={H - 3} fill={INK.muted} fontSize={9} textAnchor="middle">0 (accuracy points)</text>
      </svg>
    </div>
  );
}
