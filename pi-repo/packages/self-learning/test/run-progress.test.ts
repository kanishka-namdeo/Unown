// Unit tests for src/run-progress.ts — the in-memory live-run registry that
// backs GET /api/runs/live and GET /api/runs/:id .live (M6-2, audit M4-c D4:
// REST consumers had no mid-run signal — SSE was the only live channel).
//
// What is pinned:
//   - beginLiveRun registers a zeroed snapshot; getLiveRun derives elapsedMs
//   - touchLiveRun mutates fields and bumps updatedAt; unknown id never throws
//   - finishLiveRun drops the entry (finalize + outer-finally both call it)
//   - listLiveRuns is oldest-first and skips/drops stale entries (>30min)
//   - getLiveRun drops stale entries lazily too
//
// Pure in-memory module — no store, no LLM, no _env redirect needed (but the
// import is kept first-thing anyway to guard against future src imports).

import "./_env.ts";
import { describe, expect, test } from "bun:test";
import {
        beginLiveRun,
        finishLiveRun,
        getLiveRun,
        listLiveRuns,
        touchLiveRun,
        type LiveRunProgress,
} from "../src/run-progress.ts";

const begun = (id: string, startedAt = Date.now()) =>
        beginLiveRun({ id, taskId: "fix-fizzbuzz", kind: "baseline", cycleId: "c1", improvementId: null, label: "t-baseline", startedAt });

/** Recent-but-ordered timestamps (a raw 1_000 epoch ms would trip the 30-min
 * stale sweep by design — updatedAt is seeded from startedAt). */
const T0 = Date.now();
const ago = (ms: number) => T0 - ms;

describe("beginLiveRun / getLiveRun", () => {
        test("registered snapshot starts zeroed with derived elapsedMs", () => {
                begun("r1", ago(5_000));
                const v = getLiveRun("r1");
                expect(v).not.toBeNull();
                expect(v!.id).toBe("r1");
                expect(v!.taskId).toBe("fix-fizzbuzz");
                expect(v!.kind).toBe("baseline");
                expect(v!.label).toBe("t-baseline");
                expect(v!.turns).toBe(0);
                expect(v!.tokensIn).toBe(0);
                expect(v!.tokensOut).toBe(0);
                expect(v!.toolCalls).toBe(0);
                expect(v!.toolsUsed).toEqual([]);
                expect(v!.lastTool).toBeNull();
                expect(v!.lastTextPreview).toBe("");
                expect(v!.elapsedMs).toBeGreaterThanOrEqual(0);
        });

        test("unknown id -> null", () => {
                expect(getLiveRun("nope")).toBeNull();
        });
});

describe("touchLiveRun", () => {
        test("mutates fields and bumps updatedAt", () => {
                begun("r2", ago(4_000));
                const before = getLiveRun("r2")!;
                touchLiveRun("r2", (p: LiveRunProgress) => {
                        p.turns = 3;
                        p.tokensIn = 111;
                        p.tokensOut = 22;
                        p.contextTokens = 111;
                        p.toolCalls = 2;
                        p.toolsUsed = ["read", "edit"];
                        p.lastTool = { tool: "edit", phase: "end", isError: false, at: Date.now() };
                        p.lastTextPreview = "fixed the loop";
                });
                const after = getLiveRun("r2")!;
                expect(after.turns).toBe(3);
                expect(after.tokensIn).toBe(111);
                expect(after.tokensOut).toBe(22);
                expect(after.contextTokens).toBe(111);
                expect(after.toolCalls).toBe(2);
                expect(after.toolsUsed).toEqual(["read", "edit"]);
                expect(after.lastTool?.tool).toBe("edit");
                expect(after.lastTextPreview).toBe("fixed the loop");
                expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
        });

        test("unknown id (already finished) is a silent no-op", () => {
                expect(() => touchLiveRun("gone", (p) => (p.turns = 99))).not.toThrow();
        });

        test("a throwing mutator is swallowed (telemetry never breaks the run)", () => {
                begun("r3", ago(3_000));
                expect(() => touchLiveRun("r3", () => { throw new Error("boom"); })).not.toThrow();
                expect(getLiveRun("r3")!.turns).toBe(0);
        });
});

describe("finishLiveRun", () => {
        test("drops the entry — the DB row becomes the source of truth", () => {
                begun("r4", ago(2_000));
                expect(getLiveRun("r4")).not.toBeNull();
                finishLiveRun("r4");
                expect(getLiveRun("r4")).toBeNull();
        });

        test("double finish is safe", () => {
                begun("r5", ago(1_000));
                finishLiveRun("r5");
                expect(() => finishLiveRun("r5")).not.toThrow();
        });
});

describe("listLiveRuns", () => {
        test("oldest first, live entries only", () => {
                beginLiveRun({ id: "new", taskId: null, kind: "interactive", cycleId: null, improvementId: null, label: null, startedAt: ago(0) });
                begun("old-a", ago(2_000));
                begun("old-b", ago(1_000));
                const ids = listLiveRuns().map((r) => r.id);
                expect(ids.indexOf("old-a")).toBeLessThan(ids.indexOf("old-b"));
                expect(ids.indexOf("old-b")).toBeLessThan(ids.indexOf("new"));
        });

        test("stale entries (>30min untouched) are dropped, not listed", () => {
                // updatedAt is seeded from startedAt, so a run begun 31 minutes ago
                // and never touched is past the sweep. (A touchLiveRun would bump
                // updatedAt back to now — that is the "touch keeps it alive" path
                // every other fixture in this file exercises.)
                begun("stale-1", ago(31 * 60 * 1000));
                expect(listLiveRuns().map((r) => r.id)).not.toContain("stale-1");
                expect(getLiveRun("stale-1")).toBeNull(); // lazily dropped by the read too
        });
});
