"use client";
import { useCallback, useState } from "react";
import type { StoredSession } from "@/lib/idb";
import { assembleScores } from "@/lib/lab/scoreLog";
import { decodeChunk, type EncodedChunk } from "@/lib/lab/merge";
import { seriesKey, type SeriesMap } from "@/lib/lab/analysis";
import type { ModelVersion } from "@/lib/lab/model";
import type { LabData } from "./useLabData";

/** Read-only view of the anonymised community dataset, loaded on demand. */
export function useCommunityData() {
  const [data, setData] = useState<LabData | null>(null);
  const [contributors, setContributors] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("Loading the community dataset…");
    try {
      const r = await fetch("/api/community/dataset", { credentials: "same-origin" });
      const body = (await r.json()) as {
        error?: string; sessions: StoredSession[]; chunkIndex: { id: string }[]; models: ModelVersion[]; contributors: number;
      };
      if (!r.ok) throw new Error(body.error ?? `Server returned ${r.status}`);
      const chunks: EncodedChunk[] = [];
      for (let i = 0; i < body.chunkIndex.length; i += 500) {
        setStatus(`Loading score logs (${Math.min(i + 500, body.chunkIndex.length)} of ${body.chunkIndex.length})…`);
        const cr = await fetch("/api/community/dataset/chunks", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: body.chunkIndex.slice(i, i + 500).map((c) => c.id) }),
        });
        const cb = (await cr.json()) as { chunks: EncodedChunk[] };
        chunks.push(...cb.chunks);
      }
      const groups = new Map<string, ReturnType<typeof decodeChunk>[]>();
      for (const c of chunks.map(decodeChunk)) {
        const k = seriesKey(c.sessionId, c.channel);
        groups.set(k, [...(groups.get(k) ?? []), c]);
      }
      const series: SeriesMap = new Map();
      groups.forEach((cs, k) => series.set(k, assembleScores(cs)));
      setData({
        sessions: body.sessions.sort((a, b) => b.started_at - a.started_at),
        series,
        gear: [],
        versions: body.models.sort((a, b) => a.trainedAt - b.trainedAt),
        thresholdLog: [],
      });
      setContributors(body.contributors);
      setStatus(null);
    } catch (e) {
      setStatus(`Couldn't load the community dataset: ${String(e instanceof Error ? e.message : e)}`);
    }
  }, []);

  return { data, contributors, status, load };
}
