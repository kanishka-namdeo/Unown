// Unit tests for src/blame.ts — `/blame` receipts reader (Milestone 3.4).
//
// Layers:
//   1. blameFile — finds entries that touched a file (write/edit/bash)
//   2. blameFile — sessionId + since filters
//   3. blameFile — missing dir / corrupt lines (graceful)
//   4. blameSummary — totals + byTool + filesTouched
//   5. formatBlameReport — markdown grouped by session
//   6. formatBlameJson — valid JSON
//
// Fixtures: each test writes a fresh receipts dir under mkdtempSync and
// appends raw JSONL lines that match the ReceiptEntry schema from
// checkpoints.ts (the runtime shape — `seq`, `ts`, `kind`, `tool`, `input`).
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    blameFile,
    blameSummary,
    formatBlameJson,
    formatBlameReport,
    type BlameEntry,
    type BlameOptions,
} from "../src/blame.ts";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const tmpRoot = mkdtempSync(join(tmpdir(), "unown-blame-test-"));
process.on("beforeExit", () => {
    try {
        rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
        /* ignore */
    }
});

/** One receipts fixture dir, swept at end-of-suite. */
function freshReceiptsDir(label: string): string {
    const dir = mkdtempSync(join(tmpRoot, `unown-blame-${label}-`));
    return dir;
}

/** Append one JSONL line (newline-terminated) to a ledger file. */
function appendLine(file: string, entry: Record<string, unknown>): void {
    writeFileSync(file, JSON.stringify(entry) + "\n", { flag: "a" });
}

/** Build a session_start entry (the first line of every ledger). */
function sessionStart(seq: number, ts: number, cwd = "/repo"): Record<string, unknown> {
    return { seq, ts, kind: "session_start", subagent: false, cwd };
}

/** Build an input entry (the boundary that increments the turn counter). */
function input(seq: number, ts: number, preview: string): Record<string, unknown> {
    return { seq, ts, kind: "input", preview };
}

/** Build a tool_call entry — the shape `blameFile` scans for path matches. */
function toolCall(
    seq: number,
    ts: number,
    tool: string,
    input: Record<string, unknown>,
): Record<string, unknown> {
    return { seq, ts, kind: "tool_call", id: `call-${seq}`, tool, input };
}

// ---------------------------------------------------------------------------
// 1-3. blameFile finds entries that touched the file (write/edit/bash)
// ---------------------------------------------------------------------------

