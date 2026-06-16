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
}

export function SensorPanel({
  title,
  channelId,
  reading,
  onEnable,
  color = "#34d399",
  noChannelMessage,
}: SensorPanelProps) {
  const { status, value, secondaryValue, unit, secondaryUnit, sigma, mean, stddev, history, spectrum, threshold } = reading;

  return (
    <div className="panel-card rounded-lg border border-zinc-700/50 bg-zinc-900/80 backdrop-blur p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-zinc-200">
          {title}
        </h2>
        <StatusLed status={status} />
      </div>

      {/* No-channel fault card */}
      {status === "no-channel" && (
        <div className="bg-zinc-800/60 border border-zinc-700/50 rounded p-3 text-xs text-zinc-400 leading-relaxed">
          <p className="font-semibold text-amber-400 mb-1">Sensor not exposed</p>
          <p>{noChannelMessage || `The ${channelId} sensor is not available in this browser. Try Chrome on Android over HTTPS.`}</p>
        </div>
      )}

      {/* Blocked card */}
      {status === "blocked" && (
        <div className="bg-zinc-800/60 border border-zinc-700/50 rounded p-3 text-xs text-zinc-400 leading-relaxed">
          <p className="font-semibold text-red-400 mb-1">Permission denied</p>
          <p>Grant sensor access in your browser settings, then tap Enable.</p>
          {onEnable && (
            <button
              onClick={onEnable}
              className="mt-2 px-3 py-1 text-[10px] font-mono uppercase bg-zinc-700 hover:bg-zinc-600 rounded transition-colors"
            >
              Enable
            </button>
          )}
        </div>
      )}

      {/* Readings */}
      {status !== "no-channel" && (
        <>
          {/* Primary value */}
          <div className="font-mono text-2xl tabular-nums text-zinc-100">
            {value !== null ? value : "---"}
            <span className="text-sm text-zinc-500 ml-1">{unit}</span>
            {secondaryValue !== null && secondaryUnit && (
              <span className="text-sm text-zinc-500 ml-3">
                {secondaryValue} <span className="text-xs">{secondaryUnit}</span>
              </span>
            )}
          </div>

          {/* Baseline readout */}
          <div className="text-[10px] font-mono text-zinc-500 flex gap-4">
            <span>\u03BC={mean}</span>
            <span>\u03C3={stddev}</span>
          </div>

          {/* Sparkline */}
          <Sparkline data={history} color={color} />

          {/* Spectrum (audio only) */}
          {spectrum && <SpectrumBar data={spectrum} />}

          {/* Deviation meter */}
          <DeviationMeter sigma={sigma} threshold={threshold} />

          {/* Fallback enable button */}
          {status === "standby" && onEnable && (
            <button
              onClick={onEnable}
              className="self-start px-3 py-1.5 text-xs font-mono uppercase bg-zinc-700 hover:bg-zinc-600 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              Enable {channelId}
            </button>
          )}
        </>
      )}
    </div>
  );
}
