/**
 * manual-notes.test.ts — the Manual-notes editor view's Lane A pins
 * (F-7 chunk 3): the editor render (the lane label, the textarea
 * prefill, the budget meter, the visible over-cap marker + the exact
 * dropped tail — never a silent truncate), and the E-02 honest
 * error lane (a failed read surfaces the panel, never a blank,
 * never a fabricated section).
 */
import { describe, test, expect } from "bun:test";
import {
  renderManualNotes,
  LANE_LABEL,
} from "./manual-notes.js";

describe("the Manual-notes editor render", () => {
  test("the wire row prefills the textarea; the budget meter shows chars / 4096", () => {
    const body = "- bullet A\n- bullet B";
    const html = renderManualNotes({
      wire: { section: body, chars: body.length, cap: 4096, path: ".unown/memory/project.md" },
    });
    // The lane label: hand-edited, unverified (never "written by AutoDream").
    expect(html).toContain("Manual notes — hand-edited, unverified");
    expect(html).not.toContain("written by AutoDream");
    // The textarea is prefilled with the section body (escaped).
    expect(html).toContain(`data-mn-input`);
    expect(html).toContain(escapeHtml(body));
    // The live budget meter (chars / cap, the under-cap lane).
    expect(html).toContain(`data-mn-chars="${body.length}"`);
    expect(html).toContain('data-mn-cap="4096"');
    expect(html).toContain('data-mn-over="0"');
    // The Save button (the PUT lane).
    expect(html).toContain('data-mn-save');
    // The path pin.
    expect(html).toContain(".unown/memory/project.md");
  });

  test("a draft over the cap surfaces the VISIBLE marker + the exact dropped tail (edge 11: never a silent truncate)", () => {
    const body = "x".repeat(4096) + "DROPPED";
    const html = renderManualNotes({
      wire: { section: body, chars: body.length, cap: 4096, path: ".unown/memory/project.md" },
    });
    expect(html).toContain('data-mn-over="1"');
    // The over-cap block is present with the exact marker constant
    // (the escaped form in the data attribute; the test's escape-free
    // expectation would need the double-escaped HTML entity).
    expect(html).toContain('data-mn-overcap');
    expect(html).toContain('data-marker="&lt;!-- unown: manual notes over cap --&gt;"');
    // The over-cap tail, styled distinctly (rendered inside the
    // escaped <pre>).
    expect(html).toContain("DROPPED");
    expect(html).toContain("fugue-mn-dropped-tail");
    // The meter reports the over-cap state.
    expect(html).toContain("over cap: the renderer will drop the tail");
  });

  test("the marker text renders escaped exactly once in the preview line (the visible marker)", () => {
    const body = "x".repeat(4096) + "T";
    const html = renderManualNotes({
      wire: { section: body, chars: body.length, cap: 4096, path: ".unown/memory/project.md" },
    });
    // The marker appears escaped (data attribute + the preview <code>
    // line) and never unescaped as raw HTML.
    expect(html).toContain("&lt;!-- unown: manual notes over cap --&gt;");
    expect(html).not.toContain("<!-- unown: manual notes over cap -->");
  });

  test("a draft under the cap shows no marker, no dropped tail", () => {
    const body = "short";
    const html = renderManualNotes({
      wire: { section: "", chars: 0, cap: 4096, path: ".unown/memory/project.md" },
      draft: body,
    });
    expect(html).toContain('data-mn-over="0"');
    expect(html).not.toContain("unown: manual notes over cap");
  });

  test("a load failure surfaces the E-02 honest panel (never a blank, never a substitute)", () => {
    const html = renderManualNotes({
      wire: null,
      saveError: "the /manual-notes lane rejected or failed (503)",
    });
    expect(html).toContain('data-panel="manual-notes-load-failed"');
    expect(html).toContain("the /manual-notes lane rejected or failed (503)");
    expect(html).toContain('data-route="manual-notes"');
  });

  test("a save failure is surfaced after a successful read (the draft stays editable)", () => {
    const html = renderManualNotes({
      wire: { section: "body", chars: 4, cap: 4096, path: ".unown/memory/project.md" },
      saveError: "section over 20000 chars (got 30000)",
    });
    expect(html).toContain('data-mn-save-error');
    expect(html).toContain("section over 20000 chars (got 30000)");
    // The textarea is still present (the draft is editable; the
    // failure was the save, not the read).
    expect(html).toContain('data-mn-input');
  });

  test("the lane label constant is the exact PRD wording (never 'written by AutoDream')", () => {
    expect(LANE_LABEL).toBe("Manual notes — hand-edited, unverified");
  });
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
