import { NextResponse } from "next/server";
import { labAuthorized } from "@/lib/server/auth";
import { getLabStore, syncConfig } from "@/lib/server/labStore";
import { BadRequest, MAX_BODY_BYTES, handlePush, handleSnapshot, type PushBody } from "@/lib/server/syncHandlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function guard(req: Request) {
  if (!(await labAuthorized(req))) return NextResponse.json({ error: "Lab passcode required" }, { status: 401 });
  const cfg = syncConfig();
  if (!cfg.configured) return NextResponse.json({ error: "Server sync isn't set up", missing: cfg.missing }, { status: 503 });
  return null;
}

/** Everything on the server: sessions, score-chunk index, docs and clip ids. */
export async function GET(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  try {
    return NextResponse.json(await handleSnapshot(await getLabStore()));
  } catch (e) {
    return NextResponse.json({ error: `Server storage error: ${String(e)}` }, { status: 500 });
  }
}

/** Merge a batch of sessions, score chunks and docs into the server copy. */
export async function POST(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Batch too large" }, { status: 413 });
  let body: PushBody;
  try {
    body = JSON.parse(text) as PushBody;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  try {
    return NextResponse.json(await handlePush(await getLabStore(), body));
  } catch (e) {
    if (e instanceof BadRequest) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: `Server storage error: ${String(e)}` }, { status: 500 });
  }
}
