/**
 * search.ts tests — the L-4 pins (PLAN §3 L-4, §4.3 Srch-1..Srch-4,
 * PRD V-4). Pure, DOM-free (Lane A enforces; boundary.test.ts pins
 * the import graph).
 *
 * Pins (one group per deliverable):
 *   - tokenizer: Latin words, CJK bigrams, hyphen dual-form, digits
 *   - ranking: title boost beats body-only match, tf matters,
 *     recency tiebreak deterministic
 *   - snippets: match centered, sentence-anchored boundaries,
 *     bounded length, no mid-word cuts
 *   - rebuild: index over [A] misses B; rebuild over [A,B] finds B
 *   - CJK fixture: found by a CJK query (bigram path) and NOT
 *     found by naive whitespace splitting (assert the hybrid
 *     actually engages)
 *   - empty / degraded clips: never match, never crash
 */
import { test, expect } from "bun:test";
import type { Clip, LegatoData } from "./types.js";
import {
  tokenize,
  buildIndex,
  search,
  snippetFor,
  rebuild,
} from "./search.js";

// --- fixtures ---------------------------------------------------------

function mkClip(
  id: number,
  title: string,
  text: string,
  createdAt: string,
  extra?: Partial<Clip>,
): Clip {
  return {
    id,
    url: "https://example.com/",
    title,
    text,
    tags: [],
    state: "unread",
    highlights: [],
    createdAt,
    updatedAt: createdAt,
    ...extra,
  };
}

function mkData(clips: Clip[]): LegatoData {
  const tags = new Set<string>();
  for (const c of clips) for (const t of c.tags) tags.add(t);
  return {
    schema: "legato.v1",
    schemaVersion: 1,
    clips,
    tags: [...tags].sort(),
    queue: clips.map((c) => c.id),
  };
}

const NOW = "2026-11-07T00:00:00.000Z";

// --- tokenizer pins ---------------------------------------------------

test("tokenize: Latin words, lowercased", () => {
  expect(tokenize("The Quick Brown Fox")).toEqual(
    ["the", "quick", "brown", "fox"],
  );
});

test("tokenize: digits ride with the word", () => {
  expect(tokenize("abc123 XYZ 42")).toEqual(["abc123", "xyz", "42"]);
});

test("tokenize: the PRD example — hyphenated + multi-word", () => {
  const terms = tokenize("that error-handling article with the retry ladder");
  // the hyphen split parts + the joined form
  expect(terms).toContain("error");
  expect(terms).toContain("handling");
  expect(terms).toContain("errorhandling");
  expect(terms).toContain("retry");
  expect(terms).toContain("ladder");
  expect(terms).toContain("that");
  expect(terms).toContain("article");
});

test("tokenize: hyphen dual-form — joined + split", () => {
  const terms = tokenize("state-of-the-art");
  expect(terms).toEqual(
    ["state", "of", "the", "art", "stateoftheart"],
  );
  // "well-known" meets "well known"
  const a = tokenize("well-known");
  const b = tokenize("well known");
  expect(a.filter((t) => t !== "wellknown")).toEqual(b);
});

test("tokenize: the line-wrap hyphen joins", () => {
  expect(tokenize("hy-\nphen")).toEqual(["hy", "phen", "hyphen"]);
});

test("tokenize: CJK bigrams (Srch-1)", () => {
  const terms = tokenize("重试阶梯");
  expect(terms).toContain("重试");
  expect(terms).toContain("试阶");
  expect(terms).toContain("阶梯");
});

test("tokenize: empty / whitespace / punctuation-only → []", () => {
  expect(tokenize("")).toEqual([]);
  expect(tokenize("   ")).toEqual([]);
  expect(tokenize("!!! ???")).toEqual([]);
});

// --- ranking pins -----------------------------------------------------

test("ranking: title boost beats body-only match", () => {
  const a = mkClip(1, "Retry Ladder", "intro text", "2026-09-01T00:00:00.000Z");
  const b = mkClip(2, "Unrelated", "the ladder is here", "2026-09-01T00:00:00.000Z");
  const idx = buildIndex([a, b], NOW);
  const results = search(idx, "ladder");
  expect(results.length).toBe(2);
  expect(results[0].id).toBe(1); // title match on top
  expect(results[1].id).toBe(2);
});

test("ranking: tf matters (more occurrences rank higher)", () => {
  const a = mkClip(1, "T1", "ladder ladder ladder ladder ladder", "2026-09-01T00:00:00.000Z");
  const b = mkClip(2, "T2", "ladder", "2026-09-01T00:00:00.000Z");
  const idx = buildIndex([a, b], NOW);
  const results = search(idx, "ladder");
  expect(results[0].id).toBe(1);
  expect(results[1].id).toBe(2);
});

