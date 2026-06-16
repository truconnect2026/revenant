"use client";

interface SpectrumBarProps {
  data: number[];
  width?: number;
  height?: number;
}

export function SpectrumBar({ data, width = 240, height = 32 }: SpectrumBarProps) {
  if (data.length === 0) {
    return <div style={{ width, height }} className="opacity-20 bg-zinc-800 rounded" />;
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
