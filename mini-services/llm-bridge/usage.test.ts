// Unit tests for mini-services/llm-bridge/usage.ts — persistent usage & cost
// tracking (the opencode/Cursor-style observability layer).
//
// Covers the four contracts the module owns:
//   1. JSONL persistence — crash-safe appends, 10 MB rotation to one `.1`
//      generation (Windows-safe replace), never-throws failure mode.
//   2. Backward tail reading — stops at the first out-of-window record,
//      tolerates malformed/torn lines (skipped + counted), honors the line
//      cap, merges active + rotated files with a shared budget.
//   3. Pricing — the built-in ESTIMATE table, UNOWN_PRICE_<MODEL>_IN/OUT
//      env overrides (both halves required), unknown models → null (not 0),
//      float-artifact-free rounding.
//   4. Aggregation — multi-model multi-day fixtures → exact totals / byModel
//      / byDay (UTC day keys), model filtering incl. routed requests, cost
//      null-propagation through buckets, pricing metadata.
//
// Same conventions as pure.test.ts: bun:test, zero new deps, every env read
// goes through an explicit record — process.env is never consulted.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
        aggregateUsage,
        appendUsageRecord,
        buildUsageSummary,
        dayKeyUtc,
        estimateRecordCostUsd,
        MODEL_PRICES_ESTIMATE,
        parseUsageLine,
        priceEnvVarSuffix,
        readUsageTail,
        readUsageTails,
        resolveModelPrice,
        resolveUsageStateDir,
        roundCostUsd,
        USAGE_LOG_FILE_NAME,
        type UsageRecord,
} from "./usage";

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** Fixed "now": 2026-10-19T12:00:00.000Z — deterministic UTC day buckets. */
const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

let TMP = "";

beforeAll(() => {
        TMP = mkdtempSync(join(tmpdir(), "unown-bridge-usage-"));
});
afterAll(() => {
        try {
                rmSync(TMP, { recursive: true, force: true });
        } catch {
                /* best effort */
        }
});

/** The multi-model multi-day fixture (see the golden aggregation tests). */
const FIXTURE: UsageRecord[] = [
        // today (2026-10-19), in the 1-day window
        { ts: NOW - 2 * HOUR, model: "kimi-k2.5", upstreamModel: "kimi-k2.5", promptTokens: 1_000_000, completionTokens: 500_000, durationMs: 1000, status: "ok" },
        { ts: NOW - 3 * HOUR, model: "qwen3.7-plus", upstreamModel: "qwen3.7-plus", promptTokens: 500_000, completionTokens: 100_000, durationMs: 2000, status: "ok" },
        { ts: NOW - 1 * HOUR, model: "local-qwen3-0.6b", upstreamModel: "local:local-qwen3-0.6b", promptTokens: 10_000, completionTokens: 1_000, durationMs: 100, status: "ok" },
        { ts: NOW - 10 * 60_000, model: "kimi-k2.5", upstreamModel: "kimi-k2.5", promptTokens: 1_000, completionTokens: 100, cachedTokens: 40, durationMs: 50, status: "ok" },
        // yesterday (2026-10-18) — outside 1 day, inside 7
        { ts: NOW - 26 * HOUR, model: "kimi-k2.5", upstreamModel: "kimi-k2.5", promptTokens: 0, completionTokens: 0, durationMs: 3000, status: "error", error: "upstream 500: boom" },
        { ts: NOW - 30 * HOUR, model: "glm-4-plus", upstreamModel: "kimi-k2.5", promptTokens: 200_000, completionTokens: 100_000, durationMs: 400, status: "ok" },
        // 2026-10-16 — inside 7 days only
        { ts: NOW - 3 * DAY, model: "kimi-k2.5", upstreamModel: "kimi-k2.5", promptTokens: 100_000, completionTokens: 50_000, durationMs: 500, status: "ok" },
        // far outside every window
        { ts: NOW - 8 * DAY, model: "qwen3.6-plus", upstreamModel: "qwen3.6-plus", promptTokens: 999, completionTokens: 999, durationMs: 999, status: "ok" },
];

