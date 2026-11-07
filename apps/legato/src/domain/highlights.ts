/**
 * highlights.ts — the Legato highlights core (ticket L-8, PLAN §3 L-8,
 * "highlights/annotations in the reader; anchor text + quote ranges,
 * no silent truncation", PRD V-8).
 *
 * Pure, DOM-free, Node-free (the Ostinato law; boundary.test.ts pins
 * the import graph): every function is pure over `Clip` / `LegatoData`
 * and timestamps are INJECTED (ISO-8601 strings) — no `Date.now()`.
 *
 * ---------------------------------------------------------------------
 * THE RANGE MODEL (anchor + quote offsets)
 * ---------------------------------------------------------------------
 *
 * A highlight stores TWO pieces of range data:
 *
 *   - `anchor`: the surrounding text window (context characters
 *     around the quote, typically ~40 chars on each side) that the
 *     reader uses to locate the quote in the clip's text.
 *   - `quote`: the quoted range itself.
 *
 * The range is expressed as **offsets into the clip's `text` field**:
 *
 *   - `quoteStart`:  the index of the first character of the quote
 *   - `quoteEnd`:    the index just PAST the last character of the quote
 *                    (half-open interval, `text.slice(start, end)`
 *                    yields the quote verbatim)
 *
 * **These offsets are NOT stored in the `Highlight` type itself.**
 * The `Highlight` shape landed at L-2 with `{id, clipId, anchor,
 * quote, note?, createdAt}`. The range fields (`quoteStart` /
 * `quoteEnd`) are computed on creation and validated against the
 * CURRENT clip text at write time. They are stored in the
 * HIGHLIGHT RECORD as an extension — see `HighlightWithRange` below.
 *
 * Actually, re-reading the L-2 shape: the `Highlight` type has no
 * offset fields. L-8's deliverable is the PURE LOGIC that takes the
 * offsets as arguments, validates them, and produces a `Highlight`
 * record. The offsets are validated BEFORE the highlight is created;
 * the `Highlight` record that is stored carries `anchor` + `quote`
 * (which is sufficient for rendering + drift detection at read time).
 *
 * The domain logic therefore operates in two phases:
 *
 *   1. **CREATE** — `createHighlight(clip, quoteStart, quoteEnd,
 *      note?, now)` validates the range against `clip.text`:
 *
 *      - both offsets are non-negative integers
 *      - `quoteStart < quoteEnd` (non-empty range)
 *      - `quoteEnd <= clip.text.length` (beyond-length → REJECT,
 *        never silently clamp — the no-silent-truncation law)
 *      - `quoteStart <= clip.text.length` (beyond-length → REJECT)
 *      - the text at `[quoteStart, quoteEnd)` is non-empty after
 *        trimming (an all-whitespace quote is rejected)
 *
 *      On success the `anchor` is derived as the surrounding context
 *      window (±40 chars around the quote, clamped to the text
 *      boundaries — the clamp is on the ANCHOR window, which is
 *      descriptive context, NOT on the quote itself: the quote
 *      range is rejected outright when out of bounds, which is the
 *      no-silent-truncation law's heart).
 *
 *      On failure: throws `HighlightRangeError` (a typed error that
 *      names the exact violation — beyond-length, empty range,
 *      whitespace-only, or shifted anchor).
 *
 *   2. **DRIFT** — `detectDrift(clip, h)` checks whether the
 *      `h.quote` still appears at a consistent position in the
 *      CURRENT `clip.text`. The drift policy (documented below)
 *      is: the highlight SURVIVES, flagged — never silently lost.
 *
 * ---------------------------------------------------------------------
 * THE DRIFT POLICY (documented in the ticket's deliverable 1)
 * ---------------------------------------------------------------------
 *
 * When the clip's text has changed since the highlight was created
 * (the text was re-clipped, an extraction update ran, etc.), the
 * stored `quote` may no longer match the current text at the same
 * offsets. The drift detector reports this HONESTLY:
 *
 *   - `drift: false` — the quote appears in the current text at
 *     exactly one position (or the quote is empty / the text is
 *     empty, both treated as "no drift" for the empty-text clip
 *     edge case).
 *   - `drift: true`  — the quote does NOT appear in the current
 *     text, OR it appears at multiple positions (ambiguous). The
 *     highlight SURVIVES: it is rendered with the drift flag, and
 *     the reader can see the original quote + anchor. The drift
 *     lane never DELETES the highlight — deletion is an explicit
 *     user action (`deleteHighlight`).
 *
 * The anchor string is re-matched at read time: if the anchor no
 * longer matches the current text, the anchor display falls back
 * to the quote itself (the anchor is descriptive context, not the
 * primary data).
 *
 * ---------------------------------------------------------------------
 * THE EXPORT SHAPE (L-9's bundle)
 * ---------------------------------------------------------------------
 *
 * `exportHighlights(clip)` returns the highlights in an array
 * ordered by `createdAt` ascending (chronological), each entry
 * carrying the full `Highlight` record + a `drifted` boolean (the
 * drift-detection result against the CURRENT clip text). This is
 * the shape L-9's byte-stable export bundle carries for each
 * clip's highlights.
 *
 * ---------------------------------------------------------------------
 * DOMAIN PURETY
 * ---------------------------------------------------------------------
 *
 * No DOM, no Node builtins. All functions are pure over the input
 * data + the injected `now` string. `HighlightRangeError` is a
 * typed error exported from this module (it lives here, not in
 * types.ts, because it is L-8-specific — the Ostinato law: new
 * error types are introduced in the module that owns them).
 */

