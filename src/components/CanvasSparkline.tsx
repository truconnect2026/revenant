"use client";
import { memo, useEffect, useRef } from "react";

interface Props {
  data: number[];
  color?: string;
  height?: number;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
    const pad = 3 * dpr;

    // Faint baseline grid, always present so an idle well still reads as "armed".
    ctx.strokeStyle = "rgba(63,63,70,0.55)";
    ctx.lineWidth = 0.5 * dpr;
    ctx.setLineDash([2 * dpr, 4 * dpr]);
    for (const f of [0.25, 0.5, 0.75]) {
      ctx.beginPath();
      ctx.moveTo(0, h * f);
      ctx.lineTo(w, h * f);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    if (data.length < 2) {
      // Resting baseline: a dim flat line at centre.
      ctx.strokeStyle = hexToRgba(color, 0.32);
      ctx.lineWidth = 1.25 * dpr;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      return;
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const xy = (i: number) => ({
      x: (i / (data.length - 1)) * w,
      y: pad + ((max - data[i]) / range) * (h - pad * 2),
    });

    // Gradient area fill under the trace, fading to transparent.
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, hexToRgba(color, 0.26));
    grad.addColorStop(1, hexToRgba(color, 0));
    ctx.beginPath();
    ctx.moveTo(0, h);
    data.forEach((_, i) => {
      const p = xy(i);
      if (i === 0) ctx.lineTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Trace line with a faint glow.
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 * dpr;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = hexToRgba(color, 0.55);
    ctx.shadowBlur = 4 * dpr;
    ctx.beginPath();
    data.forEach((_, i) => {
      const p = xy(i);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.restore();

    // Hot point at the live (right) end: color halo first, bright core on top.
    const last = xy(data.length - 1);
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 6 * dpr;
    ctx.fillStyle = hexToRgba(color, 0.9);
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3.4 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fafafa";
    ctx.beginPath();
    ctx.arc(last.x, last.y, 1.6 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }, [data, color, height]);

  // Resize when container width changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = height * dpr;
      canvas.dispatchEvent(new Event("resize"));
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [height]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full block"
      style={{ height }}
      role="img"
      aria-label="Signal trace"
    />
  );
});
