"use client";
import { memo, type CSSProperties } from "react";
import { SensorReading } from "@/lib/types";
import { StatusLed } from "./StatusLed";
import { CanvasSparkline } from "./CanvasSparkline";
import { SpectrumBar } from "./SpectrumBar";
import { SigmaArc } from "./SigmaArc";

// #rrggbb → rgba() with the given alpha, for the sigma-reactive card glow.
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Map current |sigma| (relative to threshold) to a subtle outer-glow color+blur.
// Near baseline → nothing; approaching threshold → faint amber; at/over → a
// capped glow in the channel color. Intensity is clamped so it never looks gaudy.
function sigmaGlow(sigma: number, threshold: number, color: string): { color: string; blur: string } {
  if (!(threshold > 0)) return { color: "transparent", blur: "0px" };
  const ratio = Math.min(Math.abs(sigma) / threshold, 1.5);
  if (ratio < 0.2) return { color: "transparent", blur: "0px" };
  if (ratio < 1) {
    const a = ((ratio - 0.2) / 0.8) * 0.16; // 0 → 0.16 amber
    return { color: `rgba(245, 158, 11, ${a.toFixed(3)})`, blur: `${(8 + ratio * 8).toFixed(1)}px` };
  }
  const over = Math.min(ratio - 1, 0.5) / 0.5; // 0 → 1 across threshold..1.5×
  const a = 0.2 + over * 0.16; // 0.20 → 0.36, capped
  return { color: hexToRgba(color, a), blur: `${(18 + over * 8).toFixed(1)}px` };
}

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
    sigma, mean, stddev, history, spectrum, threshold, warmupProgress,
  } = reading;

  const glow = sigmaGlow(sigma, threshold, color);

  return (
    <div
      className="panel-card rounded-lg border border-zinc-600/60 bg-zinc-800/60 backdrop-blur p-4 flex flex-col gap-3 h-full"
      style={{ "--glow-color": glow.color, "--glow-blur": glow.blur } as CSSProperties}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-zinc-200">
          {title}
        </h2>
        <StatusLed status={status} />
      </div>

      {/* No-channel fault card */}
      {status === "no-channel" && (
        <div className="flex-1 bg-zinc-700/50 border border-zinc-600/40 rounded p-3 text-xs text-zinc-400 leading-relaxed">
          <p className="font-semibold text-amber-400 mb-1">Sensor not exposed</p>
          <p>{noChannelMessage || `The ${channelId} sensor is not available in this browser. Try Chrome on Android over HTTPS.`}</p>
        </div>
      )}

      {/* Blocked card */}
      {status === "blocked" && (
        <div className="flex-1 bg-zinc-700/50 border border-zinc-600/40 rounded p-3 text-xs text-zinc-400 leading-relaxed">
          <p className="font-semibold text-red-400 mb-1">Permission denied</p>
          <p>Grant sensor access in your browser settings, then retry.</p>
          {onEnable && (
            <button
              onClick={onEnable}
              className="mt-3 px-3 py-1.5 text-[10px] font-mono uppercase font-semibold bg-emerald-700 hover:bg-emerald-600 text-white rounded transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Readings */}
      {status !== "no-channel" && status !== "blocked" && (
        <div className="flex-1 flex flex-col gap-3 min-h-0">
          {/* Primary value — large instrument readout */}
          <div className="flex items-baseline gap-x-2 gap-y-1 flex-wrap">
            <span
              className={`font-mono text-4xl font-semibold tracking-tight tabular-nums leading-none ${
                value !== null ? "text-zinc-50" : "text-zinc-600"
              }`}
            >
              {value !== null ? value : "--.-"}
            </span>
            <span className="text-xs text-zinc-500">{unit}</span>
            {secondaryValue != null && secondaryUnit && (
              <span className="text-xs text-zinc-500 tabular-nums ml-1">
                {secondaryValue} <span className="text-[10px]">{secondaryUnit}</span>
              </span>
            )}
          </div>

          {/* Baseline readout */}
          <div className="text-[10px] font-mono text-zinc-500 flex gap-4">
            <span>µ={mean}</span>
            <span>σ={stddev}</span>
          </div>

          {/* Warmup progress bar */}
          {status === "settling" && warmupProgress < 1 && (
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-amber-400/80">Calibrating baseline</span>
                <span className="text-amber-400/60">{Math.round(warmupProgress * 100)}%</span>
              </div>
              <div className="h-1 bg-zinc-700/60 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-400/70 rounded-full transition-all duration-150"
                  style={{ width: `${warmupProgress * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Canvas sparkline trace */}
          <CanvasSparkline data={history} color={color} />

          {/* Spectrum (audio only) */}
          {spectrum && <SpectrumBar data={spectrum} />}

          {/* Sigma-vs-threshold arc gauge + enable button pushed to bottom */}
          <div className="mt-auto flex flex-col gap-2">
            <SigmaArc sigma={sigma} threshold={threshold} color={color} />
            {status === "standby" && !running && onEnable && (
              <button
                onClick={onEnable}
                className="self-start px-4 py-2 text-xs font-mono uppercase font-semibold bg-emerald-700 hover:bg-emerald-600 text-white rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                Enable {title}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
