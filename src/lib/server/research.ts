// Background research run: train the source models on the community dataset,
// build the spec sheet, and leave a draft research-log post for a human to
// review. Nothing is published automatically.

import { CHANNELS } from "../types";
import { trainChannel, seriesKey, type LabSession, type SeriesMap } from "../lab/analysis";
import { assembleScores } from "../lab/scoreLog";
import { decodeChunk } from "../lab/merge";
import type { ModelVersion } from "../lab/model";
import { buildSpec, type SpecSheet } from "../research/spec";
import { draftPost, type ResearchPost } from "../research/writer";
import type { LabStore } from "./labStore";
import { normalizeConfig, type LearningConfig } from "../lab/config";

/** The learning settings saved from the lab for server training (defaults if none). */
export async function serverConfig(store: LabStore): Promise<LearningConfig> {
  const doc = (await store.listDocs("config")).find((d) => d.id === "current") as Partial<LearningConfig> | undefined;
  return normalizeConfig(doc ?? null);
}

export async function loadSeries(store: LabStore): Promise<SeriesMap> {
  const index = await store.chunkIndex();
  const byKey = new Map<string, ReturnType<typeof decodeChunk>[]>();
  for (let i = 0; i < index.length; i += 500) {
    const chunks = await store.getChunks(index.slice(i, i + 500).map((c) => c.id));
    for (const c of chunks.map(decodeChunk)) {
      const k = seriesKey(c.sessionId, c.channel);
      byKey.set(k, [...(byKey.get(k) ?? []), c]);
    }
  }
  const series: SeriesMap = new Map();
  byKey.forEach((cs, k) => series.set(k, assembleScores(cs)));
  return series;
}

export async function saveSpec(store: LabStore, spec: SpecSheet) {
  await store.upsertDocs("spec", [spec, { ...spec, id: "latest" }]);
}

export async function latestSpec(store: LabStore): Promise<SpecSheet | null> {
  return ((await store.listDocs("spec")).find((d) => d.id === "latest") as SpecSheet | undefined) ?? null;
}

export async function listPosts(store: LabStore, includeDrafts: boolean): Promise<ResearchPost[]> {
  const posts = (await store.listDocs("post")) as ResearchPost[];
  return posts
    .filter((p) => includeDrafts || p.status === "published")
    .sort((a, b) => (b.publishedAt ?? b.createdAt) - (a.publishedAt ?? a.createdAt));
}

export async function runCommunityTraining(store: LabStore, now = Date.now()) {
  const sessions = (await store.listSessions()) as LabSession[];
  const series = await loadSeries(store);
  const previous = (await store.listDocs("model")) as ModelVersion[];
  const config = await serverConfig(store);
  const trained: ModelVersion[] = [];
  const notReady: string[] = [];
  for (const ch of CHANNELS) {
    const out = trainChannel(ch, sessions, [...previous, ...trained], config);
    if (out.version) trained.push({ ...out.version, trainedAt: now });
    else notReady.push(`${ch}: needs ${out.readiness.missing.join(", ")}`);
  }
  if (trained.length) await store.upsertDocs("model", trained);
  const contributors = (await store.listDocs("contributor")).length;
  const spec = buildSpec({ sessions, series, versions: [...previous, ...trained], source: "community", contributors, now, config });
  await saveSpec(store, spec);
  let draft: ResearchPost | null = null;
  if (sessions.length > 0) {
    draft = draftPost(spec, now);
    await store.upsertDocs("post", [draft]);
  }
  return { sessions: sessions.length, trained: trained.map((v) => v.id), notReady, specId: spec.id, draftId: draft?.id ?? null };
}
