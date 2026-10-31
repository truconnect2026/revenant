"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { LabSession } from "@/lib/lab/analysis";
import { loadThresholds } from "@/lib/lab/thresholds";
import { loadConfig } from "@/lib/lab/config";
import { buildSpec } from "@/lib/research/spec";
import { draftPost, fillUrl, postToMarkdown, socialText, type ResearchPost } from "@/lib/research/writer";
import { Panel } from "./panels";
import { NeedMore } from "./charts";
import type { LabData } from "./useLabData";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { credentials: "same-origin", ...init });
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `Server returned ${r.status}`);
  return body;
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      window.prompt("Copy this:", text);
    }
  };
  return { copied, copy };
}

/** X counts any link as 23 characters. */
function xLength(text: string): number {
  return text.replace(/https?:\/\/\S+|\{url\}/g, "x".repeat(23)).length;
}

export function ResearchPanel({
  data, source, contributors, onReload,
}: {
  data: LabData;
  source: "mine" | "community";
  contributors?: number;
  /** Reload the data in view (after a server training run adds model versions). */
  onReload?: () => void;
}) {
  const [serverReady, setServerReady] = useState<boolean | null>(null);
  const [drafts, setDrafts] = useState<ResearchPost[]>([]);
  const [edit, setEdit] = useState<ResearchPost | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { copied, copy } = useCopy();
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const spec = useMemo(
    () => buildSpec({
      sessions: data.sessions as LabSession[],
      series: data.series,
      versions: data.versions,
      gear: data.gear,
      thresholds: loadThresholds(),
      source: source === "community" ? "community" : "lab",
      contributors: source === "community" ? contributors : undefined,
      config: loadConfig(),
    }),
    [data, source, contributors]
  );

  const refreshPosts = useCallback(async () => {
    try {
      const status = await call<{ configured: boolean }>("/api/lab/sync/status");
      setServerReady(status.configured);
      if (status.configured) setDrafts((await call<{ posts: ResearchPost[] }>("/api/research/posts?all=1")).posts);
    } catch {
      setServerReady(false);
    }
  }, []);
  useEffect(() => { refreshPosts(); }, [refreshPosts]);

  const runTraining = async () => {
    setBusy(true);
    setMsg("Training on the community dataset…");
    try {
      const r = await call<{ sessions: number; trained: string[]; notReady: string[]; draftId: string | null }>("/api/research/train", { method: "POST" });
      setMsg(
        `Trained ${r.trained.length ? r.trained.join(", ") : "no models"} on ${r.sessions} sessions.` +
          (r.notReady.length ? ` Not ready: ${r.notReady.join("; ")}.` : "") +
          (r.draftId ? " A draft log is waiting below." : "")
      );
      refreshPosts();
      onReload?.();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const publishSpec = async () => {
    setBusy(true);
    try {
      await call("/api/research/spec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec) });
      setMsg("Spec sheet published.");
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const save = async (post: ResearchPost, status: ResearchPost["status"]) => {
    setBusy(true);
    try {
      if (status === "published" && source === "mine") {
        // Publish the numbers the post is based on alongside it. (Community specs
        // come from the server's own training run.)
        await call("/api/research/spec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec) }).catch(() => {});
      }
      const r = await call<{ post: ResearchPost }>("/api/research/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...post, status }),
      });
      setEdit(r.post);
      setMsg(status === "published" ? "Published to /research." : "Draft saved.");
      refreshPosts();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this log? If it was published it disappears from /research.")) return;
    await call(`/api/research/posts?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch((e) => setMsg(String(e)));
    if (edit?.id === id) setEdit(null);
    refreshPosts();
  };

  const url = edit ? `${origin}/research/${edit.id}` : "";

  return (
    <>
      <Panel
        title="Spec sheet"
        sub={`Built from the ${source === "community" ? "community" : "your"} data in view. Aggregates only — no session, place name or contributor appears in it.`}
      >
        <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
          <div><div className="text-zinc-500">Sessions</div><div className="text-zinc-100 text-base">{spec.dataset.sessions}</div></div>
          <div><div className="text-zinc-500">Control</div><div className="text-zinc-100 text-base">{spec.dataset.hours.null.toFixed(1)} h</div></div>
          <div><div className="text-zinc-500">Test marks</div><div className="text-zinc-100 text-base">{spec.dataset.stimuli}</div></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {source === "community" && (
            <button onClick={runTraining} disabled={busy || !serverReady} className="btn-press px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-display font-semibold uppercase tracking-wider disabled:opacity-40">
              Run training on server
            </button>
          )}
          <button onClick={publishSpec} disabled={busy || !serverReady} className="btn-press px-3 py-1.5 rounded border border-zinc-500 text-zinc-100 text-[10px] font-display uppercase tracking-wider disabled:opacity-40">
            Publish spec sheet
          </button>
          <Link href="/research/spec" className="btn-press px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 text-[10px] font-display uppercase tracking-wider">
            View public page
          </Link>
        </div>
        {serverReady === false && (
          <p className="text-[11px] font-mono text-zinc-500">Publishing needs the database and Blob store on this deployment. Drafting and copying work without them.</p>
        )}
        {msg && <p className="text-[11px] font-mono text-zinc-300">{msg}</p>}
      </Panel>

      <Panel
        title="Research log"
        sub="Turns the numbers into a readable post with its sample sizes and limits. Edit anything, then publish to /research or copy it for your blog and socials. Nothing posts on its own."
        right={
          <button
            onClick={() => setEdit(draftPost(spec))}
            disabled={spec.dataset.sessions === 0}
            className="btn-press shrink-0 px-3 py-1.5 rounded border border-zinc-500 text-zinc-100 text-[10px] font-display uppercase tracking-wider disabled:opacity-40"
          >
            New draft
          </button>
        }
      >
        {drafts.length > 0 && (
          <div className="flex flex-col gap-1 text-[11px] font-mono">
            {drafts.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <span className={`px-1.5 rounded border text-[9px] uppercase ${p.status === "published" ? "border-emerald-700 text-emerald-300" : "border-zinc-700 text-zinc-400"}`}>{p.status}</span>
                <button onClick={() => setEdit(p)} className="text-zinc-200 hover:underline truncate text-left">{p.title}</button>
                <button onClick={() => remove(p.id)} className="ml-auto text-zinc-600 hover:text-zinc-300">delete</button>
              </div>
            ))}
          </div>
        )}
        {!edit ? (
          spec.dataset.sessions === 0 ? <NeedMore>Record or load some sessions first.</NeedMore> : null
        ) : (
          <div className="flex flex-col gap-2 text-[11px] font-mono">
            <input
              value={edit.title}
              onChange={(e) => setEdit({ ...edit, title: e.target.value })}
              aria-label="Title"
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100"
            />
            <textarea
              value={edit.summary}
              onChange={(e) => setEdit({ ...edit, summary: e.target.value })}
              aria-label="Summary"
              rows={2}
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200"
            />
            {edit.findings.map((f, i) => (
              <div key={i} className="rounded border border-zinc-800 p-2 flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <input
                    value={f.headline}
                    onChange={(e) => setEdit({ ...edit, findings: edit.findings.map((x, j) => (j === i ? { ...x, headline: e.target.value } : x)) })}
                    aria-label={`Finding ${i + 1} headline`}
                    className="flex-1 bg-transparent text-zinc-100"
                  />
                  <button onClick={() => setEdit({ ...edit, findings: edit.findings.filter((_, j) => j !== i) })} className="text-zinc-600 hover:text-zinc-300" aria-label="Remove finding">✕</button>
                </div>
                <textarea
                  value={f.detail}
                  onChange={(e) => setEdit({ ...edit, findings: edit.findings.map((x, j) => (j === i ? { ...x, detail: e.target.value } : x)) })}
                  aria-label={`Finding ${i + 1} detail`}
                  rows={2}
                  className="bg-transparent text-zinc-400"
                />
              </div>
            ))}
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Social post</span>
              <button onClick={() => setEdit({ ...edit, social: socialText(edit) })} className="text-zinc-500 hover:text-zinc-300">regenerate</button>
            </div>
            <textarea
              value={edit.social.short}
              onChange={(e) => setEdit({ ...edit, social: { ...edit.social, short: e.target.value } })}
              aria-label="Short social post"
              rows={3}
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200"
            />
            <span className={xLength(edit.social.short) > 280 ? "text-rose-300" : "text-zinc-500"}>
              {xLength(edit.social.short)}/280 on X (the link counts as 23)
            </span>
            <textarea
              value={edit.social.caption}
              onChange={(e) => setEdit({ ...edit, social: { ...edit.social, caption: e.target.value } })}
              aria-label="Long caption"
              rows={5}
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200"
            />
            <div className="flex flex-wrap gap-2">
              <button onClick={() => save(edit, "published")} disabled={busy || !serverReady} className="btn-press px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-display font-semibold uppercase tracking-wider disabled:opacity-40">
                Publish
              </button>
              <button onClick={() => save(edit, "draft")} disabled={busy || !serverReady} className="btn-press px-3 py-1.5 rounded border border-zinc-600 text-zinc-300 text-[10px] font-display uppercase tracking-wider disabled:opacity-40">
                Save draft
              </button>
              <button onClick={() => copy("md", postToMarkdown(edit, url))} className="btn-press px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 text-[10px] font-mono">
                {copied === "md" ? "Copied" : "Copy Markdown"}
              </button>
              <button onClick={() => copy("short", fillUrl(edit.social.short, url))} className="btn-press px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 text-[10px] font-mono">
                {copied === "short" ? "Copied" : "Copy post"}
              </button>
              <button onClick={() => copy("caption", fillUrl(edit.social.caption, url))} className="btn-press px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 text-[10px] font-mono">
                {copied === "caption" ? "Copied" : "Copy caption"}
              </button>
            </div>
            {edit.status === "published" && (
              <Link href={`/research/${edit.id}`} className="text-zinc-400 underline">View published log</Link>
            )}
          </div>
        )}
      </Panel>
    </>
  );
}
