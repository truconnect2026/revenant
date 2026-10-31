import { NextResponse } from "next/server";
import { getLabStore, syncConfig } from "@/lib/server/labStore";
import { BadRequest, MAX_BODY_BYTES } from "@/lib/server/syncHandlers";
import { Forbidden, handleContribute, handleWithdraw, type ContributeBody } from "@/lib/server/community";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fail(e: unknown) {
  if (e instanceof BadRequest) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof Forbidden) return NextResponse.json({ error: e.message }, { status: 403 });
  return NextResponse.json({ error: "Server storage error" }, { status: 500 });
}

/** Add or update anonymised sessions in the community dataset. Public, token-authenticated. */
export async function POST(req: Request) {
  if (!syncConfig().configured) return NextResponse.json({ error: "Community dataset isn't set up yet" }, { status: 503 });
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Batch too large" }, { status: 413 });
  try {
    const body = JSON.parse(text) as ContributeBody;
    return NextResponse.json(await handleContribute(await getLabStore("community"), body));
  } catch (e) {
    if (e instanceof SyntaxError) return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
    return fail(e);
  }
}

/** Withdraw: delete everything this contributor sent. */
export async function DELETE(req: Request) {
  if (!syncConfig().configured) return NextResponse.json({ error: "Community dataset isn't set up yet" }, { status: 503 });
  try {
    const { contributor } = (await req.json()) as { contributor?: { id?: unknown; token?: unknown } };
    return NextResponse.json(await handleWithdraw(await getLabStore("community"), contributor ?? {}));
  } catch (e) {
    return fail(e);
  }
}
