/**
 * search.ts — the Legato search core (PLAN §3 L-4, §4.3 Srch-1..Srch-4,
 * PRD V-4). Pure, DOM-free (the Ostinato law; boundary.test.ts pins
 * it): the CJK char-bigram + word hybrid tokenizer, an inverted
 * index over clip text + title, a ranked query lane,
 * sentence-anchored snippets, and the rebuild-after-import lane
 * (Srch-4: the index is DERIVED from the store — nothing persisted,
 * ever).
 *
 * ---------------------------------------------------------------------
 * TOKENIZER (Srch-1, Srch-2) — the hybrid
 * ---------------------------------------------------------------------
 *
 * `tokenize(text)` — index side and query side share it, so the two
 * can never drift apart:
 *
 * - **CJK runs** are CHARACTER BIGRAMS (Srch-1): a maximal run of
 *   CJK ideographs — the Han unified block `U+4E00–U+9FFF` +
 *   Extension A `U+3400–U+4DB6`, Kana `U+3040–U+30FF`, Hangul
 *   `U+AC00–U+D7A3` — contributes every adjacent pair
 *   (`"重试阶梯"` → `"重试" "试阶" "阶梯"`). A 1-char run emits
 *   its character. Naive whitespace splitting of CJK text produces
 *   NO words at all; the bigram lane is what makes CJK clips
 *   findable by CJK queries.
 * - **Everything else** is word-scanned: the maximal
 *   `\p{L}\p{N}` runs are the words, LOWERCASED (digits ride with
 *   the letters of the same run: `"abc123"` → `"abc123"`).
 * - **Hyphenation-aware (Srch-2):** a hyphen (plus any surrounding
 *   whitespace — the line-wrap case `"hy-\nphen"`) is NOT a word
 *   boundary: it joins. A hyphenated run contributes BOTH forms:
 *   the split parts (`"state-of-the-art"` → `"state" "of" "the"
 *   "art"`) AND the joined spelling with hyphens dropped
 *   (`"stateoftheart"`). So `"state of the art"` queries match the
 *   split-form postings and `"state-of-the-art"` queries
 *   additionally carry the joined form — no false misses,
 *   `"well-known"` / `"well known"` meet each other.
 *
 * `tokenize` is total: empty / whitespace-only / punctuation-only
 * input → `[]` (the taxonomy's degraded lanes, T-6: they never
 * crash the index, they just contribute no terms).
 */

import type { Clip, LegatoData } from "./types.js";

// -------------------------------------------------------------------
// Tokenizer
// -------------------------------------------------------------------

/** A letter or digit run (Unicode: accents, CJK letters, …). */
const WORD_RUN = /[\p{L}\p{N}]+/gu;
/**
 * The CJK bigram lane (Srch-1): Han ideographs, Japanese kana
 * (hiragana + katakana), Korean hangul syllables.
 */
const CJK_RUN = /[\u4e00-\u9fff\u3400-\u4db6\u3040-\u30ff\uac00-\ud7a3]+/gu;
/** A hyphen link: a `-` plus the whitespace on either side of it —
 *  the Srch-2 line-wrap case (`"hy-\nphen"` joins to `"hyphen"`). */
/**
 * The word/term spelling at an offset: a CJK run OR a maximal word
 * span where hyphen-links are interior glue (the word runs of a
 * hyphenated piece stay together, one spelling). Returns the full
 * spelling + where the next term may start; null when no term
 * starts here.
 */
function termAt(s: string, off: number): { term: string; pos: number; next: number } | null {
  CJK_RUN.lastIndex = off;
  const cm = CJK_RUN.exec(s);
  if (cm !== null && cm.index === off) {
    return { term: cm[0], pos: off, next: off + cm[0].length };
  }
  if (!/^[\p{L}\p{N}]/u.test(s.slice(off, off + 1))) return null;
  // a word span: word-runs plus the hyphen-links between them
  const SPAN = /^[\p{L}\p{N}]*(?:(?:\s*-\s*)[\p{L}\p{N}]*)*/u;
  const m = SPAN.exec(s.slice(off));
  return m !== null && m[0].length > 0
    ? { term: m[0], pos: off, next: off + m[0].length }
    : null;
}

