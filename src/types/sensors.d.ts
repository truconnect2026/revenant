/* Generic Sensor API type declarations (Chromium) */

interface SensorOptions {
  frequency?: number;
  referenceFrame?: "device" | "screen";
}

interface SensorErrorEvent extends Event {
  readonly error: DOMException;
}

declare class Sensor extends EventTarget {
  readonly activated: boolean;
  readonly hasReading: boolean;
  readonly timestamp: DOMHighResTimeStamp | null;
  start(): void;
  stop(): void;
  onreading: ((this: this, ev: Event) => void) | null;
  onactivate: ((this: this, ev: Event) => void) | null;
  onerror: ((this: this, ev: SensorErrorEvent) => void) | null;
}

declare class Magnetometer extends Sensor {
  constructor(options?: SensorOptions);
  readonly x: number | null;
  readonly y: number | null;
  readonly z: number | null;
}

declare class Accelerometer extends Sensor {
  constructor(options?: SensorOptions);
  readonly x: number | null;
  readonly y: number | null;
  readonly z: number | null;
}

declare class Gyroscope extends Sensor {
  constructor(options?: SensorOptions);
  readonly x: number | null;
  readonly y: number | null;
  readonly z: number | null;
}

interface Window {
  Magnetometer?: typeof Magnetometer;
  Accelerometer?: typeof Accelerometer;
  Gyroscope?: typeof Gyroscope;
}