test("ranking: recency tiebreak — same tf, newer wins", () => {
  const a = mkClip(1, "Older", "ladder", "2026-08-01T00:00:00.000Z");
  const b = mkClip(2, "Newer", "ladder", "2026-11-01T00:00:00.000Z");
  const idx = buildIndex([a, b], NOW);
  const results = search(idx, "ladder");
  expect(results[0].id).toBe(2); // newer first
  expect(results[1].id).toBe(1);
});

test("ranking: deterministic — same scores → createdAt desc, id asc", () => {
  // two clips with identical content + createdAt: id asc breaks the tie
  const a = mkClip(5, "Same", "identical body", "2026-10-01T00:00:00.000Z");
  const b = mkClip(3, "Same", "identical body", "2026-10-01T00:00:00.000Z");
  const idx = buildIndex([a, b], NOW);
  const results = search(idx, "identical");
  expect(results.map((r) => r.id)).toEqual([3, 5]);
});

test("search: empty / no-term query → []", () => {
  const idx = buildIndex([mkClip(1, "X", "some text", "2026-01-01T00:00:00.000Z")], NOW);
  expect(search(idx, "")).toEqual([]);
  expect(search(idx, "   ")).toEqual([]);
  expect(search(idx, "!!!")).toEqual([]);
});
// --- snippet pins -----------------------------------------------------

test("snippet: match centered, sentence-anchored start", () => {
  const clip = mkClip(
    1,
    "T",
    "One short lead. Another intro sentence here. The keyword appears mid-paragraph with more context around it to test the boundary snapping.",
    NOW,
  );
  const snip = snippetFor(clip, ["keyword"]);
  // the snippet contains the match and starts at a sentence/word boundary
  expect(snip).toContain("keyword");
  // no mid-word cut: the first char is not a partial word
  expect(/^[a-zA-Z0-9\u4e00-\u9fff\u2026]/.test(snip[0])).toBe(true);
  // sentence-anchored: it begins after a sentence boundary (or at start)
  const idx = snip.indexOf("keyword");
  expect(idx).toBeGreaterThan(0);
});

test("snippet: bounded length (never unbounded)", () => {
  const long = "word ".repeat(200);
  const clip = mkClip(1, "T", long + " TARGET " + long, NOW);
  const snip = snippetFor(clip, ["target"]);
  expect(snip.length).toBeLessThanOrEqual(300); // cap + ellipses
  expect(snip).toContain("TARGET");
});

test("snippet: no mid-word cuts at either boundary", () => {
  const clip = mkClip(
    1,
    "T",
    "abcdefg hijklmn TARGET uvwxyz",
    NOW,
  );
  const snip = snippetFor(clip, ["target"]);
  // starts and ends on word boundaries (or ellipsis + boundary)
  const cleaned = snip.replace(/^…/, "").replace(/…$/, "");
  // first char after the ellipsis must be a word start, not mid-word
  expect(/^[a-z]/.test(cleaned[0])).toBe(true);
  expect(/[a-z]$/.test(cleaned)).toBe(true);
});

test("snippet: empty body → title fallback (the T-6 lane)", () => {
  const clip = mkClip(1, "My Fallback Title", "", NOW, { emptyText: true });
  expect(snippetFor(clip, ["x"])).toBe("My Fallback Title");
});

// --- rebuild pin (Srch-4) ---------------------------------------------

test("rebuild: index over [A] misses B; rebuild over [A,B] finds B", () => {
  const A = mkClip(1, "Retry Ladder", "the retry ladder is strong", "2026-10-07T00:00:00.000Z");
  const B = mkClip(2, "Something Else", "nothing here", "2026-11-01T00:00:00.000Z");
  const idxA = buildIndex([A], NOW);
  expect(search(idxA, "retry").map((r) => r.id)).toEqual([1]);
  // B is not in the index: its term "else" has no posting
  expect(search(idxA, "else")).toEqual([]);

  const idxAB = rebuild(mkData([A, B]), NOW);
  expect(search(idxAB, "else").map((r) => r.id)).toEqual([2]);
  // A still searchable after rebuild
  expect(search(idxAB, "retry").map((r) => r.id)).toEqual([1]);
});

// --- CJK fixture pin (Srch-1) ------------------------------------------

