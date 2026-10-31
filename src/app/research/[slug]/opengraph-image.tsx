import { ImageResponse } from "next/og";
import { getLabStore, syncConfig } from "@/lib/server/labStore";
import { listPosts } from "@/lib/server/research";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Revenant research log";

/** Social preview card for a research log: title plus its top finding. */
export default async function Image({ params }: { params: { slug: string } }) {
  let title = "Revenant Research";
  let finding = "What phone sensors really catch";
  if (syncConfig().configured) {
    const store = await getLabStore("community").catch(() => null);
    const p = store ? (await listPosts(store, false)).find((x) => x.id === params.slug) : null;
    if (p) {
      title = p.title;
      finding = (p.findings[1] ?? p.findings[0])?.headline ?? p.summary;
    }
  }
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#0c0f14", color: "#f4f4f5" }}>
        <div style={{ fontSize: 30, letterSpacing: 8, color: "#a1a1aa" }}>REVENANT RESEARCH</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>{finding}</div>
          <div style={{ fontSize: 32, color: "#a1a1aa" }}>{title}</div>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 26, color: "#71717a" }}>
          <div style={{ width: 14, height: 14, borderRadius: 7, background: "#34d399" }} />
          Real sensor data · open source · nothing assumed
        </div>
      </div>
    ),
    size
  );
}
