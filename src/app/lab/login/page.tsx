"use client";
import { useState } from "react";

export default function LabLogin() {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/lab/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: code }),
      });
      if (r.ok) window.location.href = "/lab";
      else setErr("Wrong passcode. Try again.");
    } catch {
      setErr("Couldn't reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-scope flex items-center justify-center px-4">
      <form onSubmit={submit} className="panel-card rounded-lg p-5 w-full max-w-xs flex flex-col gap-3">
        <h1 className="font-display text-sm font-bold tracking-[0.2em] text-zinc-100">REVENANT LAB</h1>
        <label htmlFor="code" className="text-[11px] font-mono text-zinc-400">Passcode</label>
        <input
          id="code" type="password" autoComplete="current-password" value={code} onChange={(e) => setCode(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm font-mono text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        />
        {err && <p className="text-[11px] font-mono text-rose-300">{err}</p>}
        <button disabled={busy || !code} className="btn-press py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-display font-semibold uppercase tracking-wider disabled:opacity-50">
          {busy ? "Checking…" : "Open lab"}
        </button>
      </form>
    </div>
  );
}
