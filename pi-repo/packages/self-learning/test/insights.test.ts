// Unit tests for src/insights.ts — the /insights cross-session analytics
// engine (v0.0.7 parity round).
//
// Layers:
//   1. buildInsightsReport — session scan (counts, date range, malformed
//      files skipped, maxSessions mtime cap, line-level tolerance)
//   2. buildInsightsReport — messages / models / tokens / activeProjects
//   3. buildInsightsReport — friction (failed toolResults, error notes)
//   4. buildInsightsReport — receipts (tool ranking, file relativization,
//      note census incl. the 120-char cap)
//   5. buildInsightsReport — bridge injection (present / null / throwing /
//      days passthrough) + missing dirs → zeroed report
//   6. renderInsightsReport — every section header, locale-formatted rows,
//      bridge cost honesty (`—` / unreachable), 8-row caps, determinism
//   7. insightsHintLine — the single-line footer
//
// Fixtures: fresh mkdtempSync roots per group. Session .jsonl files match the
// live pi transcript shape (session header line + message entries carrying
// role/model/usage); receipts match the checkpoints.ts ReceiptEntry runtime
// shape (`kind`/`tool`/`input`/`preview`, plus a `content`-shaped note — both
// spellings are in the wild).
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildInsightsReport, insightsHintLine, renderInsightsReport } from "../src/insights.ts";
import type { UsageSummary } from "../src/usage-cli.ts";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const ROOTS: string[] = [];

function makeRoot(label: string): string {
    const root = mkdtempSync(join(tmpdir(), `insights-${label}-`));
    ROOTS.push(root);
    return root;
}

/** Write a JSONL file (one JSON object per line), creating parents. */
function writeJsonl(file: string, objs: unknown[]): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, objs.map((o) => JSON.stringify(o)).join("\n") + "\n");
}

const T1 = "2026-10-19T10:00:00.000Z";
const T2 = "2026-10-20T11:00:00.000Z";
const T3 = "2026-10-21T09:00:00.000Z";
const NT1 = Date.parse("2026-10-19T10:05:00.000Z");
const NT2 = Date.parse("2026-10-20T12:00:00.000Z");

/** >120 chars so the latest-note cap is exercised; matches the friction
 *  heuristic (`failed`, `exit code 1`) so it also counts as an error note. */
const LONG_ERROR_NOTE =
    "bash failed with exit code 1 — the sandbox denied the write to /etc/hosts; rerun with the path under the project root instead of touching system files";

interface MainFixture {
    cwd: string;
    otherCwd: string;
    sessionsDir: string;
    receiptsDir: string;
}

/**
 * The shared 4-file sessions fixture (3 valid + 1 malformed) and 2-ledger
 * receipts fixture. Coverage folded in on purpose — one report, many pins:
 *   - sess-1 (cwd A): usage block incl. cacheRead + cacheWrite
 *   - sess-2 (cwd B): TWO failed toolResults (block text + string content)
 *   - sess-3 (cwd A): second model, usage without cache fields
 *   - broken.jsonl: truncated header line → whole file skipped
 *   - ledger-1: write/edit/bash tool_calls; relative, absolute-inside and
 *     absolute-outside paths; a `preview`-shaped note (older ts)
 *   - ledger-2: an absolute-inside 2nd touch of src/app.ts, a read call
 *     (NOT a touched file), and a `content`-shaped note (newest ts)
 */
