"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  contribute, join, loadMembership, needsReconsent, pendingSessions, setAudio, withdraw, type Membership,
} from "@/lib/community/client";

/** Plain-language consent. Bump CONSENT_VERSION in lib/community/privacy.ts when this changes. */
function ConsentSheet({ onAccept, onCancel }: { onAccept: (audio: boolean) => void; onCancel: () => void }) {
  const [audio, setAudioChoice] = useState(false);
  const [agree, setAgree] = useState(false);
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-950/80 p-3 flex flex-col gap-2.5 text-[11px] font-mono text-zinc-300 leading-relaxed">
      <p className="font-display text-xs font-semibold uppercase tracking-[0.15em] text-zinc-100">Join the community dataset</p>
      <p>Revenant is an open research project testing what phone sensors really catch. Contributing adds your sessions to a shared dataset used to train and test the models.</p>
      <div>
        <p className="text-zinc-100">What&apos;s shared</p>
        <p className="text-zinc-400">Sensor readings and score logs, events and your labels, test marks, felt marks, session type, the place type you pick (e.g. Home), an optional state or country, the date and hour, and phone type (iOS / Android).</p>
      </div>
      <div>
        <p className="text-zinc-100">Never shared</p>
        <p className="text-zinc-400">GPS or any coordinates, your location name, your exact clock time, device id or browser details. These are removed on your phone and again on the server.</p>
      </div>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5" checked={audio} onChange={(e) => setAudioChoice(e.target.checked)} />
        <span><span className="text-zinc-100">Also share audio clips (optional).</span> <span className="text-zinc-400">Clips can contain voices and household sounds that identify you. Off unless you tick this.</span></span>
      </label>
      <p className="text-zinc-400">
        Contributed data may be published as an open research dataset and may be used in future data products, only
        in this de-identified form. You can withdraw any time, which deletes everything you sent. Details in the{" "}
        <Link href="/privacy" className="underline">privacy notice</Link>.
      </p>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span className="text-zinc-100">I recorded these sessions and agree to share them this way.</span>
      </label>
      <div className="flex gap-2">
        <button
          disabled={!agree}
          onClick={() => onAccept(audio)}
          className="btn-press px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-display font-semibold uppercase tracking-wider disabled:opacity-40"
        >
          Join
        </button>
        <button onClick={onCancel} className="btn-press px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 text-[10px] font-display uppercase tracking-wider">
          Not now
        </button>
      </div>
    </div>
  );
}

/** Contribute finished sessions to the community dataset, or withdraw. Shown when not recording. */
export function CommunityPanel({ refreshKey }: { refreshKey: number }) {
  const [m, setM] = useState<Membership | null>(null);
  const [showConsent, setShowConsent] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const cur = loadMembership();
    setM(cur);
    setPending(cur && !needsReconsent(cur) ? (await pendingSessions(cur).catch(() => [])).length : null);
  }, []);
  useEffect(() => { refresh(); }, [refresh, refreshKey]);

  const doContribute = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await contribute(setMsg);
      setMsg(r.sessions ? `Thanks — sent ${r.sessions} session${r.sessions > 1 ? "s" : ""}${r.clips ? ` and ${r.clips} clips` : ""}.` : "Nothing new to send.");
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
      refresh();
    }
  };
  const doWithdraw = async () => {
    if (!window.confirm("Delete everything this phone contributed from the community dataset and stop contributing?")) return;
    setBusy(true);
    try {
      const n = await withdraw();
      setMsg(`Withdrawn. ${n} contributed session${n === 1 ? " was" : "s were"} deleted from the server.`);
    } catch (e) {
      setMsg(`Couldn't withdraw: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <section className="panel-card rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-xs font-semibold uppercase tracking-[0.15em] text-zinc-300">Community research</h2>
        <Link href="/research" className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300">findings →</Link>
      </div>
      {showConsent || needsReconsent(m) ? (
        <ConsentSheet
          onAccept={(audio) => { setM(join(audio)); setShowConsent(false); refresh(); }}
          onCancel={() => setShowConsent(false)}
        />
      ) : !m ? (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-mono text-zinc-500 leading-relaxed">
            Help test what phone sensors really catch. Your sessions stay on your phone unless you join — and GPS never leaves it.
          </p>
          <button onClick={() => setShowConsent(true)} className="btn-press self-start px-3 py-1.5 rounded border border-zinc-500 text-zinc-100 text-[10px] font-display uppercase tracking-wider">
            Learn more and join
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 text-[11px] font-mono">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={doContribute}
              disabled={busy || !pending}
              className="btn-press px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-display font-semibold uppercase tracking-wider disabled:opacity-40"
            >
              {busy ? "Working…" : pending ? `Contribute ${pending} session${pending > 1 ? "s" : ""}` : "All sessions contributed"}
            </button>
            <label className="flex items-center gap-1.5 text-zinc-400">
              <input type="checkbox" checked={m.audio} onChange={(e) => { setM(setAudio(e.target.checked)); refresh(); }} />
              share audio
            </label>
          </div>
          <p className="text-zinc-500">Location, labels you typed and exact times are stripped before sending.</p>
          <button onClick={doWithdraw} disabled={busy} className="self-start text-[10px] text-zinc-500 underline-offset-2 hover:underline hover:text-zinc-300">
            Withdraw and delete my contributions
          </button>
        </div>
      )}
      {msg && <p className="text-[11px] font-mono text-zinc-300">{msg}</p>}
    </section>
  );
}
