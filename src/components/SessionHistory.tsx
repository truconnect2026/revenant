"use client";
import { SessionData } from "@/lib/types";
import { idbGetSessionForExport, idbLoadSessions } from "@/lib/idb";
import { SpectrogramCanvas } from "./SpectrogramCanvas";

interface Props {
  sessions: SessionData[];
  onSessionsChange: (sessions: SessionData[]) => void;
}

function fmt(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportSession(session: SessionData) {
  const result = await idbGetSessionForExport(session.id);

  // Export each audio clip
  if (result) {
    let clipIndex = 0;
    result.blobs.forEach((blob, id) => {
      const ts = result.session.events.find((e) => e.clipId === id)?.timestamp ?? 0;
      const label = ts ? new Date(ts).toISOString().replace(/[:.]/g, "-") : `clip-${clipIndex}`;
      downloadBlob(blob, `revenant-${session.id.slice(0, 8)}-${label}.webm`);
      clipIndex++;
    });
  }

  // Export events JSON (without blob references)
  const exportData = {
    id: session.id,
    started_at: session.started_at,
    ended_at: session.ended_at,
    label: session.label,
    location: session.location,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    events: session.events.map(({ clipUrl: _url, ...ev }) => ev),
  };
  const json = JSON.stringify(exportData, null, 2);
  downloadBlob(new Blob([json], { type: "application/json" }), `revenant-${session.id.slice(0, 8)}.json`);
}

export function SessionHistory({ sessions, onSessionsChange }: Props) {
  if (sessions.length === 0) return null;

  const refresh = () => {
    idbLoadSessions().then(onSessionsChange).catch(() => {});
  };

  return (
    <details className="group mt-4">
      <summary className="cursor-pointer select-none list-none flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-400 transition-colors">
        <span className="inline-block transition-transform group-open:rotate-90">▶</span>
        Past Sessions
        <span className="font-normal normal-case text-[10px] text-zinc-600 ml-1">({sessions.length})</span>
        <button
          onClick={(e) => { e.preventDefault(); refresh(); }}
          className="ml-auto text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors normal-case tracking-normal"
          title="Reload from storage"
        >
          ↺ refresh
        </button>
      </summary>

      <div className="mt-3 flex flex-col gap-3">
        {sessions.map((s) => (
          <div
            key={s.id}
            className="rounded border border-zinc-700/40 bg-zinc-800/40 px-3 py-2 text-xs font-mono"
          >
            {/* Session header */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-zinc-300">
                  {new Date(s.started_at).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {s.label && (
                  <span className="ml-2 text-zinc-500">{s.label}</span>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0 text-zinc-500">
                <span>{s.ended_at != null ? fmt(s.ended_at - s.started_at) : "—"}</span>
                <span className={s.events.length > 0 ? "text-amber-400/80" : ""}>
                  {s.events.length} event{s.events.length !== 1 ? "s" : ""}
                </span>
                <button
                  onClick={() => exportSession(s)}
                  className="px-2 py-0.5 text-[10px] uppercase font-semibold rounded border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
                  title="Download events JSON + audio clips"
                >
                  Export
                </button>
              </div>
            </div>

            {s.location && (
              <div className="mt-0.5 text-zinc-600">
                {s.location.lat.toFixed(4)}, {s.location.lng.toFixed(4)}
              </div>
            )}

            {/* Events with audio + spectrograms */}
            {s.events.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                {s.events.map((ev) => (
                  <div key={ev.id} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 text-zinc-400">
                      <span className="text-zinc-600 w-14 shrink-0">
                        {new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <span className={`w-7 shrink-0 font-semibold ${
                        ev.channel === "emf" ? "text-cyan-400/70"
                        : ev.channel === "sound" ? "text-emerald-400/70"
                        : "text-amber-400/70"
                      }`}>
                        {ev.channel === "emf" ? "EMF" : ev.channel === "sound" ? "SND" : "MOT"}
                      </span>
                      <span className="tabular-nums text-zinc-300">
                        {ev.value} {ev.unit}
                      </span>
                      <span className="text-red-400/70 tabular-nums">
                        +{ev.sigma.toFixed(1)}σ
                      </span>
                      {ev.clipUrl && (
                        <audio
                          src={ev.clipUrl}
                          controls
                          className="h-5 ml-auto max-w-[110px]"
                          preload="none"
                        />
                      )}
                    </div>
                    {ev.spectrogram && ev.spectrogram.length > 0 && (
                      <SpectrogramCanvas data={ev.spectrogram} height={32} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
