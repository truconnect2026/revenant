// Two-component PCA by power iteration with deflation. Deterministic.

export interface PcaResult {
  points: [number, number][];
  /** Fraction of total variance explained by each component. */
  explained: [number, number];
}

export function pca2(rows: number[][]): PcaResult {
  const n = rows.length;
  if (n === 0) return { points: [], explained: [0, 0] };
  const d = rows[0].length;
  const mean = new Array(d).fill(0);
  for (const r of rows) for (let j = 0; j < d; j++) mean[j] += r[j] / n;
  const X = rows.map((r) => r.map((v, j) => v - mean[j]));

  // Covariance matrix (d × d)
  const C: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
  for (const r of X) for (let i = 0; i < d; i++) for (let j = i; j < d; j++) C[i][j] += (r[i] * r[j]) / Math.max(n - 1, 1);
  for (let i = 0; i < d; i++) for (let j = 0; j < i; j++) C[i][j] = C[j][i];
  let total = 0;
  for (let i = 0; i < d; i++) total += C[i][i];

  const comps: number[][] = [];
  const vals: number[] = [];
  for (let c = 0; c < 2; c++) {
    let v = Array.from({ length: d }, (_, i) => 1 / Math.sqrt(d) + (i === c ? 0.5 : 0));
    let lambda = 0;
    for (let it = 0; it < 300; it++) {
      const w = C.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
      const norm = Math.hypot(...w);
      if (norm < 1e-12) break;
      v = w.map((x) => x / norm);
      lambda = norm;
    }
    comps.push(v);
    vals.push(lambda);
    // Deflate
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) C[i][j] -= lambda * v[i] * v[j];
  }

  const points = X.map((r) => [
    r.reduce((s, x, j) => s + x * comps[0][j], 0),
    r.reduce((s, x, j) => s + x * (comps[1]?.[j] ?? 0), 0),
  ]) as [number, number][];
  return {
    points,
    explained: [total > 0 ? vals[0] / total : 0, total > 0 ? (vals[1] ?? 0) / total : 0],
  };
}
