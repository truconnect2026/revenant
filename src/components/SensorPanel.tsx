"use client";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { SensorReading, SentryLevel, SentryPhase } from "@/lib/types";
import { StatusLed } from "./StatusLed";
import { CanvasSparkline } from "./CanvasSparkline";
import { DeviationBar } from "./DeviationBar";
import { SentryControl } from "./SentryControl";

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${alpha})`;
}

// Include/exclude switch — decides whether a channel takes part in the session.
function IncludeToggle({
  checked, disabled, accent, title, onChange,
}: { checked: boolean; disabled?: boolean; accent: string; title: string; onChange?: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`Include ${title} channel in session`}
      disabled={disabled}
      onClick={onChange}
      className={`btn-press relative shrink-0 w-7 h-3.5 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 ${
        disabled ? "opacity-40 cursor-not-allowed" : ""
      }`}
      style={{ backgroundColor: checked && !disabled ? accent : "#3f3f46", transition: "background-color var(--t-2) var(--ease)" }}
    >
      <span
        className="absolute top-0.5 left-0.5 w-2.5 h-2.5 rounded-full bg-white"
        style={{ transform: checked ? "translateX(14px)" : "translateX(0)", transition: "transform var(--t-2) var(--ease)" }}
      />
    </button>
  );
}

interface SensorPanelProps {
  title: string;
  channelId: string;
  reading: SensorReading;
  onEnable?: () => void;
  color?: string;
  noChannelMessage?: string;
  pulseId?: string; // id of this channel's latest event — drives the anomaly beat
  included?: boolean;
  onToggleInclude?: () => void;
  toggleDisabled?: boolean; // e.g. EMF unexposed — can't be included
  sentry?: {
    armed: boolean;
    phase: SentryPhase;
    level: SentryLevel;
    onToggle: () => void;
    onLevel: (l: SentryLevel) => void;
  };
}

export const SensorPanel = memo(function SensorPanel({
  title,
  channelId,
  reading,
  onEnable,
  color = "#34d399",
  noChannelMessage,
  pulseId,
  included = true,
  onToggleInclude,
  toggleDisabled = false,
  sentry,
}: SensorPanelProps) {
  const {
    status, value, secondaryValue, unit, secondaryUnit,
    sigma, mean, stddev, history, threshold, warmupProgress,
  } = reading;

  const noChannel = status === "no-channel";
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

  const dim = !included || noChannel;
  const headerRow = (statusEl: ReactNode) => (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-0.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: dim ? "#3f3f46" : color }} />
        <h2 className={`font-display text-xs font-semibold uppercase tracking-[0.15em] shrink-0 ${dim ? "text-zinc-500" : "text-zinc-300"}`}>
          {title}
        </h2>
        {statusEl}
      </div>
      <IncludeToggle
        checked={included}
        disabled={toggleDisabled}
        accent={color}
        title={title}
        onChange={onToggleInclude}
      />
    </div>
  );

  // EMF unexposed — honest no-channel, toggle disabled, always shown.
  if (noChannel) {
    return (
      <div className="panel-card rounded-lg p-3 flex flex-col gap-2">
        {headerRow(<StatusLed status={status} accent={color} />)}
        <p className="text-[10px] font-mono text-zinc-500 leading-snug">
          {noChannelMessage || `The ${channelId} sensor is not exposed by this browser.`}
        </p>
      </div>
    );
  }

  // User-excluded — fully dormant (no permission, no sampling, no listener held).
  if (!included) {
    return (
      <div className="panel-card rounded-lg p-3 flex flex-col gap-2">
        {headerRow(<span className="text-[10px] font-display font-semibold uppercase tracking-[0.15em] text-zinc-600">Off</span>)}
        <p className="text-[10px] font-mono text-zinc-600 leading-snug">
          Excluded from this session. Toggle on to include.
        </p>
      </div>
    );
  }

  // Permission denied — keep the per-card Retry fallback.
  if (status === "blocked") {
    return (
      <div className="panel-card rounded-lg p-3 flex flex-col gap-2">
        {headerRow(<StatusLed status={status} accent={color} />)}
        <p className="text-[10px] font-mono text-zinc-500 leading-snug">
          Permission denied. Grant sensor access, then retry.
        </p>
        {onEnable && (
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
      {headerRow(<StatusLed status={status} accent={color} />)}

      {/* Hero readout */}
      <div className="relative isolate flex items-baseline gap-1 leading-none">
        {status === "live" && (
          <span
            aria-hidden
            className="absolute -z-10 -inset-x-3 -inset-y-2 rounded-full blur-md"
            style={{ background: `radial-gradient(60% 100% at 40% 50%, ${hexToRgba(color, 0.16)}, transparent)` }}
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
        {secondaryValue != null && secondaryUnit && (
          <span className="ml-1 text-[10px] font-mono tabular-nums text-zinc-600">
            {secondaryValue.toFixed(1)}<span className="ml-0.5 font-display">{secondaryUnit}</span>
          </span>
        )}
      </div>

      {/* Oscilloscope trace in a recessed readout well, with axis labels */}
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

      {/* Compact deviation meter */}
      <DeviationBar sigma={sigma} threshold={threshold} color={color} />

      {/* Baseline readout + calibration */}
      <div className="flex items-center justify-between gap-2 min-h-[1.25rem]">
        <span className="text-[10px] font-mono tabular-nums text-zinc-600">
          µ={mean} · σ={stddev}
        </span>
        {status === "settling" && warmupProgress < 1 && (
          <span className="text-[10px] font-mono tabular-nums text-amber-500/80">
            CAL {Math.round(warmupProgress * 100)}%
          </span>
        )}
      </div>

      {/* Sentry Mode (Motion only) */}
      {sentry && (
        <SentryControl
          armed={sentry.armed}
          phase={sentry.phase}
          level={sentry.level}
          accent={color}
          onToggle={sentry.onToggle}
          onLevel={sentry.onLevel}
        />
      )}
    </div>
  );
});
