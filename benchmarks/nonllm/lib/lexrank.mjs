/**
 * lexrank.mjs — dependency-free LexRank extractive summarization for
 * dream-input curation (research nonllm-architectures.md lane 3: "TextRank/
 * LexRank in pure TS is the baseline that small abstractive models only beat
 * by a few ROUGE points (MDPI 2023)" — millisecond, zero model RAM).
 *
 * Method (Erkan & Radeer 2004): sentence graph with IDF-modified cosine
 * similarity, PageRank-style power iteration with damping d=0.85, then
 * sentence scores = stationary probabilities.
 */

const STOPWORDS = new Set(
  "a an the and or but if then else when while of to in on at for with without from by as is are was were be been being this that these those it its his her their our your my i we you they he she them us not no nor so too very can will just should now do does did done have has had having about into over under again further once here there all any both each few more most other some such only own same than s t d ll m o re ve y".split(/\s+/)
);

/** Sentence split that keeps line structure meaningful for notes: split on line breaks AND sentence punctuation. */
export function splitSentences(text) {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/\n/g, " ")) // code fences: one pseudo-sentence
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
}

function tokens(s) {
  return String(s)
    .toLowerCase()
    .split(/[^a-z0-9_+#.-]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w) && !/^[.-]+$/.test(w));
}

/** TF-IDF vector of a sentence against the document's IDF table (sparse Map). */
function tfidf(sentence, idf, nDocs) {
  const v = new Map();
  const toks = tokens(sentence);
  for (const t of toks) {
    const df = idf.get(t) ?? 1;
    v.set(t, (v.get(t) ?? 0) + Math.log((1 + nDocs) / (1 + df)) + 1);
  }
  let norm = 0;
  for (const x of v.values()) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (const [k, x] of v) v.set(k, x / norm);
  return v;
}

function sparseCos(a, b) {
  let dot = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const [k, x] of small) {
    const y = big.get(k);
    if (y !== undefined) dot += x * y;
  }
  return dot; // both pre-normalized
}

/**
 * LexRank-score the sentences of `text`.
 * Returns [{ index, sentence, score }] sorted by score desc (index = position
 * in splitSentences(text), so callers can reassemble in original order).
 */
export function lexrank(text, { damping = 0.85, iters = 30, tol = 1e-6 } = {}) {
  const sentences = splitSentences(text);
  const n = sentences.length;
  if (n === 0) return [];
  if (n === 1) return [{ index: 0, sentence: sentences[0], score: 1 }];

  // IDF over sentences
  const df = new Map();
  const perSentTokens = sentences.map((s) => new Set(tokens(s)));
  for (const set of perSentTokens) for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);

  const vecs = sentences.map((s) => tfidf(s, df, n));

  // similarity matrix (degree-normalized as in the original paper's continuous LexRank)
  const sim = Array.from({ length: n }, () => new Float64Array(n));
  const rowSum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) { sim[i][j] = 0; continue; }
      const s = sparseCos(vecs[i], vecs[j]);
      sim[i][j] = s;
      rowSum[i] += s;
    }
  }
  // transition: P[i][j] = sim[i][j] / rowSum[i], or uniform if row empty
  let p = new Float64Array(n).fill(1 / n);
  for (let it = 0; it < iters; it++) {
    const next = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      let acc = (1 - damping) / n;
      for (let i = 0; i < n; i++) {
        if (i === j) continue;
        const pij = rowSum[i] > 0 ? (damping * sim[i][j]) / rowSum[i] : damping / n;
        acc += p[i] * pij;
      }
      next[j] = acc;
    }
    let delta = 0;
    for (let i = 0; i < n; i++) delta = Math.max(delta, Math.abs(next[i] - p[i]));
    p = next;
    if (delta < tol) break;
  }

  return sentences
    .map((sentence, index) => ({ index, sentence, score: p[index] }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Compress a session note for AutoDream input: keep the top sentences (in
 * original order) + the first line (run header carries run id/outcome facts).
 * Returns { text, kept, total, ratio }.
 */
export function compressNote(text, { topK = 2, minRatio = 0.35 } = {}) {
  const firstLine = String(text ?? "").split("\n")[0] ?? "";
  const ranked = lexrank(text);
  if (!ranked.length) return { text: String(text ?? ""), kept: 0, total: 0, ratio: 1 };
  const keep = new Set([firstLine]);
  for (const r of ranked.slice(0, topK)) keep.add(r.sentence);
  const sentences = splitSentences(text);
  const kept = sentences.filter((s) => keep.has(s));
  const chosen = kept.length >= Math.max(1, Math.round(sentences.length * minRatio))
    ? kept
    : sentences.slice(0, Math.max(1, Math.ceil(sentences.length * minRatio))); // never collapse below a floor
  const out = chosen.join("\n");
  return {
    text: out,
    kept: chosen.length,
    total: sentences.length,
    ratio: sentences.length ? chosen.length / sentences.length : 1,
  };
}
