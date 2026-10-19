// usage-cli.test.ts — `unown usage` (the opencode/Cursor-style usage & cost
// report; see src/usage-cli.ts).
//
// Pins:
//   1. flag grammar — --days/--model/--json/-h, inline --flag=value forms,
//      every invalid shape errors with usage (clig.dev)
//   2. rendering — the table (columns, TOTAL row, ~$ estimate marker, — for
//      unknown prices, honest note lines) from a FIXTURE summary; --json shape
//   3. sourcing — bridge API when up (in-process Bun.serve mock; asserts the
//      days/model query params), direct JSONL read when down (dead port +
//      UNOWN_BRIDGE_STATE_DIR temp dir), and the honest dead-everywhere error
//   4. mirror parity — the direct-read path shares its golden fixture with
//      mini-services/llm-bridge/usage.test.ts: the same records must
//      aggregate to the same numbers on both sides (the mirror cannot drift
//      silently)
//   5. pricing overrides — UNOWN_PRICE_<MODEL>_IN/OUT flip the estimate
//      markers on the direct-read path
import "./_env.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
        aggregateUsage,
        fetchBridgeUsage,
        formatCostUsd,
        formatDuration,
        formatInt,
        parseUsageFlags,
        renderUsageTable,
        resolveBridgeUrl,
        resolveUsageStateDir,
        runUsageCommand,
        type UsageRecord,
        type UsageSummary,
} from "../src/usage-cli.ts";

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** Same fixed "now" as mini-services/llm-bridge/usage.test.ts: 2026-10-19T12:00:00.000Z. */
const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);

// ---------------------------------------------------------------------------
// The shared golden fixture (MIRROR — keep byte-identical expectations with
// the bridge's usage.test.ts; see "mirror parity" below).
// ---------------------------------------------------------------------------

const FIXTURE: UsageRecord[] = [
        { ts: NOW - 2 * HOUR, model: "kimi-k2.5", upstreamModel: "kimi-k2.5", promptTokens: 1_000_000, completionTokens: 500_000, durationMs: 1000, status: "ok" },
        { ts: NOW - 3 * HOUR, model: "qwen3.7-plus", upstreamModel: "qwen3.7-plus", promptTokens: 500_000, completionTokens: 100_000, durationMs: 2000, status: "ok" },
        { ts: NOW - 1 * HOUR, model: "local-qwen3-0.6b", upstreamModel: "local:local-qwen3-0.6b", promptTokens: 10_000, completionTokens: 1_000, durationMs: 100, status: "ok" },
        { ts: NOW - 10 * 60_000, model: "kimi-k2.5", upstreamModel: "kimi-k2.5", promptTokens: 1_000, completionTokens: 100, cachedTokens: 40, durationMs: 50, status: "ok" },
        { ts: NOW - 26 * HOUR, model: "kimi-k2.5", upstreamModel: "kimi-k2.5", promptTokens: 0, completionTokens: 0, durationMs: 3000, status: "error", error: "upstream 500: boom" },
        { ts: NOW - 30 * HOUR, model: "glm-4-plus", upstreamModel: "kimi-k2.5", promptTokens: 200_000, completionTokens: 100_000, durationMs: 400, status: "ok" },
        { ts: NOW - 3 * DAY, model: "kimi-k2.5", upstreamModel: "kimi-k2.5", promptTokens: 100_000, completionTokens: 50_000, durationMs: 500, status: "ok" },
        { ts: NOW - 8 * DAY, model: "qwen3.6-plus", upstreamModel: "qwen3.6-plus", promptTokens: 999, completionTokens: 999, durationMs: 999, status: "ok" },
];

