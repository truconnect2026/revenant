import Link from "next/link";
import type { ReactNode } from "react";

/** Readable, public page frame for the research site. */
export function ResearchShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-scope text-zinc-200">
      <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-6">
        <header className="flex items-center justify-between gap-3 pb-3 border-b border-zinc-800/80">
          <Link href="/research" className="font-display text-base font-bold tracking-[0.2em] text-zinc-100">
            REVENANT RESEARCH
          </Link>
          <nav className="flex items-center gap-3 text-[11px] font-mono text-zinc-400">
            <Link href="/research/spec" className="hover:text-zinc-100">Spec sheet</Link>
            <Link href="/" className="hover:text-zinc-100">App</Link>
          </nav>
        </header>
        {children}
        <footer className="pt-4 border-t border-zinc-800/80 text-[11px] font-mono text-zinc-500 leading-relaxed">
          Revenant is an open-source citizen-science project. Every number comes from real phone-sensor recordings
          contributed by the community, with its sample size. It measures environmental deviation; it does not detect
          the paranormal. <Link href="/privacy" className="underline">Privacy</Link>
        </footer>
      </div>
    </div>
  );
}

export function NotSetUp() {
  return (
    <p className="text-sm font-mono text-zinc-500">
      The research store isn&apos;t connected on this deployment yet. Once the database is added, published logs appear here.
    </p>
  );
}
