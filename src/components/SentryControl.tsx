"use client";
import { SentryLevel, SentryPhase } from "@/lib/types";

interface Props {
  armed: boolean;
  phase: SentryPhase;
  level: SentryLevel;
  accent: string;
  onToggle: () => void;
  onLevel: (l: SentryLevel) => void;
}

const LEVELS: SentryLevel[] = ["low", "med", "high"];

export function SentryControl({ armed, phase, level, accent, onToggle, onLevel }: Props) {
  return (
    <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-800/70">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[9px] font-display font-semibold uppercase tracking-[0.15em] text-zinc-500 shrink-0">
          Sentry
        </span>

        {armed ? (
          phase === "triggered" ? (
            <span className="flex items-center gap-1.5 text-[10px] font-display font-bold uppercase tracking-[0.14em] text-red-400">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
              Triggered
            </span>
          ) : phase === "arming" ? (
            <span className="flex items-center gap-1.5 text-[10px] font-display font-semibold uppercase tracking-[0.14em] text-amber-400/90">
              <span className="led-breathe inline-block w-2 h-2 rounded-full bg-amber-400" />
              Arming…
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[10px] font-display font-semibold uppercase tracking-[0.14em] text-zinc-300">
              <span className="led-breathe inline-block w-2 h-2 rounded-full" style={{ backgroundColor: accent }} />
              Armed <span className="text-zinc-500">· {level}</span>
            </span>
          )
        ) : (
          <div className="flex rounded overflow-hidden border border-zinc-700" role="group" aria-label="Sentry sensitivity">
            {LEVELS.map((l) => {
              const on = level === l;
              return (
                <button
                  key={l}
                  onClick={() => onLevel(l)}
                  aria-pressed={on}
                  className={`btn-press px-1.5 py-0.5 text-[9px] font-display font-semibold uppercase tracking-wide ${
                    on ? "text-zinc-900" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                  style={on ? { backgroundColor: accent } : undefined}
                >
                  {l}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <button
        onClick={onToggle}
        className={`btn-press shrink-0 px-2.5 py-1 text-[10px] font-display font-semibold uppercase tracking-wider rounded focus:outline-none focus-visible:ring-2 ${
          armed
            ? "bg-red-600 hover:bg-red-500 text-white focus-visible:ring-red-500"
            : "border border-amber-500/60 text-amber-400 hover:bg-amber-500/10 focus-visible:ring-amber-500"
        }`}
      >
        {armed ? "Disarm" : "Arm"}
      </button>
    </div>
  );
}
