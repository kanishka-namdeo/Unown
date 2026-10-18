/**
 * activation.mjs — non-LLM memory/note importance scoring for AutoDream input
 * curation (research nonllm-memory.md Q7).
 *
 * Template: Generative Agents (Park et al. 2023) retrieval score
 *   score = w_rec * recency + w_imp * importance + w_rel * relevance
 * with recency = 0.995^(hours since last access), and the Hou/Tamoto/Miyashita
 * CHI-2024 activation model (relevance x elapsed-time x recall-frequency —
 * fully non-LLM). The LLM-scored "importance" term is replaced by cheap
 * proxies: recall frequency (log-scaled) + structural heuristics (note length,
 * outcome signal, tool richness). Every component is [0,1].
 */

export const DEFAULT_WEIGHTS = { recency: 0.55, relevance: 0.35, frequency: 0.10 };

/** Exponential recency decay, Park 2023: 0.995^hours. */
export function recencyScore(tsMs, nowMs = Date.now(), halfLifeHours = null) {
  const hours = Math.max(0, (nowMs - tsMs) / 3_600_000);
  if (halfLifeHours !== null) return 0.5 ** (hours / halfLifeHours);
  return 0.995 ** hours;
}

/** Map cosine (-1..1) to a [0,1] relevance signal. */
export function relevanceFromCosine(cos) {
  if (cos === null || cos === undefined || Number.isNaN(cos)) return 0.5; // unknown -> neutral
  return Math.max(0, Math.min(1, (cos + 1) / 2));
}

/** Log-scaled frequency: log1p(count)/log1p(max) in [0,1]. */
export function frequencyScore(count, maxCount) {
  if (!maxCount) return 0;
  return Math.max(0, Math.min(1, Math.log1p(count ?? 0) / Math.log1p(maxCount)));
}

/**
 * Structural importance heuristic standing in for Park's LLM-scored importance:
 * outcome-bearing, tool-rich, non-trivial notes carry more consolidation value.
 * All signals are lexical/structural — zero model cost.
 */
export function structuralScore(note) {
  const text = String(note?.content ?? "");
  let s = 0.35; // base
  if (/\bpas(s|ed|ses)\b|\bfail(ed|ure)?\b|\berror\b/i.test(text)) s += 0.25; // records an outcome
  if (/\b[Pp]ASSED\b|\bFAILED\b|\bERROR\b/.test(text)) s += 0.10; // engine-style outcome line
  if (/\btool\b|\bbash\b|\btest/i.test(text)) s += 0.10; // procedure-rich
  if (text.length > 400) s += 0.10; // substantial
  if (text.length < 80) s -= 0.15; // stub
  return Math.max(0, Math.min(1, s));
}

/**
 * Score notes for dream-input curation.
 * notes: [{ id, content, created_at, freq? }]  (freq = times referenced/recalled,
 * proxied by the caller — e.g. notes per task). goalText/goalEmb: the
 * consolidation goal (current memory digest or project focus); relevance uses
 * cosine(noteEmb, goalEmb) when embeddings are supplied, else structural only.
 * Returns rows [{ id, recency, relevance, frequency, structural, activation }]
 * sorted by activation desc.
 */
export function scoreNotes({ notes, nowMs = Date.now(), goalEmb = null, embedOf = null, weights = DEFAULT_WEIGHTS, useStructural = true }) {
  const maxFreq = Math.max(0, ...notes.map((n) => n.freq ?? 0));
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  // normalize weights to sum 1 (structural folds into the importance slot)
  const rows = notes.map((n) => {
    const recency = recencyScore(n.created_at, nowMs);
    let relevance = 0.5;
    if (goalEmb && embedOf) {
      const noteEmb = embedOf(n);
      if (noteEmb) relevance = relevanceFromCosine(cosine32(noteEmb, goalEmb));
    }
    const frequency = frequencyScore(n.freq ?? 0, maxFreq);
    const structural = useStructural ? structuralScore(n) : 0.5;
    return { id: n.id, recency, relevance, frequency, structural, activation: 0 };
  });
  // activation = normalized weighted sum, structural mixed into the importance mass
  const wSum = w.recency + w.relevance + w.frequency || 1;
  for (const r of rows) {
    r.activation =
      (w.recency * r.recency + w.relevance * r.relevance + w.frequency * r.frequency) / wSum * 0.6 +
      r.structural * 0.4;
  }
  return rows.sort((a, b) => b.activation - a.activation);
}

function cosine32(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
