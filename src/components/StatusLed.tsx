"use client";
import { SensorStatus } from "@/lib/types";

// `pulse` marks channels that are actively working (settling into or holding a
// baseline) so their dot breathes; standby/blocked/no-channel stay static.
const STATUS_CONFIG: Record<SensorStatus, { color: string; label: string; pulse: boolean }> = {
  standby:     { color: "bg-amber-500/60",  label: "STANDBY",    pulse: false },
  settling:    { color: "bg-amber-400",     label: "SETTLING",   pulse: true  },
  live:        { color: "bg-emerald-400",   label: "LIVE",       pulse: true  },
  blocked:     { color: "bg-red-500",       label: "BLOCKED",    pulse: false },
  "no-channel":{ color: "bg-zinc-500",      label: "NO CHANNEL", pulse: false },
};

export function StatusLed({ status }: { status: SensorStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-block w-2.5 h-2.5 rounded-full ${cfg.color} ${
          cfg.pulse ? "led-breathe" : ""
        }`}
      />
      <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400">
        {cfg.label}
      </span>
    </div>
  );
}
