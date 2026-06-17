"use client";

interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
}

const VB_W = 240;

export function Sparkline({ data, color = "#34d399", height = 48 }: SparklineProps) {
  if (data.length < 2) {
    return (
      <svg
        viewBox={`0 0 ${VB_W} ${height}`}
        preserveAspectRatio="none"
        className="w-full opacity-30"
        style={{ height }}
      >
        <line x1={0} y1={height / 2} x2={VB_W} y2={height / 2} stroke={color} strokeWidth={1} opacity={0.3} />
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * VB_W;
      const y = pad + ((max - v) / range) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${height}`}
      preserveAspectRatio="none"
      className="w-full motion-safe:transition-all"
      style={{ height }}
      role="img"
      aria-label="Signal trace"
    >
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1={0} y1={height * f}
          x2={VB_W} y2={height * f}
          stroke="currentColor"
          className="text-zinc-700"
          strokeWidth={0.5}
          strokeDasharray="2,4"
        />
      ))}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        filter="url(#glow)"
      />
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}