/**
 * Tokenize one string into index terms (the contract above). The
 * output is a SET: repeated terms contribute once (the index counts
 * occurrences itself; the query's coverage denominator is the
 * number of DISTINCT terms it tokenized to).
 */
export function tokenize(input: string): string[] {
  const out: string[] = [];
  if (typeof input !== "string" || input.length === 0) return out;

  // 1. The CJK bigrams, harvested first.
  CJK_RUN.lastIndex = 0;
  for (const m of input.matchAll(CJK_RUN)) {
    const run = m[0];
    if (run.length === 1) {
      out.push(run);
      continue;
    }
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  }

  // 2. The word lane over the non-CJK remainder: lowercase the word
  //    runs (hyphens inside a span still separate word runs — the
  //    split parts fall out here; step 3 re-merges them into the
  //    joined spelling too).
  const wordSource = input.replace(CJK_RUN, " ");
  for (let off = 0; off < wordSource.length; ) {
    const at = termAt(wordSource, off);
    if (at === null) {
      off += 1;
      continue;
    }
    WORD_RUN.lastIndex = 0;
    for (const m of at.term.matchAll(WORD_RUN)) out.push(m[0].toLowerCase());
    off = at.next;
  }

  // 3. The hyphen-join pass (the Srch-2 dual form): every maximal
  //    chain of tokens linked by hyphens adds its JOINED spelling
  //    (hyphens + inner whitespace dropped, lowercased). A token
  //    ending in `-` links to the NEXT whitespace token (`"hy-\nphen"`
  //    → `"hyphen"`, the line-wrap case). `"state-of-the-art"` is
  //    one token → its split parts are the words (step 2) plus the
  //    joined `"stateoftheart"`. A lone hyphen links nothing on the
  //    left: mere punctuation; its joined form is just the words it
  //    swallowed — the Set dedupes it away.
  const tokens = wordSource.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i].includes("-")) continue;
    let joined = "";
    let j = i;
    while (j < tokens.length) {
      const t = tokens[j];
      for (const seg of t.split("-")) {
        WORD_RUN.lastIndex = 0;
        for (const w of seg.matchAll(WORD_RUN)) joined += w[0];
      }
      if (j + 1 < tokens.length && t.endsWith("-")) j++;
      else break;
    }
    if (joined !== "") out.push(joined.toLowerCase());
    i = j;
  }

  // tokenize stays a SET — a repeated term contributes one entry
  // (the index counts occurrences itself; the query lane's coverage
  // denominator is the number of DISTINCT terms).
  return [...new Set(out)];
}

// -------------------------------------------------------------------
// Inverted index
// -------------------------------------------------------------------

/**
 * The index's per-clip entry: the terms it contributes, their
 * occurrences (term frequency — title hits already carry their
 * weight), and the first body position of each term (snippet
 * centering; -1 when the term is title/tag-only).
 */
export interface ClipIndexEntry {
  /** the clip's id (the result's identity) */
  id: number;
  /** the clip's createdAt — the recency tiebreak (ISO-8601) */
  createdAt: string;
  /** term → occurrences (body ×1 per occurrence, title ×3, tags ×3) */
  tf: Map<string, number>;
  /** term → first body offset (-1 = not in the body) */
  firstPos: Map<string, number>;
}

/** The inverted index: one entry per clip that has any postings. */
export interface SearchIndex {
  byId: Map<number, ClipIndexEntry>;
  /** the search-time NOW anchor (the injected clock's reading) */
  now: string;
}

/** Title weight: a title hit is worth 3 body occurrences — a clip
 *  that names a term in its TITLE is almost always about that term;
 *  a body hit may be a passing mention. */
