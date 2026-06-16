"use client";
import { SensorStatus } from "@/lib/types";

const STATUS_CONFIG: Record<SensorStatus, { color: string; label: string; pulse: boolean }> = {
  standby: { color: "bg-zinc-600", label: "STANDBY", pulse: false },
  settling: { color: "bg-amber-500", label: "SETTLING", pulse: true },
  live: { color: "bg-emerald-400", label: "LIVE", pulse: false },
  blocked: { color: "bg-red-500", label: "BLOCKED", pulse: false },
  "no-channel": { color: "bg-zinc-500", label: "NO CHANNEL", pulse: false },
};

export function StatusLed({ status }: { status: SensorStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-block w-2.5 h-2.5 rounded-full ${cfg.color} ${
          cfg.pulse ? "animate-pulse" : ""
        }`}
      />
      <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400">
        {cfg.label}
      </span>
    </div>
  );
}
