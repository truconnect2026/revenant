"use client";
import { memo, useEffect, useRef, useState } from "react";
import { SensorReading } from "@/lib/types";
import { StatusLed } from "./StatusLed";
import { CanvasSparkline } from "./CanvasSparkline";
import { DeviationBar } from "./DeviationBar";

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${alpha})`;
}

interface SensorPanelProps {
  title: string;
  channelId: string;
  reading: SensorReading;
  onEnable?: () => void;
  color?: string;
  noChannelMessage?: string;
  running?: boolean;
  pulseId?: string; // id of this channel's latest event — drives the anomaly beat
}

export const SensorPanel = memo(function SensorPanel({
  title,
  channelId,
  reading,
  onEnable,
  color = "#34d399",
  noChannelMessage,
  running = false,
  pulseId,
}: SensorPanelProps) {
  const {
    status, value, secondaryValue, unit, secondaryUnit,
    sigma, mean, stddev, history, threshold, warmupProgress,
  } = reading;

  const fault = status === "no-channel" || status === "blocked";
  const hi = history.length ? Math.max(...history) : null;
  const lo = history.length ? Math.min(...history) : null;

  // One-shot card reaction when this channel fires a new event.
  const [react, setReact] = useState(false);
  const prevPulse = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (pulseId && pulseId !== prevPulse.current) {
      prevPulse.current = pulseId;
      setReact(true);
      const t = setTimeout(() => setReact(false), 850);
      return () => clearTimeout(t);
    }
    prevPulse.current = pulseId;
  }, [pulseId]);

  // Identity header — accent bar + name + status LED — shared by every state.
  const header = (
    <div className="flex items-center gap-2 min-w-0">
      <span className="w-0.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: fault ? "#3f3f46" : color }} />
      <h2 className="font-display text-xs font-semibold uppercase tracking-[0.15em] text-zinc-300 shrink-0">
        {title}
      </h2>
      <StatusLed status={status} accent={color} />
    </div>
  );

  if (fault) {
    return (
      <div className="panel-card rounded-lg p-3 flex flex-col gap-2">
        {header}
        <p className="text-[10px] font-mono text-zinc-500 leading-snug">
          {status === "no-channel"
            ? noChannelMessage || `The ${channelId} sensor is not exposed by this browser.`
            : "Permission denied. Grant sensor access, then retry."}
        </p>
        {status === "blocked" && onEnable && (
          <button
            onClick={onEnable}
            className="btn-press self-start mt-0.5 px-2.5 py-1 text-[10px] font-display font-semibold uppercase tracking-wider rounded border border-zinc-600 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`panel-card rounded-lg p-3 flex flex-col gap-2 relative ${react ? "card-react" : ""}`}>
      {react && (
        <span
          aria-hidden
          className="card-react-ring pointer-events-none absolute inset-0 rounded-lg"
          style={{ boxShadow: `inset 0 0 0 1px ${hexToRgba(color, 0.9)}, 0 0 16px ${hexToRgba(color, 0.35)}` }}
        />
      )}
      {/* Row 1 — identity (left) + hero readout (right) */}
      <div className="flex items-start justify-between gap-3">
        {header}
        <div className="relative isolate flex items-baseline gap-1 leading-none shrink-0">
          {status === "live" && (
            <span
              aria-hidden
              className="absolute -z-10 -inset-x-3 -inset-y-2 rounded-full blur-md"
              style={{ background: `radial-gradient(60% 100% at 70% 50%, ${hexToRgba(color, 0.16)}, transparent)` }}
            />
          )}
          <span
            className={`font-mono text-[26px] font-semibold tabular-nums tracking-tight ${
              value !== null ? "text-zinc-50" : "text-zinc-600"
            }`}
          >
            {value !== null ? value.toFixed(1) : "--.-"}
          </span>
          <span className="font-display text-[10px] text-zinc-500">{unit}</span>
        </div>
      </div>

      {/* Secondary readout (e.g. Motion rotation rate), tucked and dim */}
      {secondaryValue != null && secondaryUnit && (
        <div className="-mt-1 text-right text-[10px] font-mono tabular-nums text-zinc-600">
          {secondaryValue.toFixed(1)}
          <span className="ml-0.5 font-display">{secondaryUnit}</span>
        </div>
      )}

      {/* Row 2 — oscilloscope trace in a recessed readout well, with axis labels */}
      <div className="readout-well relative p-2">
        <CanvasSparkline data={history} color={color} height={30} />
        <span className="absolute top-1 left-1.5 text-[8px] font-mono uppercase text-zinc-600 leading-none pointer-events-none">
          {unit}
        </span>
        {hi !== null && lo !== null && (
          <>
            <span className="absolute top-1 right-1.5 text-[8px] font-mono tabular-nums text-zinc-600 leading-none pointer-events-none">
              {hi.toFixed(0)}
            </span>
            <span className="absolute bottom-1 right-1.5 text-[8px] font-mono tabular-nums text-zinc-600 leading-none pointer-events-none">
              {lo.toFixed(0)}
            </span>
          </>
        )}
      </div>

      {/* Row 3 — compact deviation meter */}
      <DeviationBar sigma={sigma} threshold={threshold} color={color} />

      {/* Row 4 — baseline readout + calibration / enable */}
      <div className="flex items-center justify-between gap-2 min-h-[1.25rem]">
        <span className="text-[10px] font-mono tabular-nums text-zinc-600">
          µ={mean} · σ={stddev}
        </span>
        {status === "settling" && warmupProgress < 1 ? (
          <span className="text-[10px] font-mono tabular-nums text-amber-500/80">
            CAL {Math.round(warmupProgress * 100)}%
          </span>
        ) : status === "standby" && !running && onEnable ? (
          <button
            onClick={onEnable}
            className="btn-press px-2.5 py-1 text-[10px] font-display font-semibold uppercase tracking-wider rounded bg-emerald-600 hover:bg-emerald-500 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            Enable
          </button>
        ) : null}
      </div>
    </div>
  );
});
