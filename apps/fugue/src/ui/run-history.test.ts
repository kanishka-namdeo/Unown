/**
 * run-history.test.ts — the grouped run-history view (Lane A,
 * DOM-guarded: the module is DOM-free; the el-kin DOM guard asserts no
 * DOM globals are touched by the pure helpers).
 */
import { describe, test, expect } from "bun:test";
import {
  groupRuns,
  renderRunHistory,
  renderRunRow,
  runHistoryViewModel,
  moveRunSelection,
  formatDuration,
} from "./run-history.js";
import type { RunRecordView } from "../domain/types.js";

const jobs = [
  { id: 1, title: "Weekly memory consolidation" },
  { id: 2, title: "Nightly benchmark sweep" },
];

function run(partial: Partial<RunRecordView>): RunRecordView {
  return {
    id: "11",
    taskId: "1",
    kind: "cron",
    status: "ok",
    startedAt: 0,
    endedAt: 90_000,
    tokensIn: 100,
    tokensOut: 25,
    toolCalls: 1,
    turns: 1,
    error: null,
    ...partial,
  };
}

describe("run history: grouping", () => {
  test("groups by job, newest first within a group", () => {
    const runs = [run({ id: "11", taskId: "1" }), run({ id: "13", taskId: "1" }), run({ id: "12", taskId: "2" })];
    const groups = groupRuns(runs, jobs);
    expect(groups.map((g) => g.taskId)).toEqual(["1", "2"]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["13", "11"]);
    expect(groups[1].rows.map((r) => r.id)).toEqual(["12"]);
  });

  test("an honest per-group empty state: a job with zero runs", () => {
    const groups = groupRuns([run({ id: "11", taskId: "1" })], jobs);
    expect(groups[1].rows).toEqual([]);
  });

  test("a run for an unknown job id falls back to a bare id label", () => {
    const groups = groupRuns([run({ taskId: "99" })], jobs);
    expect(groups.map((g) => g.title)).toEqual(["Weekly memory consolidation", "Nightly benchmark sweep", "Job 99"]);
  });

  test("string task refs join by raw id: the 'Job 0' title regression (F-7)", () => {
    // The engine's automation-scoped lane: the job's real id is the RAW
    // string ('auto-xxx'); the run's taskId is the same raw value. The
    // group title MUST be the job's real title — a numeric collapse
    // (taskId 0, the old mapRuns defect) would read "Job 0".
    const autoJobs = [
      { id: "auto-mw6h7exg-z1js3r", title: "lane-probe" },
    ];
    const autoRuns: RunRecordView[] = [
      {
        id: "auto-mw6h7exg-z1js3r:manual:66xgor",
        taskId: "auto-mw6h7exg-z1js3r",
        kind: "manual",
        status: "ok",
        startedAt: 0,
        endedAt: 0,
        tokensIn: 0,
        tokensOut: 0,
        toolCalls: 0,
        turns: 0,
        error: null,
      },
    ];
    const groups = groupRuns(autoRuns, autoJobs);
    expect(groups.length).toBe(1);
    expect(groups[0].taskId).toBe("auto-mw6h7exg-z1js3r");
    expect(groups[0].title).toBe("lane-probe");
    expect(groups[0].rows.map((r) => r.id)).toEqual(["auto-mw6h7exg-z1js3r:manual:66xgor"]);
    // The collapsed-key accident (taskId "0") must never group under the
    // real job — the regression pin.
    expect(groups[0].title).not.toContain("Job 0");
  });
});

describe("run history: rendering", () => {
  test("zero runs → the honest no-runs panel (O-1)", () => {
    const html = renderRunHistory({ runs: [] });
    expect(html).toContain('data-panel="no-runs"');
  });

  test("rows show status, tokens, turns, duration", () => {
    const html = renderRunHistory({ runs: [run({ id: "11", taskId: "1" })], jobs });
    expect(html).toContain("100/25 tok");
    expect(html).toContain("1 turns");
    expect(html).toContain('data-status="ok"');
  });

  test("an open run (endedAt null) shows …, not a fake zero", () => {
    expect(formatDuration(run({ endedAt: null }))).toBe("…");
    const html = renderRunRow(run({ endedAt: null }));
    expect(html).toContain(">…<");
  });

  test("selected run renders data-selected", () => {
    const html = renderRunHistory({ runs: [run({ id: "11" })], selected: "11" });
    expect(html).toContain('data-selected="11"');
  });

  test("the run-row data-run / data-task carry the RAW string ids (F-7)", () => {
    const autoRun: RunRecordView = {
      id: "auto-mw6h7exg-z1js3r:manual:66xgor",
      taskId: "auto-mw6h7exg-z1js3r",
      kind: "manual",
      status: "ok",
      startedAt: 0,
      endedAt: 0,
      tokensIn: 0,
      tokensOut: 0,
      toolCalls: 0,
      turns: 0,
      error: null,
    };
    const html = renderRunRow(autoRun);
    expect(html).toContain('data-run="auto-mw6h7exg-z1js3r:manual:66xgor"');
    expect(html).toContain('data-task="auto-mw6h7exg-z1js3r"');
  });
});

describe("run history: navigation", () => {
  test("moveRunSelection clamps at both ends", () => {
    expect(moveRunSelection(0, 3, -1)).toBe(0);
    expect(moveRunSelection(2, 3, 1)).toBe(2);
    expect(moveRunSelection(0, 3, 1)).toBe(1);
  });

  test("the view model's flat ids match rendered row order", () => {
    const runs = [run({ id: "11", taskId: "1" }), run({ id: "13", taskId: "1" }), run({ id: "12", taskId: "2" })];
    const vm = runHistoryViewModel({ runs, jobs, selected: "13" });
    expect(vm.runIds).toEqual(["13", "11", "12"]);
    expect(vm.totalRows).toBe(3);
    expect(vm.selectedIndex).toBe(0);
  });
});
