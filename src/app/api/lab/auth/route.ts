import { NextResponse } from "next/server";
import { LAB_COOKIE, labToken, safeEqual } from "@/lib/lab/gate";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const pass = process.env.LAB_PASSCODE;
  if (!pass) return NextResponse.json({ ok: true, unprotected: true });
  let body: { passcode?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const given = typeof body.passcode === "string" ? body.passcode : "";
  const [a, b] = await Promise.all([labToken(given), labToken(pass)]);
  if (!safeEqual(a, b)) {
    // Small fixed delay to slow guessing.
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: "Wrong passcode" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(LAB_COOKIE, b, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    // Root path so the lab sync API (/api/lab/*) receives it too.
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
