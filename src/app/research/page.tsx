import type { Metadata } from "next";
import Link from "next/link";
import { getLabStore, syncConfig } from "@/lib/server/labStore";
import { latestSpec, listPosts } from "@/lib/server/research";
import { NotSetUp, ResearchShell } from "@/components/research/Shell";

export const metadata: Metadata = {
  title: "Revenant Research — what phone sensors really catch",
  description: "Open, community-run tests of paranormal-investigation sensors: detection rates, false alarms and model results from real recordings.",
};
export const revalidate = 300;

export default async function ResearchIndex() {
  const ready = syncConfig().configured;
  const store = ready ? await getLabStore("community").catch(() => null) : null;
  const [posts, spec] = store ? await Promise.all([listPosts(store, false), latestSpec(store)]) : [[], null];
  return (
    <ResearchShell>
      <section className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-bold text-zinc-50 leading-tight">What do phone sensors really catch?</h1>
        <p className="text-sm text-zinc-400 leading-relaxed">
          Investigators record with Revenant, mark known test events, record quiet control locations, and label what
          caused each reading. These logs report what the data shows — including where the sensors fall short.
        </p>
        {spec && (
          <p className="text-[12px] font-mono text-zinc-500">
            Current dataset: {spec.dataset.sessions} sessions{spec.dataset.contributors ? ` from ${spec.dataset.contributors} contributor${spec.dataset.contributors === 1 ? "" : "s"}` : ""} ·{" "}
            <Link href="/research/spec" className="underline">full spec sheet</Link>
          </p>
        )}
      </section>
      {!ready || !store ? (
        <NotSetUp />
      ) : posts.length === 0 ? (
        <p className="text-sm font-mono text-zinc-500">No research logs published yet.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {posts.map((p) => (
            <li key={p.id} className="panel-card rounded-lg p-4">
              <Link href={`/research/${p.id}`} className="flex flex-col gap-1.5 group">
                <span className="text-[11px] font-mono text-zinc-500">{p.date}</span>
                <span className="font-display text-lg font-semibold text-zinc-100 group-hover:underline">{p.title}</span>
                <span className="text-sm text-zinc-400 leading-relaxed">{p.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ResearchShell>
  );
}
