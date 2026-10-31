import { NextResponse } from "next/server";
import { labAuthorized } from "@/lib/server/auth";
import { getLabStore, syncConfig } from "@/lib/server/labStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lab-only: the anonymised community sessions plus the score-log index. */
export async function GET(req: Request) {
  if (!(await labAuthorized(req))) return NextResponse.json({ error: "Lab passcode required" }, { status: 401 });
  const cfg = syncConfig();
  if (!cfg.configured) return NextResponse.json({ error: "Community dataset isn't set up yet", missing: cfg.missing }, { status: 503 });
  const store = await getLabStore("community");
  const [sessions, chunkIndex, model, contributors] = await Promise.all([
    store.listSessions(),
    store.chunkIndex(),
    store.listDocs("model"),
    store.listDocs("contributor"),
  ]);
  return NextResponse.json({ sessions, chunkIndex, models: model, contributors: contributors.length });
}
