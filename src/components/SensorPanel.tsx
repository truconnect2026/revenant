"use client";
import { SensorReading } from "@/lib/types";
import { StatusLed } from "./StatusLed";
import { Sparkline } from "./Sparkline";
import { SpectrumBar } from "./SpectrumBar";
import { DeviationMeter } from "./DeviationMeter";

interface SensorPanelProps {
  title: string;
  channelId: string;
  reading: SensorReading;
  onEnable?: () => void;
  color?: string;
  noChannelMessage?: string;
  running?: boolean;
}

export function SensorPanel({
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

  return (
    <div className="panel-card rounded-lg border border-zinc-600/60 bg-zinc-800/60 backdrop-blur p-4 flex flex-col gap-3 h-full">
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
          {/* Primary value */}
          <div className="font-mono text-2xl tabular-nums text-zinc-100">
            {value !== null ? value : "--.-"}
            <span className="text-sm text-zinc-500 ml-1">{unit}</span>
            {secondaryValue !== null && secondaryUnit && (
              <span className="text-sm text-zinc-500 ml-3">
                {secondaryValue} <span className="text-xs">{secondaryUnit}</span>
              </span>
            )}
          </div>

          {/* Baseline readout */}
          <div className="text-[10px] font-mono text-zinc-500 flex gap-4">
            <span>µ={mean}</span>
            <span>σ={stddev}</span>
          </div>

          {/* Warmup progress bar — shown while baseline is settling */}
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

          {/* Sparkline */}
          <Sparkline data={history} color={color} />

          {/* Spectrum (audio only) */}
          {spectrum && <SpectrumBar data={spectrum} />}

          {/* Deviation meter + enable button pushed to bottom */}
          <div className="mt-auto flex flex-col gap-2">
            <DeviationMeter sigma={sigma} threshold={threshold} />
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
}
