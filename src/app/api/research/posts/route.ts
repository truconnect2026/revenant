import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { labAuthorized } from "@/lib/server/auth";
import { getLabStore, syncConfig } from "@/lib/server/labStore";
import { listPosts } from "@/lib/server/research";
import type { ResearchPost } from "@/lib/research/writer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9-]{3,80}$/;

/** Published posts for everyone; drafts too for the lab. */
export async function GET(req: Request) {
  if (!syncConfig().configured) return NextResponse.json({ posts: [] });
  const all = new URL(req.url).searchParams.get("all") === "1" && (await labAuthorized(req));
  return NextResponse.json({ posts: await listPosts(await getLabStore("community"), all) });
}

/** Save a draft or publish (lab only). */
export async function POST(req: Request) {
  if (!(await labAuthorized(req))) return NextResponse.json({ error: "Lab passcode required" }, { status: 401 });
  if (!syncConfig().configured) return NextResponse.json({ error: "Storage isn't set up" }, { status: 503 });
  const p = (await req.json().catch(() => null)) as ResearchPost | null;
  if (!p || p.kind !== "post" || !SLUG.test(p.id) || typeof p.title !== "string" || !Array.isArray(p.findings)) {
    return NextResponse.json({ error: "Malformed post" }, { status: 400 });
  }
  const post: ResearchPost = {
    ...p,
    title: p.title.slice(0, 140),
    summary: String(p.summary ?? "").slice(0, 600),
    findings: p.findings.slice(0, 30).map((f) => ({ headline: String(f.headline).slice(0, 200), detail: String(f.detail).slice(0, 1200) })),
    limitations: (p.limitations ?? []).slice(0, 20).map((l) => String(l).slice(0, 400)),
    status: p.status === "published" ? "published" : "draft",
    publishedAt: p.status === "published" ? p.publishedAt ?? Date.now() : undefined,
  };
  await (await getLabStore("community")).upsertDocs("post", [post]);
  revalidatePath("/research");
  revalidatePath(`/research/${post.id}`);
  return NextResponse.json({ ok: true, post });
}

export async function DELETE(req: Request) {
  if (!(await labAuthorized(req))) return NextResponse.json({ error: "Lab passcode required" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!SLUG.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  await (await getLabStore("community")).deleteDoc("post", id);
  revalidatePath("/research");
  return NextResponse.json({ ok: true });
}
