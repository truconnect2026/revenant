// Turns a spec sheet into a readable research-log post: plain-English findings,
// each carrying its sample size and interval, plus copy-ready Markdown and
// social text. It only states what the numbers support; a finding with too
// little data is left out rather than guessed.

import type { Channel } from "../types";
import { CHANNELS } from "../types";
import type { SpecSheet } from "./spec";

export interface Finding {
  headline: string;
  detail: string;
}

export interface ResearchPost {
  id: string;
  kind: "post";
  status: "draft" | "published";
  title: string;
  date: string; // YYYY-MM-DD
  createdAt: number;
  publishedAt?: number;
  summary: string;
  findings: Finding[];
  limitations: string[];
  specId: string;
  source: SpecSheet["source"];
  social: { short: string; caption: string };
}

const CH: Record<Channel, string> = { emf: "EMF", sound: "Sound", motion: "Motion" };
const pct = (v: number) => `${Math.round(v * 100)}%`;
const ci = (lo: number, hi: number) => `95% CI ${pct(lo)}–${pct(hi)}`;
const hrs = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`);
const n1 = (v: number) => (v < 10 ? v.toFixed(1) : v.toFixed(0));

export function findingsFrom(spec: SpecSheet): Finding[] {
  const out: Finding[] = [];
  const d = spec.dataset;
  const people = d.contributors ? ` from ${d.contributors} contributor${d.contributors > 1 ? "s" : ""}` : "";
  out.push({
    headline: `${d.sessions} sessions${people}`,
    detail: `${hrs(d.hours.investigation)} of investigations, ${hrs(d.hours.null)} of control recording and ${d.stimuli} calibration marks. ${d.events} events logged, ${pct(d.labeledPct || 0)} of them labeled.`,
  });

  // Calibration: strongest and weakest expected pairings with enough marks.
  const cells: { stim: string; ch: Channel; k: number; n: number; rate: number; lo: number; hi: number }[] = [];
  for (const stim of spec.calibration.rows) for (const ch of CHANNELS) {
    const c = spec.calibration.cells[stim]?.[ch];
    if (c && c.expected && c.n >= 5) cells.push({ stim, ch, k: c.hits, n: c.n, rate: c.rate, lo: c.ci.lo, hi: c.ci.hi });
  }
  if (cells.length) {
    const best = [...cells].sort((a, b) => b.rate - a.rate || b.n - a.n)[0];
    out.push({
      headline: `${CH[best.ch]} caught ${pct(best.rate)} of ${best.stim.toLowerCase()} tests`,
      detail: `${best.k} of ${best.n} calibration marks (${ci(best.lo, best.hi)}).`,
    });
    const worst = [...cells].sort((a, b) => a.rate - b.rate || b.n - a.n)[0];
    if (worst !== best && worst.rate < 0.6) {
      out.push({
        headline: `${CH[worst.ch]} missed most ${worst.stim.toLowerCase()} tests`,
        detail: `It caught ${worst.k} of ${worst.n} (${pct(worst.rate)}, ${ci(worst.lo, worst.hi)}). Treat a quiet ${CH[worst.ch].toLowerCase()} reading as weak evidence that nothing happened.`,
      });
    }
  }

  // False alarms and threshold advice.
  for (const ch of CHANNELS) {
    const c = spec.channels[ch];
    if (!c.atThreshold || c.nullHours <= 0) continue;
    out.push({
      headline: `${CH[ch]}: ${n1(c.atThreshold.fpPerHour)} false alarms per hour`,
      detail: `At the ${c.threshold}σ threshold, ${CH[ch].toLowerCase()} tripped ${c.atThreshold.falseTrips} times in ${hrs(c.nullHours)} of control recording where nothing was reported (95% CI ${n1(c.atThreshold.fpLo)}–${n1(c.atThreshold.fpHi)}/h).`,
    });
    if (c.recommended && c.recommended.threshold !== c.threshold && c.nStimuli >= 5) {
      out.push({
        headline: `${CH[ch]} works better at ${c.recommended.threshold}σ than ${c.threshold}σ`,
        detail: `Replaying the recorded scores, ${c.recommended.threshold}σ keeps ${pct(c.recommended.detectionRate)} of ${c.nStimuli} known stimuli with ${n1(c.recommended.fpPerHour)} false alarms per hour.`,
      });
    }
  }

  // Places vs control.
  if (spec.places.length) {
    const sig = spec.places.filter((p) => p.pAdj < 0.05 && p.rateA > p.rateB && p.group !== "All investigations");
    if (sig.length) {
      for (const p of sig.slice(0, 2)) {
        out.push({
          headline: `${p.group} sites logged ${n1(p.ratio)}× the control rate on ${CH[p.channel].toLowerCase()}`,
          detail: `${n1(p.rateA)}/h (${p.countA} in ${hrs(p.hoursA)}) against ${n1(p.rateB)}/h in control (adjusted p = ${p.pAdj.toFixed(3)}). Higher rates point at louder or busier places first; the labeled causes are the next thing to check.`,
        });
      }
    } else {
      out.push({
        headline: "No place type stood out from control",
        detail: `Across ${spec.places.length} comparisons, none logged more events per hour than control sessions once corrected for testing many at once.`,
      });
    }
  }

  if (spec.felt) {
    const f = spec.felt;
    out.push({
      headline: f.p < 0.05 ? "Felt-something marks lined up with sensor events" : "Felt-something marks didn't line up with sensor events",
      detail: `${pct(f.observed)} of ${f.marks} blind marks had a sensor event within 3 s, against ${pct(f.chance)} expected by chance (p = ${f.p.toFixed(3)}).${f.p < 0.05 ? " A sudden sound or bump can cause both the feeling and the reading, so this is where to look first." : ""}`,
    });
  }

  for (const ch of CHANNELS) {
    const m = spec.channels[ch].model;
    if (!m) continue;
    out.push({
      headline: `The ${CH[ch].toLowerCase()} model named the cause of ${pct(m.cvAccuracy)} of held-out events`,
      detail: `Trained on ${m.nSamples} labeled events across ${m.nSessions} sessions and ${m.nClasses} causes, tested on sessions it never saw. Always guessing the most common cause scores ${pct(m.baselineAccuracy)}. It answered "unknown" ${pct(m.rejectRate)} of the time.`,
    });
  }

  const unexplained = spec.dataset.eventsByStatus.unexplained ?? 0;
  const unlabeled = spec.dataset.eventsByStatus.unlabeled ?? 0;
  if (spec.dataset.events > 0) {
    const open = unexplained + unlabeled;
    out.push({
      headline: `${open} event${open === 1 ? " has" : "s have"} no known cause yet`,
      detail: `${unexplained} marked unexplained and ${unlabeled} not labeled yet — ${pct(open / spec.dataset.events)} of all events. No known cause means nobody has identified it yet, not that there wasn't one.`,
    });
  }
  return out;
}

