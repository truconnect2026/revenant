"use client";
import { AnomalyEvent } from "@/lib/types";

const CHANNEL_LABELS: Record<string, string> = {
  emf: "EMF",
  sound: "SND",
  motion: "MOT",
};

const CHANNEL_COLORS: Record<string, string> = {
  emf: "text-cyan-400",
  sound: "text-emerald-400",
  motion: "text-amber-400",
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function EventLog({ events }: { events: AnomalyEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="text-center text-xs font-mono text-zinc-600 py-4">
        No anomaly events recorded.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 max-h-64 overflow-y-auto scrollbar-thin">
      {[...events].reverse().map((ev) => (
        <div
          key={ev.id}
          className="flex items-center gap-3 px-3 py-1.5 bg-zinc-800/50 rounded text-xs font-mono border border-zinc-700/30"
        >
          <span className="text-zinc-500 w-16 shrink-0">{formatTime(ev.timestamp)}</span>
          <span className={`w-8 shrink-0 font-semibold ${CHANNEL_COLORS[ev.channel]}`}>
            {CHANNEL_LABELS[ev.channel]}
          </span>
          <span className="text-zinc-200 tabular-nums">
            {ev.value} {ev.unit}
          </span>
          <span className="text-red-400 tabular-nums">
            {ev.sigma > 0 ? "+" : ""}
            {ev.sigma.toFixed(1)}&sigma;
          </span>
          <span className="text-zinc-500 tabular-nums">
            &mu;={ev.mean}&plusmn;{ev.stddev}
          </span>
          {ev.clipUrl && (
            <audio src={ev.clipUrl} controls className="h-6 ml-auto max-w-[120px]" preload="none" />
          )}
        </div>
      ))}
    </div>
  );
}
