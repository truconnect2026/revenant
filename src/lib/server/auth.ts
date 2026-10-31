import { LAB_COOKIE, labToken, safeEqual } from "../lab/gate";

/** True when the request may use lab APIs: no passcode set, or a valid lab cookie. */
export async function labAuthorized(req: Request): Promise<boolean> {
  const pass = process.env.LAB_PASSCODE;
  if (!pass) return true;
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.split(/;\s*/).find((p) => p.startsWith(`${LAB_COOKIE}=`));
  const value = m ? decodeURIComponent(m.slice(LAB_COOKIE.length + 1)) : "";
  return safeEqual(value, await labToken(pass));
}
