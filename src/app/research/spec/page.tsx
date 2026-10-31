import type { Metadata } from "next";
import { getLabStore, syncConfig } from "@/lib/server/labStore";
import { latestSpec } from "@/lib/server/research";
import { NotSetUp, ResearchShell } from "@/components/research/Shell";
import { SpecView } from "@/components/research/SpecView";
import { PrintButton } from "@/components/research/PrintButton";

export const metadata: Metadata = {
  title: "Revenant spec sheet — models, detection rates and false alarms",
  description: "The current Revenant dataset, how each phone sensor performs on known stimuli and in control recordings, and the trained source models.",
};
export const revalidate = 300;

export default async function SpecPage() {
  const store = syncConfig().configured ? await getLabStore("community").catch(() => null) : null;
  const spec = store ? await latestSpec(store) : null;
  return (
    <ResearchShell>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-zinc-50 leading-tight">Spec sheet</h1>
          <p className="mt-1 text-sm text-zinc-400">Updated after every training run. Aggregates only — no session or place can be identified.</p>
        </div>
        <PrintButton />
      </div>
      {!store ? <NotSetUp /> : !spec ? <p className="text-sm font-mono text-zinc-500">No training run yet.</p> : <SpecView spec={spec} />}
    </ResearchShell>
  );
}
