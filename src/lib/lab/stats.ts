// Statistics for the lab. Pure, dependency-free, and unit-tested. Every rate the
// lab shows goes through one of these so the uncertainty is shown with it.

export interface Interval {
  lo: number;
  hi: number;
}

/** Wilson score interval for a binomial proportion (95% by default). */
export function wilson(successes: number, n: number, z = 1.959964): Interval {
  if (n <= 0) return { lo: 0, hi: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

const LN_FACT_CACHE: number[] = [0];
export function lnFactorial(n: number): number {
  if (n < 0) return NaN;
  for (let i = LN_FACT_CACHE.length; i <= n; i++) LN_FACT_CACHE[i] = LN_FACT_CACHE[i - 1] + Math.log(i);
  return LN_FACT_CACHE[n];
}

/** P(X ≤ k) for X ~ Poisson(λ). */
export function poissonCdf(k: number, lambda: number): number {
  if (k < 0) return 0;
  if (lambda <= 0) return 1;
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += Math.exp(-lambda + i * Math.log(lambda) - lnFactorial(i));
  return Math.min(1, sum);
}

function bisect(f: (x: number) => number, lo: number, hi: number, iters = 100): number {
  // f must be monotone with a sign change on [lo, hi].
  let flo = f(lo);
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if ((fm > 0) === (flo > 0)) {
      lo = mid;
      flo = fm;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

/** Exact (Garwood) 95% CI for a Poisson count. Divide by exposure for a rate. */
export function poissonCI(k: number, alpha = 0.05): Interval {
  const top = k + 20 + 10 * Math.sqrt(k + 1);
  const lo = k === 0 ? 0 : bisect((l) => 1 - poissonCdf(k - 1, l) - alpha / 2, 0, top);
  const hi = bisect((l) => poissonCdf(k, l) - alpha / 2, 0, top);
  return { lo, hi };
}

export function binomialPmf(k: number, n: number, p: number): number {
  if (k < 0 || k > n) return 0;
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  return Math.exp(
    lnFactorial(n) - lnFactorial(k) - lnFactorial(n - k) + k * Math.log(p) + (n - k) * Math.log(1 - p)
  );
}

/** Exact two-sided binomial test (sum of outcomes no more likely than observed). */
export function binomialTwoSided(k: number, n: number, p: number): number {
  if (n === 0) return 1;
  const obs = binomialPmf(k, n, p);
  let sum = 0;
  for (let i = 0; i <= n; i++) {
    const q = binomialPmf(i, n, p);
    if (q <= obs * (1 + 1e-7)) sum += q;
  }
  return Math.min(1, sum);
}

export interface RateComparison {
  rateA: number;
  rateB: number;
  ciA: Interval;
  ciB: Interval;
  /** rateA / rateB (Infinity when B observed nothing). */
  ratio: number;
  p: number;
}

/**
 * Compare two Poisson rates (counts over exposure). Conditional exact test:
 * given the total count, A's share is Binomial under "same rate".
 */
export function compareRates(countA: number, exposureA: number, countB: number, exposureB: number): RateComparison {
  const ciA = poissonCI(countA);
  const ciB = poissonCI(countB);
  const rateA = exposureA > 0 ? countA / exposureA : NaN;
  const rateB = exposureB > 0 ? countB / exposureB : NaN;
  const n = countA + countB;
  const p = n === 0 || exposureA <= 0 || exposureB <= 0 ? 1 : binomialTwoSided(countA, n, exposureA / (exposureA + exposureB));
  return {
    rateA,
    rateB,
    ciA: { lo: ciA.lo / exposureA, hi: ciA.hi / exposureA },
    ciB: { lo: ciB.lo / exposureB, hi: ciB.hi / exposureB },
    ratio: rateB > 0 ? rateA / rateB : rateA > 0 ? Infinity : NaN,
    p,
  };
}

/** Benjamini–Hochberg adjusted p-values (false discovery rate control). */
export function benjaminiHochberg(pvals: number[]): number[] {
  const m = pvals.length;
  const order = pvals.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const adj = new Array<number>(m);
  let running = 1;
  for (let r = m - 1; r >= 0; r--) {
    const { p, i } = order[r];
    running = Math.min(running, (p * m) / (r + 1));
    adj[i] = Math.min(1, running);
  }
  return adj;
}

/** Deterministic PRNG for permutation tests, so results are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function percentile(values: number[], q: number): number {
  if (values.length === 0) return NaN;
  const v = [...values].sort((a, b) => a - b);
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export function median(values: number[]): number {
  return percentile(values, 0.5);
}
