"use client";

interface DeviationBarProps {
  sigma: number;
  threshold: number;
  color?: string;
}

/**
 * Slim, glanceable σ-vs-threshold meter. The scale is calibrated per channel so
 * the threshold marker always sits at the same spot (2/3), making "how close to
 * tripping" instantly readable across all three instruments in low light. Fill
 * runs in the channel accent and flips red once the threshold is exceeded.
 */
export function DeviationBar({ sigma, threshold, color = "#34d399" }: DeviationBarProps) {
  const max = threshold > 0 ? threshold * 1.5 : 8;
  const pct = Math.max(0, Math.min(sigma / max, 1)) * 100;
  const threshPct = (threshold / max) * 100; // fixed 66.7%
  const tripped = sigma >= threshold;
  const fill = tripped ? "#f87171" : color;

  return (
    <div
      className="flex items-center gap-2 w-full"
      role="meter"
      aria-valuenow={Number(sigma.toFixed(2))}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label="Sigma deviation vs threshold"
    >
      <div className="relative flex-1 h-1.5 rounded-sm bg-black/40 ring-1 ring-inset ring-white/5 overflow-hidden">
        <div
          className="meter-fill absolute inset-y-0 left-0 rounded-sm"
          style={{ width: `${pct}%`, backgroundColor: fill }}
        />
        {/* Threshold marker */}
        <div
          className="absolute inset-y-0 w-px bg-zinc-300/70"
          style={{ left: `${threshPct}%` }}
        />
      </div>
      <span
        className={`text-[10px] font-mono tabular-nums w-11 text-right ${
          tripped ? "text-red-300" : "text-zinc-400"
        }`}
      >
        {sigma > 0 ? "+" : ""}
        {sigma.toFixed(1)}σ
      </span>
    </div>
  );
}
