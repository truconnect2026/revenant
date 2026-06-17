"use client";
import { useEffect, useRef } from "react";

interface Props {
  data: number[][];  // rows = time frames (oldest first), cols = freq bins (0-1)
  height?: number;
}

function heatRGB(v: number): [number, number, number] {
  // black → red → yellow → white
  if (v < 1 / 3) {
    const t = v * 3;
    return [Math.round(t * 220), 0, 0];
  } else if (v < 2 / 3) {
    const t = (v - 1 / 3) * 3;
    return [220, Math.round(t * 200), 0];
  } else {
    const t = (v - 2 / 3) * 3;
    return [
      220 + Math.round(t * 35),
      200 + Math.round(t * 55),
      Math.round(t * 200),
    ];
  }
}

export function SpectrogramCanvas({ data, height = 56 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth * dpr;
    const h = height * dpr;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    if (data.length === 0 || data[0].length === 0) return;

    const rows = data.length;
    const cols = data[0].length;
    const cellW = w / cols;
    const cellH = h / rows;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const v = Math.max(0, Math.min(1, data[row][col]));
        const [r, g, b] = heatRGB(v);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(
          Math.floor(col * cellW),
          Math.floor(row * cellH),
          Math.ceil(cellW),
          Math.ceil(cellH)
        );
      }
    }
  }, [data, height]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded opacity-90"
      style={{ height }}
      aria-label="Audio spectrogram"
    />
  );
}