/** The 1-day summary over FIXTURE — used as the API-fixture AND the golden direct-read expectation. */
const FIXTURE_SUMMARY: UsageSummary = {
        since: NOW - DAY,
        days: 1,
        model: null,
        totals: { requests: 4, errors: 0, promptTokens: 1_511_000, completionTokens: 601_100, cachedTokens: 40, costUsd: null },
        byModel: [
                { model: "kimi-k2.5", requests: 2, promptTokens: 1_001_000, completionTokens: 500_100, tokens: 1_501_100, costUsd: 1.85085, avgDurationMs: 525 },
                { model: "local-qwen3-0.6b", requests: 1, promptTokens: 10_000, completionTokens: 1_000, tokens: 11_000, costUsd: null, avgDurationMs: 100 },
                { model: "qwen3.7-plus", requests: 1, promptTokens: 500_000, completionTokens: 100_000, tokens: 600_000, costUsd: 0.7, avgDurationMs: 2000 },
        ],
        byDay: [{ date: "2026-10-19", requests: 4, tokens: 2_112_100, costUsd: null }],
        skippedLines: 1,
        linesRead: 5,
        truncated: false,
        pricing: { estimate: true, overridden: [], unknownModels: ["local-qwen3-0.6b"] },
};

let TMP = "";
beforeAll(() => {
        TMP = mkdtempSync(join(tmpdir(), "unown-usage-cli-"));
});
afterAll(() => {
        try {
                rmSync(TMP, { recursive: true, force: true });
        } catch {
                /* best effort */
        }
});

function fixtureLogDir(records: UsageRecord[], extraLines: string[] = []): string {
        const dir = join(TMP, `log-${Math.random().toString(36).slice(2)}`);
        mkdirSync(dir, { recursive: true });
        // Chronological (oldest first) — the real log is appended at settle time,
        // so the backward tail reader expects roughly ts-ordered lines.
        const ordered = [...records].sort((a, b) => a.ts - b.ts);
        const body = [...ordered.map((r) => JSON.stringify(r)), ...extraLines].join("\n");
        writeFileSync(join(dir, "usage-log.jsonl"), body.endsWith("\n") || body === "" ? body : `${body}\n`, "utf8");
        return dir;
}

