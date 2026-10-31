import { NextResponse, type NextRequest } from "next/server";
import { LAB_COOKIE, labToken, safeEqual } from "@/lib/lab/gate";

export async function middleware(req: NextRequest) {
  const pass = process.env.LAB_PASSCODE;
  if (!pass) return NextResponse.next(); // unset: lab is open and shows a warning
  if (req.nextUrl.pathname.startsWith("/lab/login")) return NextResponse.next();
  const cookie = req.cookies.get(LAB_COOKIE)?.value ?? "";
  if (safeEqual(cookie, await labToken(pass))) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/lab/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/lab", "/lab/:path*"] };
