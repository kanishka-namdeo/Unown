import { describe, expect, it } from "vitest";
import {
	countDiffLines,
	diffLineCountsForToolExecution,
	SessionDiffStats,
} from "../src/modes/interactive/components/session-diff-stats.ts";

const EDIT_DIFF = [
	"  1  const a = 1;", // context
	"-2  const b = 2;", // removed
	"+2  const b = 3;", // added
	"-3  const c = 3;", // removed
	"+3  const c = 4;", // added
	"+4  const d = 5;", // added
	"  5  // end",
].join("\n");

describe("countDiffLines", () => {
	it("counts +/- prefixed lines of the edit tool's display diff format", () => {
		expect(countDiffLines(EDIT_DIFF)).toEqual({ added: 3, removed: 2 });
	});

	it("ignores lines without a diff prefix (context, ellipsis, headers)", () => {
		expect(countDiffLines("     ...\n@@ -1,2 +1,3 @@\n 1  unchanged")).toEqual({ added: 0, removed: 0 });
	});

	it("returns zero counts for empty diffs", () => {
		expect(countDiffLines("")).toEqual({ added: 0, removed: 0 });
	});
});

describe("diffLineCountsForToolExecution", () => {
	it("derives edit counts from the result's display diff", () => {
		const counts = diffLineCountsForToolExecution("edit", { path: "a.ts" }, { details: { diff: EDIT_DIFF } });
		expect(counts).toEqual({ added: 3, removed: 2 });
	});

	it("counts a write's content lines as additions (trailing blanks trimmed)", () => {
		const counts = diffLineCountsForToolExecution("write", { path: "new.ts", content: "a\nb\n\n" }, {});
		expect(counts).toEqual({ added: 2, removed: 0 });
	});

	it("ignores writes without content", () => {
		expect(diffLineCountsForToolExecution("write", { path: "new.ts" }, {})).toBeUndefined();
	});

	it("ignores failed executions regardless of diffs", () => {
		expect(
			diffLineCountsForToolExecution("edit", {}, { details: { diff: EDIT_DIFF }, isError: true }),
		).toBeUndefined();
		expect(diffLineCountsForToolExecution("write", { content: "x" }, { isError: true })).toBeUndefined();
	});

	it("ignores non-mutating and unknown tools", () => {
		expect(diffLineCountsForToolExecution("read", { path: "a.ts" }, {})).toBeUndefined();
		expect(diffLineCountsForToolExecution("bash", { command: "ls" }, {})).toBeUndefined();
		expect(diffLineCountsForToolExecution("grep", {}, {})).toBeUndefined();
	});

	it("ignores edits without a diff in the result details", () => {
		expect(diffLineCountsForToolExecution("edit", {}, { details: {} })).toBeUndefined();
		expect(diffLineCountsForToolExecution("edit", {}, {})).toBeUndefined();
	});
});

describe("SessionDiffStats", () => {
	it("accumulates edit and write counts across executions", () => {
		const stats = new SessionDiffStats();
		stats.record("edit", {}, { details: { diff: EDIT_DIFF } });
		stats.record("write", { content: "one\ntwo\nthree" }, {});
		expect(stats.get()).toEqual({ added: 6, removed: 2 });
	});

	it("does not count reads or failures into the totals", () => {
		const stats = new SessionDiffStats();
		stats.record("read", {}, {});
		stats.record("edit", {}, { details: { diff: EDIT_DIFF }, isError: true });
		expect(stats.get()).toEqual({ added: 0, removed: 0 });
	});

	it("add() folds precomputed counts (the tool-execution component path)", () => {
		const stats = new SessionDiffStats();
		stats.add({ added: 4, removed: 1 });
		stats.add({ added: 2, removed: 2 });
		expect(stats.get()).toEqual({ added: 6, removed: 3 });
	});

	it("reset() clears the session story", () => {
		const stats = new SessionDiffStats();
		stats.add({ added: 10, removed: 5 });
		stats.reset();
		expect(stats.get()).toEqual({ added: 0, removed: 0 });
	});

	it("get() returns a fresh copy each call", () => {
		const stats = new SessionDiffStats();
		stats.add({ added: 1, removed: 1 });
		const a = stats.get();
		a.added = 99;
		expect(stats.get().added).toBe(1);
	});
});