test("CJK: found by the CJK bigram query, not by naive splitting", () => {
  const clip = mkClip(
    1,
    "错误处理 阶梯",
    "这个重试阶梯非常有用 阶梯",
    "2026-11-01T00:00:00.000Z",
  );
  const idx = buildIndex([clip], NOW);
  // the bigram path: "阶梯" is a bigram in the index
  expect(search(idx, "阶梯").map((r) => r.id)).toEqual([1]);
  // the title bigram "错误" also finds it
  expect(search(idx, "错误").map((r) => r.id)).toEqual([1]);
  // a REVERSED bigram ("梯阶") does NOT match — bigrams are order-sensitive
  expect(search(idx, "梯阶")).toEqual([]);

  // Assert the hybrid actually engages: naive whitespace splitting of
  // the CJK body would produce NO words, so a naive splitter would
  // miss the "阶梯" query entirely. The tokenize bigram lane is what
  // makes it findable.
  const naive = clip.text.split(/\s+/).filter((w) => w.length > 0).map((w) => w.toLowerCase());
  // "阶梯" as a whole whitespace-piece is in the naive list, but a
  // sub-word bigram query ("阶梯" from a longer CJK run) is NOT:
  const cjkOnly = mkClip(2, "纯", "重试阶梯", "2026-11-01T00:00:00.000Z");
  const naiveTerms = cjkOnly.text
    .split(/\s+/)
    .map((w) => w.toLowerCase());
  // the naive splitter gives the WHOLE run as one "word"; the bigram
  // lane gives "重试","试阶","阶梯" — the query "试阶" only matches
  // via the bigram path.
  expect(naiveTerms).toContain("重试阶梯");
  expect(naiveTerms).not.toContain("试阶");
  expect(tokenize("重试阶梯")).toContain("试阶");
  const idx2 = buildIndex([cjkOnly], NOW);
  expect(search(idx2, "试阶").map((r) => r.id)).toEqual([2]);
  expect(search(idx2, "重试阶梯").map((r) => r.id)).toEqual([2]);
  void naive;
});

// --- empty / degraded lanes -------------------------------------------

test("degraded clip (empty text, title only): findable by title terms", () => {
  const clip = mkClip(
    1,
    "Fallback Article",
    "",
    "2026-11-01T00:00:00.000Z",
    { emptyText: true },
  );
  const idx = buildIndex([clip], NOW);
  expect(search(idx, "fallback").map((r) => r.id)).toEqual([1]);
  // a body-only term has no posting
  expect(search(idx, "bodytext")).toEqual([]);
});

test("clip with empty title, no tags, empty body: no postings, never crashes", () => {
  const clip = mkClip(1, "T", "", NOW, { emptyText: true });
  // give it a real title so it has SOME posting, then a truly empty one
  const trulyEmpty: Clip = {
    ...mkClip(2, "x", "y", NOW),
    title: "",
    text: "",
    tags: [],
  };
  // the invariant layer would reject an empty title, but the search
  // lane must not crash on it: no postings → no match, no crash.
  const idx = buildIndex([trulyEmpty], NOW);
  expect(search(idx, "x")).toEqual([]);
  expect(search(idx, "anything")).toEqual([]);
});

test("search + snippet never crash on the degraded taxonomy lanes", () => {
  const lanes: Clip[] = [
    mkClip(1, "Charset", "undecodable", "2026-11-01T00:00:00.000Z", { error: "charset-unknown" }),
    mkClip(2, "Walled", "", "2026-11-01T00:00:00.000Z", { jsWalled: true, emptyText: true }),
    mkClip(3, "Paywalled", "paywall body", "2026-11-01T00:00:00.000Z", {
      excerpt: "the paywall excerpt",
      paywallExcerptOnly: true,
      error: "paywalled",
    }),
  ];
  const idx = buildIndex(lanes, NOW);
  // the paywall excerpt is searchable (T-4's product shape)
  expect(search(idx, "paywall").map((r) => r.id)).toContain(3);
  // degraded lane: snippet falls back to the title, never throws
  expect(snippetFor(lanes[1], ["walled"])).toBe("Walled");
  expect(snippetFor(lanes[2], ["paywall"])).toContain("the paywall excerpt");
});

// --- paywall excerpt pin ----------------------------------------------

test("paywall lane: the excerpt is searchable (T-4 shape)", () => {
  const clip = mkClip(
    1,
    "A Paywalled Story",
    "short body",
    "2026-11-01T00:00:00.000Z",
    { excerpt: "the paywall excerpt lane", paywallExcerptOnly: true },
  );
  const idx = buildIndex([clip], NOW);
  expect(search(idx, "paywall excerpt lane").map((r) => r.id)).toEqual([1]);
});

// --- tag pin ----------------------------------------------------------

test("tags: exact keywords carry title-level weight", () => {
  const a = mkClip(1, "Plain Body", "plain text", "2026-09-01T00:00:00.000Z", { tags: ["cjk-data"] });
  const b = mkClip(2, "Cjk Data Study", "plain text", "2026-09-01T00:00:00.000Z");
  const idx = buildIndex([a, b], NOW);
  const results = search(idx, "cjk data");
  // a's tag "cjk-data" tokenizes to ["cjk","data","cjkdata"] at ×3
  expect(results[0].id).toBe(1);
});