function fixtureFile(name: string, records: UsageRecord[], extraLines: string[] = []): string {
        const file = join(TMP, name);
        const body = [...records.map((r) => JSON.stringify(r)), ...extraLines].join("\n");
        writeFileSync(file, body.endsWith("\n") || body === "" ? body : `${body}\n`, "utf8");
        return file;
}

// ---------------------------------------------------------------------------
// parseUsageLine
// ---------------------------------------------------------------------------

describe("parseUsageLine", () => {
        test("parses a full record", () => {
                const rec = parseUsageLine(JSON.stringify(FIXTURE[0]));
                expect(rec).toMatchObject({
                        ts: FIXTURE[0].ts,
                        model: "kimi-k2.5",
                        upstreamModel: "kimi-k2.5",
                        promptTokens: 1_000_000,
                        completionTokens: 500_000,
                        durationMs: 1000,
                        status: "ok",
                });
                expect(rec?.stream).toBe(false);
                expect(rec?.cachedTokens).toBeUndefined(); // never written by JSON.stringify
        });

        test("tolerates CRLF line endings", () => {
                const rec = parseUsageLine(`${JSON.stringify(FIXTURE[0])}\r`);
                expect(rec?.model).toBe("kimi-k2.5");
        });

        test("garbage / empty / non-JSON → null (never a throw)", () => {
                for (const line of ["", "   ", "not json", "{torn", "[]", "null", "42"]) {
                        expect(parseUsageLine(line)).toBeNull();
                }
        });

        test("shape validation: numeric ts + string model are mandatory", () => {
                expect(parseUsageLine(JSON.stringify({ ts: "123", model: "kimi-k2.5" }))).toBeNull();
                expect(parseUsageLine(JSON.stringify({ ts: 123, model: 42 }))).toBeNull();
                expect(parseUsageLine(JSON.stringify({ ts: 123 }))).toBeNull();
        });

        test("missing optional fields default, unknown status coerces to ok", () => {
                const rec = parseUsageLine('{"ts":1,"model":"m"}');
                expect(rec).toEqual({ ts: 1, model: "m", upstreamModel: undefined, stream: false, promptTokens: 0, completionTokens: 0, cachedTokens: undefined, durationMs: 0, status: "ok", error: undefined });
        });
});

// ---------------------------------------------------------------------------
// appendUsageRecord (persistence + rotation)
// ---------------------------------------------------------------------------

describe("appendUsageRecord", () => {
        test("creates the state dir and appends one JSON line per record", () => {
                const file = join(TMP, "fresh", "deep", USAGE_LOG_FILE_NAME);
                const r1 = appendUsageRecord(file, FIXTURE[0]);
                const r2 = appendUsageRecord(file, FIXTURE[1]);
                expect(r1).toEqual({ appended: true, rotated: false });
                expect(r2.appended).toBe(true);
                const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
                expect(lines).toHaveLength(2);
                expect(parseUsageLine(lines[0])?.model).toBe("kimi-k2.5");
                expect(parseUsageLine(lines[1])?.model).toBe("qwen3.7-plus");
        });

        test("rotates to a single .1 generation when the file exceeds maxBytes", () => {
                const file = join(TMP, "rotate", USAGE_LOG_FILE_NAME);
                appendUsageRecord(file, FIXTURE[0]); // creates the file
                appendUsageRecord(file, FIXTURE[1], 10); // size > 10 → rotate first
                expect(existsSync(`${file}.1`)).toBe(true);
                expect(parseUsageLine(readFileSync(`${file}.1`, "utf8"))?.model).toBe("kimi-k2.5");
                expect(parseUsageLine(readFileSync(file, "utf8"))?.model).toBe("qwen3.7-plus");
                // third append rotates AGAIN — the old .1 is replaced (one generation)
                appendUsageRecord(file, FIXTURE[2], 10);
                expect(parseUsageLine(readFileSync(`${file}.1`, "utf8"))?.model).toBe("qwen3.7-plus");
                expect(parseUsageLine(readFileSync(file, "utf8"))?.model).toBe("local-qwen3-0.6b");
        });

        test("an existing .1 destination is replaced (Windows-safe rm-then-rename)", () => {
                const dir = join(TMP, "rotate-win");
                mkdirSync(dir, { recursive: true });
                const file = join(dir, USAGE_LOG_FILE_NAME);
                writeFileSync(`${file}.1`, "stale generation", "utf8");
                appendUsageRecord(file, FIXTURE[0]); // create active
                appendUsageRecord(file, FIXTURE[1], 10); // rotate over the stale .1
                expect(readFileSync(`${file}.1`, "utf8")).not.toContain("stale");
        });

        test("never throws — an unwritable path reports the failure", () => {
                const blocker = join(TMP, "blocker");
                writeFileSync(blocker, "i am a file", "utf8");
                const res = appendUsageRecord(join(blocker, "usage-log.jsonl"), FIXTURE[0]);
                expect(res.appended).toBe(false);
                expect(res.error).toBeTruthy();
        });
});

