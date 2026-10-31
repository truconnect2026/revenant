import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { labAuthorized } from "@/lib/server/auth";
import { getLabStore, syncConfig } from "@/lib/server/labStore";
import { latestSpec, saveSpec } from "@/lib/server/research";
import type { SpecSheet } from "@/lib/research/spec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!syncConfig().configured) return NextResponse.json({ spec: null });
  return NextResponse.json({ spec: await latestSpec(await getLabStore("community")) });
}

/** Publish a spec sheet built in the lab (aggregates only). */
export async function POST(req: Request) {
  if (!(await labAuthorized(req))) return NextResponse.json({ error: "Lab passcode required" }, { status: 401 });
  if (!syncConfig().configured) return NextResponse.json({ error: "Storage isn't set up" }, { status: 503 });
  const text = await req.text();
  if (text.length > 1_000_000) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const spec = JSON.parse(text) as SpecSheet;
  if (spec?.kind !== "spec" || !/^spec-\d+$/.test(spec.id)) return NextResponse.json({ error: "Malformed spec" }, { status: 400 });
  await saveSpec(await getLabStore("community"), spec);
  revalidatePath("/research/spec");
  return NextResponse.json({ ok: true });
}
