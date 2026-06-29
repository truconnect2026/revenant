/**
 * Rolling baseline for anomaly detection.
 * Maintains a circular buffer of fixed size.
 * Scores a sample BEFORE inserting it so spikes don't dilute the baseline.
 *
 * Two statistic modes:
 *  - default: mean / sample-stddev (cheap, fine for slow-moving channels).
 *  - robust:  median / MAD-derived stddev. A handful of transients (claps,
 *    door slams) are outliers that don't move the median or MAD, so the
 *    baseline σ stays representative of the quiet floor instead of inflating
 *    every time we detect the very events we're trying to catch.
 */
export interface BaselineOptions {
  /** Use median + MAD instead of mean + stddev (transient-robust). */
  robust?: boolean;
  /**
   * Lower clamp on stddev, in the sample's own units. Prevents hypersensitivity
   * (and a flood of false trips) when the environment is dead-quiet and the
   * measured spread collapses toward zero. Only applied in robust mode.
   */
  minSigma?: number;
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = n >> 1;
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export class RollingBaseline {
  private buffer: number[];
  private index = 0;
  private count = 0;
  private sum = 0;
  private sumSq = 0;
  private readonly size: number;
  private readonly warmup: number;
  private readonly robust: boolean;
  private readonly minSigma: number;

  // Robust stats are O(n log n); compute lazily and cache until the next push.
  private robustDirty = true;
  private robustMedian = 0;
  private robustSd = 0;

  constructor(windowSize = 200, warmupSamples = 60, options: BaselineOptions = {}) {
    this.size = windowSize;
    this.warmup = warmupSamples;
    this.buffer = new Array(windowSize).fill(0);
    this.robust = options.robust ?? false;
    this.minSigma = options.minSigma ?? 0;
  }

  get isWarmedUp(): boolean {
    return this.count >= this.warmup;
  }

  get sampleCount(): number {
    return this.count;
  }

  private get filledLength(): number {
    return Math.min(this.count, this.size);
  }

  private computeRobust(): void {
    if (!this.robustDirty) return;
    const n = this.filledLength;
    if (n === 0) {
      this.robustMedian = 0;
      this.robustSd = 0;
    } else {
      const vals = this.buffer.slice(0, n).sort((a, b) => a - b);
      const med = median(vals);
      const dev = vals.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
      // 1.4826 scales MAD to a normal-consistent stddev estimate.
      this.robustMedian = med;
      this.robustSd = 1.4826 * median(dev);
    }
    this.robustDirty = false;
  }

  get mean(): number {
    if (this.robust) {
      this.computeRobust();
      return this.robustMedian;
    }
    if (this.count === 0) return 0;
    return this.sum / this.filledLength;
  }

  get stddev(): number {
    if (this.robust) {
      this.computeRobust();
      return Math.max(this.robustSd, this.minSigma);
    }
    const n = this.filledLength;
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
    this.robustDirty = true;
  }

  reset(): void {
    this.buffer.fill(0);
    this.index = 0;
    this.count = 0;
    this.sum = 0;
    this.sumSq = 0;
    this.robustDirty = true;
  }
}