describe("blameFile — touch detection", () => {
    test("1. finds entries that touched the file via the write tool", () => {
        const dir = freshReceiptsDir("write");
        const ledger = join(dir, "sess-A.jsonl");
        appendLine(ledger, sessionStart(1, 1000));
        appendLine(ledger, input(2, 1100, "edit foo"));
        appendLine(ledger, toolCall(3, 1200, "write", { path: "src/foo.ts", content: "<12 chars>" }));
        appendLine(ledger, toolCall(4, 1300, "write", { path: "src/bar.ts", content: "<3 chars>" }));

        const entries = blameFile(dir, "src/foo.ts");
        expect(entries).toHaveLength(1);
        const e = entries[0];
        expect(e.tool).toBe("write");
        expect(e.summary).toBe("src/foo.ts");
        expect(e.sessionId).toBe("sess-A");
        expect(e.turn).toBe(1); // 1 input seen before the tool_call
        expect(e.ts).toBe(1200);
    });

    test("2. finds entries that touched the file via the edit tool", () => {
        const dir = freshReceiptsDir("edit");
        const ledger = join(dir, "20261019-120000-ab12.jsonl");
        appendLine(ledger, sessionStart(1, 1000));
        appendLine(ledger, input(2, 1100, "fix bug"));
        appendLine(ledger, toolCall(3, 1200, "edit", { path: "lib/util.ts", content: "<8 chars>" }));

        const entries = blameFile(dir, "lib/util.ts");
        expect(entries).toHaveLength(1);
        expect(entries[0].tool).toBe("edit");
        expect(entries[0].summary).toBe("lib/util.ts");
        // The session id is the ledger filename stem.
        expect(entries[0].sessionId).toBe("20261019-120000-ab12");
    });

    test("3. finds entries that touched the file via the bash tool (command contains the path)", () => {
        const dir = freshReceiptsDir("bash");
        const ledger = join(dir, "sess.jsonl");
        appendLine(ledger, sessionStart(1, 1000));
        appendLine(ledger, input(2, 1100, "rm old file"));
        appendLine(
            ledger,
            toolCall(3, 1200, "bash", { command: "rm -f src/old/deprecated.ts && touch README" }),
        );
        // A bash command that DOESN'T reference the file should not match.
        appendLine(ledger, toolCall(4, 1300, "bash", { command: "echo hello world" }));

        const entries = blameFile(dir, "src/old/deprecated.ts");
        expect(entries).toHaveLength(1);
        expect(entries[0].tool).toBe("bash");
        expect(entries[0].summary).toContain("rm -f src/old/deprecated.ts");
        expect(entries[0].turn).toBe(1);
    });

    test("matches a bare basename when the target has no path separator (write tool)", () => {
        const dir = freshReceiptsDir("basename");
        const ledger = join(dir, "sess.jsonl");
        appendLine(ledger, sessionStart(1, 1000));
        appendLine(ledger, input(2, 1100, "edit"));
        appendLine(ledger, toolCall(3, 1200, "write", { path: "package.json", content: "<5 chars>" }));

        const entries = blameFile(dir, "package.json");
        expect(entries).toHaveLength(1);
        expect(entries[0].summary).toBe("package.json");
    });

    test("path match is separator-aware: `bar.ts` does NOT match `foobar.ts`", () => {
        const dir = freshReceiptsDir("sep-aware");
        const ledger = join(dir, "sess.jsonl");
        appendLine(ledger, sessionStart(1, 1000));
        appendLine(ledger, input(2, 1100, "edit"));
        appendLine(ledger, toolCall(3, 1200, "write", { path: "src/foobar.ts", content: "<1 chars>" }));

        const entries = blameFile(dir, "bar.ts");
        expect(entries).toHaveLength(0);
    });

    test("absolute path target matches relative receipt path when cwd is supplied", () => {
        const dir = freshReceiptsDir("abs");
        const ledger = join(dir, "sess.jsonl");
        appendLine(ledger, sessionStart(1, 1000));
        appendLine(ledger, input(2, 1100, "edit"));
        appendLine(ledger, toolCall(3, 1200, "write", { path: "src/foo.ts", content: "<1 chars>" }));

        const entries = blameFile(dir, "/repo/src/foo.ts", {}, "/repo");
        expect(entries).toHaveLength(1);
        expect(entries[0].summary).toBe("src/foo.ts");
    });
});

// ---------------------------------------------------------------------------
// 4-5. blameFile filters (sessionId + since)
// ---------------------------------------------------------------------------

