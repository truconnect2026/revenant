"use client";

interface SigmaArcProps {
  sigma: number;
  threshold: number;
  color?: string;
  maxSigma?: number;
}

// Geometry for a 180° top arc: 9 o'clock (0σ) → 12 o'clock → 3 o'clock (maxσ).
const CX = 50;
const CY = 50;
const R = 40;
const STROKE = 7;

function pointAt(t: number, radius: number = R) {
  const clamped = Math.max(0, Math.min(1, t));
  const deg = 180 * (1 - clamped);
  const rad = (deg * Math.PI) / 180;
  return { x: CX + radius * Math.cos(rad), y: CY - radius * Math.sin(rad) };
}

const START = pointAt(0);
const END = pointAt(1);
// Sweep-flag 1 = clockwise on screen (9→12→3 o'clock), largeArc 0 (exactly 180°).
const ARC_PATH = `M ${START.x} ${START.y} A ${R} ${R} 0 0 1 ${END.x} ${END.y}`;

/**
 * Compact sigma-vs-threshold gauge. The arc fills from 0σ toward maxσ (revealed
 * via a normalized stroke-dash so it sweeps smoothly), an amber tick marks the
 * threshold, and the live σ reads out in the centre — turning the channel color
 * red once tripped. Pure SVG + CSS; no per-frame JS.
 */
export function SigmaArc({ sigma, threshold, color = "#34d399", maxSigma = 8 }: SigmaArcProps) {
  const pct = Math.max(0, Math.min(sigma / maxSigma, 1));
  const tripped = sigma >= threshold;
  const fill = tripped ? "#ef4444" : color;

  const tThr = Math.max(0, Math.min(threshold / maxSigma, 1));
  const thrIn = pointAt(tThr, R - STROKE / 2 - 1);
  const thrOut = pointAt(tThr, R + STROKE / 2 + 1);

  return (
    <div
      className="w-full flex justify-center"
      role="meter"
      aria-valuenow={Number(sigma.toFixed(2))}
      aria-valuemin={0}
      aria-valuemax={maxSigma}
      aria-label="Sigma deviation vs threshold"
    >
      <svg viewBox="0 0 100 62" className="w-full max-w-[168px]">
        {/* Track */}
        <path
          d={ARC_PATH}
          fill="none"
          stroke="#27272a"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
        {/* Fill — revealed from the start via normalized dash offset */}
        <path
          d={ARC_PATH}
          fill="none"
          stroke={fill}
          strokeWidth={STROKE}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - pct}
          style={{ transition: "stroke-dashoffset 200ms ease-out, stroke 200ms ease-out" }}
        />
        {/* Threshold marker */}
        <line
          x1={thrIn.x}
          y1={thrIn.y}
          x2={thrOut.x}
          y2={thrOut.y}
          stroke="#f59e0b"
          strokeWidth={1.6}
          strokeLinecap="round"
        />
        {/* End scale labels */}
        <text x={START.x - 2} y="60" fontSize="7" fill="#71717a" fontFamily="var(--font-mono)" textAnchor="middle">0</text>
        <text x={END.x + 2} y="60" fontSize="7" fill="#71717a" fontFamily="var(--font-mono)" textAnchor="middle">{maxSigma}</text>
        {/* Centre readout */}
        <text
          x="50"
          y="46"
          fontSize="18"
          fontWeight="600"
          fill={tripped ? "#f87171" : "#e4e4e7"}
          fontFamily="var(--font-mono)"
          textAnchor="middle"
          style={{ fontVariantNumeric: "tabular-nums", transition: "fill 200ms ease-out" }}
        >
          {sigma.toFixed(1)}
          <tspan fontSize="9" fill="#71717a" dx="1">σ</tspan>
        </text>
      </svg>
    </div>
  );
}