// ---------------------------------------------------------------------------
// readUsageTail / readUsageTails (backward streaming)
// ---------------------------------------------------------------------------

describe("readUsageTail", () => {
        test("returns in-window records in file order, stopping at the first older record", () => {
                const oldRec: UsageRecord = { ts: NOW - 5 * DAY, model: "kimi-k2.5", upstreamModel: "kimi-k2.5", promptTokens: 1, completionTokens: 1, durationMs: 1, status: "ok" };
                const inWindow = FIXTURE.slice(0, 3);
                const file = fixtureFile("tail-basic.jsonl", [oldRec, ...inWindow]);
                const res = readUsageTail(file, NOW - 24 * HOUR);
                expect(res.records.map((r) => r.model)).toEqual(["kimi-k2.5", "qwen3.7-plus", "local-qwen3-0.6b"]);
                expect(res.stoppedAtOldRecord).toBe(true);
                expect(res.hitCap).toBe(false);
                expect(res.skipped).toBe(0);
        });

        test("malformed lines are skipped and counted, valid neighbors survive", () => {
                const inWindow = FIXTURE.slice(0, 3);
                const file = fixtureFile("tail-garbage.jsonl", inWindow, ["{torn write", "not json", ""]);
                const res = readUsageTail(file, NOW - 24 * HOUR);
                expect(res.records).toHaveLength(3);
                expect(res.skipped).toBe(2);
        });

        test("a torn LAST line (crash mid-append, no trailing newline) is tolerated", () => {
                const file = join(TMP, "tail-torn.jsonl");
                writeFileSync(file, `${FIXTURE.slice(0, 2).map((r) => JSON.stringify(r)).join("\n")}\n{"ts":${NOW - 1000},"model":"kim`, "utf8");
                const res = readUsageTail(file, NOW - 24 * HOUR);
                expect(res.records).toHaveLength(2);
                expect(res.skipped).toBe(1);
        });

        test("the line cap bounds the scan and reports truncation", () => {
                const file = fixtureFile("tail-cap.jsonl", FIXTURE.slice(0, 4));
                const res = readUsageTail(file, 0, 2);
                // newest two records survive (file order), the older ones were never read
                expect(res.records.map((r) => r.model)).toEqual(["local-qwen3-0.6b", "kimi-k2.5"]);
                expect(res.hitCap).toBe(true);
                expect(res.linesRead).toBe(2);
        });


        test("a missing file is an empty tail (no throw)", () => {
                const res = readUsageTail(join(TMP, "does-not-exist.jsonl"), 0);
                expect(res.records).toEqual([]);
                expect(res.skipped).toBe(0);
                expect(res.hitCap).toBe(false);
        });

        test("a file with only old records stops immediately without reading the rotated sibling", () => {
                const file = fixtureFile("tail-all-old.jsonl", FIXTURE.slice(7, 8));
                const res = readUsageTail(file, NOW - 24 * HOUR);
                expect(res.records).toEqual([]);
                expect(res.stoppedAtOldRecord).toBe(true);
        });
});

