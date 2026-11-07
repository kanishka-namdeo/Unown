/**
 * Legato domain types — the `legato.v1` grammar, declared ONCE here
 * (PLAN §1.1, §2). DOM-free + Node-free (the Ostinato law): plain JSON
 * at every level, no class instances, no Date objects; timestamps are
 * ISO-8601 strings.
 *
 * Both hosts import this module — the clip pipeline seam
 * (`src/pipeline/`) and the storage seam (`src/storage/`). The
 * closed enum sets are frozen: no widening without a schema bump
 * (PLAN §2).
 */

/**
 * One read-later clip — a URL clipped to a clean readable copy
 * (PLAN §2 "The full Clip record shape").
 */
export type Clip = {
  /** deterministic integer id (ids.ts) */
  id: number;
  /** the URL as clipped (non-empty) */
  url: string;
  /** set when the fetch followed redirects */
  finalUrl?: string;
  /** non-empty (fallback: host name) */
  title: string;
  /** extracted readable body (≤ cap — L-3 law: 500 KB) */
  text: string;
  /** paywall lane: the clipable excerpt */
  excerpt?: string;
  /** true → text is excerpt-only, link preserved */
  paywallExcerptOnly?: boolean;
  /** true → readable text empty; title+URL fallback */
  emptyText?: boolean;
  /** true → 403/429 / empty-but-200 JS wall; fallback lane + "open in browser" affordance */
  jsWalled?: boolean;
  /** canonical order, deduped */
  tags: string[];
  /** the queue's four-state machine (L-6) */
  state: ClipState;
  highlights: Highlight[];
  /** ISO-8601 */
  createdAt: string;
  /** ISO-8601 */
  updatedAt: string;
  /** closed ClipError set, only on failed / degraded clips */
  error?: ClipError;
};

/**
 * The queue's four-state machine (L-6). Closed set — transitions are
 * a table, not freeform (PLAN §2).
 */
export type ClipState = "unread" | "reading" | "done" | "archived";

/**
 * The seven-entry error taxonomy (PLAN §2, §4.1 T-1..T-7). Closed
 * set; declared 1:1 against the pipeline's fetch/extract failures
 * (error-taxonomy.ts, L-3).
 */
export type ClipError =
  | "charset-unknown"   // undecodable / unknown charset → error clip, never mojibake
  | "redirect-loop"     // redirect chain that cycles → no infinite follow
  | "js-walled"         // 403/429 / empty-but-200 JS wall → FALLBACK lane, never bypass
  | "paywalled"         // clip the excerpt + link, never bypass
  | "oversized"         // 500 KB extract cap → retained first-N-KB prefix
  | "empty-text"        // readable text empty (non-walled) → title+URL fallback
  | "fetch-failed";     // network failure / fetch cap → error clip, never a silent hang

/**
 * A highlight within a clip (PLAN §2): anchor text + quote range.
 * The reader annotation UI (L-8) renders these; the domain keeps the
 * shape only.
 */
export type Highlight = {
  /** deterministic integer id (ids.ts, "highlight" allocation) */
  id: number;
  /** the owning clip; must resolve to a Clip.id in the store */
  clipId: number;
  /** the surrounding text that anchors the quote */
  anchor: string;
  /** the quoted range itself */
  quote: string;
  /** optional free-text note */
  note?: string;
  /** ISO-8601 */
  createdAt: string;
};

/**
 * The full Legato data set — the store schema v1 (PLAN §2). Plain
 * JSON at every level; this IS the import/export wire shape and the
 * persistence shape (byte-stable export, L-9).
 */
export type LegatoData = {
  /** the schema tag — the import gate refuses any value other than
   *  "legato.v1" (including a future legato.v2). */
  schema: "legato.v1";
  /** IDB object-store schema version; the v1→v2-with-data migration
   *  frame is L-2's deliverable (migration.ts). */
  schemaVersion: 1;
  /** insertion order is state */
  clips: Clip[];
  /** the tag index: every distinct tag across all clips, in
   *  canonical order. Must set-match the union of clip.tags. */
  tags: string[];
  /** reading order — clip ids, array order IS state (PLAN §2). Must
   *  set-match clip ids with no duplicates. */
  queue: number[];
};

/**
 * Guard-failure error (the Ostinato precedent). Every boundary that
 * admits a data set runs `assertData` first; any invariant breach
 * throws this.
 */
export class DomainInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainInvariantError";
  }
}

/**
 * The typed quota-class error the storage seam throws when a save
 * fails for quota reasons (S-2). The FakeStorage test hook injects
 * this deterministically; the real IDB adapter maps the native
 * quota-exceeded DOMException to it.
 */
export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

/**
 * The typed error the migration frame throws when it encounters an
 * unknown or future `schemaVersion` (the L-2 pin: unknown version →
 * typed refusal, never a silent pass-through).
 */
export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}
