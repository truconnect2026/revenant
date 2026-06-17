import { SessionData } from "./types";

const KEY = "revenant-sessions";
const MAX_STORED = 20;

export function loadSessions(): SessionData[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SessionData[]) : [];
  } catch {
    return [];
  }
}

export function saveSession(session: SessionData): void {
  if (typeof window === "undefined") return;
  try {
    const existing = loadSessions();
    const idx = existing.findIndex((s) => s.id === session.id);
    if (idx >= 0) existing[idx] = session;
    else existing.unshift(session);
    localStorage.setItem(KEY, JSON.stringify(existing.slice(0, MAX_STORED)));
  } catch {
    // Storage full or unavailable — silently skip
  }
}
