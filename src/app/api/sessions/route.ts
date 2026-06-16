import { NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { SessionData } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const db = await getDB();
  const sessions = await db.list();
  return NextResponse.json(sessions);
}

export async function POST(request: Request) {
  const body = (await request.json()) as SessionData;
  if (!body.id || !body.started_at) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  const db = await getDB();
  await db.save(body);
  return NextResponse.json({ ok: true });
}
