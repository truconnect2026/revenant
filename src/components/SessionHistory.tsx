"use client";
import { SessionData } from "@/lib/types";

function fmt(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function SessionHistory({ sessions }: { sessions: SessionData[] }) {
  if (sessions.length === 0) return null;

  return (
    <details className="group mt-4">
      <summary className="cursor-pointer select-none list-none flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-400 transition-colors">
        <span className="inline-block transition-transform group-open:rotate-90">▶</span>
        Past Sessions
        <span className="font-normal normal-case text-[10px] text-zinc-600 ml-1">({sessions.length})</span>
      </summary>

      <div className="mt-3 flex flex-col gap-2">
        {sessions.map((s) => (
          <div
            key={s.id}
            className="rounded border border-zinc-700/40 bg-zinc-800/40 px-3 py-2 text-xs font-mono"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-zinc-300">
                  {new Date(s.started_at).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {s.label && (
                  <span className="ml-2 text-zinc-500">{s.label}</span>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0 text-zinc-500">
                <span>{s.ended_at != null ? fmt(s.ended_at - s.started_at) : "—"}</span>
                <span className={s.events.length > 0 ? "text-amber-400/80" : ""}>
                  {s.events.length} event{s.events.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
            {s.location && (
              <div className="mt-0.5 text-zinc-600">
                {s.location.lat.toFixed(4)}, {s.location.lng.toFixed(4)}
              </div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
