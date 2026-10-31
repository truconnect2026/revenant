"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { idbGetAll, idbLoadStoredSessions, idbPutStoredSessions, type StoredSession } from "@/lib/idb";
import { assembleScores, type ScoreChunk } from "@/lib/lab/scoreLog";
import { seriesKey, type SeriesMap } from "@/lib/lab/analysis";
import type { ModelVersion } from "@/lib/lab/model";
import type { Channel, EventLabel } from "@/lib/types";
import type { ThresholdChange } from "@/lib/lab/thresholds";

export interface GearTrial {
  id: string;
  ts: number;
  device: string;
  trialType: "stimulus" | "null" | "investigation";
  stimulus?: string;
  triggered: boolean;
  notes?: string;
}

export interface LabData {
  sessions: StoredSession[];
  series: SeriesMap;
  gear: GearTrial[];
  versions: ModelVersion[];
  thresholdLog: ThresholdChange[];
}

const EMPTY: LabData = { sessions: [], series: new Map(), gear: [], versions: [], thresholdLog: [] };

export function useLabData() {
  const [data, setData] = useState<LabData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [sessions, chunks, gear, versions, meta] = await Promise.all([
        idbLoadStoredSessions(),
        idbGetAll<ScoreChunk>("scoreLogs"),
        idbGetAll<GearTrial>("gearTrials"),
        idbGetAll<ModelVersion>("modelVersions"),
        idbGetAll<ThresholdChange & { kind?: string }>("labMeta"),
      ]);
      const groups = new Map<string, ScoreChunk[]>();
      for (const c of chunks) {
        const k = seriesKey(c.sessionId, c.channel);
        groups.set(k, [...(groups.get(k) ?? []), c]);
      }
      const series: SeriesMap = new Map();
      groups.forEach((cs, k) => series.set(k, assembleScores(cs)));
      setData({
        sessions,
        series,
        gear: gear.sort((a, b) => b.ts - a.ts),
        versions: versions.sort((a, b) => a.trainedAt - b.trainedAt),
        thresholdLog: meta.filter((m) => m.kind === "threshold").sort((a, b) => b.ts - a.ts),
      });
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  /** Set a human label on a stored event and persist it. */
  const labelEvent = useCallback(async (sessionId: string, eventId: string, label: EventLabel) => {
    const cur = dataRef.current.sessions.find((s) => s.id === sessionId);
    if (!cur) return;
    const changed: StoredSession = { ...cur, events: cur.events.map((e) => (e.id === eventId ? { ...e, label } : e)) };
    setData((d) => ({ ...d, sessions: d.sessions.map((s) => (s.id === sessionId ? changed : s)) }));
    await idbPutStoredSessions([changed]);
  }, []);

  return { data, setData, loading, error, reload, labelEvent };
}

export type { Channel };