const TITLE_WEIGHT = 3;
/** Tag weight: a tag is a deliberate keyword the user assigned —
 *  title-level weight, one occurrence each. */
const TAG_WEIGHT = 3;
/** The tf cap: more than 4 occurrences of a term saturates its
 *  contribution (the ranking pins the plateau). */
const TF_CAP = 4;

/**
 * Build the inverted index over a clip set (PLAN §3 L-4; Srch-4:
 * the index derives from the store — nothing is persisted, an
 * import flows through `rebuild` and search sees it).
 *
 * Searchable content per clip:
 *   - body = `text` (plus `excerpt` when present — the paywall lane
 *     keeps its clipable excerpt searchable, T-4's shape)
 *   - title (×3 per occurrence of each term)
 *   - tags (×3 each — exact keywords)
 * Degraded clips (emptyText / error lanes, T-6: empty body) keep
 * their title + tags postings: they are findable by their fallback
 * fields, never dropped. A clip with an empty title, no tags and
 * empty body contributes no postings: it matches nothing, and
 * nothing crashes.
 *
 * `now` is the recency anchor (default: the wall clock's reading at
 * build time — pass the test clock to pin it).
 */
export function buildIndex(clips: readonly Clip[], now?: string): SearchIndex {
  const byId = new Map<number, ClipIndexEntry>();
  for (const clip of clips) {
    const body = clip.excerpt !== undefined ? clip.text + " " + clip.excerpt : clip.text;
    const entry: ClipIndexEntry = {
      id: clip.id,
      createdAt: clip.createdAt,
      tf: new Map(),
      firstPos: new Map(),
    };
    // Body: one position scan, count + first occurrence per term.
    for (let off = 0; off < body.length; ) {
      const at = termAt(body, off);
      if (at === null) {
        off += 1;
        continue;
      }
      // The term's index set (a body word like "state-of-the-art"
      // contributes its parts + the joined form, exactly as the
      // query lane does — one shared tokenizer, no drift).
      for (const t of tokenize(at.term)) {
        addTf(entry.tf, t, 1);
        if (!entry.firstPos.has(t)) entry.firstPos.set(t, at.pos);
      }
      off = at.next;
    }
    // Title ×3.
    for (const t of tokenize(clip.title)) {
      addTf(entry.tf, t, TITLE_WEIGHT);
      if (!entry.firstPos.has(t)) entry.firstPos.set(t, -1);
    }
    // Tags ×3 (one occurrence each — a tag is an exact keyword).
    for (const tag of clip.tags) {
      for (const t of tokenize(tag)) addTf(entry.tf, t, TAG_WEIGHT);
    }
    if (entry.tf.size > 0) byId.set(clip.id, entry);
  }
  return { byId, now: now ?? new Date().toISOString() };
}

/**
 * The rebuild lane (Srch-4): an import APPENDS to the store, and
 * the index is re-derived over the whole set — no stale-index
 * merge, ever. `rebuild(data, now)` over a store view is exactly
 * `buildIndex(data.clips, now)`: a post-import search sees the
 * imported clips, and the index equals a fresh build over the same
 * dataset.
 */
export function rebuild(data: LegatoData, now?: string): SearchIndex {
  return buildIndex(data.clips, now);
}

function addTf(tf: Map<string, number>, t: string, by: number): void {
  tf.set(t, (tf.get(t) ?? 0) + by);
}

// -------------------------------------------------------------------
// Query lane
// -------------------------------------------------------------------

/** A ranked result: the clip id + its score + the query terms it
 *  matched. */
export interface SearchResult {
  id: number;
  score: number;
  /** the query terms this clip matched (coverage numerator) */
  matched: string[];
}

