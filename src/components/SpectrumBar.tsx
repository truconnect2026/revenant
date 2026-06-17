"use client";

interface SpectrumBarProps {
  data: number[];
  width?: number;
  height?: number;
}

export function SpectrumBar({ data, width = 240, height = 32 }: SpectrumBarProps) {
  if (data.length === 0) {
    return (
      <svg width={width} height={height} role="img" aria-label="Audio spectrum — idle">
        {[0.33, 0.66].map((f) => (
          <line
            key={f}
            x1={0} y1={height * f}
            x2={width} y2={height * f}
            stroke="#3f3f46"
            strokeWidth={0.5}
            strokeDasharray="2,4"
          />
        ))}
        <line
          x1={0} y1={height - 3}
          x2={width} y2={height - 3}
          stroke="#34d399" strokeWidth={1} opacity={0.15}
        />
      </svg>
    );
  }

  const barW = width / data.length;

  return (
    <svg width={width} height={height} role="img" aria-label="Audio spectrum">
      {data.map((v, i) => {
        const h = v * height;
        return (
          <rect
            key={i}
            x={i * barW}
            y={height - h}
            width={Math.max(barW - 0.5, 0.5)}
            height={h}
            fill="#34d399"
            opacity={0.6 + v * 0.4}
          />
        );
      })}
    </svg>
  );
}
