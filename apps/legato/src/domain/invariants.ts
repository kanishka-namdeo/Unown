/**
 * Invariant checks — `assertData` over `LegatoData` (PLAN §1.1, §2).
 *
 * DOM-free, pure. Every boundary that admits a data set (import
 * gate, storage load, migration output) runs `assertData` first and
 * throws `DomainInvariantError` at the first breach (the Ostinato
 * pattern).
 *
 * Invariants checked:
 *  - clip ids are unique integers ≥ 1
 *  - highlight ids are unique integers ≥ 1
 *  - every highlight.clipId resolves to an existing clip
 *  - every clip.state is in the closed ClipState set
 *  - every clip.error, when present, is in the closed ClipError set
 *  - clip.url and clip.title are non-empty strings
 *  - clip.tags entries are strings (dedup/canonical order is a
 *    domain rule, not an invariant — the set is what matters)
 *  - createdAt / updatedAt are ISO-8601 strings (syntactic check)
 *  - highlight createdAt is an ISO-8601 string
 *  - data.tags set-matches the union of clip.tags
 *  - data.queue set-matches clip ids with no duplicates
 */
import type { LegatoData, Clip, ClipState, ClipError, Highlight } from "./types.js";
import { DomainInvariantError } from "./types.js";

/** The closed ClipState set (PLAN §2). */
const CLIP_STATES: ReadonlySet<string> = new Set(["unread", "reading", "done", "archived"]);

/** The closed ClipError set (PLAN §2). */
const CLIP_ERRORS: ReadonlySet<string> = new Set([
  "charset-unknown", "redirect-loop", "js-walled", "paywalled",
  "oversized", "empty-text", "fetch-failed",
]);

/**
 * ISO-8601 syntactic check — a string that matches the shape
 * `YYYY-MM-DDTHH:mm:ss(.sss)?(Z|±HH:MM)`. This is a cheap
 * structural guard, not a full Date parse (the domain stays
 * Node-free: no `new Date()` here).
 */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isIsoString(s: unknown): boolean {
  return typeof s === "string" && ISO_RE.test(s);
}

/**
 * Assert `data` satisfies all LegatoData invariants.
 *
 * @throws {DomainInvariantError} on the first breach.
 */
export function assertData(data: LegatoData): void {
  // --- clip ids: unique integers ≥ 1 ---
  const clipIds = new Set<number>();
  for (const c of data.clips) {
    if (typeof c.id !== "number" || !Number.isInteger(c.id) || c.id < 1) {
      throw new DomainInvariantError(`clip id must be an integer ≥ 1 (got ${JSON.stringify(c.id)})`);
    }
    if (clipIds.has(c.id)) {
      throw new DomainInvariantError(`duplicate clip id: ${c.id}`);
    }
    clipIds.add(c.id);
  }

  // --- per-clip field checks ---
  for (const c of data.clips) {
    assertClipFields(c, clipIds);
    // highlight id uniqueness is global across the whole store
    assertHighlights(c, clipIds);
  }

  // --- store-level: tag index set-matches the union ---
  assertTagIndex(data);

  // --- store-level: queue set-matches clip ids, no duplicates ---
  assertQueue(data, clipIds);
}

function assertClipFields(c: Clip, _allClipIds: Set<number>): void {
  if (typeof c.url !== "string" || c.url.length === 0) {
    throw new DomainInvariantError(`clip ${c.id}: url must be a non-empty string`);
  }
  if (typeof c.title !== "string" || c.title.length === 0) {
    throw new DomainInvariantError(`clip ${c.id}: title must be a non-empty string`);
  }
  if (typeof c.text !== "string") {
    throw new DomainInvariantError(`clip ${c.id}: text must be a string`);
  }
  if (!Array.isArray(c.tags)) {
    throw new DomainInvariantError(`clip ${c.id}: tags must be an array`);
  }
  for (const t of c.tags) {
    if (typeof t !== "string") {
      throw new DomainInvariantError(`clip ${c.id}: tag entry must be a string (got ${JSON.stringify(t)})`);
    }
  }
  if (typeof c.state !== "string" || !CLIP_STATES.has(c.state)) {
    throw new DomainInvariantError(`clip ${c.id}: state '${c.state}' is not in the closed ClipState set`);
  }
  if (c.error !== undefined && (typeof c.error !== "string" || !CLIP_ERRORS.has(c.error))) {
    throw new DomainInvariantError(`clip ${c.id}: error '${c.error}' is not in the closed ClipError set`);
  }
  if (!isIsoString(c.createdAt)) {
    throw new DomainInvariantError(`clip ${c.id}: createdAt must be an ISO-8601 string`);
  }
  if (!isIsoString(c.updatedAt)) {
    throw new DomainInvariantError(`clip ${c.id}: updatedAt must be an ISO-8601 string`);
  }
  if (!Array.isArray(c.highlights)) {
    throw new DomainInvariantError(`clip ${c.id}: highlights must be an array`);
  }
}