/**
 * Search the index for a query. AND-over-distinct-terms at the doc
 * level: EVERY distinct term the query tokenized to must have a
 * posting in the clip. Empty / no-term queries return `[]` (a
 * search box with only spaces matches nothing — the Q-3 empty-state
 * lane stays honest).
 *
 * The documented formula (the module header states it in full):
 *
 *   score(c, q) = 100 · coverage + tf + 3 · recency
 *
 *   coverage  = 1 (every query term matched — otherwise the clip is
 *               not a result)
 *   tf        = Σ over matched query terms t: 3 · min(tf(c,t), 4) / 4
 *               (the ×3 title weight already lives in tf(c,t); the
 *               /4 cap normalizes each term's contribution to 0..3)
 *   recency   = 1 − log10(ΔDays + 1) / 10, clamped to [0, 1], where
 *               ΔDays is the whole-day age of c.createdAt against
 *               the search anchor `now` (the index's build-time
 *               reading by default — repeat searches of one index
 *               are stable), clamped to a 10000-day horizon.
 *
 * Scale: the tf lane spans 0..3·|qTerms|; the recency lane spans
 * 0..3 — it is the TIEBREAK. Determinism: scores are equal →
 * sort by `createdAt` descending, then by `id` ascending.
 */
export function search(
  index: SearchIndex,
  query: string,
  now?: string,
): SearchResult[] {
  const qTerms = tokenize(query);
  if (qTerms.length === 0) return [];
  const anchor = now ?? index.now;

  const results: SearchResult[] = [];
  for (const entry of index.byId.values()) {
    const matched: string[] = [];
    let all = true;
    for (const t of qTerms) {
      if ((entry.tf.get(t) ?? 0) > 0) matched.push(t);
      else {
        all = false;
        break;
      }
    }
    if (!all) continue;

    let tfScore = 0;
    for (const t of matched) {
      tfScore += (3 * Math.min(entry.tf.get(t) ?? 0, TF_CAP)) / TF_CAP;
    }
    const days = Math.min(10_000, Math.max(0, dayDiff(anchor, entry.createdAt)));
    const recency = Math.max(0, Math.min(1, 1 - Math.log10(days + 1) / 10));

    results.push({ id: entry.id, score: 100 + tfScore + 3 * recency, matched });
  }

  // Deterministic total order: score desc, createdAt desc, id asc.
  const createdAtOf = (id: number): string => index.byId.get(id)?.createdAt ?? "";
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ca = createdAtOf(a.id);
    const cb = createdAtOf(b.id);
    if (ca !== cb) return ca < cb ? 1 : -1;
    return a.id - b.id;
  });
  return results;
}

/** Whole days between two ISO-8601 timestamps (a ≥ b → positive;
 *  malformed → 0, the recency lane degrades to neutral, never
 *  NaN). */
function dayDiff(aIso: string, bIso: string): number {
  const a = isoDays(aIso);
  const b = isoDays(bIso);
  if (a === null || b === null) return 0;
  return Math.max(0, Math.floor(a - b));
}

/**
 * A tiny ISO-8601 parser (the domain stays Node-free: no
 * `Date.parse` drift across implementations — the grammar's
 * timestamps are plain JSON, UTC `Z` form by house convention, and
 * the recency lane needs only the DIFF in whole days). Whole days
 * from 1970-01-01 + the sub-day fraction.
 */
function isoDays(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.exec(iso);
  if (m === null) return null;
  const Y = Number(m[1]);
  const Mo = Number(m[2]);
  const D = Number(m[3]);
  const subDay = (Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6])) / 86_400;
  const leap = Y % 4 === 0 && (Y % 100 !== 0 || Y % 400 === 0);
  const monthLens = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let doy = D;
  for (let i = 0; i < Mo - 1; i++) doy += monthLens[i];
  const yearDays =
    365 * (Y - 1970) +
    Math.floor((Y - 1970) / 4) -
    Math.floor((Y - 1970) / 100) +
    Math.floor((Y - 1970) / 400);
  return yearDays + doy - 1 + subDay;
}

// -------------------------------------------------------------------
// Snippets (Srch-3)
// -------------------------------------------------------------------