describe("blameFile — filters", () => {
    test("4. respects the sessionId filter", () => {
        const dir = freshReceiptsDir("session-filter");
        const ledgerA = join(dir, "sess-A.jsonl");
        const ledgerB = join(dir, "sess-B.jsonl");
        for (const [ledger, sess] of [[ledgerA, "sess-A"], [ledgerB, "sess-B"]] as const) {
            appendLine(ledger, sessionStart(1, 1000));
            appendLine(ledger, input(2, 1100, "edit"));
            appendLine(ledger, toolCall(3, 1200, "write", { path: "src/foo.ts", content: "<1 chars>" }));
            void sess;
        }

        const opts: BlameOptions = { sessionId: "sess-A" };
        const entries = blameFile(dir, "src/foo.ts", opts);
        expect(entries).toHaveLength(1);
        expect(entries[0].sessionId).toBe("sess-A");
    });

    test("4b. also matches `sub-<sessionId>` ledger filenames (subagent ledgers)", () => {
        const dir = freshReceiptsDir("sub-session");
        const ledger = join(dir, "sub-sess-A.jsonl");
        appendLine(ledger, sessionStart(1, 1000));
        appendLine(ledger, input(2, 1100, "edit"));
        appendLine(ledger, toolCall(3, 1200, "write", { path: "src/foo.ts", content: "<1 chars>" }));

        const entries = blameFile(dir, "src/foo.ts", { sessionId: "sess-A" });
        expect(entries).toHaveLength(1);
    });

    test("5. respects the since filter (epoch-ms timestamp)", () => {
        const dir = freshReceiptsDir("since");
        const ledger = join(dir, "sess.jsonl");
        appendLine(ledger, sessionStart(1, 1000));
        appendLine(ledger, input(2, 1100, "edit 1"));
        appendLine(ledger, toolCall(3, 1200, "write", { path: "src/foo.ts", content: "<1 chars>" }));
        appendLine(ledger, input(4, 5000, "edit 2"));
        appendLine(ledger, toolCall(5, 5500, "write", { path: "src/foo.ts", content: "<2 chars>" }));

        // Only the second write is at or after t=3000.
        const entries = blameFile(dir, "src/foo.ts", { since: 3000 });
        expect(entries).toHaveLength(1);
        expect(entries[0].ts).toBe(5500);
    });

    test("since=0 (no filter) returns every match", () => {
        const dir = freshReceiptsDir("since-zero");
        const ledger = join(dir, "sess.jsonl");
        appendLine(ledger, sessionStart(1, 1000));
        appendLine(ledger, input(2, 1100, "edit"));
        appendLine(ledger, toolCall(3, 1200, "write", { path: "src/foo.ts", content: "<1 chars>" }));
        appendLine(ledger, toolCall(4, 1300, "write", { path: "src/foo.ts", content: "<2 chars>" }));

        const entries = blameFile(dir, "src/foo.ts", { since: 0 });
        expect(entries).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// 6-8. blameFile — graceful handling
// ---------------------------------------------------------------------------

describe("blameFile — graceful handling", () => {
    test("6. returns [] when no receipts match the file", () => {
        const dir = freshReceiptsDir("no-match");
        const ledger = join(dir, "sess.jsonl");
        appendLine(ledger, sessionStart(1, 1000));
        appendLine(ledger, input(2, 1100, "edit"));
        appendLine(ledger, toolCall(3, 1200, "write", { path: "src/other.ts", content: "<1 chars>" }));

        const entries = blameFile(dir, "src/missing.ts");
        expect(entries).toEqual([]);
    });

    test("7. handles a missing receipts directory gracefully (returns [])", () => {
        const missing = join(tmpRoot, "no-such-dir-", String(Date.now()));
        expect(existsSync(missing)).toBe(false);
        const entries = blameFile(missing, "src/foo.ts");
        expect(entries).toEqual([]);
    });

    test("8. skips corrupt JSONL lines (and still returns the valid entries)", () => {
        const dir = freshReceiptsDir("corrupt");
        const ledger = join(dir, "sess.jsonl");
        // A valid session_start.
        appendLine(ledger, sessionStart(1, 1000));
        // A garbage line — not JSON at all.
        writeFileSync(ledger, "this is not json\n", { flag: "a" });
        // A JSON object with the wrong shape (no `kind`).
        writeFileSync(ledger, JSON.stringify({ seq: 99, garbage: true }) + "\n", { flag: "a" });
        // A truncated JSON object (looks like the writer was interrupted).
        writeFileSync(ledger, '{"seq":100,"ts":1200,"kind":"tool_call","tool":"writ', { flag: "a" });
        // A valid input boundary.
        appendLine(ledger, input(2, 1100, "edit"));
        // A valid write that should still be found.
        appendLine(ledger, toolCall(3, 1200, "write", { path: "src/foo.ts", content: "<1 chars>" }));

        const entries = blameFile(dir, "src/foo.ts");
        // The corrupt lines are skipped silently — only the valid write surfaces.
        expect(entries).toHaveLength(1);
        expect(entries[0].tool).toBe("write");
        expect(entries[0].summary).toBe("src/foo.ts");
    });
});

// ---------------------------------------------------------------------------
// 9. blameSummary
// ---------------------------------------------------------------------------

describe("blameSummary", () => {
    test("9. returns totalEntries + byTool counts + filesTouched list", () => {
        const dir = freshReceiptsDir("summary");
        const ledger = join(dir, "sess.jsonl");
        appendLine(ledger, sessionStart(1, 1000));
        appendLine(ledger, input(2, 1100, "edit"));
        appendLine(ledger, toolCall(3, 1200, "write", { path: "src/a.ts", content: "<1 chars>" }));
        appendLine(ledger, toolCall(4, 1300, "edit", { path: "src/b.ts", content: "<2 chars>" }));
        appendLine(ledger, toolCall(5, 1400, "bash", { command: "ls src/" }));
        appendLine(ledger, toolCall(6, 1500, "write", { path: "src/a.ts", content: "<3 chars>" }));

        const summary = blameSummary(dir);
        expect(summary.totalEntries).toBe(4); // 4 tool_calls (write+edit+bash+write)
        expect(summary.byTool).toEqual({ write: 2, edit: 1, bash: 1 });
        // filesTouched is the DISTINCT set of write/edit paths (bash excluded).
        expect(summary.filesTouched).toEqual(["src/a.ts", "src/b.ts"]);
    });

    test("respects sessionId filter (only counts that session's entries)", () => {
        const dir = freshReceiptsDir("summary-session");
        const ledgerA = join(dir, "sess-A.jsonl");
        const ledgerB = join(dir, "sess-B.jsonl");
        for (const ledger of [ledgerA, ledgerB]) {
            appendLine(ledger, sessionStart(1, 1000));
            appendLine(ledger, input(2, 1100, "edit"));
            appendLine(ledger, toolCall(3, 1200, "write", { path: "src/foo.ts", content: "<1 chars>" }));
        }

        const summary = blameSummary(dir, { sessionId: "sess-A" });
        expect(summary.totalEntries).toBe(1);
        expect(summary.byTool).toEqual({ write: 1 });
        expect(summary.filesTouched).toEqual(["src/foo.ts"]);
    });

    test("respects since filter (time-bounded counts)", () => {
        const dir = freshReceiptsDir("summary-since");
        const ledger = join(dir, "sess.jsonl");
        appendLine(ledger, sessionStart(1, 1000));
        appendLine(ledger, input(2, 1100, "edit"));
        appendLine(ledger, toolCall(3, 1200, "write", { path: "src/a.ts", content: "<1 chars>" }));
        appendLine(ledger, toolCall(4, 5000, "write", { path: "src/b.ts", content: "<2 chars>" }));

        const summary = blameSummary(dir, { since: 3000 });
        expect(summary.totalEntries).toBe(1);
        expect(summary.byTool).toEqual({ write: 1 });
        expect(summary.filesTouched).toEqual(["src/b.ts"]);
    });

    test("missing receipts dir → empty summary (no throw)", () => {
        const missing = join(tmpRoot, "summary-missing-", String(Date.now()));
        const summary = blameSummary(missing);
        expect(summary.totalEntries).toBe(0);
        expect(summary.byTool).toEqual({});
        expect(summary.filesTouched).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// 10-11. formatters
// ---------------------------------------------------------------------------

describe("formatBlameReport", () => {
    test("10. returns markdown with entries grouped by session", () => {
        const entries: BlameEntry[] = [
            { ts: 1000, turn: 1, sessionId: "sess-A", tool: "write", summary: "src/foo.ts" },
            { ts: 2000, turn: 1, sessionId: "sess-A", tool: "bash", summary: "rm src/foo.ts" },
            { ts: 3000, turn: 1, sessionId: "sess-B", tool: "edit", summary: "src/foo.ts" },
        ];
        const md = formatBlameReport(entries, "src/foo.ts");
        // Title + filepath.
        expect(md).toContain("# Blame — `src/foo.ts`");
        // Both session headers, each with the session id and a touch count.
        expect(md).toContain("## Session `sess-A` (2 touches)");
        expect(md).toContain("## Session `sess-B` (1 touch)");
        // Each entry line.
        expect(md).toContain("write: src/foo.ts");
        expect(md).toContain("bash: rm src/foo.ts");
        expect(md).toContain("edit: src/foo.ts");
        // Turn labels.
        expect(md).toContain("turn 1");
        // Footer total.
        expect(md).toContain("Showing 3 receipts across 2 sessions");
    });

    test("empty entries → friendly 'no matching receipts' message", () => {
        const md = formatBlameReport([], "src/missing.ts");
        expect(md).toContain("# Blame — `src/missing.ts`");
        expect(md).toContain("No matching receipts found");
    });

    test("no filePath arg → generic title", () => {
        const md = formatBlameReport([], undefined);
        expect(md).toContain("# Blame — receipts");
    });
});

describe("formatBlameJson", () => {
    test("11. returns valid JSON (parseable, array of BlameEntry)", () => {
        const entries: BlameEntry[] = [
            { ts: 1000, turn: 1, sessionId: "sess-A", tool: "write", summary: "src/foo.ts" },
            { ts: 2000, turn: null, sessionId: "sess-B", tool: "bash", summary: "echo hi" },
        ];
        const json = formatBlameJson(entries);
        // Must parse back to a deep-equal array.
        const parsed = JSON.parse(json);
        expect(parsed).toEqual(entries);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed).toHaveLength(2);
        expect(parsed[0]).toEqual({
            ts: 1000,
            turn: 1,
            sessionId: "sess-A",
            tool: "write",
            summary: "src/foo.ts",
        });
    });

    test("empty entries → '[]'", () => {
        expect(formatBlameJson([])).toBe("[]");
    });
});

// ---------------------------------------------------------------------------
// Cross-cutting: blameFile + formatters (the /blame <file> render path)
// ---------------------------------------------------------------------------

describe("blameFile + formatBlameReport end-to-end", () => {
    test("a two-session ledger renders with both session blocks", () => {
        const dir = freshReceiptsDir("e2e");
        const ledgerA = join(dir, "sess-A.jsonl");
        const ledgerB = join(dir, "sess-B.jsonl");
        // Session A: 1 input → 1 write to foo.ts.
        appendLine(ledgerA, sessionStart(1, 1000));
        appendLine(ledgerA, input(2, 1100, "edit foo"));
        appendLine(ledgerA, toolCall(3, 1200, "write", { path: "src/foo.ts", content: "<1 chars>" }));
        // Session B: 2 inputs → 1 edit + 1 bash touching foo.ts.
        appendLine(ledgerB, sessionStart(1, 2000));
        appendLine(ledgerB, input(2, 2100, "edit foo"));
        appendLine(ledgerB, toolCall(3, 2200, "edit", { path: "src/foo.ts", content: "<2 chars>" }));
        appendLine(ledgerB, input(4, 2300, "rm foo"));
        appendLine(ledgerB, toolCall(5, 2400, "bash", { command: "rm src/foo.ts" }));

        const entries = blameFile(dir, "src/foo.ts");
        expect(entries).toHaveLength(3); // 1 write + 1 edit + 1 bash across both sessions
        const md = formatBlameReport(entries, "src/foo.ts");
        expect(md).toContain("## Session `sess-A` (1 touch)");
        expect(md).toContain("## Session `sess-B` (2 touches)");
        // Turn attribution: sess-A's write is turn 1; sess-B's edit is turn 1,
        // bash is turn 2.
        const aLine = md.split("## Session `sess-A`")[1].split("## Session")[0];
        expect(aLine).toContain("turn 1");
        const bBlock = md.split("## Session `sess-B`")[1];
        expect(bBlock).toContain("turn 1");
        expect(bBlock).toContain("turn 2");
    });
});
