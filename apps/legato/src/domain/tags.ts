/**
 * tags.ts — the Legato tag core (PLAN §3 L-7: "filter combos, tag
 * index", PRD V-7). Pure, DOM-free, Node-free (the Ostinato law;
 * boundary.test.ts pins the import graph): the tag index is DERIVED
 * from the store (Srch-4's "the index derives from the store" ruling,
 * same as search.ts — nothing persisted, an import re-derives it),
 * and the filter-combo algebra composes the tag AND-combos with the
 * state filter and the '/' text query into ONE filter predicate.
 *
 * ---------------------------------------------------------------------
 * NORMALIZATION (the case-fold / trim / canonical-order law)
 * ---------------------------------------------------------------------
 *
 * `normalizeTag(raw)` — trim, then case-fold (lowercase, locale-
 * independent `toLowerCase`). The store's tag spelling is the
 * normalized spelling: what the user types in the tag editor
 * arrives here and is stored normalized, so a "Rust" typed later
 * is the same tag as the existing "rust" and the index never grows
 * a case-variant duplicate.
 *
 * `canonicalTagList(raw[])` — normalize each entry, drop empties,
 * dedupe, and sort ASCII-ascending (the `Clip.tags` "canonical
 * order, deduped" grammar note in types.ts). This is the single
 * clip-tags shape every write lane funnels through.
 *
 * ---------------------------------------------------------------------
 * THE TAG INDEX (derived, per L-4's "the index derives from the
 * store" ruling)
 * ---------------------------------------------------------------------
 *
 * `buildTagIndex(data)` → every distinct tag across all clips, in
 * canonical (sorted) order, with its clip count. The store's
 * `data.tags` field (the grammar's tag index) must set-match the
 * union of clip.tags (invariants.ts enforces this); this
 * function re-derives it + adds the counts, so an import's
 * re-derivation sees fresh counts with zero persisted state.
 *
 * `rebuildTagIndex` is `buildTagIndex` over `LegatoData` — the
 * import/rebuild lane (Srch-4's shape applied to tags).
 *
 * ---------------------------------------------------------------------
 * THE FILTER-COMBO ALGEBRA (the documented composition law)
 * ---------------------------------------------------------------------
 *
 * Three independent filter dimensions, each a pure CLIP predicate:
 *
 *   T(tags)      — the tag AND-combo: a clip matches iff it
 *                  carries EVERY tag in `tags` (subset test over
 *                  the clip's canonical tag set). Empty combo
 *                  (`tags = []`) is the IDENTITY — it matches
 *                  every clip (the "empty-combo = no filter" law,
 *                  pinned in tags.test.ts).
 *   S(state)     — the state filter: `state === null` is the
 *                  IDENTITY (no state constraint, browse view);
 *                  a non-null state is an equality predicate.
 *   Q(query)     — the '/' text-query lane (L-5/L-4): `query`
 *                  trimmed to "" is the IDENTITY; a non-empty
 *                  query runs the search.ts ranking lane and is
 *                  passed through UNCHANGED — the text dimension
 *                  is NOT composed into a predicate here, the
 *                  search lane owns it (it is the RANKED lane,
 *                  not a boolean predicate; composing it would
 *                  throw away its recency + tf ordering).
 *
 * THE COMPOSITION LAW: the three dimensions form a monoid under
 * AND-composition — the COMPOSED PREDICATE `T ∘ S` is
 *
 *   matches(c) = T(tags)(c) AND S(state)(c)
 *
 * with:
 *   - **identity**: `T([]) AND S(null)` matches every clip
 *     (the no-filter lane);
 *   - **associativity**: `(T ∘ S)` is two independent predicates
 *     conjoined — a clip is in the result iff it satisfies both,
 *     so the order of evaluation is irrelevant and combining with
 *     a third conjunct (e.g. a future error filter) is free;
 *   - **idempotence per dimension**: selecting a tag twice is the
 *     same combo as selecting it once (the UI's toggle is
 *     XOR; the domain's AND-combo dedupes by construction).
 *
 * `FilterCombo` is the composed value (tags + state; the text
 * query rides alongside, NOT inside — see above). `applyFilter`
 * runs the composition over a clip set and returns the matches in
 * the SET's original order (ordering is the queue lane's
 * concern, L-6 — filtering is a predicate, not a sort).
 *
 * `isFilterActive(combo)` — the Q-3 empty-state discriminator's
 * input: true when ANY dimension is non-identity (any tag, or any
 * state, or a non-empty text query). The "no-matches" panel only
 * runs when a filter is active; an unfiltered empty active queue
 * is "all-read", not "no-matches" (the Q-3 discrimination).
 *
 * ---------------------------------------------------------------------
 * RENAME / DEDUPE LANES (pure data → data transforms)
 * ---------------------------------------------------------------------
 *
 * `renameTag(data, old, now)` — rename a tag ACROSS THE STORE:
 * every clip carrying the old spelling (as a case-folded
 * equivalent) gets the new normalized spelling, with the
 * clip's `canonicalTagList` re-derived so the canonical order
 * stays enforced and the clip dedupes (a clip already carrying
 * the new tag does not end up with two). `data.tags` (the
 * index) is re-derived too (the index is always derived, never
 * hand-kept). Returns a fresh LegatoData (data → data, the
 * brief's "renameTag as a pure data->data transform"; no
 * mutation of the input).
 *
 * `dedupeTags(data)` — merge CASE-VARIANT tags: group every
 * distinct tag by its normalized form; when a group has more
 * than one spelling, the canonical representative is the
 * smallest normalized spelling (ASCII order — deterministic),
 * and every clip is re-derived over that representative. The
 * index is re-derived. Also data → data, no mutation.
 *
 * Both transforms carry `now` (ISO-8601, injected) and update
 * each touched clip's `updatedAt` (the Ostinato
 * every-transition persistence rule: the storage seam's byte-
 * stable save picks it up; the app persists after every
 * transition).
 */

