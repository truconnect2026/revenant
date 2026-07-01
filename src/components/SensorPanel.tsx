"use client";
import { memo } from "react";
import { SensorReading } from "@/lib/types";
import { StatusLed } from "./StatusLed";
import { CanvasSparkline } from "./CanvasSparkline";
import { DeviationBar } from "./DeviationBar";

interface SensorPanelProps {
  title: string;
  channelId: string;
  reading: SensorReading;
  onEnable?: () => void;
  color?: string;
  noChannelMessage?: string;
  running?: boolean;
}

export const SensorPanel = memo(function SensorPanel({
  title,
  channelId,
  reading,
  onEnable,
  color = "#34d399",
  noChannelMessage,
  running = false,
}: SensorPanelProps) {
  const {
    status, value, secondaryValue, unit, secondaryUnit,
    sigma, mean, stddev, history, threshold, warmupProgress,
  } = reading;

  const fault = status === "no-channel" || status === "blocked";

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
      <div className="panel-card rounded-lg p-3 flex flex-col gap-1.5">
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
    <div className="panel-card rounded-lg p-3 flex flex-col gap-2">
      {/* Row 1 — identity (left) + hero readout (right) */}
      <div className="flex items-start justify-between gap-3">
        {header}
        <div className="flex items-baseline gap-1 leading-none shrink-0">
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

      {/* Row 2 — oscilloscope trace */}
      <CanvasSparkline data={history} color={color} height={30} />

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