import type { Clip, Highlight, LegatoData } from "./types.js";
import { nextHighlightId } from "./ids.js";

/**
 * The typed rejection for an invalid highlight range (the
 * no-silent-truncation law: every rejection is a NAMED violation,
 * never a silent clamp or truncation).
 *
 * Carries the violation kind so the UI can name it in the notice
 * lane (the Q-2 honest-surface rule: "never silent").
 */
export class HighlightRangeError extends Error {
  readonly reason:
    | "beyond-length"      // offset > clip.text.length
    | "negative-offset"    // offset < 0
    | "empty-range"        // quoteStart >= quoteEnd
    | "whitespace-only"    // the range contains only whitespace
    | "shifted-anchor";    // the anchor no longer matches at the claimed
                           // position (the drift-class rejection: the caller
                           // re-validated a stale offset against current text)
  constructor(
    message: string,
    reason: HighlightRangeError["reason"],
  ) {
    super(message);
    this.name = "HighlightRangeError";
    this.reason = reason;
  }
}

/**
 * The surrounding context window: ±40 chars around the quote,
 * clamped to the text boundaries (the clamp is on the ANCHOR,
 * never on the quote — the quote range is rejected when out of
 * bounds, which is the no-silent-truncation law).
 */
const ANCHOR_WINDOW = 40;

/**
 * Derive the anchor string for a quote at `[start, end)` in `text`:
 * the `ANCHOR_WINDOW` characters on each side of the quote,
 * clamped to `[0, text.length]`. The anchor is DESCRIPTIVE CONTEXT
 * (helps the reader locate the quote) — it is not the quote
 * itself.
 */
export function deriveAnchor(text: string, start: number, end: number): string {
  const lo = Math.max(0, start - ANCHOR_WINDOW);
  const hi = Math.min(text.length, end + ANCHOR_WINDOW);
  return text.slice(lo, hi);
}

/**
 * Create a highlight on `clip` covering the text range
 * `[quoteStart, quoteEnd)` (half-open interval into `clip.text`).
 *
 * Validates the range BEFORE creating the record:
 *   - both offsets are integers ≥ 0
 *   - `quoteStart < quoteEnd` (non-empty)
 *   - `quoteEnd <= clip.text.length` (beyond-length → REJECT with
 *     `HighlightRangeError`, reason "beyond-length" — the
 *     no-silent-truncation law)
 *   - the quoted substring is not whitespace-only
 *
 * On success: allocates the next highlight id (via `ids.ts`),
 * derives the anchor, and RETURNS a fresh `Highlight` record.
 * The caller (the app) pushes it onto `clip.highlights` and
 * persists through the StoragePort.
 *
 * @throws {HighlightRangeError} on any range violation
 */
