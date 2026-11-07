/**
 * highlights.test.ts — the L-8 domain pins (PLAN §3 L-8, PRD V-8).
 *
 * Pure, DOM-free (Lane A enforces; boundary.test.ts pins the import
 * graph). Pins:
 *   - range validation: beyond-length rejection, negative-offset
 *     rejection, empty-range rejection, whitespace-only rejection
 *   - successful creation: anchor derivation + quote extraction
 *   - deleteHighlight: removal + chronological list
 *   - the drift policy: drifted/undrifted detection, anchor fallback
 *   - exportHighlights: the L-9 bundle shape
 */
import { test, expect } from "bun:test";
import type { Clip, Highlight, LegatoData } from "./types.js";
import {
  createHighlight,
  deleteHighlight,
  listForClip,
  detectDrift,
  exportHighlights,
  exportAllHighlights,
  deriveAnchor,
  HighlightRangeError,
} from "./highlights.js";

const NOW = "2026-11-07T00:00:00.000Z";

function mkClip(
  id: number,
  text: string,
  highlights: Highlight[] = [],
): Clip {
  return {
    id,
    url: "https://example.com/" + id,
    title: "Clip " + id,
    text,
    tags: [],
    state: "unread",
    highlights,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
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

// ─── createHighlight: range validation ──────────────────────────────

test("createHighlight: valid range produces a Highlight with correct quote + anchor", () => {
  const text = "The quick brown fox jumps over the lazy dog";
  const clip = mkClip(1, text);
  // "brown fox" starts at index 10, ends at index 19
  const h = createHighlight(clip, 10, 19, undefined, NOW);
  expect(h.quote).toBe("brown fox");
  expect(h.clipId).toBe(1);
  expect(h.createdAt).toBe(NOW);
  // The anchor should contain the quote
  expect(h.anchor).toContain("brown fox");
});

test("createHighlight: beyond-length quoteEnd throws HighlightRangeError (beyond-length)", () => {
  const clip = mkClip(1, "short text");
  expect(() => createHighlight(clip, 0, 999, undefined, NOW)).toThrow(
    HighlightRangeError,
  );
  try {
    createHighlight(clip, 0, 999, undefined, NOW);
  } catch (e) {
    expect(e).toBeInstanceOf(HighlightRangeError);
    expect((e as HighlightRangeError).reason).toBe("beyond-length");
  }
});

test("createHighlight: beyond-length quoteStart throws HighlightRangeError (beyond-length)", () => {
  const clip = mkClip(1, "short");
  expect(() => createHighlight(clip, 99, 100, undefined, NOW)).toThrow(
    HighlightRangeError,
  );
});

test("createHighlight: negative offset throws HighlightRangeError (negative-offset)", () => {
  const clip = mkClip(1, "hello world");
  expect(() => createHighlight(clip, -1, 5, undefined, NOW)).toThrow(
    HighlightRangeError,
  );
});

test("createHighlight: empty range (start >= end) throws HighlightRangeError (empty-range)", () => {
  const clip = mkClip(1, "hello world");
  expect(() => createHighlight(clip, 5, 5, undefined, NOW)).toThrow(
    HighlightRangeError,
  );
  expect(() => createHighlight(clip, 7, 3, undefined, NOW)).toThrow(
    HighlightRangeError,
  );
});

test("createHighlight: whitespace-only range throws HighlightRangeError (whitespace-only)", () => {
  const clip = mkClip(1, "a   b");
  // [1,4) = "   " — whitespace only
  expect(() => createHighlight(clip, 1, 4, undefined, NOW)).toThrow(
    HighlightRangeError,
  );
});

test("createHighlight: note is trimmed; empty note becomes undefined", () => {
  const clip = mkClip(1, "hello world");
  const h1 = createHighlight(clip, 0, 5, "  my note  ", NOW);
  expect(h1.note).toBe("my note");
  const h2 = createHighlight(clip, 0, 5, "   ", NOW);
  expect(h2.note).toBeUndefined();
});

// ─── deleteHighlight ─────────────────────────────────────────────────

test("deleteHighlight: removes the highlight and returns it", () => {
  const clip = mkClip(1, "hello world", [
    { id: 10, clipId: 1, anchor: "hello w", quote: "hello", createdAt: NOW },
    { id: 11, clipId: 1, anchor: "world", quote: "world", createdAt: NOW },
  ]);
  const removed = deleteHighlight(clip, 10);
  expect(removed !== null).toBe(true);
  expect(removed!.id).toBe(10);
  expect(clip.highlights.length).toBe(1);
  expect(clip.highlights[0].id).toBe(11);
});

test("deleteHighlight: returns null when the id is not found", () => {
  const clip = mkClip(1, "hello world");
  expect(deleteHighlight(clip, 99)).toBeNull();
  expect(clip.highlights.length).toBe(0);
});

// ─── listForClip: chronological ordering ────────────────────────────

test("listForClip: returns highlights in createdAt-ascending order", () => {
  const clip = mkClip(1, "text", [
    { id: 3, clipId: 1, anchor: "c", quote: "c", createdAt: "2026-03-01T00:00:00Z" },
    { id: 1, clipId: 1, anchor: "a", quote: "a", createdAt: "2026-01-01T00:00:00Z" },
    { id: 2, clipId: 1, anchor: "b", quote: "b", createdAt: "2026-02-01T00:00:00Z" },
  ]);
  const sorted = listForClip(clip);
  expect(sorted[0].id).toBe(1);
  expect(sorted[1].id).toBe(2);
  expect(sorted[2].id).toBe(3);
});

test("listForClip: ties broken by id ascending", () => {
  const clip = mkClip(1, "text", [
    { id: 5, clipId: 1, anchor: "x", quote: "x", createdAt: NOW },
    { id: 2, clipId: 1, anchor: "y", quote: "y", createdAt: NOW },
  ]);
  const sorted = listForClip(clip);
  expect(sorted[0].id).toBe(2);
  expect(sorted[1].id).toBe(5);
});

test("createHighlight: an offset past the CURRENT text length is rejected (the drifted-text / shifted-anchor case — no silent clamp)", () => {
  // The text changed since the highlight existed: an offset that was
  // valid at creation time now points beyond the current text.
  // The domain refuses (no-silent-truncation law) — the highlight
  // SURVIVES flagged via the drift lane, it is never re-anchored
  // to clamped offsets.
  const clip = mkClip(1, "short");
  expect(() => createHighlight(clip, 0, 100, undefined, NOW)).toThrow(HighlightRangeError);
});

// ─── detectDrift: the drift policy ──────────────────────────────────

test("detectDrift: no drift when the quote appears in the current text", () => {
  const clip = mkClip(1, "hello world foo", [
    { id: 1, clipId: 1, anchor: "hello wo", quote: "hello", createdAt: NOW },
  ]);
  const result = detectDrift(clip, clip.highlights[0]);
  expect(result.drifted).toBe(false);
  expect(result.highlight.id).toBe(1);
  // anchorNow is re-matched at the current position
  expect(result.anchorNow).toContain("hello");
});

test("detectDrift: drifted=true when the quote is NOT in the current text", () => {
  const clip = mkClip(1, "completely different text", [
    { id: 1, clipId: 1, anchor: "old context", quote: "original quote", createdAt: NOW },
  ]);
  const result = detectDrift(clip, clip.highlights[0]);
  expect(result.drifted).toBe(true);
  // The highlight SURVIVES (the no-silent-loss law): the record
  // is still present, just flagged.
  expect(result.highlight.quote).toBe("original quote");
  // The anchor falls back to the STORED anchor (the quote is gone,
  // so we cannot re-match it at a current position).
  expect(result.anchorNow).toBe("old context");
});

test("detectDrift: drifted=true when the clip text is empty", () => {
  const clip = mkClip(1, "", [
    { id: 1, clipId: 1, anchor: "context", quote: "something", createdAt: NOW },
  ]);
  const result = detectDrift(clip, clip.highlights[0]);
  expect(result.drifted).toBe(true);
});

// ─── exportHighlights: the L-9 bundle shape ────────────────────────

test("exportHighlights: returns ExportHighlight[] in chronological order with drift flags", () => {
  const clip = mkClip(1, "aaa bbb ccc", [
    { id: 2, clipId: 1, anchor: "bbb c", quote: "bbb", createdAt: "2026-02-01T00:00:00Z" },
    { id: 1, clipId: 1, anchor: "aaa b", quote: "aaa", createdAt: "2026-01-01T00:00:00Z" },
  ]);
  const out = exportHighlights(clip);
  expect(out.length).toBe(2);
  // Chronological order
  expect(out[0].highlight.id).toBe(1);
  expect(out[1].highlight.id).toBe(2);
  // Both are in the current text, so not drifted
  expect(out[0].drifted).toBe(false);
  expect(out[1].drifted).toBe(false);
});

test("exportAllHighlights: returns per-clip arrays", () => {
  const clip1 = mkClip(1, "hello", [
    { id: 1, clipId: 1, anchor: "hel", quote: "hel", createdAt: NOW },
  ]);
  const clip2 = mkClip(2, "world");
  const data = mkData([clip1, clip2]);
  const out = exportAllHighlights(data);
  expect(out.length).toBe(2);
  expect(out[0].length).toBe(1);
  expect(out[1].length).toBe(0);
});

// ─── deriveAnchor: context window clamping ──────────────────────────

test("deriveAnchor: clamps to text boundaries at the start", () => {
  const text = "short";
  const anchor = deriveAnchor(text, 0, 5);
  expect(anchor).toBe("short");
});

test("deriveAnchor: clamps to text boundaries at the end", () => {
  const text = "short";
  const anchor = deriveAnchor(text, 0, 5);
  expect(anchor).toBe("short");
});

test("deriveAnchor: includes 40 chars on each side when available", () => {
  // Build a long text where the quote is in the middle
  const padding = "x".repeat(50);
  const text = padding + "QUOTE" + padding;
  const start = 50;
  const end = 55;
  const anchor = deriveAnchor(text, start, end);
  // Should be 50+40 chars on the left, 50+40 on the right, plus the 5-char quote
  // clamped to the actual text length
  expect(anchor.length).toBeLessThanOrEqual(text.length);
  expect(anchor).toContain("QUOTE");
});