describe("readUsageTails", () => {
        test("active + rotated merge oldest → newest with a shared line budget", () => {
                const active = fixtureFile("multi-active.jsonl", FIXTURE.slice(0, 2)); // newest
                // rotated file, chronological (oldest first): 8d-old stops the backward scan
                const rotated = fixtureFile("multi-active.jsonl.1", [FIXTURE[7], FIXTURE[6], FIXTURE[4]]);
                const res = readUsageTails([active, rotated], NOW - 7 * DAY);
                // rotated: 8-day-old stops the scan → [3-day-old, 26h-old]; active: both in window
                expect(res.records.map((r) => r.model)).toEqual(["kimi-k2.5", "kimi-k2.5", "kimi-k2.5", "qwen3.7-plus"]);
                expect(res.records.map((r) => r.ts)).toEqual([NOW - 3 * DAY, NOW - 26 * HOUR, NOW - 2 * HOUR, NOW - 3 * HOUR]);
                expect(res.hitCap).toBe(false);
        });

        test("the rotated file is skipped entirely when the active file reaches an older record", () => {
                const active = fixtureFile("skip-active.jsonl", [FIXTURE[7], ...FIXTURE.slice(0, 2)]); // 8-day-old line FIRST, then recent
                const rotated = fixtureFile("skip-active.jsonl.1", FIXTURE.slice(2, 4));
                const res = readUsageTails([active, rotated], NOW - 24 * HOUR);
                expect(res.records.map((r) => r.ts)).toEqual([NOW - 2 * HOUR, NOW - 3 * HOUR]);
        });
});

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

describe("pricing", () => {
        test("env var suffix: uppercase, non-alphanumerics → single underscores", () => {
                expect(priceEnvVarSuffix("kimi-k2.5")).toBe("KIMI_K2_5");
                expect(priceEnvVarSuffix("qwen3.7-plus")).toBe("QWEN3_7_PLUS");
                expect(priceEnvVarSuffix("local-qwen3-0.6b")).toBe("LOCAL_QWEN3_0_6B");
        });

        test("the built-in table prices the known models as estimates", () => {
                for (const model of ["kimi-k2.5", "qwen3.7-plus", "qwen3.6-plus"]) {
                        expect(resolveModelPrice(model, {})).toEqual({ ...MODEL_PRICES_ESTIMATE[model], source: "estimate" });
                }
        });

        test("UNOWN_PRICE_<MODEL>_IN/OUT overrides win (BOTH halves required)", () => {
                const env = { UNOWN_PRICE_KIMI_K2_5_IN: "1", UNOWN_PRICE_KIMI_K2_5_OUT: "4" };
                expect(resolveModelPrice("kimi-k2.5", env)).toEqual({ inputUsdPer1M: 1, outputUsdPer1M: 4, source: "env" });
                // half-override (missing OUT) falls back to the estimate table
                expect(resolveModelPrice("kimi-k2.5", { UNOWN_PRICE_KIMI_K2_5_IN: "1" })?.source).toBe("estimate");
                // empty values mean unset (the .env.example convention)
                expect(resolveModelPrice("kimi-k2.5", { UNOWN_PRICE_KIMI_K2_5_IN: "", UNOWN_PRICE_KIMI_K2_5_OUT: "" })?.source).toBe("estimate");
        });

        test("malformed override values are ignored, not fatal", () => {
                expect(resolveModelPrice("kimi-k2.5", { UNOWN_PRICE_KIMI_K2_5_IN: "abc", UNOWN_PRICE_KIMI_K2_5_OUT: "4" })?.source).toBe("estimate");
                expect(resolveModelPrice("kimi-k2.5", { UNOWN_PRICE_KIMI_K2_5_IN: "-1", UNOWN_PRICE_KIMI_K2_5_OUT: "4" })?.source).toBe("estimate");
        });

        test("unknown models price as null, never 0", () => {
                expect(resolveModelPrice("gpt-4o", {})).toBeNull();
                expect(resolveModelPrice("local-qwen3-0.6b", {})).toBeNull();
                expect(estimateRecordCostUsd({ ts: 1, model: "gpt-4o", promptTokens: 100, completionTokens: 100, durationMs: 1, status: "ok" }, {})).toBeNull();
        });

        test("cost math: per-1M prices, cached tokens at full input rate", () => {
                // kimi-k2.5 estimate: 0.6 in / 2.5 out
                expect(estimateRecordCostUsd({ ts: 1, model: "kimi-k2.5", promptTokens: 1_000_000, completionTokens: 1_000_000, durationMs: 1, status: "ok" }, {})).toBe(3.1);
                expect(estimateRecordCostUsd({ ts: 1, model: "kimi-k2.5", promptTokens: 1_000_000, completionTokens: 0, durationMs: 1, status: "ok" }, {})).toBe(0.6);
                const cached = estimateRecordCostUsd({ ts: 1, model: "kimi-k2.5", promptTokens: 1_000_000, completionTokens: 0, cachedTokens: 500_000, durationMs: 1, status: "ok" }, {});
                expect(cached).toBe(0.6); // conservative: cached billed as input
        });

        test("routed requests price by their upstream model", () => {
                // glm-4-plus is unknown, but it was routed onto kimi-k2.5
                expect(estimateRecordCostUsd({ ts: 1, model: "glm-4-plus", upstreamModel: "kimi-k2.5", promptTokens: 1_000_000, completionTokens: 0, durationMs: 1, status: "ok" }, {})).toBe(0.6);
        });

        test("roundCostUsd kills float artifacts", () => {
                expect(roundCostUsd(0.1 + 0.2)).toBe(0.3);
                expect(roundCostUsd(1.8508500000000002)).toBe(1.85085);
        });
});

