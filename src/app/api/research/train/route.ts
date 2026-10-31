import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { labAuthorized } from "@/lib/server/auth";
import { getLabStore, syncConfig } from "@/lib/server/labStore";
import { runCommunityTraining } from "@/lib/server/research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run() {
  const cfg = syncConfig();
  if (!cfg.configured) return NextResponse.json({ error: "Storage isn't set up", missing: cfg.missing }, { status: 503 });
  try {
    const result = await runCommunityTraining(await getLabStore("community"));
    revalidatePath("/research");
    revalidatePath("/research/spec");
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: `Training failed: ${String(e)}` }, { status: 500 });
  }
}

/** Vercel Cron (daily). Vercel sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run();
}

/** Manual run from the lab. */
export async function POST(req: Request) {
  if (!(await labAuthorized(req))) return NextResponse.json({ error: "Lab passcode required" }, { status: 401 });
  return run();
}
