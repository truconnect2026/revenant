import { NextResponse } from "next/server";
import { labAuthorized } from "@/lib/server/auth";
import { getLabStore, syncConfig } from "@/lib/server/labStore";
import { BadRequest, handleGetChunks } from "@/lib/server/syncHandlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fetch score chunks by id (up to 500 per request). */
export async function POST(req: Request) {
  if (!(await labAuthorized(req))) return NextResponse.json({ error: "Lab passcode required" }, { status: 401 });
  if (!syncConfig().configured) return NextResponse.json({ error: "Server sync isn't set up" }, { status: 503 });
  try {
    const { ids } = (await req.json()) as { ids?: unknown };
    return NextResponse.json({ chunks: await handleGetChunks(await getLabStore(), ids) });
  } catch (e) {
    if (e instanceof BadRequest) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: `Server storage error: ${String(e)}` }, { status: 500 });
  }
}