function buildMainFixture(): MainFixture {
    const cwd = makeRoot("main");
    const otherCwd = makeRoot("other");
    const sessionsDir = join(cwd, "sessions");
    const receiptsDir = join(cwd, ".unown", "receipts");

    writeJsonl(join(sessionsDir, "2026-10-19T10-00-00-000Z_sess-1.jsonl"), [
        { type: "session", version: 3, id: "sess-1", timestamp: T1, cwd },
        { type: "message", id: "m1", parentId: null, timestamp: T1, message: { role: "user", content: "fix the login bug" } },
        {
            type: "message",
            id: "m2",
            parentId: "m1",
            timestamp: T1,
            message: {
                role: "assistant",
                content: [{ type: "text", text: "on it" }],
                provider: "zai-bridge",
                model: "agnes-3.0-flash",
                usage: { input: 1000, output: 200, cacheRead: 4096, cacheWrite: 512 },
            },
        },
        {
            type: "message",
            id: "m3",
            parentId: "m2",
            timestamp: T1,
            message: { role: "toolResult", toolCallId: "tc1", toolName: "write", content: [{ type: "text", text: "wrote 3 lines" }] },
        },
    ]);
    writeJsonl(join(sessionsDir, "2026-10-20T11-00-00-000Z_sess-2.jsonl"), [
        { type: "session", version: 3, id: "sess-2", timestamp: T2, cwd: otherCwd },
        { type: "message", id: "m4", parentId: null, timestamp: T2, message: { role: "user", content: "run the tests" } },
        {
            type: "message",
            id: "m5",
            parentId: "m4",
            timestamp: T2,
            message: {
                role: "assistant",
                content: [{ type: "text", text: "running" }],
                model: "agnes-3.0-flash",
                usage: { input: 500, output: 50, cacheRead: 1024, cacheWrite: 0 },
            },
        },
        {
            type: "message",
            id: "m6",
            parentId: "m5",
            timestamp: T2,
            message: { role: "toolResult", toolCallId: "tc2", toolName: "bash", content: [{ type: "text", text: "error: ENOENT: no such file or directory" }] },
        },
        {
            type: "message",
            id: "m7",
            parentId: "m6",
            timestamp: T2,
            message: { role: "toolResult", toolCallId: "tc3", toolName: "bash", content: "exit code 2 — bun test failed" },
        },
        {
            type: "message",
            id: "m8",
            parentId: "m7",
            timestamp: T2,
            message: { role: "toolResult", toolCallId: "tc4", toolName: "read", content: [{ type: "text", text: "42 lines" }] },
        },
    ]);
    writeJsonl(join(sessionsDir, "2026-10-21T09-00-00-000Z_sess-3.jsonl"), [
        { type: "session", version: 3, id: "sess-3", timestamp: T3, cwd },
        { type: "message", id: "m9", parentId: null, timestamp: T3, message: { role: "user", content: "ship it" } },
        {
            type: "message",
            id: "m10",
            parentId: "m9",
            timestamp: T3,
            message: { role: "assistant", content: [{ type: "text", text: "done" }], model: "gpt-4o", usage: { input: 100, output: 10 } },
        },
    ]);
    // Malformed: truncated header line → the WHOLE file must be skipped
    // (not counted, no entries, its newer mtime doesn't matter).
    writeFileSync(join(sessionsDir, "2026-10-22T00-00-00-000Z_broken.jsonl"), '{"type":"session","id":"bad\n{"type":"message"}\n');

    writeJsonl(join(receiptsDir, "ledger-1.jsonl"), [
        { kind: "session_start", subagent: false, cwd, seq: 1, ts: NT1 - 1000 },
        { kind: "input", preview: "fix the login bug", seq: 2, ts: NT1 },
        { kind: "tool_call", id: "tc1", tool: "write", input: { path: "src/app.ts", content: "x" }, seq: 3, ts: NT1 + 1 },
        { kind: "tool_call", id: "tc2", tool: "edit", input: { path: join(cwd, "src/util.ts") }, seq: 4, ts: NT1 + 2 },
        { kind: "tool_call", id: "tc3", tool: "bash", input: { command: "bun test" }, seq: 5, ts: NT1 + 3 },
        { kind: "tool_call", id: "tc4", tool: "write", input: { path: "/etc/hosts" }, seq: 6, ts: NT1 + 4 },
        { kind: "note", preview: "When editing blame.ts, run bun test after", seq: 7, ts: NT1 + 5 },
    ]);
    writeJsonl(join(receiptsDir, "ledger-2.jsonl"), [
        { kind: "session_start", subagent: false, cwd: otherCwd, seq: 1, ts: NT2 - 1000 },
        // absolute-inside form → still counts as the SAME file as the relative form
        { kind: "tool_call", id: "tc5", tool: "write", input: { path: join(cwd, "src/app.ts") }, seq: 2, ts: NT2 },
        // read ≠ write/edit → must NOT appear in topFiles
        { kind: "tool_call", id: "tc6", tool: "read", input: { path: join(cwd, "README.md") }, seq: 3, ts: NT2 + 1 },
        // `content`-shaped note (the spec's spelling), newest ts → the latest note
        { kind: "note", content: LONG_ERROR_NOTE, seq: 4, ts: NT2 + 2 },
    ]);
    return { cwd, otherCwd, sessionsDir, receiptsDir };
}

