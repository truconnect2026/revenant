import type { AnomalyEvent, Channel, EventLabel, StimulusMark } from "../types";

/** Known explanations an investigator can tag an event with. */
export const SOURCE_CHIPS = [
  "HVAC",
  "Footsteps",
  "Voice",
  "Electronics",
  "Appliance",
  "Traffic",
  "Door",
  "Wind",
  "Pet",
  "Handling",
  "Knock",
  "Clap",
  "Magnet",
] as const;

/** Things an investigator can do on purpose during a calibration run. */
export const STIMULUS_TYPES: { type: string; expected: Channel[]; hint: string }[] = [
  { type: "Knock", expected: ["sound", "motion"], hint: "Knock on a surface near the phone" },
  { type: "Footsteps", expected: ["sound", "motion"], hint: "Walk past the phone" },
  { type: "Voice", expected: ["sound"], hint: "Speak a sentence at normal volume" },
  { type: "Door", expected: ["sound"], hint: "Open or close a door" },
  { type: "Clap", expected: ["sound"], hint: "One sharp clap" },
  { type: "Magnet", expected: ["emf"], hint: "Pass a magnet near the phone" },
  { type: "Phone", expected: ["emf", "sound"], hint: "Call or ring a second phone nearby" },
  { type: "Bump", expected: ["motion"], hint: "Bump the surface the phone sits on" },
];

export function expectedChannels(type: string): Channel[] {
  return STIMULUS_TYPES.find((s) => s.type === type)?.expected ?? ["emf", "sound", "motion"];
}

/** Window (ms) around a stimulus tap in which an event is attributed to it. */
export const MATCH_WINDOW_MS: [number, number] = [-2000, 4000];

/**
 * Attach calibration stimuli to the events they caused. Only events that are
 * unlabeled, or were previously auto-labeled, are touched — a human label is
 * never overwritten. Returns a new array only when something changed.
 */
export function applyStimulusLabels(events: AnomalyEvent[], stimuli: StimulusMark[]): AnomalyEvent[] {
  let changed = false;
  const out = events.map((ev) => {
    const human = ev.label?.labeledBy === "human";
    if (human) return ev;
    const match = stimuli
      .filter((s) => {
        const dt = ev.timestamp - s.timestamp;
        return dt >= MATCH_WINDOW_MS[0] && dt <= MATCH_WINDOW_MS[1];
      })
      .sort((a, b) => Math.abs(ev.timestamp - a.timestamp) - Math.abs(ev.timestamp - b.timestamp))[0];
    if (!match) {
      if (ev.label?.labeledBy === "auto-stimulus") {
        // Stimulus was removed — revert to unlabeled, keep any model suggestion.
        changed = true;
        const label: EventLabel = { status: "unlabeled", modelPrediction: ev.label.modelPrediction };
        return { ...ev, label };
      }
      return ev;
    }
    if (ev.label?.stimulusId === match.id) return ev;
    changed = true;
    const label: EventLabel = {
      status: "injected",
      source: match.type,
      labeledBy: "auto-stimulus",
      labeledAt: Date.now(),
      stimulusId: match.id,
      modelPrediction: ev.label?.modelPrediction,
    };
    return { ...ev, label };
  });
  return changed ? out : events;
}

export function labelStatus(ev: AnomalyEvent): EventLabel["status"] {
  return ev.label?.status ?? "unlabeled";
}

/** Ground-truth source for training: human-explained or injected events only. */
export function trainingSource(ev: AnomalyEvent): string | null {
  const l = ev.label;
  if (!l || !l.source) return null;
  if (l.status === "explained" || l.status === "injected") return l.source;
  return null;
}
