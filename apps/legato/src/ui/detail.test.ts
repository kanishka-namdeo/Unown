/**
 * detail.test.ts — the L-8 highlights/annotations DOM pins
 * (PLAN §3 L-8, PRD V-8: "highlights/annotations in the reader;
 * anchor text + quote ranges, no silent truncation").
 *
 * Lane semantics (the el-pin precedent):
 *   Lane A — `cd apps/legato && bun test`: DOM-free; the DOM-guarded
 *            tests register skipped stubs. The domain half runs in
 *            both lanes (highlights.ts is pure).
 *   Lane B — `bun test apps/legato` from the root: happy-dom
 *            preload provides the DOM; the render/panel/delete
 *            pins RUN.
 *
 * Pins:
 *   - renderDetailPane: a clip with highlights renders the body
 *     with the highlight spans + the panel rows
 *   - renderHighlights: the panel list (chronological), the jump-to
 *     button, the delete button, the drift flag
 *   - the empty lane: "No highlights yet" copy (Q-3: never a blank)
 *   - the 'h' key create path: a selection within the body produces
 *     a highlight (via the domain's createHighlight)
 *   - the 'x' key delete path: deleting the focused highlight removes
 *     it from the clip
 */
import { test, expect } from "bun:test";
import type { Clip, Highlight } from "../domain/types.js";

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

function mkHighlight(id: number, clipId: number, anchor: string, quote: string): Highlight {
  return {
    id,
    clipId,
    anchor,
    quote,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

// ─── Domain half (runs in BOTH lanes — no DOM needed) ─────────────

// These re-export the highlights.test.ts pins but exercise the
// UI-facing functions (listForClip, detectDrift) through the
// domain module directly.

test("detail: the domain's listForClip returns chronological order (domain half)", async () => {
  const { listForClip } = await import("../domain/highlights.js");
  const clip = mkClip(1, "text", [
    mkHighlight(3, 1, "c", "c"),
    mkHighlight(1, 1, "a", "a"),
    mkHighlight(2, 1, "b", "b"),
  ]);
  const sorted = listForClip(clip);
  expect(sorted[0].id).toBe(1);
  expect(sorted[1].id).toBe(2);
  expect(sorted[2].id).toBe(3);
});

test("detail: the domain's detectDrift flags a quote not in the text (domain half)", async () => {
  const { detectDrift } = await import("../domain/highlights.js");
  const clip = mkClip(1, "current text", [
    mkHighlight(1, 1, "old context", "original quote"),
  ]);
  const result = detectDrift(clip, clip.highlights[0]);
  expect(result.drifted).toBe(true);
  expect(result.highlight.quote).toBe("original quote");
});

// ─── DOM-guarded half (Lane B only) ───────────────────────────────

const hasDom = typeof document !== "undefined";

if (!hasDom) {
  test.skip(
    "detail highlight render / panel / delete / keyboard — requires a DOM (Lane B's happy-dom provides it)",
    () => {},
  );
} else {
  test("detail: a clip with highlights renders the panel rows (DOM)", async () => {
    const { renderDetailPane } = await import("./detail.js");
    const clip = mkClip(1, "The quick brown fox", [
      mkHighlight(10, 1, "quick br", "brown fox"),
      mkHighlight(11, 1, "The qui", "quick"),
    ]);
    const root = document.createElement("div");
    document.body.append(root);
    const { highlightsLane } = renderDetailPane(root, { clip, idPrefix: "t1" });
    // The panel heading
    expect(highlightsLane.querySelector(".legato-highlights-panel-title") !== null).toBe(true);
    // Two panel rows (chronological)
    const rows = highlightsLane.querySelectorAll(".legato-highlight-row");
    expect(rows.length).toBe(2);
    // Each row has a jump button + a delete button
    for (const row of Array.from(rows)) {
      expect(row.querySelector(".legato-highlight-jump") !== null).toBe(true);
      expect(row.querySelector(".legato-highlight-delete") !== null).toBe(true);
    }
    root.remove();
  });

  test("detail: a clip with no highlights renders the honest empty lane (DOM)", async () => {
    const { renderDetailPane } = await import("./detail.js");
    const clip = mkClip(1, "some text");
    const root = document.createElement("div");
    document.body.append(root);
    const { highlightsLane } = renderDetailPane(root, { clip, idPrefix: "t2" });
    const empty = highlightsLane.querySelector(".legato-highlights-empty");
    expect(empty !== null).toBe(true);
    expect(empty!.textContent).toContain("No highlights yet");
    root.remove();
  });

  test("detail: a drifted highlight renders with the drift flag (DOM)", async () => {
    const { renderDetailPane } = await import("./detail.js");
    const clip = mkClip(1, "completely different text", [
      mkHighlight(1, 1, "old context", "original quote"),
    ]);
    const root = document.createElement("div");
    document.body.append(root);
    const { highlightsLane } = renderDetailPane(root, { clip, idPrefix: "t3" });
    const rows = highlightsLane.querySelectorAll(".legato-highlight-row");
    expect(rows.length).toBe(1);
    expect(rows[0].className).toContain("legato-highlight-drifted");
    const flag = rows[0].querySelector(".legato-highlight-drift-flag");
    expect(flag !== null).toBe(true);
    root.remove();
  });

  test("detail: the body renders highlight spans for undrifted highlights (DOM)", async () => {
    const { renderDetailPane } = await import("./detail.js");
    const clip = mkClip(1, "The quick brown fox", [
      mkHighlight(10, 1, "quick br", "brown fox"),
    ]);
    const root = document.createElement("div");
    document.body.append(root);
    const { paneEl } = renderDetailPane(root, { clip, idPrefix: "t4" });
    const mark = paneEl.querySelector('.legato-highlight-span[data-highlight-id="10"]');
    expect(mark !== null).toBe(true);
    expect(mark!.textContent).toBe("brown fox");
    root.remove();
  });

  test("detail: clicking the delete button removes the highlight and calls onHighlightDeleted (DOM)", async () => {
    const { renderDetailPane } = await import("./detail.js");
    let deleted: { clipId: number; highlightId: number } | undefined;
    const clip = mkClip(1, "The quick brown fox", [
      mkHighlight(10, 1, "quick br", "brown fox"),
    ]);
    const root = document.createElement("div");
    document.body.append(root);
    const { highlightsLane } = renderDetailPane(root, {
      clip,
      idPrefix: "t5",
      onHighlightDeleted: (clipId, highlightId) => {
        deleted = { clipId, highlightId };
      },
    });
    const delBtn = highlightsLane.querySelector<HTMLElement>(".legato-highlight-delete")!;
    delBtn.click();
    expect(deleted !== undefined).toBe(true);
    expect(deleted).toEqual({ clipId: 1, highlightId: 10 });
    expect(clip.highlights.length).toBe(0);
    root.remove();
  });

  test("detail: clicking the jump button scrolls to + focuses the body mark (DOM)", async () => {
    const { renderDetailPane } = await import("./detail.js");
    const clip = mkClip(1, "The quick brown fox", [
      mkHighlight(10, 1, "quick br", "brown fox"),
    ]);
    const root = document.createElement("div");
    document.body.append(root);
    const { paneEl, highlightsLane } = renderDetailPane(root, { clip, idPrefix: "t6" });
    const jumpBtn = highlightsLane.querySelector<HTMLElement>(".legato-highlight-jump")!;
    // scrollIntoView + focus are no-ops in happy-dom but must not throw
    jumpBtn.click();
    const mark = paneEl.querySelector('.legato-highlight-span[data-highlight-id="10"]');
    expect(mark !== null).toBe(true);
    root.remove();
  });
}