/** A UsageSummary-shaped bridge aggregate (costUsd 1.25, estimate pricing). */
function makeUsageSummary(): UsageSummary {
    return {
        since: Date.parse("2026-10-16T00:00:00.000Z"),
        days: 7,
        model: null,
        totals: { requests: 42, errors: 3, promptTokens: 1_000_000, completionTokens: 200_000, cachedTokens: 500_000, costUsd: 1.25 },
        byModel: [
            { model: "agnes-3.0-flash", requests: 42, promptTokens: 1_000_000, completionTokens: 200_000, tokens: 1_200_000, costUsd: 1.25, avgDurationMs: 812 },
        ],
        byDay: [{ date: "2026-10-23", requests: 42, tokens: 1_200_000, costUsd: 1.25 }],
        skippedLines: 0,
        linesRead: 42,
        truncated: false,
        pricing: { estimate: true, overridden: [], unknownModels: [] },
    };
}

afterAll(() => {
    for (const root of ROOTS) {
        try {
            rmSync(root, { recursive: true, force: true });
        } catch {
            /* best effort */
        }
    }
});

// ---------------------------------------------------------------------------
// buildInsightsReport — the sessions scan
// ---------------------------------------------------------------------------

describe("buildInsightsReport (sessions)", () => {
    test("1. counts parsed sessions with the date range; malformed files skipped", async () => {
        const fx = buildMainFixture();
        const report = await buildInsightsReport({
            cwd: fx.cwd,
            sessionsDir: fx.sessionsDir,
            receiptsDir: fx.receiptsDir,
            fetchUsage: async () => null,
        });
        expect(report.sessions.count).toBe(3); // broken.jsonl skipped
        expect(report.sessions.oldest).toBe(T1);
        expect(report.sessions.newest).toBe(T3);
        expect(report.windowDays).toBe(7);
        expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test("2. message counts, per-session model census, token sums", async () => {
        const fx = buildMainFixture();
        const report = await buildInsightsReport({
            cwd: fx.cwd,
            sessionsDir: fx.sessionsDir,
            receiptsDir: fx.receiptsDir,
            fetchUsage: async () => null,
        });
        expect(report.messages).toEqual({ user: 3, assistant: 3 });
        // agnes-3.0-flash used in sess-1 + sess-2 → 2 sessions; gpt-4o → 1.
        expect(report.topModels).toEqual([
            { model: "agnes-3.0-flash", count: 2 },
            { model: "gpt-4o", count: 1 },
        ]);
        // prompt 1000+500+100 · completion 200+50+10 · cached (4096+512)+(1024+0)+0
        expect(report.tokens).toEqual({ prompt: 1600, completion: 260, cached: 5632 });
    });

    test("3. activeProjects from header.cwd, top count desc", async () => {
        const fx = buildMainFixture();
        const report = await buildInsightsReport({
            cwd: fx.cwd,
            sessionsDir: fx.sessionsDir,
            receiptsDir: fx.receiptsDir,
            fetchUsage: async () => null,
        });
        expect(report.activeProjects).toEqual([
            { cwd: fx.cwd, count: 2 },
            { cwd: fx.otherCwd, count: 1 },
        ]);
    });

    test("4. friction: failed toolResults (block + string content), distinct sessions, error notes", async () => {
        const fx = buildMainFixture();
        const report = await buildInsightsReport({
            cwd: fx.cwd,
            sessionsDir: fx.sessionsDir,
            receiptsDir: fx.receiptsDir,
            fetchUsage: async () => null,
        });
        expect(report.friction.failedToolResults).toBe(2); // m6 + m7, both in sess-2
        expect(report.friction.sessionsWithErrors).toBe(1);
        expect(report.friction.errorNotes).toBe(1); // the LONG_ERROR_NOTE receipt
    });

    test("5. maxSessions caps at the most-recent files by mtime", async () => {
        const cwd = makeRoot("cap");
        const sessionsDir = join(cwd, "sessions");
        mkdirSync(sessionsDir, { recursive: true });
        for (let i = 1; i <= 4; i++) {
            const file = join(sessionsDir, `s${i}.jsonl`);
            writeJsonl(file, [{ type: "session", id: `s${i}`, timestamp: `2026-10-0${i}T00:00:00.000Z`, cwd: join(cwd, `proj-${i}`) }]);
            const at = new Date(Date.parse(`2026-10-0${i}T12:00:00.000Z`)); // i=4 newest
            utimesSync(file, at, at);
        }
        const report = await buildInsightsReport({
            cwd,
            sessionsDir,
            receiptsDir: join(cwd, "receipts"),
            maxSessions: 2,
            fetchUsage: async () => null,
        });
        expect(report.sessions.count).toBe(2);
        // Equal counts tie-break alphabetically (the deterministic ranking):
        // proj-3 before proj-4; proj-1/proj-2 were capped OUT by mtime.
        expect(report.activeProjects.map((p) => p.cwd)).toEqual([join(cwd, "proj-3"), join(cwd, "proj-4")]);
    });

    test("6. malformed entry LINES inside a valid session are skipped, not fatal; empty and non-header files skipped", async () => {
        const cwd = makeRoot("tolerant");
        const sessionsDir = join(cwd, "sessions");
        mkdirSync(sessionsDir, { recursive: true });
        writeFileSync(join(sessionsDir, "empty.jsonl"), "");
        writeJsonl(join(sessionsDir, "nonheader.jsonl"), [
            { type: "message", id: "x", parentId: null, timestamp: T1, message: { role: "user", content: "first line is not a session header" } },
        ]);
        writeFileSync(
            join(sessionsDir, "valid-with-garbage.jsonl"),
            [
                JSON.stringify({ type: "session", id: "g1", timestamp: T1, cwd }),
                "{not json",
                JSON.stringify({ type: "message", id: "g2", parentId: null, timestamp: T1, message: { role: "user", content: "still counted" } }),
            ].join("\n") + "\n",
        );
        const report = await buildInsightsReport({
            cwd,
            sessionsDir,
            receiptsDir: join(cwd, "receipts"),
            fetchUsage: async () => null,
        });
        expect(report.sessions.count).toBe(1); // empty + non-header files skipped
        expect(report.messages.user).toBe(1); // garbage line dropped, good line kept
    });
});

// ---------------------------------------------------------------------------
// buildInsightsReport — the receipts scan
// ---------------------------------------------------------------------------

describe("buildInsightsReport (receipts)", () => {
    test("7. tool ranking + file relativization (inside → relative, outside stays absolute, read excluded)", async () => {
        const fx = buildMainFixture();
        const report = await buildInsightsReport({
            cwd: fx.cwd,
            sessionsDir: fx.sessionsDir,
            receiptsDir: fx.receiptsDir,
            fetchUsage: async () => null,
        });
        expect(report.topTools).toEqual([
            { tool: "write", count: 3 },
            { tool: "bash", count: 1 },
            { tool: "edit", count: 1 },
            { tool: "read", count: 1 },
        ]);
        expect(report.topFiles).toEqual([
            { path: "src/app.ts", count: 2 }, // relative + absolute-inside forms merged
            { path: "/etc/hosts", count: 1 }, // outside cwd → stays absolute
            { path: "src/util.ts", count: 1 }, // absolute-inside → relativized
        ]);
        // README.md was only READ — never in topFiles.
        expect(report.topFiles.find((f) => f.path.includes("README"))).toBeUndefined();
    });

    test("8. notes: count, latest (content field, newest ts, 120-char cap)", async () => {
        const fx = buildMainFixture();
        const report = await buildInsightsReport({
            cwd: fx.cwd,
            sessionsDir: fx.sessionsDir,
            receiptsDir: fx.receiptsDir,
            fetchUsage: async () => null,
        });
        expect(report.notes.count).toBe(2);
        expect(report.notes.latest).toBeDefined();
        expect(report.notes.latest?.ts).toBe(new Date(NT2 + 2).toISOString());
        expect(report.notes.latest?.text.length).toBe(120); // capped exactly
        expect(report.notes.latest?.text.endsWith("…")).toBe(true);
        expect(report.notes.latest?.text.startsWith("bash failed with exit code 1")).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// buildInsightsReport — bridge injection + zeroed reports
// ---------------------------------------------------------------------------

describe("buildInsightsReport (bridge + robustness)", () => {
    test("9. injected fetchUsage: called with the window (default 7, passthrough 3); summary lands verbatim", async () => {
        const fx = buildMainFixture();
        const calls: number[] = [];
        const report = await buildInsightsReport({
            cwd: fx.cwd,
            sessionsDir: fx.sessionsDir,
            receiptsDir: fx.receiptsDir,
            fetchUsage: async (days) => {
                calls.push(days);
                return makeUsageSummary();
            },
        });
        expect(calls).toEqual([7]);
        expect(report.bridge).not.toBeNull();
        expect(report.bridge?.totals.requests).toBe(42);
        expect(report.bridge?.totals.costUsd).toBe(1.25);

        const days3 = await buildInsightsReport({
            cwd: fx.cwd,
            sessionsDir: fx.sessionsDir,
            receiptsDir: fx.receiptsDir,
            days: 3,
            fetchUsage: async (days) => {
                calls.push(days);
                return null;
            },
        });
        expect(days3.windowDays).toBe(3);
        expect(calls).toEqual([7, 3]);
    });

    test("10. null-returning and THROWING fetchUsage → bridge null (report unaffected)", async () => {
        const fx = buildMainFixture();
        const down = await buildInsightsReport({
            cwd: fx.cwd,
            sessionsDir: fx.sessionsDir,
            receiptsDir: fx.receiptsDir,
            fetchUsage: async () => null,
        });
        expect(down.bridge).toBeNull();
        expect(down.sessions.count).toBe(3); // local scans unaffected

        const threw = await buildInsightsReport({
            cwd: fx.cwd,
            sessionsDir: fx.sessionsDir,
            receiptsDir: fx.receiptsDir,
            fetchUsage: async () => {
                throw new Error("bridge down");
            },
        });
        expect(threw.bridge).toBeNull();
        expect(threw.messages.user).toBe(3);
    });

    test("11. missing dirs → zeroed report that renders without throwing", async () => {
        const cwd = makeRoot("empty");
        const report = await buildInsightsReport({
            cwd,
            sessionsDir: join(cwd, "no-sessions"),
            receiptsDir: join(cwd, "no-receipts"),
            fetchUsage: async () => null,
        });
        expect(report.sessions.count).toBe(0);
        expect(report.sessions.oldest).toBeUndefined();
        expect(report.sessions.newest).toBeUndefined();
        expect(report.messages).toEqual({ user: 0, assistant: 0 });
        expect(report.topModels).toEqual([]);
        expect(report.topFiles).toEqual([]);
        expect(report.topTools).toEqual([]);
        expect(report.activeProjects).toEqual([]);
        expect(report.notes.count).toBe(0);
        expect(report.notes.latest).toBeUndefined();
        expect(report.tokens).toEqual({ prompt: 0, completion: 0, cached: 0 });
        expect(report.bridge).toBeNull();
        expect(report.friction.failedToolResults).toBe(0);
        expect(report.friction.sessionsWithErrors).toBe(0);
        expect(() => renderInsightsReport(report)).not.toThrow();
        expect(renderInsightsReport(report)).toContain("no sessions found");
    });
});

// ---------------------------------------------------------------------------
// renderInsightsReport
// ---------------------------------------------------------------------------

describe("renderInsightsReport", () => {
    test("12. contains every section header + the closing line", async () => {
        const fx = buildMainFixture();
        const report = await buildInsightsReport({
            cwd: fx.cwd,
            sessionsDir: fx.sessionsDir,
            receiptsDir: fx.receiptsDir,
            fetchUsage: async () => makeUsageSummary(),
        });
        const text = renderInsightsReport(report);
        for (const header of [
            "── SESSIONS · 3 ──",
            "── ACTIVITY · 6 messages ──",
            "── MODELS · 2 ──",
            "── FILES · most-touched ──",
            "── TOOLS · 6 calls ──",
            "── LEARNING · 2 notes ──",
            "── TOKENS · 7,492 total ──",
            "── FRICTION · 2 failed tool results ──",
        ]) {
            expect(text).toContain(header);
        }
        expect(text).toContain(`window: 7 days · generated ${report.generatedAt}`);
    });

    test("13. renders content rows with locale-formatted numbers, projects, models, files, tools, notes, tokens, bridge cost", async () => {
        const fx = buildMainFixture();
        const report = await buildInsightsReport({
            cwd: fx.cwd,
            sessionsDir: fx.sessionsDir,
            receiptsDir: fx.receiptsDir,
            fetchUsage: async () => makeUsageSummary(),
        });
        const text = renderInsightsReport(report);
        expect(text).toContain("3 sessions · 2026-10-19 10:00 → 2026-10-21 09:00");
        expect(text).toContain("user 3 · assistant 3");
        expect(text).toContain(`  ${fx.cwd} · 2 sessions`);
        expect(text).toContain(`  ${fx.otherCwd} · 1 session`);
        expect(text).toContain("  agnes-3.0-flash · 2 sessions");
        expect(text).toContain("  gpt-4o · 1 session");
        expect(text).toContain("  src/app.ts · 2 touches");
        expect(text).toContain("  /etc/hosts · 1 touch");
        expect(text).toContain("  write · 3");
        expect(text).toContain(`  latest: ${report.notes.latest?.text} · 2026-10-20 12:00`);
        expect(text).toContain("  prompt 1,600 · completion 260 · cached 5,632"); // en-US grouping
        expect(text).toContain("  bridge 7d · 42 requests · 3 errors · ~$1.2500"); // formatCostUsd(1.25, estimate)
        expect(text).toContain("  2 failed tool results · 1 of 3 sessions affected");
        expect(text).toContain("  error notes: 1");
    });

    test("14. honest money: `cost —` when bridge costUsd is null; `bridge: unreachable` when the bridge is down", async () => {
        const fx = buildMainFixture();
        const summary = makeUsageSummary();
        summary.totals = { ...summary.totals, costUsd: null };
        const noCost = await buildInsightsReport({
            cwd: fx.cwd,
            sessionsDir: fx.sessionsDir,
            receiptsDir: fx.receiptsDir,
            fetchUsage: async () => summary,
        });
        const noCostText = renderInsightsReport(noCost);
        expect(noCostText).toContain("cost —");
        expect(noCostText).not.toContain("~$");

        const down = await buildInsightsReport({
            cwd: fx.cwd,
            sessionsDir: fx.sessionsDir,
            receiptsDir: fx.receiptsDir,
            fetchUsage: async () => null,
        });
        expect(renderInsightsReport(down)).toContain("bridge: unreachable");
    });

    test("15. caps every list at 8 rows with `… +N more` (15-file fixture)", async () => {
        const cwd = makeRoot("caps");
        const sessionsDir = join(cwd, "sessions");
        const receiptsDir = join(cwd, "receipts");
        writeJsonl(join(sessionsDir, "s.jsonl"), [
            { type: "session", id: "s", timestamp: T1, cwd },
            { type: "message", id: "m1", parentId: null, timestamp: T1, message: { role: "user", content: "write many files" } },
        ]);
        const entries: unknown[] = [{ kind: "session_start", subagent: false, cwd, seq: 1, ts: NT1 }];
        for (let i = 1; i <= 15; i++) {
            entries.push({ kind: "tool_call", id: `w${i}`, tool: "write", input: { path: `src/file-${String(i).padStart(2, "0")}.ts` }, seq: i + 1, ts: NT1 + i });
        }
        writeJsonl(join(receiptsDir, "l.jsonl"), entries);
        const report = await buildInsightsReport({ cwd, sessionsDir, receiptsDir, fetchUsage: async () => null });
        // The report carries the full ranking; only the RENDER is capped.
        expect(report.topFiles.length).toBe(15);
        const text = renderInsightsReport(report);
        const fileRows = text.split("\n").filter((l) => l.startsWith("  src/file-"));
        expect(fileRows.length).toBe(8); // RENDER_ROW_CAP
        expect(text).toContain("… +7 more");
        expect(text).toContain("  src/file-01.ts · 1 touch");
        expect(text).toContain("  src/file-08.ts · 1 touch");
        expect(text).not.toContain("src/file-09.ts");
    });

    test("16. deterministic: two renders of the same report are byte-identical", async () => {
        const fx = buildMainFixture();
        const report = await buildInsightsReport({
            cwd: fx.cwd,
            sessionsDir: fx.sessionsDir,
            receiptsDir: fx.receiptsDir,
            fetchUsage: async () => makeUsageSummary(),
        });
        expect(renderInsightsReport(report)).toBe(renderInsightsReport(report));
    });
});

// ---------------------------------------------------------------------------
// insightsHintLine
// ---------------------------------------------------------------------------

describe("insightsHintLine", () => {
    test("17. single-line footer naming the scanned sources", () => {
        const hint = insightsHintLine();
        expect(typeof hint).toBe("string");
        expect(hint.length).toBeGreaterThan(0);
        expect(hint).not.toContain("\n");
        expect(hint).toContain("session");
        expect(hint).toContain("receipts");
        expect(hint).toContain("bridge");
    });
});
