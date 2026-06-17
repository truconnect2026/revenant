/**
 * Rolling baseline for anomaly detection.
 * Maintains a circular buffer of fixed size.
 * Scores a sample BEFORE inserting it so spikes don't dilute the baseline.
 */
export class RollingBaseline {
  private buffer: number[];
  private index = 0;
  private count = 0;
  private sum = 0;
  private sumSq = 0;
  private readonly size: number;
  private readonly warmup: number;

  constructor(windowSize = 200, warmupSamples = 60) {
    this.size = windowSize;
    this.warmup = warmupSamples;
    this.buffer = new Array(windowSize).fill(0);
  }

  get isWarmedUp(): boolean {
    return this.count >= this.warmup;
  }

  get sampleCount(): number {
    return this.count;
  }

  get mean(): number {
    if (this.count === 0) return 0;
    const n = Math.min(this.count, this.size);
    return this.sum / n;
  }

  get stddev(): number {
    const n = Math.min(this.count, this.size);
    if (n < 2) return 0;
    const mean = this.sum / n;
    const variance = this.sumSq / n - mean * mean;
    // sample stddev (n-1)
    return Math.sqrt((variance * n) / (n - 1));
  }

  /** Score a value against current baseline WITHOUT inserting it */
  score(value: number): number {
    const sd = this.stddev;
    if (sd === 0) return 0;
    return Math.abs(value - this.mean) / sd;
  }

  /** Insert a value into the rolling window */
  push(value: number): void {
    if (this.count >= this.size) {
      // Remove the oldest value
      const old = this.buffer[this.index];
      this.sum -= old;
      this.sumSq -= old * old;
    }
    this.buffer[this.index] = value;
    this.sum += value;
    this.sumSq += value * value;
    this.index = (this.index + 1) % this.size;
    this.count++;
  }

  reset(): void {
    this.buffer.fill(0);
    this.index = 0;
    this.count = 0;
    this.sum = 0;
    this.sumSq = 0;
  }
}