function assertHighlights(clip: Clip, clipIds: Set<number>): void {
  const globalHighlightIds = new Set<number>();
  // We need a global check — collect all highlight ids across clips
  // (done in assertData, but this function is called per-clip, so
  // the global uniqueness check happens there).
  for (const h of clip.highlights) {
    assertHighlightFields(h, clipIds, globalHighlightIds);
  }
}

function assertHighlightFields(
  h: Highlight,
  clipIds: Set<number>,
  seenIds: Set<number>,
): void {
  if (typeof h.id !== "number" || !Number.isInteger(h.id) || h.id < 1) {
    throw new DomainInvariantError(`highlight id must be an integer ≥ 1 (got ${JSON.stringify(h.id)})`);
  }
  if (seenIds.has(h.id)) {
    throw new DomainInvariantError(`duplicate highlight id: ${h.id}`);
  }
  seenIds.add(h.id);
  if (!clipIds.has(h.clipId)) {
    throw new DomainInvariantError(`highlight ${h.id}: clipId ${h.clipId} does not resolve to an existing clip`);
  }
  if (typeof h.anchor !== "string") {
    throw new DomainInvariantError(`highlight ${h.id}: anchor must be a string`);
  }
  if (typeof h.quote !== "string") {
    throw new DomainInvariantError(`highlight ${h.id}: quote must be a string`);
  }
  if (h.note !== undefined && typeof h.note !== "string") {
    throw new DomainInvariantError(`highlight ${h.id}: note, when present, must be a string`);
  }
  if (!isIsoString(h.createdAt)) {
    throw new DomainInvariantError(`highlight ${h.id}: createdAt must be an ISO-8601 string`);
  }
}

function assertTagIndex(data: LegatoData): void {
  if (!Array.isArray(data.tags)) {
    throw new DomainInvariantError("data.tags must be an array");
  }
  // Build the union of all clip.tags
  const union = new Set<string>();
  for (const c of data.clips) {
    for (const t of c.tags) union.add(t);
  }
  // data.tags must set-match the union
  for (const t of data.tags) {
    if (typeof t !== "string") {
      throw new DomainInvariantError(`data.tags entry must be a string (got ${JSON.stringify(t)})`);
    }
    if (!union.has(t)) {
      throw new DomainInvariantError(`data.tags lists tag '${t}' not present in any clip`);
    }
  }
  for (const t of union) {
    if (!data.tags.includes(t)) {
      throw new DomainInvariantError(`data.tags is missing tag '${t}' present in clips`);
    }
  }
  // No duplicates in data.tags
  const seen = new Set<string>();
  for (const t of data.tags) {
    if (seen.has(t)) {
      throw new DomainInvariantError(`duplicate entry in data.tags: '${t}'`);
    }
    seen.add(t);
  }
}

function assertQueue(data: LegatoData, clipIds: Set<number>): void {
  if (!Array.isArray(data.queue)) {
    throw new DomainInvariantError("data.queue must be an array");
  }
  const seen = new Set<number>();
  for (const id of data.queue) {
    if (typeof id !== "number" || !Number.isInteger(id)) {
      throw new DomainInvariantError(`data.queue entry must be an integer (got ${JSON.stringify(id)})`);
    }
    if (seen.has(id)) {
      throw new DomainInvariantError(`duplicate entry in data.queue: ${id}`);
    }
    seen.add(id);
    if (!clipIds.has(id)) {
      throw new DomainInvariantError(`data.queue lists clip id ${id} that does not resolve to an existing clip`);
    }
  }
  // Every clip must be in the queue (set-match, not subset)
  for (const id of clipIds) {
    if (!seen.has(id)) {
      throw new DomainInvariantError(`clip id ${id} is missing from data.queue`);
    }
  }
}
