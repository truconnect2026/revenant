import type { Metadata } from "next";
import { ResearchShell } from "@/components/research/Shell";

export const metadata: Metadata = { title: "Privacy — Revenant" };

function S({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="font-display text-base font-semibold text-zinc-100">{title}</h2>
      <div className="text-sm text-zinc-400 leading-relaxed flex flex-col gap-2">{children}</div>
    </section>
  );
}

export default function Privacy() {
  return (
    <ResearchShell>
      <h1 className="font-display text-2xl font-bold text-zinc-50">Privacy, in plain language</h1>
      <p className="text-[12px] font-mono text-amber-300/80">
        Draft summary. Formal terms will follow legal review; until then this page describes how the app actually behaves.
      </p>
      <S title="By default, everything stays on your phone">
        <p>Sessions, readings, audio clips and labels are saved in your browser on your device. Nothing is uploaded unless you choose to contribute.</p>
      </S>
      <S title="If you join the community dataset">
        <p>
          Shared: sensor readings and score logs, events and the labels you gave them, test marks, felt-something marks,
          session type, the place type you picked (e.g. Home), an optional state or country, the date and hour, and phone
          type (iOS / Android / desktop).
        </p>
        <p>
          Never shared: GPS or any coordinates, the location name you typed, your exact clock time (shifted to the top of the
          hour), your device id or browser details. These are removed on your phone before upload and removed again on the server.
        </p>
        <p>Audio clips are shared only if you separately turn on audio sharing. Clips can contain voices and household sounds.</p>
      </S>
      <S title="How contributions are used">
        <p>
          To train and test the models, to publish research logs and the spec sheet (aggregate numbers only), and — in the
          de-identified form above — as an open research dataset and in future data products.
        </p>
      </S>
      <S title="Withdrawing">
        <p>
          Tap &ldquo;Withdraw and delete my contributions&rdquo; in the app. Everything your phone contributed is deleted from the
          server. Aggregate numbers already published in past logs can&apos;t be un-published, but they contain nothing about you.
        </p>
        <p>Your contributor id is random and stored only on your phone; clearing the app&apos;s browser data loses the ability to withdraw.</p>
      </S>
      <S title="Who runs it">
        <p>Revenant is an open-source project. The code is public, so anyone can check exactly what is collected.</p>
      </S>
    </ResearchShell>
  );
}