// ---------------------------------------------------------------------------
// Aggregation (golden multi-model multi-day fixture)
// ---------------------------------------------------------------------------

describe("aggregateUsage", () => {
        test("1-day window: exact totals / byModel / byDay (UTC buckets)", () => {
                const s = aggregateUsage(FIXTURE, { sinceTs: NOW - 1 * DAY, days: 1, env: {} });
                // in-window: kimi 1M/500k, qwen3.7 500k/100k, local 10k/1k, kimi cached 1k/100
                expect(s.since).toBe(NOW - DAY);
                expect(s.totals).toEqual({
                        requests: 4,
                        errors: 0,
                        promptTokens: 1_511_000,
                        completionTokens: 601_100,
                        cachedTokens: 40,
                        costUsd: null, // local-qwen3-0.6b has no price data
                });
                expect(s.byModel).toEqual([
                        { model: "kimi-k2.5", requests: 2, promptTokens: 1_001_000, completionTokens: 500_100, tokens: 1_501_100, costUsd: 1.85085, avgDurationMs: 525 },
                        { model: "local-qwen3-0.6b", requests: 1, promptTokens: 10_000, completionTokens: 1_000, tokens: 11_000, costUsd: null, avgDurationMs: 100 },
                        { model: "qwen3.7-plus", requests: 1, promptTokens: 500_000, completionTokens: 100_000, tokens: 600_000, costUsd: 0.7, avgDurationMs: 2000 },
                ]);
                expect(s.byDay).toEqual([{ date: "2026-10-19", requests: 4, tokens: 2_112_100, costUsd: null }]);
                expect(s.pricing).toEqual({ estimate: true, overridden: [], unknownModels: ["local-qwen3-0.6b"] });
        });

        test("7-day window: yesterday + 3-days-ago rows appear, error counted, 8-day-old excluded", () => {
                const s = aggregateUsage(FIXTURE, { sinceTs: NOW - 7 * DAY, days: 7, env: {} });
                expect(s.totals.requests).toBe(7);
                expect(s.totals.errors).toBe(1);
                expect(s.totals.promptTokens).toBe(1_811_000);
                expect(s.totals.completionTokens).toBe(751_100);
                expect(s.totals.costUsd).toBeNull(); // still the unpriced local record
                const kimi = s.byModel.find((r) => r.model === "kimi-k2.5")!;
                expect(kimi.requests).toBe(4); // +error +3-days-ago
                expect(kimi.costUsd).toBe(2.03585); // 1.85 + 0.00085 + 0 (error) + 0.185
                expect(kimi.avgDurationMs).toBe(1138); // (1000+50+3000+500)/4, round-half-up
                const routed = s.byModel.find((r) => r.model === "glm-4-plus")!;
                expect(routed.costUsd).toBe(0.37); // priced via its upstream kimi-k2.5
                expect(s.byDay.map((d) => d.date)).toEqual(["2026-10-16", "2026-10-18", "2026-10-19"]);
                expect(s.byDay).toEqual([
                        { date: "2026-10-16", requests: 1, tokens: 150_000, costUsd: 0.185 },
                        { date: "2026-10-18", requests: 2, tokens: 300_000, costUsd: 0.37 },
                        { date: "2026-10-19", requests: 4, tokens: 2_112_100, costUsd: null },
                ]);
        });

        test("env-pinned prices flip the estimate markers", () => {
                const env = { UNOWN_PRICE_KIMI_K2_5_IN: "1", UNOWN_PRICE_KIMI_K2_5_OUT: "4" };
                const s = aggregateUsage(FIXTURE.slice(0, 1), { sinceTs: NOW - DAY, days: 1, env });
                expect(s.totals.costUsd).toBe(3); // 1M*1 + 0.5M*4
                expect(s.pricing).toEqual({ estimate: false, overridden: ["kimi-k2.5"], unknownModels: [] });
        });

        test("model filter matches requested OR upstream id; routed rows group under the filter", () => {
                const s = aggregateUsage(FIXTURE, { sinceTs: NOW - 7 * DAY, days: 7, model: "kimi-k2.5", env: {} });
                // kimi-k2.5 requested: 4 records + glm-4-plus routed onto kimi upstream
                expect(s.model).toBe("kimi-k2.5");
                expect(s.byModel).toHaveLength(1);
                expect(s.byModel[0].model).toBe("kimi-k2.5");
                expect(s.byModel[0].requests).toBe(5);
                expect(s.byModel[0].costUsd).toBe(2.40585); // 2.03585 + 0.37 (routed)
                expect(s.totals.requests).toBe(5);
        });

        test("a filter naming an unknown model yields an honest empty summary", () => {
                const s = aggregateUsage(FIXTURE, { sinceTs: NOW - DAY, days: 1, model: "gpt-4o", env: {} });
                expect(s.totals.requests).toBe(0);
                expect(s.totals.costUsd).toBe(0); // no unpriced records IN SCOPE → sum is 0, not null
                expect(s.byModel).toEqual([]);
        });

        test("records older than sinceTs are excluded even when passed in", () => {
                const s = aggregateUsage(FIXTURE, { sinceTs: NOW - 1 * HOUR, days: 1 / 24, env: {} });
                // the 1-hour record sits exactly ON the boundary (inclusive) + the 10-minute one
                expect(s.totals.requests).toBe(2);
                expect(s.totals.cachedTokens).toBe(40);
        });
});

