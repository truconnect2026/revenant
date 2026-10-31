"use client";
import { useState } from "react";
import type { SessionType } from "@/lib/types";
import { STIMULUS_TYPES } from "@/lib/lab/sources";

export const SESSION_TYPES: { type: SessionType; name: string; hint: string }[] = [
  { type: "investigation", name: "Investigate", hint: "A normal investigation at a location with claims." },
  { type: "null", name: "Control", hint: "A boring place with no claims, same setup. Measures false alarms." },
  { type: "calibration", name: "Calibrate", hint: "Make known sounds and movements on purpose. Measures what each sensor catches." },
];

export function SessionTypePicker({ value, onChange }: { value: SessionType; onChange: (t: SessionType) => void }) {
  const current = SESSION_TYPES.find((s) => s.type === value) ?? SESSION_TYPES[0];
  return (
    <div className="flex flex-col gap-1">
      <div role="radiogroup" aria-label="Session type" className="flex rounded border border-zinc-700 overflow-hidden">
        {SESSION_TYPES.map((s) => (
          <button
            key={s.type}
            role="radio"
            aria-checked={value === s.type}
            onClick={() => onChange(s.type)}
            className={`btn-press flex-1 px-2 py-1.5 text-[10px] font-display font-semibold uppercase tracking-wider ${
              value === s.type ? "bg-zinc-200 text-zinc-900" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>
      <p className="text-[10px] font-mono text-zinc-500 leading-snug">{current.hint}</p>
    </div>
  );
}

interface FieldProps {
  sessionType: SessionType;
  blind: boolean;
  onBlind: (b: boolean) => void;
  onStimulus: (type: string) => void;
  onFelt: () => void;
  stimulusCount: number;
  feltCount: number;
}

/** In-session controls: stimulus markers, "felt something", blind mode. */
export function FieldControls({ sessionType, blind, onBlind, onStimulus, onFelt, stimulusCount, feltCount }: FieldProps) {
  const [flash, setFlash] = useState<string | null>(null);
  const [showStim, setShowStim] = useState(sessionType === "calibration");

  const mark = (type: string) => {
    onStimulus(type);
    setFlash(type);
    setTimeout(() => setFlash(null), 900);
  };

  return (
    <div className="panel-card rounded-lg p-3 flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <button
          onClick={onFelt}
          className="btn-press flex-1 py-3 rounded border border-rose-700/80 bg-rose-950/40 text-rose-200 font-display text-xs font-semibold uppercase tracking-[0.2em] hover:bg-rose-900/40"
        >
          Felt something
        </button>
        <button
          role="switch"
          aria-checked={blind}
          onClick={() => onBlind(!blind)}
          className={`btn-press px-3 py-3 rounded border text-[10px] font-display font-semibold uppercase tracking-wider ${
            blind ? "border-zinc-300 text-zinc-100 bg-zinc-700/40" : "border-zinc-700 text-zinc-400"
          }`}
          title="Hide readouts so they can't influence what you report"
        >
          {blind ? "Blind on" : "Blind"}
        </button>
      </div>
      <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
        <span>{feltCount} felt · {stimulusCount} test marks</span>
        <button onClick={() => setShowStim((s) => !s)} className="underline-offset-2 hover:underline text-zinc-400">
          {showStim ? "Hide test marks" : "Test marks"}
        </button>
      </div>
      {showStim && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] font-mono text-zinc-500 leading-snug">
            Tap a mark, then do it within a couple of seconds. Events that follow are tagged as tests automatically.
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            {STIMULUS_TYPES.map((s) => (
              <button
                key={s.type}
                onClick={() => mark(s.type)}
                title={s.hint}
                className={`btn-press py-2 rounded border text-[10px] font-mono ${
                  flash === s.type ? "border-violet-400 text-violet-100 bg-violet-500/20" : "border-zinc-700 text-zinc-300"
                }`}
              >
                {s.type}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
