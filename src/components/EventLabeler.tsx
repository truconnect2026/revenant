"use client";
import { useEffect, useState } from "react";
import type { AnomalyEvent, EventLabel, LabelStatus } from "@/lib/types";
import { SOURCE_CHIPS } from "@/lib/lab/sources";

const CUSTOM_KEY = "revenant.customSources";

export const STATUS_STYLE: Record<LabelStatus, { text: string; cls: string }> = {
  unlabeled: { text: "Unlabeled", cls: "text-zinc-500 border-zinc-700" },
  explained: { text: "Explained", cls: "text-sky-300 border-sky-700/70" },
  injected: { text: "Test", cls: "text-violet-300 border-violet-700/70" },
  unexplained: { text: "Unexplained", cls: "text-rose-300 border-rose-700/70" },
};

export function humanLabel(prev: EventLabel | undefined, status: LabelStatus, source?: string): EventLabel {
  // Keep the model's suggestion alongside; a human label never erases it.
  return {
    status,
    source,
    labeledBy: status === "unlabeled" ? undefined : "human",
    labeledAt: Date.now(),
    modelPrediction: prev?.modelPrediction,
  };
}

function loadCustom(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

interface Props {
  event: AnomalyEvent;
  onLabel: (label: EventLabel) => void;
  compact?: boolean;
}

/** Status tag + model suggestion, expanding into source chips. */
export function EventLabeler({ event, onLabel, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (open) setCustom(loadCustom());
  }, [open]);

  const label = event.label;
  const status: LabelStatus = label?.status ?? "unlabeled";
  const st = STATUS_STYLE[status];
  const pred = label?.modelPrediction;
  const sources = [...SOURCE_CHIPS, ...custom.filter((c) => !(SOURCE_CHIPS as readonly string[]).includes(c))];

  const pick = (src: string) => {
    onLabel(humanLabel(label, "explained", src));
    setOpen(false);
  };
  const addCustom = () => {
    const v = draft.trim().slice(0, 32);
    if (!v) return;
    const next = Array.from(new Set([...custom, v]));
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(next)); } catch {}
    setDraft("");
    pick(v);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-mono">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={`btn-press px-1.5 py-0.5 rounded border uppercase tracking-wider ${st.cls}`}
          title="Label this event"
        >
          {st.text}
          {label?.source ? ` · ${label.source}` : ""}
          {label?.labeledBy === "auto-stimulus" ? " (auto)" : ""}
        </button>
        {pred && status !== "explained" && status !== "injected" && (
          <span className="text-zinc-500" title={`Model ${pred.modelVersion}, nearest distance ${pred.distance}`}>
            {pred.source === "unknown"
              ? "model: no close match"
              : `model suggests: ${pred.source} (${Math.round(pred.confidence * 100)}%)`}
          </span>
        )}
        {pred && pred.source !== "unknown" && status === "unlabeled" && !compact && (
          <button
            onClick={() => pick(pred.source)}
            className="btn-press px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200"
          >
            Confirm
          </button>
        )}
      </div>
      {open && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {sources.map((src) => (
            <button
              key={src}
              onClick={() => pick(src)}
              className={`btn-press px-2 py-1 rounded border text-[10px] font-mono ${
                label?.source === src && status === "explained"
                  ? "border-sky-500 text-sky-200 bg-sky-500/10"
                  : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
              }`}
            >
              {src}
            </button>
          ))}
          <button
            onClick={() => { onLabel(humanLabel(label, "unexplained")); setOpen(false); }}
            className="btn-press px-2 py-1 rounded border border-rose-800 text-rose-300 text-[10px] font-mono"
          >
            Unexplained
          </button>
          {status !== "unlabeled" && (
            <button
              onClick={() => { onLabel(humanLabel(label, "unlabeled")); setOpen(false); }}
              className="btn-press px-2 py-1 rounded border border-zinc-800 text-zinc-500 text-[10px] font-mono"
            >
              Clear
            </button>
          )}
          <span className="flex items-center gap-1">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addCustom(); }}
              placeholder="Other source"
              aria-label="Custom source"
              className="w-24 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-[10px] font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500"
            />
            <button
              onClick={addCustom}
              className="btn-press px-1.5 py-1 rounded border border-zinc-700 text-zinc-400 text-[10px] font-mono"
            >
              Add
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
