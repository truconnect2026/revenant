import { NextResponse } from "next/server";
import { labAuthorized } from "@/lib/server/auth";
import { getLabStore, syncConfig } from "@/lib/server/labStore";
import { MAX_BODY_BYTES, validClipId } from "@/lib/server/syncHandlers";
import { Forbidden, canUploadClip } from "@/lib/server/community";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Contributor uploads one clip (only with audio sharing on, only for their own events). */
export async function PUT(req: Request) {
  if (!syncConfig().configured) return NextResponse.json({ error: "Community dataset isn't set up yet" }, { status: 503 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!validClipId(id)) return NextResponse.json({ error: "Bad clip id" }, { status: 400 });
  const contributor = { id: url.searchParams.get("cid") ?? undefined, token: req.headers.get("x-contributor-token") ?? undefined };
  const store = await getLabStore("community");
  try {
    if (!(await canUploadClip(store, contributor, id))) return NextResponse.json({ error: "Unknown clip" }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Not allowed" }, { status: e instanceof Forbidden ? 403 : 400 });
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Bad clip size" }, { status: 413 });
  await store.putClip(id, bytes, "audio/wav");
  return NextResponse.json({ ok: true });
}

/** Lab-only: listen to a contributed clip. */
export async function GET(req: Request) {
  if (!(await labAuthorized(req))) return NextResponse.json({ error: "Lab passcode required" }, { status: 401 });
  if (!syncConfig().configured) return NextResponse.json({ error: "Community dataset isn't set up yet" }, { status: 503 });
  const id = new URL(req.url).searchParams.get("id");
  if (!validClipId(id)) return NextResponse.json({ error: "Bad clip id" }, { status: 400 });
  const clip = await (await getLabStore("community")).getClip(id).catch(() => null);
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new Response(clip.body as BodyInit, { headers: { "Content-Type": clip.contentType, "Cache-Control": "private, max-age=3600" } });
}