/** Env for the direct-read path: dead bridge + explicit state dir, nothing inherited. */
function directEnv(stateDir: string, extra: Record<string, string> = {}): Record<string, string | undefined> {
        return { PI_BRIDGE_URL: "http://127.0.0.1:9", UNOWN_BRIDGE_STATE_DIR: stateDir, ...extra };
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

describe("parseUsageFlags", () => {
        test("defaults: last 24h, no filter, human table", () => {
                expect(parseUsageFlags([])).toEqual({ days: 1, json: false, help: false });
        });

        test("--days / --model / --json (space and = forms)", () => {
                expect(parseUsageFlags(["--days", "7", "--model", "kimi-k2.5", "--json"])).toEqual({ days: 7, model: "kimi-k2.5", json: true, help: false });
                expect(parseUsageFlags(["--days=7", "--model=kimi-k2.5"])).toEqual({ days: 7, model: "kimi-k2.5", json: false, help: false });
        });

        test("invalid days values error with a clear message", () => {
                for (const argv of [["--days"], ["--days", "0"], ["--days", "-3"], ["--days", "x"], ["--days", "366"], ["--days", "1.5"]]) {
                        const flags = parseUsageFlags(argv);
                        expect(flags.error).toMatch(/--days expects an integer 1-365/);
                }
        });

        test("unknown flags and positionals error (usage takes flags only)", () => {
                expect(parseUsageFlags(["--week"]).error).toMatch(/unknown flag "--week"/);
                expect(parseUsageFlags(["kimi-k2.5"]).error).toMatch(/unexpected argument/);
                expect(parseUsageFlags(["--model"]).error).toMatch(/--model expects a model id/);
        });

        test("-h / --help", () => {
                expect(parseUsageFlags(["-h"]).help).toBe(true);
                expect(parseUsageFlags(["--help"]).help).toBe(true);
        });
});

// ---------------------------------------------------------------------------
// Formatting + rendering (pure)
// ---------------------------------------------------------------------------

describe("rendering", () => {
        test("the table: header, model rows, TOTAL row, ~$ estimate marker, — for unknown price", () => {
                const out = renderUsageTable(FIXTURE_SUMMARY);
                expect(out).toContain("LLM usage — last 1 day (since 2026-10-18 12:00 UTC)");
                expect(out).toContain("MODEL");
                expect(out).toContain("REQUESTS");
                expect(out).toContain("TOKENS IN");
                expect(out).toContain("TOKENS OUT");
                expect(out).toContain("AVG LATENCY");
                expect(out).toContain("kimi-k2.5");
                expect(out).toContain("~$1.8509"); // estimate marker
                expect(out).toContain("~$0.7000");
                expect(out).toContain("—"); // local-qwen3-0.6b has no price data
                expect(out).toContain("TOTAL");
                expect(out).toContain("4"); // requests
                expect(out).toContain("1,511,000"); // comma-grouped tokens
                expect(out).toContain("525ms");
                expect(out).toContain("2.0s");
        });

        test("honest note lines: estimate, unknown models, skipped lines, source", () => {
                const out = renderUsageTable(FIXTURE_SUMMARY, { sourceNote: "source: /x/usage-log.jsonl (direct read)" });
                expect(out).toContain("costs are ~estimates — set UNOWN_PRICE_<MODEL>_IN/OUT");
                expect(out).toContain("no price data for: local-qwen3-0.6b");
                expect(out).toContain("1 malformed log line(s) skipped");
                expect(out).toContain("source: /x/usage-log.jsonl");
        });

        test("env-pinned prices drop the ~ marker and the estimate note", () => {
                const pinned: UsageSummary = { ...FIXTURE_SUMMARY, pricing: { estimate: false, overridden: ["kimi-k2.5"], unknownModels: [] } };
                const out = renderUsageTable(pinned);
                expect(out).toContain("$1.8509");
                expect(out).not.toContain("~$");
                expect(out).not.toContain("costs are ~estimates");
        });

        test("empty window: friendly message, no table", () => {
                const empty: UsageSummary = { ...FIXTURE_SUMMARY, totals: { ...FIXTURE_SUMMARY.totals, requests: 0 }, byModel: [], byDay: [] };
                const out = renderUsageTable(empty);
                expect(out).toContain("No usage recorded in this window");
                expect(out).not.toContain("TOTAL");
        });

        test("truncation note when the read hit the line cap", () => {
                const out = renderUsageTable({ ...FIXTURE_SUMMARY, truncated: true });
                expect(out).toContain("line cap");
        });

        test("formatters: cost / duration / int", () => {
                expect(formatCostUsd(null, true)).toBe("—");
                expect(formatCostUsd(1.85085, true)).toBe("~$1.8509");
                expect(formatCostUsd(1.85085, false)).toBe("$1.8509");
                expect(formatDuration(525)).toBe("525ms");
                expect(formatDuration(2000)).toBe("2.0s");
                expect(formatInt(1_511_000)).toBe("1,511,000");
        });
});

// ---------------------------------------------------------------------------
// Sourcing: bridge API vs direct file read vs honest failure
// ---------------------------------------------------------------------------

describe("runUsageCommand — bridge API path", () => {
        let server: ReturnType<typeof Bun.serve>;
        let seenUrls: string[] = [];

        beforeAll(() => {
                seenUrls = [];
                server = Bun.serve({
                        port: 0,
                        async fetch(req) {
                                const url = new URL(req.url);
                                seenUrls.push(url.pathname + url.search);
                                if (url.pathname === "/v1/usage") return Response.json(FIXTURE_SUMMARY);
                                return new Response("not found", { status: 404 });
                        },
                });
        });
        afterAll(() => {
                server?.stop(true);
        });

        test("renders the bridge's aggregate and passes days/model as query params", async () => {
                const res = await runUsageCommand(["--days", "7", "--model", "kimi-k2.5"], { env: { PI_BRIDGE_URL: `http://127.0.0.1:${server.port}` } });
                expect(res.exitCode).toBe(0);
                expect(res.stdout).toContain("kimi-k2.5");
                expect(seenUrls.at(-1)).toBe("/v1/usage?days=7&model=kimi-k2.5");
        });

        test("--json: machine-readable shape with source bridge", async () => {
                const res = await runUsageCommand(["--json"], { env: { PI_BRIDGE_URL: `http://127.0.0.1:${server.port}` } });
                expect(res.exitCode).toBe(0);
                const parsed = JSON.parse(res.stdout!.trim());
                expect(parsed.source).toBe("bridge");
                expect(parsed.bridgeUrl).toBe(`http://127.0.0.1:${server.port}`);
                expect(parsed.summary.totals.requests).toBe(4);
                expect(parsed.summary.byModel[0].model).toBe("kimi-k2.5");
        });

        test("a malformed bridge response falls through to the direct read", async () => {
                const bad = Bun.serve({
                        port: 0,
                        fetch: () => new Response("hmm", { status: 200, headers: { "Content-Type": "application/json" } }),
                });
                try {
                        const dir = fixtureLogDir(FIXTURE.slice(0, 4));
                        const res = await runUsageCommand(["--json"], { env: { PI_BRIDGE_URL: `http://127.0.0.1:${bad.port}`, UNOWN_BRIDGE_STATE_DIR: dir }, now: () => NOW });
                        expect(res.exitCode).toBe(0);
                        expect(JSON.parse(res.stdout!.trim()).source).toBe("file");
                } finally {
                        bad.stop(true);
                }
        });
});

describe("runUsageCommand — direct file read (bridge down)", () => {
        test("--help prints usage, exit 0", async () => {
                const res = await runUsageCommand(["--help"], { env: {} });
                expect(res.exitCode).toBe(0);
                expect(res.stdout).toContain("unown usage — token & cost report");
        });

        test("bad flag: exit 1, usage on stderr", async () => {
                const res = await runUsageCommand(["--days", "nope"], { env: {} });
                expect(res.exitCode).toBe(1);
                expect(res.stderr).toContain("--days expects an integer 1-365");
                expect(res.stderr).toContain("Usage:");
        });

        test("golden 1-day window: MIRROR PARITY with the bridge's own aggregation", async () => {
                const dir = fixtureLogDir(FIXTURE, ["{a torn line"]);
                const res = await runUsageCommand([], { env: directEnv(dir), now: () => NOW });
                expect(res.exitCode).toBe(0);
                // the same numbers mini-services/llm-bridge/usage.test.ts pins for the
                // same fixture — if either implementation drifts, one of the two fails
                expect(res.stdout).toContain("kimi-k2.5");
                expect(res.stdout).toContain("~$1.8509");
                expect(res.stdout).toContain("~$0.7000");
                expect(res.stdout).toContain("—");
                expect(res.stdout).toContain("TOTAL");
                expect(res.stdout).toContain("source: ");
                expect(res.stdout).toContain("(direct read — the bridge at http://127.0.0.1:9 was unreachable)");
        });

        test("--json direct read: skipped lines surface, source file, exact golden totals", async () => {
                const dir = fixtureLogDir(FIXTURE, ["{a torn line"]);
                const res = await runUsageCommand(["--json"], { env: directEnv(dir), now: () => NOW });
                expect(res.exitCode).toBe(0);
                const parsed = JSON.parse(res.stdout!.trim());
                expect(parsed.source).toBe("file");
                expect(parsed.file).toBe(join(dir, "usage-log.jsonl"));
                expect(parsed.summary.totals).toEqual({ requests: 4, errors: 0, promptTokens: 1_511_000, completionTokens: 601_100, cachedTokens: 40, costUsd: null });
                expect(parsed.summary.byModel).toHaveLength(3);
                expect(parsed.summary.byDay).toEqual([{ date: "2026-10-19", requests: 4, tokens: 2_112_100, costUsd: null }]);
                expect(parsed.summary.skippedLines).toBe(1);
                expect(parsed.summary.pricing.unknownModels).toEqual(["local-qwen3-0.6b"]);
        });

        test("--days 7 widens the window; --model filters (routed requests group under the filter)", async () => {
                const dir = fixtureLogDir(FIXTURE);
                const week = await runUsageCommand(["--days", "7", "--json"], { env: directEnv(dir), now: () => NOW });
                const parsed = JSON.parse(week.stdout!.trim());
                expect(parsed.summary.totals.requests).toBe(7);
                expect(parsed.summary.totals.errors).toBe(1);
                const kimi = await runUsageCommand(["--days", "7", "--model", "kimi-k2.5", "--json"], { env: directEnv(dir), now: () => NOW });
                const k = JSON.parse(kimi.stdout!.trim()).summary;
                expect(k.totals.requests).toBe(5); // 4 kimi + glm-4-plus routed onto kimi
                expect(k.byModel).toHaveLength(1);
                expect(k.byModel[0].costUsd).toBe(2.40585);
        });

        test("UNOWN_PRICE_* overrides apply to the direct read (no ~ marker, no estimate note)", async () => {
                const dir = fixtureLogDir(FIXTURE.slice(0, 1)); // kimi-k2.5 only
                const res = await runUsageCommand([], { env: directEnv(dir, { UNOWN_PRICE_KIMI_K2_5_IN: "1", UNOWN_PRICE_KIMI_K2_5_OUT: "4" }), now: () => NOW });
                expect(res.exitCode).toBe(0);
                expect(res.stdout).toContain("$3.0000"); // 1M*1 + 0.5M*4
                expect(res.stdout).not.toContain("~$");
                expect(res.stdout).not.toContain("costs are ~estimates");
        });

        test("bridge down AND no log file: honest error with both fixes, exit 1", async () => {
                const res = await runUsageCommand([], { env: directEnv(join(TMP, "no-such-dir")), now: () => NOW });
                expect(res.exitCode).toBe(1);
                expect(res.stderr).toContain("not reachable at http://127.0.0.1:9");
                expect(res.stderr).toContain("no usage log exists at");
                expect(res.stderr).toContain("bun run agent:start");
                expect(res.stderr).toContain("UNOWN_BRIDGE_STATE_DIR=");
        });

        test("empty window: friendly message, exit 0", async () => {
                const dir = fixtureLogDir(FIXTURE.slice(7, 8)); // only the 8-day-old record
                const res = await runUsageCommand([], { env: directEnv(dir), now: () => NOW });
                expect(res.exitCode).toBe(0);
                expect(res.stdout).toContain("No usage recorded in this window");
        });
});

// ---------------------------------------------------------------------------
// Pure helpers used by the command (path + url resolution, aggregation)
// ---------------------------------------------------------------------------

describe("resolveBridgeUrl / resolveUsageStateDir", () => {
        test("bridge url: PI_BRIDGE_URL wins, trailing slash stripped, 127.0.0.1:3031 default", () => {
                expect(resolveBridgeUrl({})).toBe("http://127.0.0.1:3031");
                expect(resolveBridgeUrl({ PI_BRIDGE_URL: "http://localhost:9999/" })).toBe("http://localhost:9999");
                expect(resolveBridgeUrl({ PI_BRIDGE_URL: "" })).toBe("http://127.0.0.1:3031"); // empty .env value means unset
        });

        test("state dir: UNOWN_BRIDGE_STATE_DIR wins; $UNOWN_HOME/bridge fallback", () => {
                expect(resolveUsageStateDir({ UNOWN_BRIDGE_STATE_DIR: "/x/y" }, "/nowhere")).toBe("/x/y");
                expect(resolveUsageStateDir({ UNOWN_HOME: "/tmp/uh" }, "/nowhere")).toBe(join("/tmp/uh", "bridge"));
        });
});

describe("aggregateUsage (CLI mirror)", () => {
        test("mirror parity: the same fixture aggregates to the bridge-side golden numbers", () => {
                const s = aggregateUsage(FIXTURE, { sinceTs: NOW - DAY, days: 1, env: {} });
                expect(s.totals).toEqual(FIXTURE_SUMMARY.totals);
                expect(s.byModel).toEqual(FIXTURE_SUMMARY.byModel);
                expect(s.byDay).toEqual(FIXTURE_SUMMARY.byDay);
                expect(s.pricing).toEqual({ estimate: true, overridden: [], unknownModels: ["local-qwen3-0.6b"] });
        });

        test("env-pinned pricing flips the markers (parity with the bridge side)", () => {
                const s = aggregateUsage(FIXTURE.slice(0, 1), { sinceTs: NOW - DAY, days: 1, env: { UNOWN_PRICE_KIMI_K2_5_IN: "1", UNOWN_PRICE_KIMI_K2_5_OUT: "4" } });
                expect(s.totals.costUsd).toBe(3);
                expect(s.pricing).toEqual({ estimate: false, overridden: ["kimi-k2.5"], unknownModels: [] });
        });
});

describe("fetchBridgeUsage", () => {
        test("unreachable bridge → null (never a throw)", async () => {
                expect(await fetchBridgeUsage("http://127.0.0.1:9", 1, undefined, undefined)).toBeNull();
        });
});
