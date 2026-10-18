/**
 * bm25.mjs — dependency-free BM25 + Reciprocal-Rank-Fusion (H17).
 *
 * The research program's consistent finding (nonllm-sota-digest.md §1): every
 * production agent-memory system (Mem0, Zep/Graphiti, Letta, LangMem, Cognee)
 * pairs embeddings with LEXICAL search (BM25/full-text) — the two miss
 * different things. RRF (Cormack et al. 2009; k=60 convention) fuses ranked
 * lists WITHOUT touching raw scores — immune to the BM25-vs-cosine scale
 * mismatch that sinks weighted-score fusion. Pure TS, zero deps, µs/doc.
 */

/** Deterministic tokenizer: lowercase, split on non-alphanumeric. */
export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

/**
 * Build a BM25 index over docs. k1=1.5, b=0.75 (Lucene/Elastic defaults —
 * the values the field actually ships). API: score(query) -> ranked indices.
 */
export function buildBM25(docs, { k1 = 1.5, b = 0.75 } = {}) {
  const terms = docs.map((d) => tokenize(d));
  const N = docs.length;
  const avgDl = terms.length ? terms.reduce((a, t) => a + t.length, 0) / terms.length : 1;
  // document frequency per term
  const df = new Map();
  for (const t of terms) {
    const seen = new Set(t);
    for (const w of seen) df.set(w, (df.get(w) ?? 0) + 1);
  }
  const idf = (w) => {
    const n = df.get(w) ?? 0;
    // Lucene-style: ln(1 + (N - n + 0.5) / (n + 0.5)); non-negative
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };
  const tfCache = terms.map((t) => {
    const m = new Map();
    for (const w of t) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
  });

  return {
    N,
    /** BM25 scores for every doc against the query (lowercase-tokenized). */
    scoreAll(query) {
      const q = tokenize(query);
      return docs.map((_, i) => {
        const tf = tfCache[i];
        const dl = terms[i].length;
        let s = 0;
        for (const w of q) {
          const f = tf.get(w);
          if (!f) continue;
          s += idf(w) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * dl) / (avgDl || 1))));
        }
        return s;
      });
    },
    /** Ranked doc indices (best first). */
    rank(query) {
      const scores = this.scoreAll(query);
      return docs.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
    },
  };
}

/**
 * Reciprocal Rank Fusion over K ranked index lists. k=60 is the literature
 * convention (Cormack 2009; every production hybrid-search writeup uses it).
 * Returns fused ranked indices. Rank-invariant to score scales by design.
 */
export function rrfFuse(rankedList, { k = 60 } = {}) {
  if (!rankedList.length) return [];
  const scores = new Map();
  for (const list of rankedList) {
    list.forEach((idx, rank) => {
      scores.set(idx, (scores.get(idx) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return [...scores.keys()].sort((a, b) => scores.get(b) - scores.get(a));
}

/** Top-k set from a ranked index list. */
export function topkSet(ranked, k) {
  return new Set(ranked.slice(0, k));
}
