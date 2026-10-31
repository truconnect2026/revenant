"use client";
export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="no-print btn-press px-3 py-1.5 rounded border border-zinc-600 text-zinc-300 text-[11px] font-mono">
      Print or save as PDF
    </button>
  );
}
