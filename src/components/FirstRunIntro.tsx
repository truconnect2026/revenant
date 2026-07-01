"use client";

interface Props {
  onDismiss: () => void;
}

const LINES = [
  { k: "EMF", c: "#22d3ee", d: "Magnetic-field strength — flags deviation from the ambient baseline (µT)." },
  { k: "SOUND", c: "#34d399", d: "Acoustic level — flags transients above the room's settled floor (dBFS)." },
  { k: "MOTION", c: "#fbbf24", d: "Vibration & tilt — flags bumps beyond resting sensor noise (m/s²)." },
];

export function FirstRunIntro({ onDismiss }: Props) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="intro-enter panel-card rounded-xl max-w-sm w-full p-5 flex flex-col gap-4">
        <div>
          <h2 className="font-display text-base font-bold tracking-[0.2em] text-zinc-100">REVENANT</h2>
          <p className="text-[10px] font-display uppercase tracking-[0.16em] text-zinc-500 mt-1">
            Three instruments, one baseline
          </p>
        </div>
        <ul className="flex flex-col gap-3">
          {LINES.map((l) => (
            <li key={l.k} className="flex gap-2.5">
              <span className="w-0.5 rounded-full shrink-0" style={{ backgroundColor: l.c }} />
              <div>
                <div className="font-display text-xs font-semibold tracking-[0.15em]" style={{ color: l.c }}>
                  {l.k}
                </div>
                <div className="text-[11px] font-mono text-zinc-400 leading-snug mt-0.5">{l.d}</div>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-[10px] font-mono text-zinc-600 leading-snug">
          Reads real device sensors — no synthesized data. Reports environmental deviation from baseline, not the paranormal.
        </p>
        <button
          onClick={onDismiss}
          className="btn-press self-end px-4 py-1.5 text-[11px] font-display uppercase tracking-wider font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          Begin
        </button>
      </div>
    </div>
  );
}
