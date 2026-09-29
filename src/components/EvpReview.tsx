"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ClipRecord, idbDeleteClip, idbListClips, idbSaveTranscript } from "@/lib/idb";
import { METHOD_LABEL, SttMethod, speechSupport, transcribeClip } from "@/lib/speech";
import { SpectrogramCanvas } from "./SpectrogramCanvas";

function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Duration straight from the WAV header (byte rate at offset 28, data size at 40).
async function wavDurationSec(blob: Blob): Promise<number | null> {
  try {
    const view = new DataView(await blob.slice(0, 44).arrayBuffer());
    if (view.byteLength < 44) return null;
    const byteRate = view.getUint32(28, true);
    const dataSize = view.getUint32(40, true);
    return byteRate > 0 ? dataSize / byteRate : null;
  } catch {
    return null;
  }
}

interface Row extends ClipRecord {
  url: string;
  duration: number | null;
}

export function EvpReview() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [stt, setStt] = useState<{ supported: boolean; method: SttMethod | null }>({
    supported: false,
    method: null,
  });

  const load = useCallback(async () => {
    const clips = await idbListClips().catch(() => [] as ClipRecord[]);
    const next = await Promise.all(
      clips.map(async (c) => ({
        ...c,
        url: URL.createObjectURL(c.blob),
        duration: await wavDurationSec(c.blob),
      }))
    );
    setRows((prev) => {
      prev?.forEach((r) => URL.revokeObjectURL(r.url));
      return next;
    });
  }, []);

  useEffect(() => {
    setStt(speechSupport());
    load();
  }, [load]);

  // Free object URLs on unmount.
  const rowsRef = useRef<Row[] | null>(null);
  rowsRef.current = rows;
  useEffect(() => () => rowsRef.current?.forEach((r) => URL.revokeObjectURL(r.url)), []);

  const remove = async (r: Row) => {
    if (!window.confirm("Delete this audio clip? The anomaly event stays in its session.")) return;
    await idbDeleteClip(r.sessionId, r.event.id).catch(() => {});
    URL.revokeObjectURL(r.url);
    setRows((prev) => prev?.filter((x) => x.event.id !== r.event.id) ?? null);
  };

  const transcribe = async (r: Row) => {
    if (busyId) return;
    setBusyId(r.event.id);
    setErrors((e) => ({ ...e, [r.event.id]: "" }));
    try {
      const res = await transcribeClip(r.blob);
      const transcript = { text: res.text, method: METHOD_LABEL[res.method], created_at: Date.now() };
      await idbSaveTranscript(r.event.id, transcript).catch(() => {});
      setRows((prev) =>
        prev?.map((x) => (x.event.id === r.event.id ? { ...x, transcript } : x)) ?? null
      );
    } catch (err) {
      setErrors((e) => ({ ...e, [r.event.id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-scope text-zinc-100 flex flex-col">
      <div className="graticule fixed inset-0 pointer-events-none z-0" />
      <div className="vignette fixed inset-0 pointer-events-none z-0" />

      <div className="relative z-10 max-w-3xl w-full mx-auto px-4 py-4 flex flex-col flex-1 gap-4">
        <header className="flex items-center justify-between gap-3 pb-3 border-b border-zinc-800/80">
          <div className="min-w-0">
            <h1 className="font-display text-lg font-bold tracking-[0.2em] text-zinc-100 leading-none">
              EVP REVIEW
            </h1>
            <p className="mt-1.5 text-[10px] font-mono text-zinc-500 leading-none">
              {rows === null ? "Loading…" : `${rows.length} ${rows.length === 1 ? "clip" : "clips"} on this device`}
            </p>
          </div>
          <Link
            href="/"
            className="btn-press px-3 py-1.5 text-[10px] font-display uppercase tracking-wider font-semibold rounded border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
          >
            ← Instrument
          </Link>
        </header>

        {!stt.supported && (
          <p className="text-[10px] font-mono text-zinc-500 leading-relaxed">
            Speech-to-text needs the Web Speech API (Chrome, Edge, or Safari). Playback and delete still work.
          </p>
        )}
        {stt.method === "loopback" && (
          <p className="text-[10px] font-mono text-zinc-500 leading-relaxed">
            Speech-to-text plays the clip on the speaker and listens with the mic. Turn the volume up and
            keep the room quiet. Room sound is included in the result.
          </p>
        )}

        {rows !== null && rows.length === 0 && (
          <div className="panel-card rounded-lg px-3 py-6 text-center text-[11px] font-mono text-zinc-600">
            No recorded clips. Sound anomalies during a session save a clip here.
          </div>
        )}

        <ul className="flex flex-col gap-2">
          {rows?.map((r) => {
            const ev = r.event;
            const busy = busyId === ev.id;
            return (
              <li key={ev.id} className="panel-card rounded-lg px-3 py-2 flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] font-mono">
                  <span className="text-zinc-300 tabular-nums">{fmtDateTime(ev.timestamp)}</span>
                  {r.sessionLabel && <span className="text-zinc-500 truncate max-w-[10rem]">{r.sessionLabel}</span>}
                  <span className="text-emerald-400 font-display font-semibold tracking-wider">SND</span>
                  <span className="text-zinc-200 tabular-nums">
                    {ev.value} <span className="text-zinc-500">{ev.unit}</span>
                  </span>
                  <span className="text-zinc-300 tabular-nums">
                    {ev.sigma > 0 ? "+" : ""}
                    {ev.sigma.toFixed(1)}&sigma;
                  </span>
                  {r.duration !== null && (
                    <span className="text-zinc-600 tabular-nums">{r.duration.toFixed(1)}s</span>
                  )}
                </div>

                {ev.spectrogram && ev.spectrogram.length > 0 && (
                  <SpectrogramCanvas data={ev.spectrogram} height={40} />
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <audio src={r.url} controls preload="metadata" className="h-8 flex-1 min-w-[180px]" />
                  {stt.supported && (
                    <button
                      onClick={() => transcribe(r)}
                      disabled={busyId !== null}
                      className="btn-press px-2.5 py-1 text-[10px] font-display uppercase tracking-wider font-semibold rounded border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 disabled:opacity-50"
                    >
                      {busy ? "Listening…" : r.transcript ? "Re-transcribe" : "Transcribe"}
                    </button>
                  )}
                  <button
                    onClick={() => remove(r)}
                    disabled={busy}
                    className="btn-press px-2.5 py-1 text-[10px] font-display uppercase tracking-wider font-semibold rounded border border-red-900/70 text-red-400/80 hover:text-red-300 hover:border-red-700 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>

                {errors[ev.id] && (
                  <p className="text-[10px] font-mono text-red-400/80">{errors[ev.id]}</p>
                )}

                {r.transcript && (
                  <div className="text-[10px] font-mono leading-relaxed">
                    {r.transcript.text ? (
                      <span className="text-zinc-300 italic">&ldquo;{r.transcript.text}&rdquo;</span>
                    ) : (
                      <span className="text-zinc-500">No speech recognized.</span>
                    )}
                    <span className="ml-2 text-zinc-600">{r.transcript.method}</span>
                    {r.transcript.text && (
                      <span className="block mt-0.5 text-amber-500/80">
                        ⚠ Pattern-matching on noise — not evidence of a voice or entity.
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <footer className="mt-auto text-center text-[10px] font-mono text-zinc-600 leading-relaxed">
          Clips are real microphone audio captured around sound anomalies. Stored only on this device.
        </footer>
      </div>
    </div>
  );
}
