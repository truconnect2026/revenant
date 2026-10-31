"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Channel } from "@/lib/types";
import { useLabData, type LabData } from "./useLabData";
import { getDeviceId } from "@/lib/lab/device";
import { useCommunityData } from "./useCommunityData";
import { ResearchPanel } from "./ResearchPanel";
import {
  CalibrationPanel, ChannelPicker, DataPanel, FeltPanel, GearPanel, LocationPanel, ModelPanel, OverviewPanel,
  ResiduePanel, ThresholdPanel,
} from "./panels";

const TABS = [
  { id: "overview", name: "Overview" },
  { id: "model", name: "Model" },
  { id: "residue", name: "Residue" },
  { id: "calibration", name: "Sensors" },
  { id: "threshold", name: "Thresholds" },
  { id: "location", name: "Sites" },
  { id: "felt", name: "Felt" },
  { id: "gear", name: "Gear" },
  { id: "research", name: "Research" },
] as const;
type Tab = (typeof TABS)[number]["id"];
const CHANNEL_TABS: Tab[] = ["model", "residue", "threshold"];

export function LabDashboard({ unprotected }: { unprotected: boolean }) {
  const { data: allData, setData, loading, error, reload, labelEvent } = useLabData();
  const [tab, setTab] = useState<Tab>("overview");
  const [channel, setChannel] = useState<Channel>("sound");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [thisDeviceOnly, setThisDeviceOnly] = useState(false);
  const [source, setSource] = useState<"mine" | "community">("mine");
  const community = useCommunityData();
  const pickSource = (s: "mine" | "community") => {
    setSource(s);
    if (s === "community" && !community.data) community.load();
  };
  useEffect(() => setDeviceId(getDeviceId()), []);

  // Sessions without a device id were recorded here before ids existed.
  const otherDevices = deviceId ? allData.sessions.filter((s) => s.device?.id && s.device.id !== deviceId).length : 0;
  const localData: LabData = useMemo(() => {
    if (!thisDeviceOnly || !deviceId) return allData;
    const sessions = allData.sessions.filter((s) => !s.device?.id || s.device.id === deviceId);
    const keep = new Set(sessions.map((s) => s.id));
    const series = new Map(Array.from(allData.series.entries()).filter(([k]) => keep.has(k.split(":")[0])));
    return { ...allData, sessions, series };
  }, [allData, thisDeviceOnly, deviceId]);
  const communityView = source === "community";
  const data: LabData = communityView ? community.data ?? { ...allData, sessions: [], series: new Map(), versions: [], gear: [], thresholdLog: [] } : localData;

  return (
    <div className="min-h-screen bg-scope text-zinc-100">
      <div className="graticule fixed inset-0 pointer-events-none z-0" />
      <div className="relative z-10 max-w-3xl mx-auto px-4 py-4 flex flex-col gap-3">
        <header className="flex items-center justify-between gap-3 pb-3 border-b border-zinc-800/80">
          <div>
            <h1 className="font-display text-lg font-bold tracking-[0.2em] leading-none">REVENANT LAB</h1>
            <p className="mt-1.5 text-[10px] font-mono text-zinc-500">Testing what the sensors actually catch</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={reload} className="btn-press px-2.5 py-1.5 rounded border border-zinc-700 text-zinc-400 text-[10px] font-mono" title="Reload from this device">
              ↺
            </button>
            <Link href="/" className="btn-press px-3 py-1.5 rounded border border-zinc-600 text-zinc-300 text-[10px] font-display uppercase tracking-wider">
              Field
            </Link>
          </div>
        </header>

        {unprotected && (
          <p className="rounded border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-[10px] font-mono text-amber-200/90">
            LAB_PASSCODE isn&apos;t set, so this page is open to anyone with the link. Set it in Vercel to lock the lab.
          </p>
        )}

        <nav className="-mx-4 px-4 overflow-x-auto scrollbar-thin" aria-label="Lab sections">
          <div className="flex gap-1.5 w-max">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={`btn-press px-3 py-1.5 rounded-full text-[10px] font-display font-semibold uppercase tracking-wider border ${
                  tab === t.id ? "bg-zinc-200 text-zinc-900 border-zinc-200" : "border-zinc-700 text-zinc-400"
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
        </nav>

        <div role="radiogroup" aria-label="Data source" className="flex rounded border border-zinc-700 overflow-hidden self-start">
          {([["mine", "My data"], ["community", "Community"]] as const).map(([id, name]) => (
            <button
              key={id}
              role="radio"
              aria-checked={source === id}
              onClick={() => pickSource(id)}
              className={`btn-press px-3 py-1 text-[10px] font-display font-semibold uppercase tracking-wider ${source === id ? "bg-zinc-200 text-zinc-900" : "text-zinc-400"}`}
            >
              {name}
            </button>
          ))}
        </div>
        {communityView && (
          <p className="text-[10px] font-mono text-zinc-500">
            {community.status ?? `Anonymised community dataset${community.contributors ? ` · ${community.contributors} contributors` : ""}. Read-only: labels belong to contributors.`}
            {!community.status && (
              <button onClick={community.load} className="ml-2 underline">reload</button>
            )}
          </p>
        )}

        {(CHANNEL_TABS.includes(tab) || (otherDevices > 0 && !communityView)) && (
          <div className="flex items-center justify-between gap-2">
            {otherDevices > 0 && !communityView ? (
              <button
                onClick={() => setThisDeviceOnly((v) => !v)}
                className="btn-press px-2.5 py-1 rounded border border-zinc-700 text-[10px] font-mono text-zinc-300"
                title={`${otherDevices} session(s) came from other phones`}
              >
                {thisDeviceOnly ? "This phone only" : "All phones"}
              </button>
            ) : <span />}
            {CHANNEL_TABS.includes(tab) && <ChannelPicker value={channel} onChange={setChannel} />}
          </div>
        )}

        {error && <p className="text-[11px] font-mono text-rose-300">Couldn&apos;t read local data: {error}</p>}
        {loading && data.sessions.length === 0 ? (
          <p className="text-[11px] font-mono text-zinc-500">Loading this device&apos;s data…</p>
        ) : (
          <>
            {tab === "overview" && (
              <>
                <OverviewPanel data={data} />
                <LoopGuide />
                {!communityView && <DataPanel reload={reload} />}
              </>
            )}
            {tab === "model" && <ModelPanel data={data} channel={channel} setData={setData} onLabel={labelEvent} readOnly={communityView} />}
            {tab === "residue" && <ResiduePanel data={data} channel={channel} onLabel={labelEvent} readOnly={communityView} />}
            {tab === "calibration" && <CalibrationPanel data={data} />}
            {tab === "threshold" && <ThresholdPanel data={data} channel={channel} reload={reload} />}
            {tab === "location" && <LocationPanel data={data} />}
            {tab === "felt" && <FeltPanel data={data} />}
            {tab === "gear" && <GearPanel data={data} reload={reload} />}
            {tab === "research" && <ResearchPanel data={data} source={source} contributors={community.contributors} onReload={communityView ? community.load : reload} />}
          </>
        )}

        <footer className="pt-2 text-center text-[10px] font-mono text-zinc-600 leading-relaxed">
          Every number here comes from real recorded sensor data on this device. Nothing is simulated or filled in.
        </footer>
      </div>
    </div>
  );
}

function LoopGuide() {
  const steps = [
    ["Control", "Record a quiet place with no claims. This sets the false-alarm rate."],
    ["Calibrate", "Make known sounds and movements with test marks. This shows what each sensor catches."],
    ["Investigate", "Hunt as usual. Use Felt something, in Blind mode when you can."],
    ["Label", "Tag events with their real cause in the field log, past sessions or the Residue tab."],
    ["Train", "Train the model, check the threshold test, then repeat. Watch the residue shrink."],
  ];
  return (
    <section className="panel-card rounded-lg p-3">
      <h2 className="font-display text-xs font-semibold uppercase tracking-[0.15em] text-zinc-200">The loop</h2>
      <ol className="mt-2 flex flex-col gap-1.5">
        {steps.map(([t, d], i) => (
          <li key={t} className="flex gap-2 text-[11px] font-mono">
            <span className="text-zinc-500 tabular-nums w-3 shrink-0">{i + 1}</span>
            <span><span className="text-zinc-200">{t}.</span> <span className="text-zinc-400">{d}</span></span>
          </li>
        ))}
      </ol>
    </section>
  );
}
