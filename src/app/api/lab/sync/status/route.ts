import { NextResponse } from "next/server";
import { labAuthorized } from "@/lib/server/auth";
import { syncConfig } from "@/lib/server/labStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await labAuthorized(req))) return NextResponse.json({ error: "Lab passcode required" }, { status: 401 });
  return NextResponse.json(syncConfig());
}
