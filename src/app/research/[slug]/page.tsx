import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getLabStore, syncConfig } from "@/lib/server/labStore";
import { listPosts } from "@/lib/server/research";
import { ResearchShell } from "@/components/research/Shell";
import type { ResearchPost } from "@/lib/research/writer";

export const revalidate = 300;

async function getPost(slug: string): Promise<ResearchPost | null> {
  if (!syncConfig().configured || !/^[a-z0-9-]{3,80}$/.test(slug)) return null;
  const store = await getLabStore("community").catch(() => null);
  if (!store) return null;
  return (await listPosts(store, false)).find((p) => p.id === slug) ?? null;
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const p = await getPost(params.slug);
  if (!p) return { title: "Revenant Research" };
  return { title: `${p.title} — Revenant Research`, description: p.summary, openGraph: { title: p.title, description: p.summary, type: "article" } };
}

export default async function PostPage({ params }: { params: { slug: string } }) {
  const p = await getPost(params.slug);
  if (!p) notFound();
  return (
    <ResearchShell>
      <article className="flex flex-col gap-5">
        <header className="flex flex-col gap-2">
          <span className="text-[11px] font-mono text-zinc-500">{p.date} · {p.source === "community" ? "community dataset" : "investigator dataset"}</span>
          <h1 className="font-display text-2xl font-bold text-zinc-50 leading-tight">{p.title}</h1>
          <p className="text-base text-zinc-300 leading-relaxed">{p.summary}</p>
        </header>
        <section className="flex flex-col gap-4">
          {p.findings.map((f, i) => (
            <div key={i} className="flex flex-col gap-1">
              <h2 className="font-display text-base font-semibold text-zinc-100">{f.headline}</h2>
              <p className="text-sm text-zinc-400 leading-relaxed">{f.detail}</p>
            </div>
          ))}
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-sm font-semibold uppercase tracking-[0.15em] text-zinc-300">Limitations</h2>
          <ul className="list-disc pl-5 text-sm text-zinc-400 leading-relaxed flex flex-col gap-1">
            {p.limitations.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </section>
        <p className="text-sm text-zinc-400">
          Method and the full numbers behind this log: <Link href="/research/spec" className="underline">spec sheet</Link>.
        </p>
      </article>
    </ResearchShell>
  );
}