describe("dayKeyUtc", () => {
        test("UTC calendar keys, midnight boundary included on the new day", () => {
                expect(dayKeyUtc(Date.UTC(2026, 9, 19, 0, 0, 0))).toBe("2026-10-19");
                expect(dayKeyUtc(Date.UTC(2026, 9, 18, 23, 59, 59))).toBe("2026-10-18");
        });
});

// ---------------------------------------------------------------------------
// buildUsageSummary (files → summary, end to end)
// ---------------------------------------------------------------------------

describe("buildUsageSummary", () => {
        test("reads the tail of the active file + the rotated generation, wires since/days", () => {
                const active = fixtureFile("summary-active.jsonl", FIXTURE.slice(0, 4));
                const rotated = fixtureFile("summary-active.jsonl.1", [FIXTURE[7], FIXTURE[6], FIXTURE[5], FIXTURE[4]]);
                const s = buildUsageSummary([active, rotated], { days: 7, env: {}, now: NOW });
                expect(s.since).toBe(NOW - 7 * DAY);
                expect(s.days).toBe(7);
                expect(s.totals.requests).toBe(7);
                expect(s.skippedLines).toBe(0);
                expect(s.truncated).toBe(false);
        });

        test("malformed lines + truncation surface in the read statistics", () => {
                const active = fixtureFile("summary-stats.jsonl", FIXTURE.slice(0, 4), ["garbage line", "{also torn"]);
                const s = buildUsageSummary([active], { days: 1, env: {}, now: NOW, maxLines: 10 });
                expect(s.totals.requests).toBe(4);
                expect(s.skippedLines).toBe(2);
                // cap 2: the two NEWEST lines are the garbage ones — nothing valid survives,
                // and the summary honestly reports truncation
                const capped = buildUsageSummary([active], { days: 1, env: {}, now: NOW, maxLines: 2 });
                expect(capped.truncated).toBe(true);
                expect(capped.totals.requests).toBe(0);
                expect(capped.skippedLines).toBe(2);
        });

        test("non-positive days clamp to 1", () => {
                const active = fixtureFile("summary-clamp.jsonl", FIXTURE.slice(0, 2));
                expect(buildUsageSummary([active], { days: 0, env: {}, now: NOW }).days).toBe(1);
        });
});

