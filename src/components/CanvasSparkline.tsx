"use client";
import { memo, useEffect, useRef } from "react";

interface Props {
  data: number[];
  color?: string;
  height?: number;
}

export const CanvasSparkline = memo(function CanvasSparkline({
  data,
  color = "#34d399",
  height = 48,
}: Props) {
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
    const pad = 2 * dpr;

    if (data.length < 2) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    // Grid lines
    ctx.strokeStyle = "rgba(63,63,70,0.8)";
    ctx.lineWidth = 0.5 * dpr;
    ctx.setLineDash([2 * dpr, 4 * dpr]);
    for (const f of [0.25, 0.5, 0.75]) {
      ctx.beginPath();
      ctx.moveTo(0, h * f);
      ctx.lineTo(w, h * f);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Trace
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 * dpr;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = pad + ((max - v) / range) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [data, color, height]);

  // Resize when container width changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = height * dpr;
      // Force a redraw by dispatching a synthetic update — will be caught by the draw effect
      canvas.dispatchEvent(new Event("resize"));
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [height]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full"
      style={{ height }}
      role="img"
      aria-label="Signal trace"
    />
  );
});
