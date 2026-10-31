import { SessionData } from "./types";

interface DB {
  save(session: SessionData): Promise<void>;
  list(): Promise<SessionData[]>;
}

// --- In-memory store (default) ---
const memoryStore: SessionData[] = [];

const memoryDB: DB = {
  async save(session) {
    const idx = memoryStore.findIndex((s) => s.id === session.id);
    if (idx >= 0) memoryStore[idx] = session;
    else memoryStore.push(session);
  },
  async list() {
    return [...memoryStore].sort((a, b) => b.started_at - a.started_at);
  },
};

// --- Postgres (when DATABASE_URL or POSTGRES_URL is set) ---
// Vercel Postgres moved to Neon; the Neon driver works with either variable.
async function getPostgresDB(url: string): Promise<DB> {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at BIGINT NOT NULL,
      ended_at BIGINT,
      label TEXT,
      location JSONB,
      events JSONB NOT NULL DEFAULT '[]'
    )
  `;

  return {
    async save(session) {
      await sql`
        INSERT INTO sessions (id, started_at, ended_at, label, location, events)
        VALUES (
          ${session.id},
          ${session.started_at},
          ${session.ended_at},
          ${session.label},
          ${JSON.stringify(session.location)},
          ${JSON.stringify(session.events)}
        )
        ON CONFLICT (id) DO UPDATE SET
          ended_at = EXCLUDED.ended_at,
          label = EXCLUDED.label,
          location = EXCLUDED.location,
          events = EXCLUDED.events
      `;
    },
    async list() {
      const rows = await sql`SELECT * FROM sessions ORDER BY started_at DESC`;
      return rows as unknown as SessionData[];
    },
  };
}

let cachedDB: DB | null = null;

export async function getDB(): Promise<DB> {
  if (cachedDB) return cachedDB;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url) {
    cachedDB = await getPostgresDB(url);
  } else {
    cachedDB = memoryDB;
  }
  return cachedDB;
}