import type { LegatoData, Clip, ClipState } from "./types.js";

/** The case-fold: trim + `toLowerCase` (locale-independent). */
export function normalizeTag(raw: string): string {
  if (typeof raw !== "string") return "";
  // Trim ALL whitespace (the law says trim — a tag that is
  // whitespace-only must normalize to "" and be dropped, not
  // survive as a literal whitespace entry in the canonical list).
  const n = raw.trim().toLowerCase();
  return n.replace(/\s+/g, "");
}

/**
 * The canonical tag list for a clip (types.ts's "canonical order,
 * deduped" note): normalize each entry, drop the empties, dedupe,
 * ASCII-sort. The single write shape — the tag editor and the
 * rename/dedupe lanes all funnel through this.
 */
export function canonicalTagList(raw: readonly string[]): string[] {
  const out = new Set<string>();
  for (const r of raw) {
    const n = normalizeTag(r);
    if (n !== "") out.add(n); // drop empty entries (whitespace-only raw)
  }
  return [...out].sort();
}

/** One entry of the tag index: the tag + how many clips carry it. */
export interface TagIndexEntry {
  tag: string;
  count: number;
}

/** The full tag index: every distinct tag across all clips, in
 *  canonical (sorted) order, with its count. */
export interface TagIndex {
  tags: TagIndexEntry[];
  /** the tag set (for the filter-combo membership test). */
  byTag: Map<string, number>;
}

/**
 * Build the tag index over a clip set (derived, nothing
 * persisted — the import/rebuild lane sees it fresh). The index
 * is sorted ASCII-ascending so the filter bar's chips render in a
 * deterministic order (the UI never carries its own sort).
 */
export function buildTagIndex(clips: readonly Clip[]): TagIndex {
  const byTag = new Map<string, number>();
  for (const c of clips) {
    for (const t of new Set(c.tags)) byTag.set(t, (byTag.get(t) ?? 0) + 1);
  }
  const tags = [...byTag.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([tag, count]) => ({ tag, count }));
  return { tags, byTag };
}

/** The rebuild lane (the Srch-4 shape applied to tags): rebuild
 *  the index over a whole store view after an import. */
export function rebuildTagIndex(data: LegatoData): TagIndex {
  return buildTagIndex(data.clips);
}

/**
 * The filter combo — the two boolean dimensions (tags + state)
 * that compose into ONE predicate, plus the text query that rides
 * ALONGSIDE them (the search lane owns it — the composition law
 * above explains why it is not a conjunct).
 *
 * An empty combo (`tags: []`, `state: null`, `query: ""`) is the
 * IDENTITY: `applyFilter` returns the whole set unchanged.
 */
export interface FilterCombo {
  /** the tag AND-combo (canonical, deduped; [] = identity) */
  tags: readonly string[];
  /** the state filter (null = identity, no state constraint) */
  state: ClipState | null;
  /** the '/' text-query lane ("" = identity; rides alongside the
   *  composition — the search lane is the RANKED lane, see the
   *  composition law in the module header). */
  query: string;
}

/** A fresh identity combo (no filter active). */
export function emptyCombo(): FilterCombo {
  return { tags: [], state: null, query: "" };
}

/**
 * THE COMPOSED PREDICATE — one function of a clip, the
 * `T(tags) AND S(state)` from the composition law. Exported so
 * the UI can hold it and the test lane can pin it directly
 * (empty combo → identity is the pin's target).
 */
export function filterPredicate(combo: FilterCombo): (c: Clip) => boolean {
  const tagSet = new Set(combo.tags);
  return (c: Clip): boolean => {
    // T: the tag AND-combo (subset test — the clip must carry
    // EVERY selected tag).
    for (const t of tagSet) {
      if (!c.tags.includes(t)) return false;
    }
    // S: the state filter (identity when null).
    if (combo.state !== null && c.state !== combo.state) return false;
    return true;
  };
}

