import { NextResponse } from "next/server";
import { labAuthorized } from "@/lib/server/auth";
import { getLabStore, syncConfig } from "@/lib/server/labStore";
import { serverConfig } from "@/lib/server/research";
import { normalizeConfig } from "@/lib/lab/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The learning settings server training uses. */
export async function GET(req: Request) {
  if (!(await labAuthorized(req))) return NextResponse.json({ error: "Lab passcode required" }, { status: 401 });
  if (!syncConfig().configured) return NextResponse.json({ error: "Storage isn't set up" }, { status: 503 });
  return NextResponse.json({ config: await serverConfig(await getLabStore("community")) });
}

/** Save the lab's tuned settings for the next server training run. */
export async function POST(req: Request) {
  if (!(await labAuthorized(req))) return NextResponse.json({ error: "Lab passcode required" }, { status: 401 });
  if (!syncConfig().configured) return NextResponse.json({ error: "Storage isn't set up" }, { status: 503 });
  const body = await req.json().catch(() => null);
  const config = normalizeConfig(body);
  const doc: typeof config & { id: string } = { ...config, id: "current", updatedAt: Date.now() };
  await (await getLabStore("community")).upsertDocs("config", [doc]);
  return NextResponse.json({ ok: true, config });
}
