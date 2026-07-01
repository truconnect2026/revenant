"use client";
import { useState } from "react";

interface Props {
  haptics: boolean;
  sound: boolean;
  onToggle: (key: "haptics" | "sound", value: boolean) => void;
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="btn-press flex items-center justify-between gap-3 w-full px-2 py-1.5 rounded hover:bg-white/5 text-left"
    >
      <span className="flex flex-col">
        <span className="text-[11px] font-display font-medium tracking-wide text-zinc-200">{label}</span>
        <span className="text-[9px] font-mono text-zinc-500">{hint}</span>
      </span>
      <span
        className={`relative shrink-0 w-8 h-4 rounded-full transition-colors ${checked ? "bg-emerald-600" : "bg-zinc-700"}`}
        style={{ transition: "background-color var(--t-2) var(--ease)" }}
      >
        <span
          className="absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white"
          style={{ transform: checked ? "translateX(16px)" : "translateX(0)", transition: "transform var(--t-2) var(--ease)" }}
        />
      </span>
    </button>
  );
}

export function SettingsControl({ haptics, sound, onToggle }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        aria-label="Settings"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="btn-press flex items-center justify-center w-8 h-8 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 mt-2 z-50 w-52 panel-card rounded-lg p-1.5 flex flex-col gap-0.5">
            <div className="px-2 pt-1 pb-1.5 text-[9px] font-display uppercase tracking-[0.18em] text-zinc-500 border-b border-zinc-800/80">
              Feedback
            </div>
            <Toggle label="Haptics" hint="Vibrate on anomaly" checked={haptics} onChange={(v) => onToggle("haptics", v)} />
            <Toggle label="Sound tick" hint="Quiet blip on anomaly" checked={sound} onChange={(v) => onToggle("sound", v)} />
          </div>
        </>
      )}
    </div>
  );
}