/**
 * Apply the composed filter over a clip set, returning the
 * matches in the SET'S ORDER (ordering is the queue lane's
 * concern; the filter is a predicate, not a sort). The text
 * query is NOT applied here — the caller runs the search lane
 * (search.ts) first when `combo.query` is non-empty, and the
 * composed predicate runs over the search results (or over the
 * whole set when the query is empty).
 */
export function applyFilter(clips: readonly Clip[], combo: FilterCombo): Clip[] {
  if (!isFilterActive(combo)) return [...clips];
  const pred = filterPredicate(combo);
  return clips.filter(pred);
}

/**
 * Is ANY dimension of the combo non-identity? The Q-3 empty-state
 * discriminator's input — a "no-matches" panel is only honest
 * when a filter actually ran (an unfiltered empty active queue is
 * "all-read", the L-6 lane; a filtered empty one is "no-matches",
 * the L-6/L-7 shared panel the brief's item 5 gives the tag
 * dimension).
 */
export function isFilterActive(combo: FilterCombo): boolean {
  return (
    combo.tags.length > 0 ||
    combo.state !== null ||
    combo.query.trim() !== ""
  );
}

/**
 * The RENAME lane (a pure data → data transform, the brief's
 * "renameTag as a pure data->data transform"): every clip
 * carrying a case-folded equivalent of `oldTag` gets the new
 * normalized spelling of `newTag`, its `canonicalTagList`
 * re-derived (canonical order + dedupe stay enforced — a clip
 * that already had the new tag does not end up with two), and
 * its `updatedAt` touched. The store's tag index is re-derived
 * (never hand-kept). `now` is the injected clock (ISO-8601).
 *
 * Returns a FRESH LegatoData (no mutation of the input — the
 * caller owns persistence through the StoragePort, the
 * Ostinato every-transition rule).
 */
export function renameTag(
  data: LegatoData,
  oldTag: string,
  newTag: string,
  now: string,
): LegatoData {
  const oldN = normalizeTag(oldTag);
  const newN = normalizeTag(newTag);
  if (oldN === "" || newN === "") return data; // nothing to rename to/from
  const clips: Clip[] = data.clips.map((c) => {
    const hasOld = c.tags.some((t) => normalizeTag(t) === oldN);
    if (!hasOld) return c;
    // Swap every case-variant of oldN for newN, then re-derive the
    // canonical list (order + dedupe stay enforced — a clip already
    // carrying newN does not end up with two).
    const swapped = c.tags.map((t) => (normalizeTag(t) === oldN ? newN : t));
    return { ...c, tags: canonicalTagList(swapped), updatedAt: now };
  });
  return {
    ...data,
    clips,
    tags: canonicalTagList(clips.flatMap((c) => c.tags)),
  };
}

/**
 * The DEDUPE lane (merge case-variants): group every distinct
 * tag by its normalized form; when a group has >1 spelling, the
 * representative is the SMALLEST normalized spelling (ASCII —
 * deterministic, no clock needed). Every clip is re-derived over
 * the representative set (its `canonicalTagList` re-sorted,
 * deduped), `updatedAt` touched on any clip that changed. The
 * index is re-derived. Pure data → data, no mutation.
 */
export function dedupeTags(data: LegatoData, now: string): LegatoData {
  // Distinct tags from the clips' union (the index re-derives
  // from the same source, so this stays the truth).
  const union = new Set<string>();
  for (const c of data.clips) for (const t of c.tags) union.add(t);
  const distinct = [...union];

  // Representative per normalized group: the canonical spelling
  // (normalizeTag of the smallest ASCII spelling in the group —
  // the group's representative is what the store actually carries,
  // not just the smallest raw spelling).
  const groups = new Map<string, string[]>();
  for (const t of distinct) {
    const n = normalizeTag(t);
    const g = groups.get(n);
    if (g === undefined) groups.set(n, [t]);
    else g.push(t);
  }
  const mapTo = new Map<string, string>(); // original spelling → representative
  for (const [norm, spellings] of groups) {
    // The representative is the NORMALIZED form of the smallest
    // ASCII spelling in the group: group "[Rust, rust]" has
    // smallest spelling "rust" (lowercase < uppercase in ASCII);
    // normalizeTag("rust") = "rust" → representative is "rust".
    // Group "[Go, go]" → smallest "Go" → normalizeTag("Go") =
    // "go" → representative is "go".
    const rep = normalizeTag(spellings.sort()[0]);
    for (const s of spellings) mapTo.set(s, rep);
    // Self-map (idempotence): the representative maps to itself.
    mapTo.set(rep, rep);
  }

  const clips: Clip[] = data.clips.map((c) => {
    const next = c.tags.map((t) => mapTo.get(t) ?? t);
    const changed = next.some((t, i) => t !== c.tags[i]);
    if (!changed) return c;
    return { ...c, tags: canonicalTagList(next), updatedAt: now };
  });
  return {
    ...data,
    clips,
    tags: canonicalTagList(clips.flatMap((c) => c.tags)),
  };
}