// ---------------------------------------------------------------------------
// resolveUsageStateDir
// ---------------------------------------------------------------------------

describe("resolveUsageStateDir", () => {
        test("UNOWN_BRIDGE_STATE_DIR wins (and is trimmed)", () => {
                expect(resolveUsageStateDir({ UNOWN_BRIDGE_STATE_DIR: "/x/y" }, "/nowhere")).toBe("/x/y");
                expect(resolveUsageStateDir({ UNOWN_BRIDGE_STATE_DIR: "  /x/y  " }, "/nowhere")).toBe("/x/y");
        });

        test("running inside the unown repo → <repo>/.run (walks up from the bridge dir)", () => {
                const repo = join(TMP, "fake-repo");
                const bridgeDir = join(repo, "mini-services", "llm-bridge");
                const nested = join(repo, "pi-repo", "packages", "self-learning", "src");
                rmSync(repo, { recursive: true, force: true });
                mkdirSync(bridgeDir, { recursive: true });
                mkdirSync(nested, { recursive: true });
                writeFileSync(join(repo, "package.json"), "{}", "utf8");
                expect(resolveUsageStateDir({}, bridgeDir)).toBe(join(repo, ".run"));
                expect(resolveUsageStateDir({}, nested)).toBe(join(repo, ".run"));
        });

        test("outside any repo → $UNOWN_HOME/bridge, then ~/.unown/bridge", () => {
                const outside = join(TMP, "plain-project");
                rmSync(outside, { recursive: true, force: true });
                mkdirSync(outside, { recursive: true });
                expect(resolveUsageStateDir({ UNOWN_HOME: "/tmp/unown-home" }, outside)).toBe(join("/tmp/unown-home", "bridge"));
                expect(resolveUsageStateDir({}, outside)).toBe(join(homedir(), ".unown", "bridge"));
                // multiple start dirs are tried in order before the fallback —
                // the real bridge module dir resolves to THIS checkout's .run
                expect(resolveUsageStateDir({}, [outside, import.meta.dir])).toBe(join(import.meta.dir, "..", "..", ".run"));
        });
});
