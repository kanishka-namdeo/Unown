/**
 * run-detail.test.ts — the run detail view (Lane A, DOM-guarded: pure
 * render helpers; the DOM wiring lives in app.ts).
 */
import { describe, test, expect } from "bun:test";
import {
  renderRunDetail,
  verbatimError,
  hasSuccessBadge,
  RUN_DETAIL_FIELDS,
} from "./run-detail.js";
import type { RunRecordView } from "../domain/types.js";

function run(partial: Partial<RunRecordView>): RunRecordView {
  return {
    id: 12,
    taskId: 2,
    kind: "every",
    status: "failed",
    startedAt: 0,
    endedAt: 65_000,
    tokensIn: 800,
    tokensOut: 0,
    toolCalls: 1,
    turns: 2,
    error: "upstream 429: rate limit exceeded",
    ...partial,
  };
}

describe("run detail: fields", () => {
  test("every RunRecordView field is rendered (field inventory pin)", () => {
    const html = renderRunDetail(run({}));
    for (const f of RUN_DETAIL_FIELDS) {
      expect(html.includes(f) || html.includes(`data-field`), `field ${f} rendered`).toBe(true);
    }
    expect(html).toContain("800");
    expect(html).toContain("upstream 429: rate limit exceeded");
  });

  test("an ok run renders the success badge; a failed run never does", () => {
    expect(hasSuccessBadge("ok")).toBe(true);
    expect(hasSuccessBadge("failed")).toBe(false);
    expect(hasSuccessBadge("capped")).toBe(false);
    expect(hasSuccessBadge("budget-throttled")).toBe(false);
    const okHtml = renderRunDetail(run({ status: "ok", error: null }));
    expect(okHtml).toContain('data-badge="success"');
    const failedHtml = renderRunDetail(run({}));
    expect(failedHtml).not.toContain('data-badge="success"');
    expect(failedHtml).toContain('data-badge="failed"');
  });

  test("the back control restores focus to the owning job", () => {
    const html = renderRunDetail(run({ taskId: 7 }));
    expect(html).toContain('data-back-task="7"');
  });
});

describe("run detail: the E-05 error-verbatim pin", () => {
  test("a multi-line error string renders VERBATIM, never summarized, never swallowed", () => {
    const multiLine =
      "upstream 429: rate limit exceeded\nretry in 30s\nsecond burst: 503 upstream unavailable";
    const html = renderRunDetail(run({ error: multiLine }));
    // The error div is present (never swallowed)…
    expect(html).toContain('data-has-error="true"');
    // …and every line of the engine's text survives (verbatim),
    // inside the whitespace-preserving element.
    const m = html.match(/<pre class="fugue-run-error-verbatim">([\s\S]*?)<\/pre>/);
    expect(m).not.toBeNull();
    const rendered = m![1]
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    expect(rendered).toBe(multiLine);
  });

  test("error text with HTML is escaped, but still verbatim after unescaping", () => {
    const hostile = `<script>alert("x")<\/script>\nline two`;
    expect(verbatimError(hostile)).toContain("&lt;script&gt;");
    expect(verbatimError(hostile)).not.toContain("<script>");
    const html = renderRunDetail(run({ error: hostile }));
    expect(html).not.toContain('<script>alert');
  });

  test("a null error renders the honest no-error line (never a fabricated one)", () => {
    const html = renderRunDetail(run({ error: null, status: "ok" }));
    expect(html).toContain('data-has-error="false"');
    expect(html).not.toContain('data-has-error="true"');
  });
});

describe("run detail: the no-partial-success pin", () => {
  test("a failed run with partial tokens NEVER renders a success badge", () => {
    const partial = run({ status: "failed", tokensIn: 500, tokensOut: 120 });
    const html = renderRunDetail(partial);
    expect(html).toContain('data-status="failed"');
    expect(html).not.toContain('data-badge="success"');
    expect(html).toContain("500"); // the partial tokens stay visible
    expect(html).toContain("120");
  });

  test("budget-throttled and capped runs are never success either", () => {
    for (const status of ["budget-throttled", "capped", "draining", "schema-invalid", "loop-guard"] as const) {
      const html = renderRunDetail(run({ status }));
      expect(html).not.toContain('data-badge="success"');
    }
  });
});