export function draftPost(spec: SpecSheet, now = Date.now()): ResearchPost {
  const date = new Date(now).toISOString().slice(0, 10);
  const nice = new Date(now).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const findings = findingsFrom(spec);
  const lead = findings[1] ?? findings[0];
  const summary = `${findings[0].headline}. ${lead && lead !== findings[0] ? `${lead.headline}.` : ""}`.trim();
  const post: ResearchPost = {
    id: `log-${date}-${(now % 0xffff).toString(16)}`,
    kind: "post",
    status: "draft",
    title: `Research log: ${nice}`,
    date,
    createdAt: now,
    summary,
    findings,
    limitations: spec.limitations,
    specId: spec.id,
    source: spec.source,
    social: { short: "", caption: "" },
  };
  post.social = socialText(post);
  return post;
}

/** Short post (fits X/Threads with a link) and a longer caption. `{url}` is replaced with the post link. */
export function socialText(post: Pick<ResearchPost, "title" | "findings" | "summary">): { short: string; caption: string } {
  const top = post.findings[1] ?? post.findings[0];
  const tail = " Real phone sensors, open data, nothing assumed. {url}";
  let head = `New Revenant research log: ${top ? top.headline : post.summary}.`;
  // A link counts as 23 characters on X; keep the rest under 257.
  const budget = 280 - 23 - (tail.length - "{url}".length);
  if (head.length > budget) head = head.slice(0, budget - 1) + "…";
  const bullets = post.findings.slice(0, 4).map((f) => `• ${f.headline}`).join("\n");
  const caption = `${post.title}\n\n${bullets}\n\nEvery number comes from real recorded sensor data, with its sample size. Full log and method: {url}\n\n#CitizenScience #OpenData #ParanormalResearch #Revenant`;
  return { short: head + tail, caption };
}

export function postToMarkdown(post: ResearchPost, url = "{url}"): string {
  const lines = [
    `# ${post.title}`,
    "",
    post.summary,
    "",
    "## Findings",
    "",
    ...post.findings.flatMap((f) => [`**${f.headline}.** ${f.detail}`, ""]),
    "## Limitations",
    "",
    ...post.limitations.map((l) => `- ${l}`),
    "",
    `Method and full numbers: ${url.replace(/\/research\/.*$/, "/research/spec")}`,
  ];
  return lines.join("\n").replace(/\{url\}/g, url);
}

export function fillUrl(text: string, url: string): string {
  return text.replace(/\{url\}/g, url);
}
