/**
 * knn.mjs — k-nearest-neighbours + centroid (Rocchio) classification over
 * cosine similarity. The "dumbest thing that works" triage lane (research
 * nonllm-architectures.md Q4 / nonllm-classification.md lane fit): a few
 * labeled exemplars per class + a local ONNX embedding beats tiny-LLM
 * prompting on both accuracy and latency (SetFit RAFT, BTZSC evidence).
 */

/** Cosine similarity of two number vectors (embeddings arrive L2-normalized; still safe). */
export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/**
 * kNN classify x against labeled exemplars.
 * train: [{vec, label}]. Returns { label, confidence, top: [{label, sim}] }.
 * confidence = margin between the best class (vote-weighted) and the best
 * OTHER class — the cascade gate (margin >= tau => trust local, else defer).
 */
export function knnClassify(train, x, k = 5) {
  if (!train.length) return { label: null, confidence: 0, top: [] };
  const sims = train.map((t) => ({ label: t.label, sim: cosine(t.vec, x) }));
  sims.sort((a, b) => b.sim - a.sim);
  const top = sims.slice(0, Math.min(k, sims.length));
  const votes = new Map();
  for (const t of top) votes.set(t.label, (votes.get(t.label) ?? 0) + t.sim); // similarity-weighted vote
  let best = null, bestScore = -Infinity;
  for (const [label, score] of votes) if (score > bestScore) { best = label; bestScore = score; }
  let runnerUp = -Infinity;
  for (const [label, score] of votes) if (label !== best && score > runnerUp) runnerUp = score;
  const total = [...votes.values()].reduce((a, b) => a + b, 0) || 1;
  const confidence = runnerUp === -Infinity ? Math.min(1, bestScore / total) : Math.max(0, (bestScore - runnerUp) / total);
  return { label: best, confidence, top };
}

/** Nearest-centroid (Rocchio) classify — the even cheaper variant (no store of exemplars, one mean vec per class). */
export function centroidClassify(train, x) {
  const byLabel = new Map();
  for (const t of train) {
    if (!byLabel.has(t.label)) byLabel.set(t.label, new Array(t.vec.length).fill(0));
    const acc = byLabel.get(t.label);
    for (let i = 0; i < acc.length; i++) acc[i] += t.vec[i];
  }
  const centroids = [...byLabel.entries()].map(([label, acc]) => {
    const n = train.filter((t) => t.label === label).length;
    return { label, vec: acc.map((v) => v / n) };
  });
  const sims = centroids.map((c) => ({ label: c.label, sim: cosine(c.vec, x) })).sort((a, b) => b.sim - a.sim);
  const margin = sims.length > 1 ? sims[0].sim - sims[1].sim : 1;
  return { label: sims[0]?.label ?? null, confidence: Math.max(0, Math.min(1, margin)), top: sims };
}

/** Leave-one-out evaluation of a classifier fn (train-minus-one -> predict the held-out). */
export async function looEvaluate(train, classifyFn) {
  const rows = [];
  for (let i = 0; i < train.length; i++) {
    const held = train[i];
    const rest = train.filter((_, j) => j !== i);
    const pred = await classifyFn(rest, held.vec);
    rows.push({ gold: held.label, pred: pred.label, confidence: pred.confidence });
  }
  return rows;
}
