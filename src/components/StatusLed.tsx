"use client";
import { SensorStatus } from "@/lib/types";

const LABELS: Record<SensorStatus, string> = {
  standby: "STANDBY",
  settling: "SETTLING",
  live: "LIVE",
  blocked: "BLOCKED",
  "no-channel": "NO CHANNEL",
};

// The dot carries the only color: the channel accent when the instrument is
// active (live/settling), red for a fault, neutral otherwise. Active dots
// breathe. The label stays neutral so color never scatters.
export function StatusLed({ status, accent = "#a1a1aa" }: { status: SensorStatus; accent?: string }) {
  const active = status === "live" || status === "settling";
  const dotColor = status === "blocked" ? "#f87171" : active ? accent : "#52525b";

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`inline-block w-2 h-2 rounded-full ${active ? "led-breathe" : ""}`}
        style={{ backgroundColor: dotColor }}
      />
      <span className="text-[10px] font-display font-medium uppercase tracking-[0.15em] text-zinc-400">
        {LABELS[status]}
      </span>
    </div>
  );
}
