/**
 * dreams.test.ts — the dreams journal view pins (Lane A, DOM-free).
 *
 * Pins the view model + render helpers against the adapter-native
 * DreamRecord view (the F-7 chunk 2 type alignment): the closed
 * DreamStatus badge map (E-06: gated NEVER the success class), the
 * open-run duration ("…" on a null endedAt), the consolidation
 * ledger line, the output preview's ~200-char cap + the honest empty
 * state, and the journal's newest-first ordering (the adapter's
 * mapDreams ordering — the view renders it as given).
 */
import { describe, test, expect } from "bun:test";
import type { DreamRecord } from "../adapter/engine-adapter.js";
import {
  dreamStatusClass,
  dreamDuration,
  dreamLedger,
  dreamOutputPreview,
  renderDreamRow,
  renderDreams,
  dreamsViewModel,
  moveDreamSelection,
} from "./dreams.js";

function dream(over: Partial<DreamRecord> = {}): DreamRecord {
  return {
    id: "project-85ebe9ad-36eb-48e2-ac09-369231b6caea",
    status: "done",
    startedAt: 1794063969594,
    endedAt: 1794064145248,
    notesIn: 3,
    entriesMerged: 0,
    entriesPruned: 2,
    entriesAdded: 3,
    output: "# Project Memory\n\n## Known pitfalls\n- ...",
    ...over,
  };
}

describe("the status badge map (E-06: gated is NEVER the success class)", () => {
  test("done is the only success badge", () => {
    expect(dreamStatusClass("done")).toBe("is-success");
  });
  test("gated is its own warn lane (amber), never is-success", () => {
    expect(dreamStatusClass("gated")).toBe("is-gated");
    expect(dreamStatusClass("gated")).not.toBe("is-success");
  });
  test("running / no-notes / error each get a distinct class", () => {
    expect(dreamStatusClass("running")).toBe("is-running");
    expect(dreamStatusClass("no-notes")).toBe("is-no-notes");
    expect(dreamStatusClass("error")).toBe("is-error");
  });
});

describe("the duration + ledger + preview helpers", () => {
  test("the done row's started->ended span is human-readable", () => {
    expect(dreamDuration(dream())).toBe("2m 56s"); // 175.654s -> 176s rounded
  });
  test("a running dream (null endedAt) shows the open-run label", () => {
    expect(dreamDuration(dream({ status: "running", endedAt: null }))).toBe("…");
  });
  test("the consolidation ledger reads +merged/-pruned/+added", () => {
    expect(dreamLedger(dream())).toBe("+0/-2/+3");
  });
  test("the output preview caps at ~200 chars", () => {
    const long = "x".repeat(400);
    const p = dreamOutputPreview(dream({ output: long }));
    expect(p.length).toBe(200);
    expect(p.endsWith("…")).toBe(true);
  });
  test("a short output previews in full (no ellipsis)", () => {
    const p = dreamOutputPreview(dream());
    expect(p).toContain("## Known pitfalls");
    expect(p).not.toContain("…");
  });
  test("an empty output previews the honest empty line", () => {
    expect(dreamOutputPreview(dream({ output: "" }))).toBe("(no output yet)");
  });
});

describe("the journal render", () => {
  test("one row per dream, the RAW string id in data-dream", () => {
    const html = renderDreams({ dreams: [dream()] });
    expect(html).toContain('data-dream="project-85ebe9ad-36eb-48e2-ac09-369231b6caea"');
    expect(html).toContain('data-status="done"');
  });
  test("the badge carries the RAW status word (gated renders GATED)", () => {
    const html = renderDreams({ dreams: [dream({ status: "gated" })] });
    expect(html).toContain('data-status="gated"');
    expect(html).toContain("is-gated");
    // The success class is absent on a gated row.
    expect(html).not.toContain("is-success");
  });
  test("the running row renders with the open-run duration", () => {
    const html = renderDreams({ dreams: [dream({ status: "running", endedAt: null })] });
    expect(html).toContain("…");
  });
  test("the output renders inside an expandable details/summary", () => {
    const html = renderDreams({ dreams: [dream()] });
    expect(html).toContain("<details class=\"fugue-dream-output\"");
    expect(html).toContain("<summary class=\"fugue-dream-preview\">");
    expect(html).toContain("<pre class=\"fugue-dream-output-full\">");
  });
  test("the zero-dreams state is the honest no-dreams panel (V-41)", () => {
    const html = renderDreams({ dreams: [] });
    expect(html).toContain('data-panel="no-dreams"');
    expect(html).toContain("No dreams yet");
    expect(html).not.toContain("fugue-dream-row");
  });
  test("interpolated strings are escaped (the escapeHtml law)", () => {
    const html = renderDreams({
      dreams: [dream({ output: '<script>alert("x")</script>' })],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("the view model + navigation", () => {
  test("dreamsViewModel lists the ids in render order + finds the selection", () => {
    const vm = dreamsViewModel({
      dreams: [dream(), dream({ id: "8f2b1c0e-1234-4abc-9def-85ebe9ad0002" })],
      selected: "8f2b1c0e-1234-4abc-9def-85ebe9ad0002",
    });
    expect(vm.totalRows).toBe(2);
    expect(vm.dreamIds).toEqual([
      "project-85ebe9ad-36eb-48e2-ac09-369231b6caea",
      "8f2b1c0e-1234-4abc-9def-85ebe9ad0002",
    ]);
    expect(vm.selectedIndex).toBe(1);
  });
  test("moveDreamSelection clamps at the edges", () => {
    expect(moveDreamSelection(0, 3, -1)).toBe(0);
    expect(moveDreamSelection(2, 3, 1)).toBe(2);
    expect(moveDreamSelection(1, 3, 1)).toBe(2);
  });
});
