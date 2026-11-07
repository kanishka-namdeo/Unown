/**
 * tags.test.ts — the L-7 domain pins (PLAN §3 L-7, PRD V-7).
 *
 * Lane semantics: pure, DOM-free — RUNS in BOTH lanes (Lane A's
 * DOM-free runtime enforces; boundary.test.ts pins the import
 * graph).
 *
 * Pins (one group per deliverable):
 *   - the tag index: derived from the store, per-tag counts,
 *     canonical (sorted) order; rebuild = fresh build over the
 *     same data set (Srch-4's "the index derives from the store"
 *     applied to tags)
 *   - the filter-combo algebra: empty combo = the identity
 *     predicate (the brief's explicit pin); tag AND-combos
 *     compose with the state filter into ONE predicate; the text
 *     query rides ALONGSIDE (the search lane owns it — it is the
 *     ranked lane, not a conjunct); isFilterActive discriminates
 *     the Q-3 empty-state panel ("no-matches" only when a filter
 *     actually ran)
 *   - normalization: case-fold, trim, canonical order (sorted,
 *     deduped); the write shape every tag lane funnels through
 *   - rename/dedupe lanes: renameTag as a pure data → data
 *     transform (no mutation of the input; the index re-derives);
 *     dedupeTags merges case-variants to the smallest normalized
 *     spelling (deterministic, no clock)
 */
import { test, expect } from "bun:test";
import type { Clip, LegatoData } from "./types.js";
import {
  normalizeTag,
  canonicalTagList,
  buildTagIndex,
  rebuildTagIndex,
  emptyCombo,
  filterPredicate,
  applyFilter,
  isFilterActive,
  renameTag,
  dedupeTags,
  type FilterCombo,
} from "./tags.js";

// --- fixtures ---------------------------------------------------------

