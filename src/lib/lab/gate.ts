// Passcode gate for /lab. The cookie holds a SHA-256 of the passcode (never the
// passcode itself). Works in both the Edge middleware and Node route handlers.

export const LAB_COOKIE = "revenant_lab";

export async function labToken(passcode: string): Promise<string> {
  const bytes = new TextEncoder().encode(`revenant-lab:${passcode}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