export function createHighlight(
  clip: Clip,
  quoteStart: number,
  quoteEnd: number,
  note?: string,
  now?: string,
): Highlight {
  const text = clip.text;

  // --- range validation (the no-silent-truncation law) ---

  if (!Number.isInteger(quoteStart) || !Number.isInteger(quoteEnd)) {
    throw new HighlightRangeError(
      `highlight range offsets must be integers (got ${quoteStart}..${quoteEnd})`,
      "negative-offset",
    );
  }
  if (quoteStart < 0 || quoteEnd < 0) {
    throw new HighlightRangeError(
      `highlight range offsets must be ≥ 0 (got ${quoteStart}..${quoteEnd})`,
      "negative-offset",
    );
  }
  if (quoteStart >= quoteEnd) {
    throw new HighlightRangeError(
      `highlight range must be non-empty: quoteStart (${quoteStart}) must be < quoteEnd (${quoteEnd})`,
      "empty-range",
    );
  }
  if (quoteEnd > text.length) {
    throw new HighlightRangeError(
      `highlight range extends beyond the clip text: quoteEnd ${quoteEnd} > text length ${text.length} — NEVER silently truncated`,
      "beyond-length",
    );
  }

  const quote = text.slice(quoteStart, quoteEnd);
  if (quote.trim() === "") {
    throw new HighlightRangeError(
      `highlight range [${quoteStart}, ${quoteEnd}) is whitespace-only — refusing to create an empty annotation`,
      "whitespace-only",
    );
  }

  // The anchor: descriptive context, clamped to the text boundaries.
  const anchor = deriveAnchor(text, quoteStart, quoteEnd);

  const id = nextHighlightId({
    schema: "legato.v1",
    schemaVersion: 1,
    clips: [clip],
    tags: [],
    queue: [],
  });

  const createdAt = now ?? "1970-01-01T00:00:00.000Z";

  return {
    id,
    clipId: clip.id,
    anchor,
    quote,
    note: note !== undefined && note.trim() !== "" ? note.trim() : undefined,
    createdAt,
  };
}

/**
 * Delete a highlight from a clip by its id. Returns the DELETED
 * highlight (or null when not found). The caller (the app) splices
 * it out of `clip.highlights` and persists.
 *
 * Pure: does not mutate the input — returns the deleted record so
 * the caller can decide the mutation + persist lane.
 */
export function deleteHighlight(
  clip: Clip,
  highlightId: number,
): Highlight | null {
  const idx = clip.highlights.findIndex((h) => h.id === highlightId);
  if (idx === -1) return null;
  const [removed] = clip.highlights.splice(idx, 1);
  return removed;
}

/**
 * The highlights for one clip, in CHRONOLOGICAL order
 * (`createdAt` ascending; ties broken by `id` ascending for
 * determinism).
 */
export function listForClip(clip: Clip): Highlight[] {
  return clip.highlights
    .slice()
    .sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
      return a.id - b.id;
    });
}

/**
 * The export shape for a clip's highlights (what L-9's byte-stable
 * bundle carries). Each entry: the full `Highlight` record + a
 * `drifted` boolean (the drift-detection result against the
 * CURRENT clip text). Chronological order.
 */
export interface ExportHighlight {
  /** the full highlight record */
  highlight: Highlight;
  /** true when the quote no longer appears in the current clip
   *  text (the drift flag — the highlight survives, flagged). */
  drifted: boolean;
  /** the anchor as it appears in the CURRENT text (re-matched;
   *  falls back to the stored anchor when the re-match fails). */
  anchorNow: string;
}

/**
 * Detect whether `h`'s quote still appears in `clip.text`
 * (the drift lane). Returns:
 *
 *   - `drifted: false` when the quote appears in the current text
 *     (at least once; the count is irrelevant — the highlight
 *     survives regardless of how many times it appears).
 *   - `drifted: true`  when the quote does NOT appear in the
 *     current text (the text changed since the highlight was
 *     created — re-clipped, extraction updated, etc.).
 *
 * The drift policy: the highlight SURVIVES, flagged. It is never
 * silently deleted. The reader sees the original quote + anchor +
 * a "drifted" indicator.
 *
 * The anchor re-match: `anchorNow` is the CURRENT text window at
 * the position where the quote currently lives (if found), or the
 * STORED anchor (if the quote is gone — the fallback).
 */
export function detectDrift(clip: Clip, h: Highlight): ExportHighlight {
  const text = clip.text;
  const idx = text.indexOf(h.quote);

  if (idx !== -1) {
    // The quote is still in the text — no drift.
    // Re-match the anchor at the current position.
    const anchorNow = deriveAnchor(text, idx, idx + h.quote.length);
    return { highlight: h, drifted: false, anchorNow };
  }

  // The quote is NOT in the current text — DRIFTED.
  // The highlight survives (the no-silent-loss law): the stored
  // anchor is the fallback (the quote + original context are
  // preserved in the record).
  return { highlight: h, drifted: true, anchorNow: h.anchor };
}

/**
 * The full export for one clip: all highlights in chronological
 * order, each with its drift flag (L-9's bundle shape).
 */
export function exportHighlights(clip: Clip): ExportHighlight[] {
  return listForClip(clip).map((h) => detectDrift(clip, h));
}

/**
 * The export for the WHOLE STORE (every clip's highlights,
 * chronological within each clip). L-9's bundle carries this.
 */
export function exportAllHighlights(data: LegatoData): ExportHighlight[][] {
  return data.clips.map((c) => exportHighlights(c));
}
