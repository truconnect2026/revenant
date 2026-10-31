"use client";
import { useEffect, useState } from "react";
import { idbGetClip, type StoredSession } from "@/lib/idb";
import { fetchServerClip } from "@/lib/lab/sync";
import type { EventLabel } from "@/lib/types";
import { SpectrogramCanvas } from "../SpectrogramCanvas";
import { EventLabeler } from "../EventLabeler";
import { CHANNEL_HEX } from "./charts";

type StoredEvent = StoredSession["events"][number];

const SESSION_TYPE_NAME: Record<string, string> = { investigation: "Investigation", null: "Control", calibration: "Calibration" };

/** One stored event with its audio, spectrogram, measured features and labeler. */
export function EventDetail({
  session, event, onLabel, readOnly = false,
}: {
  session: StoredSession;
  event: StoredEvent;
  onLabel: (label: EventLabel) => void;
  /** Community data: labels belong to contributors, and audio comes from the community store. */
  readOnly?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
  }, [event.id]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const [audioMsg, setAudioMsg] = useState<string | null>(null);
  const loadAudio = async () => {
    if (!event.clipId) return;
    // This phone first; otherwise the server copy (recorded on another phone).
    const blob = readOnly
      ? await fetch(`/api/community/clip?id=${encodeURIComponent(event.clipId)}`).then((r) => (r.ok ? r.blob() : null)).catch(() => null)
      : (await idbGetClip(event.clipId)) ?? (await fetchServerClip(event.clipId));
    if (blob) setUrl(URL.createObjectURL(blob));
    else setAudioMsg("Audio isn't on this phone or the server.");
  };

  const f = event.features;
  const facts: [string, string][] = [];
  if (f) {
    if (f.durationMs !== undefined) facts.push(["duration", `${Math.round(f.durationMs)} ms`]);
    if (f.riseTimeMs !== undefined) facts.push(["rise", `${Math.round(f.riseTimeMs)} ms`]);
    if (f.dominantFreqHz !== undefined) facts.push(["dominant", `${Math.round(f.dominantFreqHz)} Hz`]);
    if (f.spectralCentroidHz !== undefined) facts.push(["centroid", `${Math.round(f.spectralCentroidHz)} Hz`]);
    if (f.spectralFlatness !== undefined) facts.push(["flatness", f.spectralFlatness.toFixed(2)]);
    if (f.peakDbfs !== undefined) facts.push(["peak", `${f.peakDbfs.toFixed(1)} dBFS`]);
    if (f.axisDev) facts.push(["axis dev x/y/z", f.axisDev.map((v) => v.toFixed(2)).join(" / ")]);
    if (f.rotPeak !== undefined) facts.push(["rotation", `${f.rotPeak.toFixed(1)} °/s`]);
  }

  return (
    <div className="rounded border border-zinc-800 bg-black/20 p-2.5 flex flex-col gap-1.5 text-[11px] font-mono">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-display font-semibold uppercase tracking-wider" style={{ color: CHANNEL_HEX[event.channel] }}>
          {event.channel}
        </span>
        <span className="text-zinc-200 tabular-nums">{event.value} {event.unit}</span>
        <span className="text-zinc-300 tabular-nums">+{event.sigma.toFixed(1)}σ</span>
        {event.sentry && <span className="text-zinc-500">sentry</span>}
        <span className="ml-auto text-zinc-500">
          {new Date(event.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      </div>
      <div className="text-zinc-500">
        {SESSION_TYPE_NAME[session.type ?? "investigation"]}{session.label ? ` · ${session.label}` : session.place?.type ? ` · ${session.place.type}` : ""}
      </div>
      {facts.length > 0 && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
          {facts.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <span className="text-zinc-500">{k}</span>
              <span className="text-zinc-300 tabular-nums">{v}</span>
            </div>
          ))}
        </div>
      )}
      {event.spectrogram && event.spectrogram.length > 0 && <SpectrogramCanvas data={event.spectrogram} height={36} />}
      {event.clipId && (url ? (
        <audio src={url} controls className="h-7 w-full" autoPlay />
      ) : (
        <div className="flex items-center gap-2">
          <button onClick={loadAudio} className="btn-press self-start px-2 py-1 rounded border border-zinc-700 text-zinc-300 text-[10px]">
            Play clip
          </button>
          {audioMsg && <span className="text-[10px] text-zinc-500">{audioMsg}</span>}
        </div>
      ))}
      {readOnly ? (
        <span className="text-[10px] text-zinc-500">
          {event.label?.status && event.label.status !== "unlabeled" ? `Contributor label: ${event.label.status}${event.label.source ? ` · ${event.label.source}` : ""}` : "Unlabeled by contributor"}
        </span>
      ) : (
        <EventLabeler event={event} onLabel={onLabel} />
      )}
    </div>
  );
}
