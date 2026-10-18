/**
 * stats.mjs — tiny dependency-free statistics helpers for the nonllm bench.
 * Everything operates on plain number arrays; nulls/NaNs are dropped.
 */

export function round(x, digits = 3) {
  if (x === null || x === undefined || Number.isNaN(x)) return null;
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

// ---------------------------------------------------------------- ranking

function ranks(xs) {
  // average ranks for ties (fractional ranking, as Spearman requires)
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1; // 1-based average rank
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

/** Pearson correlation of two equal-length arrays. */
export function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i]; sb += b[i]; saa += a[i] * a[i]; sbb += b[i] * b[i]; sab += a[i] * b[i];
  }
  const cov = n * sab - sa * sb;
  const va = n * saa - sa * sa;
  const vb = n * sbb - sb * sb;
  const den = Math.sqrt(va * vb);
  return den === 0 ? null : cov / den;
}

/** Spearman rank correlation (rho) of two equal-length arrays. */
export function spearman(a, b) {
  if (a.length !== b.length || a.length < 2) return null;
  const ra = ranks(a);
  const rb = ranks(b);
  return pearson(ra, rb);
}

/** Jaccard overlap of two top-k index sets (0..1). */
export function topkOverlap(a, b) {
  const sa = new Set(a);
  const hits = b.filter((x) => sa.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? null : hits / union;
}

// ---------------------------------------------------------------- classification

export function confusionMatrix(gold, pred, labels) {
  const m = new Map();
  for (const l of labels) m.set(l, new Map(labels.map((l2) => [l2, 0])));
  for (let i = 0; i < gold.length; i++) {
    if (!m.has(gold[i]) || !m.get(gold[i]).has(pred[i])) continue; // skip unknown labels
    m.get(gold[i]).set(pred[i], m.get(gold[i]).get(pred[i]) + 1);
  }
  return m;
}

export function accuracy(gold, pred) {
  if (!gold.length) return null;
  let ok = 0;
  for (let i = 0; i < gold.length; i++) if (gold[i] === pred[i]) ok++;
  return ok / gold.length;
}

/**
 * Macro-F1 (unweighted mean of per-label F1). Predictions OUTSIDE `labels`
 * (e.g. a model answering "other" when the gold set is {benchmark, terminal})
 * count as errors: a FN for the gold label, never a TP — they must not be
 * silently dropped the way confusionMatrix does for matrix display.
 */
export function macroF1(gold, pred, labels) {
  const f1s = [];
  for (const l of labels) {
    let tp = 0, fp = 0, fn = 0;
    for (let i = 0; i < gold.length; i++) {
      const g = gold[i], p = pred[i];
      if (g === l && p === l) tp++;
      else if (g === l) fn++; // gold l, predicted something else (incl. out-of-set)
      else if (p === l) fp++; // predicted l, gold something else
    }
    if (tp + fp + fn === 0) continue; // label absent from both sides
    const p = tp + fp ? tp / (tp + fp) : 0;
    const r = tp + fn ? tp / (tp + fn) : 0;
    f1s.push(p + r ? (2 * p * r) / (p + r) : 0);
  }
  return f1s.length ? f1s.reduce((a, b) => a + b, 0) / f1s.length : null;
}

export function prf(tp, fp, fn) {
  const p = tp + fp ? tp / (tp + fp) : null;
  const r = tp + fn ? tp / (tp + fn) : null;
  const f = p !== null && r !== null && p + r > 0 ? (2 * p * r) / (p + r) : null;
  return { precision: p, recall: r, f1: f };
}

// ---------------------------------------------------------------- descriptive

export function mean(xs) {
  const v = xs.filter((x) => typeof x === "number" && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function median(xs) {
  const v = xs.filter((x) => typeof x === "number" && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