/** The snippet's hard cap (bounded by contract, never unbounded). */
const SNIPPET_MAX = 280;
/** The match window centered in the snippet (before the cap). */
const SNIPPET_WINDOW = 160;

/**
 * The snippet lane: a bounded excerpt of the clip body with the
 * first match region centered.
 *
 * The boundaries are NEVER mid-word, NEVER unbounded:
 *   - the START snaps back to a sentence anchor (`.`, `!`, `?`,
 *     `;` followed by whitespace) when one lies inside the raw
 *     window; otherwise to the nearest whitespace — a word is
 *     never cut in half.
 *   - the END snaps forward to a sentence anchor of the same
 *     species; otherwise to the nearest whitespace.
 *   - the HARD CAP (`SNIPPET_MAX`) always wins: when the snapped
 *     window exceeds it, the start pulls forward to the match and
 *     the end is truncated at the cap — the excerpt stays bounded.
 *
 * A degraded clip (empty body, the T-6 lane) falls back to its
 * title — the "title+URL fallback" shape — never to a blank.
 */
export function snippetFor(clip: Clip, terms: readonly string[]): string {
  const body = clip.excerpt !== undefined ? clip.text + " " + clip.excerpt : clip.text;
  if (body.trim() === "") {
    return clip.title.slice(0, SNIPPET_MAX);
  }
  // The first occurrence of ANY of the given terms (the "first
  // match region" the brief names).
  let pos = -1;
  for (const t of terms) {
    if (t === "") continue;
    const p = body.toLowerCase().indexOf(t.toLowerCase());
    if (p !== -1 && (pos === -1 || p < pos)) pos = p;
  }
  if (pos === -1) {
    // The terms matched the title, not the body (or there was no
    // body): lead with the title, then the body's head.
    return clip.title.slice(0, SNIPPET_MAX);
  }
  let start = Math.max(0, pos - Math.floor(SNIPPET_WINDOW / 2));
  let end = Math.min(body.length, pos + Math.ceil(SNIPPET_WINDOW / 2));
  start = snapStart(body, start);
  end = snapEnd(body, end);
  if (end - start > SNIPPET_MAX) {
    // The cap wins: pull the start forward to the match region,
    // then end at the cap.
    start = Math.max(start, pos - 60);
    start = snapStart(body, start);
    end = Math.min(body.length, start + SNIPPET_MAX);
    end = snapEnd(body, end);
    if (end - start > SNIPPET_MAX) end = start + SNIPPET_MAX;
  }
  let snip = body.slice(start, end).trim();
  if (start > 0) snip = "\u2026" + snip;
  if (end < body.length) snip = snip + "\u2026";
  return snip;
}

/**
 * The sentence-anchored START: walk back from the raw position to
 * the last sentence anchor (`.` `!` `?` `;` + whitespace) or
 * whitespace boundary — the snippet starts AFTER that whitespace,
 * so it opens at a sentence/word boundary, never mid-word.
 */
function snapStart(s: string, raw: number): number {
  let i = Math.min(raw, s.length - 1);
  while (i > 0) {
    const c = s[i];
    if (/\s/.test(c)) return i; // start at the whitespace itself
    if (c === "." || c === "!" || c === "?" || c === ";") {
      // the anchor + its following whitespace: start after it
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      return Math.min(j, s.length);
    }
    i -= 1;
  }
  return 0;
}

/**
 * The sentence-anchored END: walk forward from the raw position to
 * the next sentence anchor (the anchor is included, its trailing
 * whitespace is included); otherwise to the next whitespace — the
 * snippet ends on a sentence/word boundary, never mid-word.
 */
function snapEnd(s: string, raw: number): number {
  let i = Math.max(0, raw - 1);
  while (i < s.length - 1) {
    const c = s[i];
    if (/\s/.test(c)) return i; // end before the whitespace
    if (c === "." || c === "!" || c === "?" || c === ";") {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      return j; // end after the anchor + trailing whitespace
    }
    i += 1;
  }
  return s.length;
}