function mkClip(
  id: number,
  tags: string[],
  state: Clip["state"] = "unread",
): Clip {
  return {
    id,
    url: "https://example.com/" + id,
    title: "Clip " + id,
    text: "body " + id,
    tags,
    state,
    highlights: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function mkData(clips: Clip[]): LegatoData {
  const union = new Set<string>();
  for (const c of clips) for (const t of c.tags) union.add(t);
  return {
    schema: "legato.v1",
    schemaVersion: 1,
    clips,
    tags: [...union].sort(),
    queue: clips.map((c) => c.id),
  };
}

// ─── Normalization (the case-fold / trim / canonical-order law) ─────

test("normalizeTag: trims + case-folds (locale-independent)", () => {
  expect(normalizeTag("  Rust ")).toBe("rust");
  expect(normalizeTag("TYPESCRIPT")).toBe("typescript");
  expect(normalizeTag("")).toBe("");
  expect(normalizeTag("   ")).toBe("");
});

test("canonicalTagList: normalize + dedupe + ASCII-sort (the write shape)", () => {
  expect(canonicalTagList(["zeta", "alpha", "Alpha", "  zeta "])).toEqual([
    "alpha",
    "zeta",
  ]);
  expect(canonicalTagList(["", "  "])).toEqual([]);
  expect(canonicalTagList([])).toEqual([]);
});

// ─── The tag index (derived from the store, per L-4's ruling) ───────

test("buildTagIndex: per-tag clip counts + canonical (sorted) order", () => {
  const clips = [
    mkClip(1, ["b", "a"]),
    mkClip(2, ["a", "c"]),
    mkClip(3, ["c"]),
    mkClip(4, []),
  ];
  const idx = buildTagIndex(clips);
  expect(idx.tags.map((e) => e.tag)).toEqual(["a", "b", "c"]);
  expect(idx.tags.find((e) => e.tag === "a")!.count).toBe(2);
  expect(idx.tags.find((e) => e.tag === "b")!.count).toBe(1);
  expect(idx.tags.find((e) => e.tag === "c")!.count).toBe(2);
  expect(idx.byTag.get("a")).toBe(2);
});

test("buildTagIndex: a tag repeated on ONE clip counts once per clip", () => {
  const idx = buildTagIndex([mkClip(1, ["a", "a"])]);
  expect(idx.tags.map((e) => [e.tag, e.count])).toEqual([["a", 1]]);
});

test("rebuildTagIndex: fresh build over the same data set equals a direct build (Srch-4 shape)", () => {
  const clips = [mkClip(1, ["x", "y"]), mkClip(2, ["y", "z"])];
  const data = mkData(clips);
  expect(rebuildTagIndex(data)).toEqual(buildTagIndex(clips));
});

test("buildTagIndex: an empty store yields an empty index (never crashes)", () => {
  const idx = buildTagIndex([]);
  expect(idx.tags).toEqual([]);
  expect(idx.byTag.size).toBe(0);
});

// ─── The filter-combo algebra (the documented composition law) ──────

test("empty combo = the identity predicate (the brief's explicit pin)", () => {
  const clips = [mkClip(1, ["a"], "unread"), mkClip(2, ["b"], "done")];
  const combo = emptyCombo();
  // The predicate itself: every clip passes.
  const pred = filterPredicate(combo);
  expect(clips.every((c) => pred(c))).toBe(true);
  // applyFilter returns the whole set, in order, unchanged.
  expect(applyFilter(clips, combo)).toEqual(clips);
  // And it is NOT an active filter (the Q-3 discriminator).
  expect(isFilterActive(combo)).toBe(false);
});

test("tag AND-combo: a clip must carry EVERY selected tag", () => {
  const clips = [
    mkClip(1, ["a", "b"]),
    mkClip(2, ["a"]),
    mkClip(3, ["b"]),
    mkClip(4, []),
  ];
  const combo: FilterCombo = { tags: ["a", "b"], state: null, query: "" };
  expect(applyFilter(clips, combo).map((c) => c.id)).toEqual([1]);
  expect(isFilterActive(combo)).toBe(true);
});

test("state filter alone: equality predicate over a closed state set", () => {
  const clips = [
    mkClip(1, [], "unread"),
    mkClip(2, [], "reading"),
    mkClip(3, [], "done"),
    mkClip(4, [], "archived"),
  ];
  const combo: FilterCombo = { tags: [], state: "reading", query: "" };
  expect(applyFilter(clips, combo).map((c) => c.id)).toEqual([2]);
});

test("tags AND state compose into ONE predicate (the composition law)", () => {
  const clips = [
    mkClip(1, ["a"], "unread"),
    mkClip(2, ["a"], "reading"),
    mkClip(3, ["b"], "reading"),
  ];
  const combo: FilterCombo = { tags: ["a"], state: "reading", query: "" };
  // Clip 2 is the only one with BOTH tag "a" AND state "reading".
  expect(applyFilter(clips, combo).map((c) => c.id)).toEqual([2]);
  // Associativity pin: evaluating S first, then T, gives the same
  // set (order of the conjunction is irrelevant).
  const predT = filterPredicate({ tags: combo.tags, state: null, query: "" });
  const predS = filterPredicate({ tags: [], state: combo.state, query: "" });
  const both = clips.filter((c) => predT(c) && predS(c));
  expect(both.map((c) => c.id)).toEqual([2]);
});

test("the text query rides ALONGSIDE the composition (it is not a conjunct)", () => {
  // The composition law: Q is the ranked search lane (search.ts),
  // not a boolean predicate — applyFilter ignores it; the caller
  // runs the search lane first when it is non-empty. Pin that
  // `query` alone does not make the boolean dimensions change.
  const clips = [mkClip(1, ["a"]), mkClip(2, ["b"])];
  const combo: FilterCombo = { tags: ["a"], state: null, query: "zebra" };
  // The tag dimension still selects only clip 1 (the query is
  // carried, not composed — the search lane owns it).
  expect(applyFilter(clips, combo).map((c) => c.id)).toEqual([1]);
  // … but the query DOES make the filter active (the Q-3
  // discriminator sees it — the "no-matches" panel can run when
  // the search lane found nothing).
  expect(isFilterActive(combo)).toBe(true);
});

test("applyFilter returns matches in the SET's original order (filtering is a predicate, not a sort)", () => {
  const clips = [
    mkClip(3, ["a"]),
    mkClip(1, ["a"]),
    mkClip(2, ["b"]),
  ];
  const combo: FilterCombo = { tags: ["a"], state: null, query: "" };
  expect(applyFilter(clips, combo).map((c) => c.id)).toEqual([3, 1]);
});

test("isFilterActive: each dimension independently activates the filter", () => {
  expect(isFilterActive({ tags: ["x"], state: null, query: "" })).toBe(true);
  expect(isFilterActive({ tags: [], state: "done", query: "" })).toBe(true);
  expect(isFilterActive({ tags: [], state: null, query: "  " })).toBe(false); // blank query is identity
  expect(isFilterActive({ tags: [], state: null, query: "x" })).toBe(true);
});

// ─── The rename lane (a pure data → data transform) ─────────────────

test("renameTag: swaps every case-variant across all clips (pure: the input is not mutated)", () => {
  const clips = [mkClip(1, ["Old", "other"]), mkClip(2, ["old"]), mkClip(3, ["unrelated"])];
  const data = mkData(clips);
  const before = JSON.stringify(data.clips);
  const out = renameTag(data, "old", "new", "2026-11-07T00:00:00Z");
  // The input is untouched (pure transform — the caller persists
  // the returned data, never the input).
  expect(JSON.stringify(data.clips)).toBe(before);
  // Clips 1 + 2 carry the new tag; clip 3 is unchanged.
  expect(out.clips[0].tags).toEqual(["new", "other"]);
  expect(out.clips[1].tags).toEqual(["new"]);
  expect(out.clips[2].tags).toEqual(["unrelated"]);
  // The index re-derives: "new" is present, "old" is gone.
  expect(out.tags).toEqual(["new", "other", "unrelated"]);
  // Touched clips carry the injected now; untouched clips do not.
  expect(out.clips[0].updatedAt).toBe("2026-11-07T00:00:00Z");
  expect(out.clips[1].updatedAt).toBe("2026-11-07T00:00:00Z");
  expect(out.clips[2].updatedAt).toBe("2026-01-01T00:00:00Z");
});

test("renameTag: a clip already carrying the new tag does not end up with two (dedupe by construction)", () => {
  const clips = [mkClip(1, ["old", "new"])];
  const out = renameTag(mkData(clips), "old", "new", "2026-11-07T00:00:00Z");
  expect(out.clips[0].tags).toEqual(["new"]);
});

test("renameTag: an empty old or new spelling is a no-op (returns the input, unmodified)", () => {
  const clips = [mkClip(1, ["a"])];
  const data = mkData(clips);
  expect(renameTag(data, "  ", "b", "2026-11-07T00:00:00Z")).toBe(data);
  expect(renameTag(data, "a", "   ", "2026-11-07T00:00:00Z")).toBe(data);
});

// ─── The dedupe lane (merge case-variants) ───────────────────────────

test("dedupeTags: merges case-variants to the smallest normalized spelling", () => {
  // The union has "Rust" and "rust" (same normalized form "rust");
  // the representative is the smallest ASCII spelling, "rust".
  const clips = [mkClip(1, ["Rust", "go"]), mkClip(2, ["rust"])];
  const out = dedupeTags(mkData(clips), "2026-11-07T00:00:00Z");
  // Both clips now carry the representative; the index re-derives
  // to the merged set.
  expect(out.clips[0].tags).toEqual(["go", "rust"]);
  expect(out.clips[1].tags).toEqual(["rust"]);
  expect(out.tags).toEqual(["go", "rust"]);
  // Clip 1's "Rust" was replaced by the representative "rust" →
  // updatedAt touched. Clip 2's "rust" is already the
  // representative (normalizeTag("rust") = "rust", no change) →
  // updatedAt stays.
  expect(out.clips[0].updatedAt).toBe("2026-11-07T00:00:00Z");
  expect(out.clips[1].updatedAt).toBe("2026-01-01T00:00:00Z");
});

test("dedupeTags: a store with no case-variants is unchanged (tags equal the input's)", () => {
  const clips = [mkClip(1, ["a", "b"]), mkClip(2, ["b"])];
  const data = mkData(clips);
  const out = dedupeTags(data, "2026-11-07T00:00:00Z");
  expect(out.clips[0].tags).toEqual(["a", "b"]);
  // No clip changed → no updatedAt touch on the unmodified clips.
  expect(out.clips[0].updatedAt).toBe("2026-01-01T00:00:00Z");
  expect(out.tags).toEqual(["a", "b"]);
});

test("dedupeTags: the pure transform — the input data is not mutated", () => {
  const clips = [mkClip(1, ["Rust"]), mkClip(2, ["rust"])];
  const data = mkData(clips);
  const before = JSON.stringify(data);
  dedupeTags(data, "2026-11-07T00:00:00Z");
  expect(JSON.stringify(data)).toBe(before);
});
