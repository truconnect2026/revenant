"use client";

interface DeviationMeterProps {
  sigma: number;
  threshold: number;
  maxSigma?: number;
}

export function DeviationMeter({ sigma, threshold, maxSigma = 8 }: DeviationMeterProps) {
  const pct = Math.min(sigma / maxSigma, 1) * 100;
  const threshPct = (threshold / maxSigma) * 100;
  const isTripped = sigma >= threshold;

  return (
    <div className="w-full" role="meter" aria-valuenow={sigma} aria-valuemin={0} aria-valuemax={maxSigma} aria-label="Sigma deviation">
      <div className="flex justify-between text-[9px] font-mono text-zinc-500 mb-0.5">
        <span>0\u03C3</span>
        <span>{maxSigma}\u03C3</span>
      </div>
      <div className="relative h-2 bg-zinc-800 rounded-full overflow-hidden">
        {/* Threshold tick */}
        <div
          className="absolute top-0 h-full w-px bg-amber-500/70 z-10"
          style={{ left: `${threshPct}%` }}
        />
        {/* Fill bar */}
        <div
          className={`h-full rounded-full transition-all duration-75 ${
            isTripped ? "bg-red-500" : "bg-emerald-500/70"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-right text-[10px] font-mono mt-0.5">
        <span className={isTripped ? "text-red-400" : "text-zinc-400"}>
          {sigma.toFixed(1)}\u03C3
        </span>
      </div>
    </div>
  );
}
