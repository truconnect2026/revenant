"use client";
import { useState } from "react";
import { AnomalyEvent } from "@/lib/types";
import { SpectrogramCanvas } from "./SpectrogramCanvas";

const CHANNEL_LABELS: Record<string, string> = {
  emf: "EMF",
  sound: "SND",
  motion: "MOT",
};

const CHANNEL_COLORS: Record<string, string> = {
  emf: "text-cyan-400",
  sound: "text-emerald-400",
  motion: "text-amber-400",
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

interface Props {
  events: AnomalyEvent[];
  className?: string;
  transcribeEnabled?: boolean;
}

export function EventLog({ events, className = "", transcribeEnabled = false }: Props) {
  const [transcriptions, setTranscriptions] = useState<Record<string, string>>({});
  const [transcribing, setTranscribing] = useState<string | null>(null);

  const analyze = async (ev: AnomalyEvent) => {
    if (!ev.clipUrl || transcribing) return;
    setTranscribing(ev.id);
    try {
      const blob = await fetch(ev.clipUrl).then((r) => r.blob());
      const fd = new FormData();
      fd.append("audio", blob, "clip.wav");
      const resp = await fetch("/api/transcribe", { method: "POST", body: fd });
      const data = await resp.json() as { text?: string; error?: string };
      setTranscriptions((prev) => ({
        ...prev,
        [ev.id]: data.text ?? data.error ?? "No result",
      }));
    } catch {
      setTranscriptions((prev) => ({ ...prev, [ev.id]: "Network error" }));
    } finally {
      setTranscribing(null);
    }
  };

  if (events.length === 0) {
    return (
      <div className={`flex items-center justify-center text-xs font-mono text-zinc-600 ${className}`}>
        No anomaly events recorded.
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-1 overflow-y-auto scrollbar-thin ${className}`}>
      {[...events].reverse().map((ev) => (
        <div
          key={ev.id}
          className="flex flex-col px-3 py-1.5 bg-zinc-800/50 rounded border border-zinc-700/30 gap-1"
        >
          {/* Main event row */}
          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="text-zinc-500 w-16 shrink-0">{formatTime(ev.timestamp)}</span>
            <span className={`w-8 shrink-0 font-semibold ${CHANNEL_COLORS[ev.channel]}`}>
              {CHANNEL_LABELS[ev.channel]}
            </span>
            <span className="text-zinc-200 tabular-nums">
              {ev.value} {ev.unit}
            </span>
            <span className="text-red-400 tabular-nums">
              {ev.sigma > 0 ? "+" : ""}
              {ev.sigma.toFixed(1)}&sigma;
            </span>
            <span className="text-zinc-500 tabular-nums">
              &mu;={ev.mean}&plusmn;{ev.stddev}
            </span>
            <div className="ml-auto flex items-center gap-2 shrink-0">
              {transcribeEnabled && ev.clipUrl && !transcriptions[ev.id] && (
                <button
                  onClick={() => analyze(ev)}
                  disabled={transcribing === ev.id}
                  className="px-2 py-0.5 text-[10px] font-mono uppercase font-semibold rounded border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 disabled:opacity-50 transition-colors"
                >
                  {transcribing === ev.id ? "…" : "Analyze"}
                </button>
              )}
              {ev.clipUrl && (
                <audio src={ev.clipUrl} controls className="h-6 max-w-[120px]" preload="none" />
              )}
            </div>
          </div>

          {/* Spectrogram (sound events only) */}
          {ev.spectrogram && ev.spectrogram.length > 0 && (
            <SpectrogramCanvas data={ev.spectrogram} height={40} />
          )}

          {/* Transcript */}
          {transcriptions[ev.id] && (
            <div className="text-[10px] font-mono leading-relaxed">
              <span className="text-zinc-300 italic">&ldquo;{transcriptions[ev.id]}&rdquo;</span>
              <span className="block mt-0.5 text-amber-500/80">
                ⚠ Pattern-matching on noise — not evidence of a voice or entity.
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
