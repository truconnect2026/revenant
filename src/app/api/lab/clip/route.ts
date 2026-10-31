import { NextResponse } from "next/server";
import { labAuthorized } from "@/lib/server/auth";
import { getLabStore, syncConfig } from "@/lib/server/labStore";
import { MAX_BODY_BYTES, validClipId } from "@/lib/server/syncHandlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(req: Request) {
  if (!(await labAuthorized(req))) return NextResponse.json({ error: "Lab passcode required" }, { status: 401 });
  if (!syncConfig().configured) return NextResponse.json({ error: "Server sync isn't set up" }, { status: 503 });
  return null;
}

/** Upload one event's audio clip (raw WAV body). */
export async function PUT(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id");
  if (!validClipId(id)) return NextResponse.json({ error: "Bad clip id" }, { status: 400 });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Bad clip size" }, { status: 413 });
  const type = req.headers.get("content-type") || "audio/wav";
  if (!type.startsWith("audio/")) return NextResponse.json({ error: "Not audio" }, { status: 415 });
  try {
    await (await getLabStore()).putClip(id, bytes, type);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: `Server storage error: ${String(e)}` }, { status: 500 });
  }
}

/** Stream a stored clip back (private blob, so it only leaves through this gate). */
export async function GET(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id");
  if (!validClipId(id)) return NextResponse.json({ error: "Bad clip id" }, { status: 400 });
  const clip = await (await getLabStore()).getClip(id).catch(() => null);
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new Response(clip.body as BodyInit, {
    headers: { "Content-Type": clip.contentType, "Cache-Control": "private, max-age=3600" },
  });
}
