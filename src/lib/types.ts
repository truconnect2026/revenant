export type SensorStatus =
  | "standby"
  | "settling"
  | "live"
  | "blocked"
  | "no-channel";

export interface AnomalyEvent {
  id: string;
  channel: "emf" | "sound" | "motion";
  value: number;
  unit: string;
  sigma: number;
  mean: number;
  stddev: number;
  timestamp: number;
  clipUrl?: string;          // object URL, valid for current page session only
  spectrogram?: number[][];  // FFT frames: rows=time (oldest first), cols=freq bins 0-1
}

export interface SessionData {
  id: string;
  started_at: number;
  ended_at: number | null;
  label: string | null;
  location: { lat: number; lng: number } | null;
  events: AnomalyEvent[];
}

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
