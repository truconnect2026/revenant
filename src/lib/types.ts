export type SensorStatus =
  | "standby"
  | "settling"
  | "live"
  | "blocked"
  | "no-channel";

// Motion "Sentry Mode" — an armed, high-sensitivity watch.
export type SentryLevel = "low" | "med" | "high";
export type SentryPhase = "off" | "arming" | "armed" | "triggered";

export type Channel = "emf" | "sound" | "motion";
export const CHANNELS: Channel[] = ["emf", "sound", "motion"];

// ── Learning-loop data model ────────────────────────────────────────────────
// Investigation = a normal hunt. Null = a control location with no claims, same
// setup (measures the false-positive rate). Calibration = the investigator makes
// known physical events on purpose (measures what each sensor can catch).
export type SessionType = "investigation" | "null" | "calibration";

/**
 * Measured characteristics of an event, computed from the real sensor data
 * around it. Every field is derived from recorded samples — nothing estimated.
 * Fields a channel can't measure are simply absent.
 */
export interface EventFeatures {
  peakSigma: number;
  /** Time the signal stayed above the trip level around the peak (ms). */
  durationMs?: number;
  /** Time from first crossing the trip level to the peak (ms). */
  riseTimeMs?: number;
  // Sound (from the event's own PCM clip)
  peakDbfs?: number;
  dominantFreqHz?: number;
  spectralCentroidHz?: number;
  spectralFlatness?: number;
  zeroCrossingRate?: number;
  /** 8 log-spaced bands, 50 Hz – 8 kHz, mean power in dB. */
  bandDb?: number[];
  // Motion / EMF (deviation of each axis from its own recent median)
  axisDev?: [number, number, number];
  dominantAxis?: "x" | "y" | "z";
  rotPeak?: number;
}

export type LabelStatus = "unlabeled" | "explained" | "injected" | "unexplained";

export interface ModelPrediction {
  /** Predicted source, or "unknown" when the model refuses to guess. */
  source: string;
  confidence: number;
  distance: number;
  modelVersion: string;
}

/**
 * Who said what about an event. Human labels always win. A model prediction is
 * only ever a suggestion and is stored separately — never as `source`.
 */
export interface EventLabel {
  status: LabelStatus;
  source?: string;
  labeledBy?: "human" | "auto-stimulus";
  labeledAt?: number;
  /** Stimulus id when auto-matched to a calibration stimulus. */
  stimulusId?: string;
  modelPrediction?: ModelPrediction;
}

/** A known physical event the investigator made on purpose (ground truth). */
export interface StimulusMark {
  id: string;
  type: string;
  timestamp: number;
  expected: Channel[];
}

/** "I felt something" — a subjective, human-reported moment. */
export interface SubjectiveMark {
  id: string;
  timestamp: number;
  /** True when the screen readouts were hidden at the time (blind mode). */
  blind: boolean;
}

export interface AnomalyEvent {
  id: string;
  channel: Channel;
  value: number;
  unit: string;
  sigma: number;
  mean: number;
  stddev: number;
  timestamp: number;
  clipUrl?: string;          // object URL, valid for current page session only
  spectrogram?: number[][];  // FFT frames: rows=time (oldest first), cols=freq bins 0-1
  /** Threshold in force when the event fired. */
  threshold?: number;
  /** True when Motion Sentry mode produced this event. */
  sentry?: boolean;
  features?: EventFeatures;
  label?: EventLabel;
}

export interface DeviceInfo {
  userAgent: string;
  platform?: string;
  /** Random per-browser id, so merged datasets can be filtered by device. */
  id?: string;
}

export interface SessionData {
  id: string;
  started_at: number;
  ended_at: number | null;
  label: string | null;
  location: { lat: number; lng: number } | null;
  events: AnomalyEvent[];
  // Learning-loop fields (absent on sessions recorded before schema v2).
  type?: SessionType;
  channels?: Record<Channel, boolean>;
  thresholds?: Partial<Record<Channel, number>>;
  device?: DeviceInfo;
  stimuli?: StimulusMark[];
  subjective?: SubjectiveMark[];
  /** Data-model version the session was recorded under. */
  schema?: number;
}

export const SCHEMA_VERSION = 2;

export interface SensorReading {
  status: SensorStatus;
  value: number | null;
  secondaryValue?: number | null;
  unit: string;
  secondaryUnit?: string;
  sigma: number;
  mean: number;
  stddev: number;
  history: number[];
  spectrum?: number[];
  threshold: number;
  warmupProgress: number; // 0–1; reaches 1 when baseline is ready
}
