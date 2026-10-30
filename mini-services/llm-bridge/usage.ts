/**
 * usage.ts — persistent usage & cost tracking for the llm-bridge
 * (the opencode/Cursor-style observability layer).
 *
 * The in-memory request ring in index.ts (500 entries) is volatile — it dies
 * with the process. This module persists one line per proxied chat
 * completion to a JSONL file and computes aggregated usage summaries from it:
 *
 *   - appendUsageRecord(): crash-safe append (one JSON object per line; a
 *     torn last line is tolerated by the reader), rotating the file at
 *     USAGE_LOG_MAX_BYTES to a single `.1` generation
 *   - readUsageTail(): streams the file BACKWARD from the end, stopping at
 *     the first record older than the query window (or the line cap) — a
 *     days=N query never pays for the whole history
 *   - aggregateUsage()/buildUsageSummary(): totals / byModel / byDay with
 *     estimated USD costs from the pricing table below
 *   - resolveUsageStateDir(): where the log lives — $UNOWN_BRIDGE_STATE_DIR,
 *     else <repo>/.run/ when running from the repo checkout, else
 *     $UNOWN_HOME/bridge (default ~/.unown/bridge)
 *
 * PRIVACY: only token counts, model ids, timestamps, durations and status
 * are ever written. Message content, tool payloads and prompts are NOT
 * logged (the error field carries at most a 200-char upstream error string).
 *
 * Everything is parameterized over env/inputs (pure.ts conventions) so
 * usage.test.ts can exercise persistence, rotation, aggregation and pricing
 * without process.env or the network. The serving glue lives in index.ts.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One persisted request record (one JSONL line). */
export interface UsageRecord {
        /** Epoch ms when the request arrived (the ring entry's ts). */
        ts: number;
        /** Model id as REQUESTED (pre-routing, e.g. "glm-4-plus"). */
        model: string;
        /** Model id actually sent upstream (post-routing), prefixed `local:` on the local lane. */
        upstreamModel?: string;
        stream?: boolean;
        promptTokens: number;
        completionTokens: number;
        /** Cached input tokens (usage.prompt_tokens_details.cached_tokens), when the upstream reports them. */
        cachedTokens?: number;
        durationMs: number;
        status: "ok" | "error";
        /** Short upstream error string (capped 200 chars, never payloads). */
        error?: string;
        /** Which admission lane served the request (M5; absent on pre-M5 lines —
         *  readers treat missing as unknown, never as interactive). */
        lane?: "interactive" | "background";
}

export interface UsageTotals {
        requests: number;
        errors: number;
        promptTokens: number;
        completionTokens: number;
        cachedTokens: number;
        /** Sum of per-record costs; null when any in-scope request has no price data (honest unknown, not 0). */
        costUsd: number | null;
}

export interface UsageModelRow {
        model: string;
        requests: number;
        promptTokens: number;
        completionTokens: number;
        /** promptTokens + completionTokens. */
        tokens: number;
        costUsd: number | null;
        avgDurationMs: number;
}

export interface UsageDayRow {
        /** UTC calendar date, YYYY-MM-DD. */
        date: string;
        requests: number;
        tokens: number;
        costUsd: number | null;
}

export interface UsageSummary {
        /** Epoch ms cutoff — records with ts < since are excluded. */
        since: number;
        days: number;
        /** Model filter that was applied (requested OR upstream id), null = all. */
        model: string | null;
        totals: UsageTotals;
        byModel: UsageModelRow[];
        byDay: UsageDayRow[];
        /** Malformed JSONL lines tolerated (skipped) while reading. */
        skippedLines: number;
        linesRead: number;
        /** True when the line cap was hit before covering the window — old entries may be missing. */
        truncated: boolean;
        pricing: {
                /** True when at least one cost came from the built-in ESTIMATE table (vs. env-pinned or verified prices). */
                estimate: boolean;
                /** In-scope models priced via UNOWN_PRICE_* overrides. */
                overridden: string[];
                /** In-scope models priced from the model-specs sidecar (verified vendor-published rates). */
                sidecarPriced: string[];
                /** In-scope models with no price data at all (their costs are excluded / null). */
                unknownModels: string[];
        };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const USAGE_LOG_FILE_NAME = "usage-log.jsonl";
/** Rotate the active log when it exceeds 10 MB (one `.1` generation kept). */
export const USAGE_LOG_MAX_BYTES = 10 * 1024 * 1024;
/** Hard cap on lines read per summary query (backward scan budget). */
export const USAGE_TAIL_MAX_LINES = 50_000;
export const DAY_MS = 86_400_000;
/** Backward-read chunk size — big enough to amortize syscalls, small enough for tight tails. */
const READ_CHUNK_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export interface ModelPrice {
        /** USD per 1M input (prompt) tokens. */
        inputUsdPer1M: number;
        /** USD per 1M output (completion) tokens. */
        outputUsdPer1M: number;
}

/**
 * Built-in model pricing — USD per 1M tokens.
 *
 * ESTIMATE — override via UNOWN_PRICE_<MODEL>_IN / UNOWN_PRICE_<MODEL>_OUT
 * env vars (USD per 1M tokens), where <MODEL> is the model id uppercased
 * with every non-alphanumeric run replaced by a single "_"
 * (kimi-k2.5 → KIMI_K2_5, qwen3.7-plus → QWEN3_7_PLUS):
 *
 *   UNOWN_PRICE_KIMI_K2_5_IN=0.55
 *   UNOWN_PRICE_KIMI_K2_5_OUT=2.15
 *
 * Real prices change; these conservative placeholders exist so the usage
 * table shows a reasonable number out of the box. An override must set BOTH
 * _IN and _OUT (a half-override is ignored — an accidentally halved price is
 * worse than an estimate). Models not listed here and not overridden price
 * as null (unknown), never 0. Cached input tokens are billed at the full
 * input price (conservative).
 */
export const MODEL_PRICES_ESTIMATE: Record<string, ModelPrice> = {
        "kimi-k2.5": { inputUsdPer1M: 0.6, outputUsdPer1M: 2.5 },
        "qwen3.7-plus": { inputUsdPer1M: 0.8, outputUsdPer1M: 3.0 },
        "qwen3.6-plus": { inputUsdPer1M: 0.8, outputUsdPer1M: 3.0 },
};

/** Env-var name fragment for a model id: uppercase, non-alphanumerics → "_". */
export function priceEnvVarSuffix(model: string): string {
        return model.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

export interface ResolvedModelPrice extends ModelPrice {
        source: "env" | "sidecar" | "estimate";
}

/**
 * The model-specs sidecar (~/.unown/agent/model-specs.json) as a price
 * source: detection recorded a VERIFIED vendor-published cost for a
 * `provider/model` key — the suffix match keeps the bridge (which only knows
 * bare model ids) reading the agent's provenance store without sharing its
 * files. Corrupt/missing sidecar = no price from this source.
 */
export function sidecarModelPrice(model: string, env: Record<string, string | undefined> = process.env): ModelPrice | null {
        if (!model) return null;
        const home = env.UNOWN_HOME || path.join(homedir(), ".unown");
        let specs: Record<string, { cost?: { input?: number; output?: number } }>;
        try {
                specs = JSON.parse(fs.readFileSync(path.join(home, "agent", "model-specs.json"), "utf8")).specs ?? {};
        } catch {
                return null;
        }
        const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 10_000 ? n : undefined);
        for (const [key, record] of Object.entries(specs)) {
                if (key !== model && !key.endsWith(`/${model}`)) continue;
                const input = num(record?.cost?.input);
                const output = num(record?.cost?.output);
                if (input !== undefined && output !== undefined) return { inputUsdPer1M: input, outputUsdPer1M: output };
        }
        return null;
}

/**
 * Resolve the price for one model id: an env override (BOTH _IN and _OUT,
 * finite, non-negative) wins; then the model-specs SIDECAR (verified
 * vendor-published pricing the detection cascade recorded); then the built-in
 * ESTIMATE table; else null.
 */
export function resolveModelPrice(model: string, env: Record<string, string | undefined> = process.env): ResolvedModelPrice | null {
        const suffix = priceEnvVarSuffix(model);
        const inRaw = env[`UNOWN_PRICE_${suffix}_IN`];
        const outRaw = env[`UNOWN_PRICE_${suffix}_OUT`];
        // `||` on the raw strings: an EMPTY value (the .env.example convention for
        // optional vars) means "unset", not "0".
        if (inRaw || outRaw) {
                const inN = Number(inRaw);
                const outN = Number(outRaw);
                if (inRaw && outRaw && Number.isFinite(inN) && Number.isFinite(outN) && inN >= 0 && outN >= 0) {
                        return { inputUsdPer1M: inN, outputUsdPer1M: outN, source: "env" };
                }
        }
        const sidecar = sidecarModelPrice(model, env);
        if (sidecar) return { ...sidecar, source: "sidecar" };
        const base = MODEL_PRICES_ESTIMATE[model];
        return base ? { ...base, source: "estimate" } : null;
}

/** Round a USD amount to 8 decimals — kills float artifacts (0.1 + 0.2 ≠ 0.3). */
export function roundCostUsd(x: number): number {
        return Math.round(x * 1e8) / 1e8;
}

/** Cost of one record; null when the model has no price data (never 0). */
export function estimateRecordCostUsd(record: UsageRecord, env: Record<string, string | undefined> = process.env): number | null {
        const price = resolveModelPrice(record.model, env) ?? resolveModelPrice(record.upstreamModel ?? "", env);
        if (!price) return null;
        // Cached tokens bill at the full input rate (conservative estimate).
        return roundCostUsd((record.promptTokens / 1e6) * price.inputUsdPer1M + (record.completionTokens / 1e6) * price.outputUsdPer1M);
}

// ---------------------------------------------------------------------------
// State dir resolution
// ---------------------------------------------------------------------------

function looksLikeUnownRepo(dir: string): boolean {
        try {
                return fs.existsSync(path.join(dir, "mini-services", "llm-bridge")) && fs.existsSync(path.join(dir, "package.json"));
        } catch {
                return false;
        }
}

/**
 * Where the usage log lives:
 *   1. $UNOWN_BRIDGE_STATE_DIR (explicit override — the CLI's direct-read
 *      fallback relies on it when it cannot see the bridge's filesystem)
 *   2. <repo>/.run/ — found by walking up from any start dir inside the
 *      unown repo checkout (the bridge module always lives there; the CLI
 *      passes both its cwd and its own module dir)
 *   3. $UNOWN_HOME/bridge (default ~/.unown/bridge) — detached installs
 */
export function resolveUsageStateDir(env: Record<string, string | undefined>, startDirs: string | string[]): string {
        const explicit = (env.UNOWN_BRIDGE_STATE_DIR ?? "").trim();
        if (explicit) return explicit;
        const dirs = Array.isArray(startDirs) ? startDirs : [startDirs];
        for (const start of dirs) {
                let dir = path.resolve(start);
                for (;;) {
                        if (looksLikeUnownRepo(dir)) return path.join(dir, ".run");
                        const parent = path.dirname(dir);
                        if (parent === dir) break;
                        dir = parent;
                }
        }
        // Same home convention as the CLI's term.ts resolveUnownHome (`||`:
        // an empty UNOWN_HOME means unset).
        const home = env.UNOWN_HOME || path.join(homedir(), ".unown");
        return path.join(home, "bridge");
}

// ---------------------------------------------------------------------------
// Learned specs (the model-specs round) — context limits upstream 400s reveal
// ---------------------------------------------------------------------------

/** One learned spec record — the durable shape in model-specs-learned.json. */
export interface LearnedSpecRecord {
        model: string;
        contextWindow?: number;
        maxTokens?: number;
        learnedAt: number;
        /** The (truncated) upstream error the numbers came from — the receipt. */
        fromError: string;
}

/** Where the learned-specs store lives (same state dir as the usage log). */
export function learnedSpecsFile(stateDir: string): string {
        return path.join(stateDir.replace(/\/+$/, ""), "model-specs-learned.json");
}

export function loadLearnedSpecs(stateDir: string): Record<string, LearnedSpecRecord> {
        try {
                const raw = JSON.parse(fs.readFileSync(learnedSpecsFile(stateDir), "utf8")) as Record<string, LearnedSpecRecord>;
                if (raw && typeof raw === "object") return raw;
        } catch {
                /* missing/corrupt — empty */
        }
        return {};
}

/**
 * Record what an upstream 400 just taught us about a model's real context
 * limit. Only writes when the numbers are NEW (or changed) — a wedged client
 * hammering the same overflow must not rewrite the file per request. Returns
 * true when the store was written. Never throws (the chat path owns this
 * call's error budget).
 */
export function recordLearnedSpec(
        stateDir: string,
        model: string,
        parsed: { contextWindow?: number; maxTokens?: number },
        fromError: string,
        now = Date.now(),
): boolean {
        if (!model || (parsed.contextWindow === undefined && parsed.maxTokens === undefined)) return false;
        const all = loadLearnedSpecs(stateDir);
        const prev = all[model];
        if (prev && prev.contextWindow === parsed.contextWindow && prev.maxTokens === parsed.maxTokens) return false;
        all[model] = {
                model,
                ...(parsed.contextWindow !== undefined ? { contextWindow: parsed.contextWindow } : {}),
                ...(parsed.maxTokens !== undefined ? { maxTokens: parsed.maxTokens } : {}),
                learnedAt: now,
                fromError: fromError.slice(0, 300),
        };
        try {
                fs.mkdirSync(stateDir, { recursive: true });
                fs.writeFileSync(learnedSpecsFile(stateDir), `${JSON.stringify(all, null, 2)}\n`, "utf8");
                return true;
        } catch {
                return false;
        }
}

// ---------------------------------------------------------------------------
// Append + rotation
// ---------------------------------------------------------------------------

export interface AppendResult {
        appended: boolean;
        rotated: boolean;
        error?: string;
}

/**
 * Append one record as a JSONL line. When the file already exceeds
 * maxBytes, rotate first: usage-log.jsonl → usage-log.jsonl.1 (one
 * generation kept; an existing .1 is replaced — rm-then-rename so Windows,
 * where rename onto an existing file raises, behaves identically).
 *
 * Failures NEVER throw to the chat path — the result carries the error and
 * the caller logs once and moves on.
 */
export function appendUsageRecord(file: string, record: UsageRecord, maxBytes: number = USAGE_LOG_MAX_BYTES): AppendResult {
        try {
                fs.mkdirSync(path.dirname(file), { recursive: true });
                let rotated = false;
                try {
                        if (fs.statSync(file).size > maxBytes) {
                                const rotatedPath = `${file}.1`;
                                try {
                                        fs.rmSync(rotatedPath, { force: true });
                                } catch {
                                        /* best effort — rename may still fail below */
                                }
                                fs.renameSync(file, rotatedPath);
                                rotated = true;
                        }
                } catch {
                        /* missing file / unreadable size — fall through to a plain append */
                }
                fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
                return { appended: true, rotated };
        } catch (err: any) {
                return { appended: false, rotated: false, error: String(err?.message ?? err) };
        }
}

// ---------------------------------------------------------------------------
// Reading + parsing
// ---------------------------------------------------------------------------

/** Tolerant line parse: valid shape (numeric ts + string model) or null. */
export function parseUsageLine(line: string): UsageRecord | null {
        const trimmed = line.trim();
        if (!trimmed) return null;
        try {
                const obj = JSON.parse(trimmed);
                if (typeof obj?.ts !== "number" || typeof obj?.model !== "string") return null;
                return {
                        ts: obj.ts,
                        model: obj.model,
                        upstreamModel: typeof obj.upstreamModel === "string" ? obj.upstreamModel : undefined,
                        stream: obj.stream === true,
                        promptTokens: typeof obj.promptTokens === "number" ? obj.promptTokens : 0,
                        completionTokens: typeof obj.completionTokens === "number" ? obj.completionTokens : 0,
                        cachedTokens: typeof obj.cachedTokens === "number" ? obj.cachedTokens : undefined,
                        durationMs: typeof obj.durationMs === "number" ? obj.durationMs : 0,
                        status: obj.status === "error" ? "error" : "ok",
                        error: typeof obj.error === "string" ? obj.error : undefined,
                };
        } catch {
                return null;
        }
}

export interface TailResult {
        /** In FILE ORDER (oldest → newest), already filtered to ts >= sinceTs. */
        records: UsageRecord[];
        skipped: number;
        linesRead: number;
        /** True when the scan stopped at the line cap (records in the window may be missing). */
        hitCap: boolean;
        /** True when a parseable record OLDER than the window stopped the scan — older files cannot matter. */
        stoppedAtOldRecord: boolean;
}

/**
 * Stream one JSONL file BACKWARD from the end, collecting records with
 * ts >= sinceTs. Stops at the first record OLDER than the window (records
 * are appended in rough ts order), at maxLines, or at the file start —
 * whichever comes first. Malformed lines (torn tail writes, garbage) are
 * skipped and counted, never fatal. A missing file is an empty tail.
 */
export function readUsageTail(file: string, sinceTs: number, maxLines: number = USAGE_TAIL_MAX_LINES): TailResult {
        const out: UsageRecord[] = [];
        let skipped = 0;
        let linesRead = 0;
        let hitCap = false;
        let stoppedAtOldRecord = false;
        const empty = (): TailResult => ({ records: out, skipped, linesRead, hitCap, stoppedAtOldRecord });
        if (maxLines <= 0) return { records: [], skipped: 0, linesRead: 0, hitCap: true, stoppedAtOldRecord: false };
        if (!fs.existsSync(file)) return empty();
        let fd: number | undefined;
        try {
                fd = fs.openSync(file, "r");
                const size = fs.fstatSync(fd).size;
                let pos = size;
                // Partial line at the front of the bytes read so far (toward the file
                // start) — completed by the next (earlier) chunk.
                let pending: Buffer = Buffer.alloc(0);
                const processLine = (lineBuf: Buffer): "continue" | "stop" => {
                        if (lineBuf.length === 0) return "continue";
                        linesRead++;
                        const rec = parseUsageLine(lineBuf.toString("utf8"));
                        if (!rec) {
                                skipped++;
                        return linesRead < maxLines ? "continue" : ((hitCap = true), "stop");
                        }
                        if (rec.ts < sinceTs) {
                                stoppedAtOldRecord = true;
                        return "stop";
                        }
                        out.push(rec);
                        return linesRead < maxLines ? "continue" : ((hitCap = true), "stop");
                };
                scan: while (pos > 0) {
                        const len = Math.min(READ_CHUNK_BYTES, pos);
                        pos -= len;
                        const buf = Buffer.alloc(len);
                        fs.readSync(fd, buf, 0, len, pos);
                        let data = Buffer.concat([buf, pending]);
                        // Extract complete lines from the END of `data` (backward).
                        for (;;) {
                                const nl = data.lastIndexOf(0x0a);
                                if (nl === -1) break;
                                const line = data.subarray(nl + 1);
                                data = data.subarray(0, nl);
                                if (processLine(line) === "stop") break scan;
                        }
                        pending = data;
                }
                // File start reached without stopping: whatever is left is the first
                // line (no preceding newline) — process it too.
                if (!stoppedAtOldRecord && !hitCap && pending.length > 0) processLine(pending);
                return { records: out.reverse(), skipped, linesRead, hitCap, stoppedAtOldRecord };
        } catch {
                return { records: out.reverse(), skipped, linesRead, hitCap, stoppedAtOldRecord };
        } finally {
                if (fd !== undefined) {
                        try {
                                fs.closeSync(fd);
                        } catch {
                                /* ignore */
                        }
                }
        }
}

/**
 * Read the tails of [active, rotated...] with a SHARED line budget: the
 * rotated file only matters when the active file does not reach back to
 * sinceTs. Records are returned oldest → newest across files.
 */
export function readUsageTails(files: string[], sinceTs: number, maxLines: number = USAGE_TAIL_MAX_LINES): TailResult {
        const all: UsageRecord[] = [];
        let skipped = 0;
        let linesRead = 0;
        for (const file of files) {
                const remaining = maxLines - linesRead;
                if (remaining <= 0) return { records: all, skipped, linesRead, hitCap: true, stoppedAtOldRecord: false };
                const res = readUsageTail(file, sinceTs, remaining);
                skipped += res.skipped;
                linesRead += res.linesRead;
                // Files are given newest-first — prepend keeps oldest → newest order.
                all.unshift(...res.records);
                if (res.hitCap) return { records: all, skipped, linesRead, hitCap: true, stoppedAtOldRecord: false };
                if (res.stoppedAtOldRecord) return { records: all, skipped, linesRead, hitCap: false, stoppedAtOldRecord: true };
        }
        return { records: all, skipped, linesRead, hitCap: false, stoppedAtOldRecord: false };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** UTC calendar date key (YYYY-MM-DD) for an epoch-ms timestamp. */
export function dayKeyUtc(ts: number): string {
        return new Date(ts).toISOString().slice(0, 10);
}

export interface AggregateOptions {
        sinceTs: number;
        days: number;
        model?: string;
        env?: Record<string, string | undefined>;
}

/**
 * Aggregate in-window records into the usage summary. Pure: caller-owned
 * records, env passed in. The model filter matches the REQUESTED id or the
 * upstream id (a filtered "kimi-k2.5" row includes requests that asked for
 * an unknown id and were routed there).
 */
export function aggregateUsage(records: UsageRecord[], opts: AggregateOptions): UsageSummary {
        const env = opts.env ?? {};
        const wanted = opts.model?.trim() || undefined;
        interface Bucket {
                requests: number;
                errors: number;
                promptTokens: number;
                completionTokens: number;
                cachedTokens: number;
                durationMsTotal: number;
                costUsd: number;
                anyUnpriced: boolean;
                anyEstimate: boolean;
                anyEnv: boolean;
        }
        const zeroBucket = (): Bucket => ({
                requests: 0,
                errors: 0,
                promptTokens: 0,
                completionTokens: 0,
                cachedTokens: 0,
                durationMsTotal: 0,
                costUsd: 0,
                anyUnpriced: false,
                anyEstimate: false,
                anyEnv: false,
        });
        const totals = zeroBucket();
        const byModel = new Map<string, Bucket>();
        const byDay = new Map<string, Bucket>();
        const unknownModels = new Set<string>();
        const overridden = new Set<string>();
        const sidecarPriced = new Set<string>();

        for (const rec of records) {
                if (rec.ts < opts.sinceTs) continue;
                if (wanted && rec.model !== wanted && rec.upstreamModel !== wanted) continue;
                const cost = estimateRecordCostUsd(rec, env);
                const price = resolveModelPrice(rec.model, env) ?? resolveModelPrice(rec.upstreamModel ?? "", env);
                if (!price) unknownModels.add(rec.model);
                else if (price.source === "env") overridden.add(rec.model);
                else if (price.source === "sidecar") sidecarPriced.add(rec.model);

                const apply = (b: Bucket) => {
                        b.requests++;
                        if (rec.status === "error") b.errors++;
                        b.promptTokens += rec.promptTokens;
                        b.completionTokens += rec.completionTokens;
                        b.cachedTokens += rec.cachedTokens ?? 0;
                        b.durationMsTotal += rec.durationMs;
                        if (cost === null) b.anyUnpriced = true;
                        else {
                                b.costUsd += cost;
                                if (price?.source === "estimate") b.anyEstimate = true;
                                if (price?.source === "env") b.anyEnv = true;
                        }
                };
                apply(totals);
                // With a filter, group under the filtered id — requests that asked
                // for an unknown id and were ROUTED onto the filter still land in the
                // row the user asked for.
                const groupKey = wanted ?? rec.model;
                let bucket = byModel.get(groupKey);
                if (!bucket) byModel.set(groupKey, (bucket = zeroBucket()));
                apply(bucket);
                const dayKey = dayKeyUtc(rec.ts);
                let day = byDay.get(dayKey);
                if (!day) byDay.set(dayKey, (day = zeroBucket()));
                apply(day);
        }

        return {
                since: opts.sinceTs,
                days: opts.days,
                model: wanted ?? null,
                totals: {
                        requests: totals.requests,
                        errors: totals.errors,
                        promptTokens: totals.promptTokens,
                        completionTokens: totals.completionTokens,
                        cachedTokens: totals.cachedTokens,
                        costUsd: totals.anyUnpriced ? null : roundCostUsd(totals.costUsd),
                },
                byModel: [...byModel.entries()]
                        .map(([model, b]) => ({
                                model,
                                requests: b.requests,
                                promptTokens: b.promptTokens,
                                completionTokens: b.completionTokens,
                                tokens: b.promptTokens + b.completionTokens,
                                costUsd: b.anyUnpriced ? null : roundCostUsd(b.costUsd),
                                avgDurationMs: b.requests ? Math.round(b.durationMsTotal / b.requests) : 0,
                        }))
                        .sort((a, b) => b.requests - a.requests || (a.model < b.model ? -1 : 1)),
                byDay: [...byDay.entries()]
                        .map(([date, b]) => ({
                                date,
                                requests: b.requests,
                                tokens: b.promptTokens + b.completionTokens,
                                costUsd: b.anyUnpriced ? null : roundCostUsd(b.costUsd),
                        }))
                        .sort((a, b) => (a.date < b.date ? -1 : 1)),
                skippedLines: 0,
                linesRead: 0,
                truncated: false,
                pricing: {
                        estimate: totals.anyEstimate,
                        overridden: [...overridden].sort(),
                        sidecarPriced: [...sidecarPriced].sort(),
                        unknownModels: [...unknownModels].sort(),
                },
        };
}

export interface BuildSummaryOptions {
        days: number;
        model?: string;
        env?: Record<string, string | undefined>;
        /** Injectable clock (tests); defaults to Date.now(). */
        now?: number;
        /** Line budget override (tests); defaults to USAGE_TAIL_MAX_LINES. */
        maxLines?: number;
}

/**
 * Build a full usage summary from the log files (active + one rotated
 * generation): read the relevant tails, aggregate, merge read statistics.
 */
export function buildUsageSummary(files: string[], opts: BuildSummaryOptions): UsageSummary {
        const now = opts.now ?? Date.now();
        const days = opts.days > 0 ? opts.days : 1;
        const sinceTs = now - days * DAY_MS;
        const tail = readUsageTails(files, sinceTs, opts.maxLines ?? USAGE_TAIL_MAX_LINES);
        const summary = aggregateUsage(tail.records, { sinceTs, days, model: opts.model, env: opts.env });
        summary.skippedLines = tail.skipped;
        summary.linesRead = tail.linesRead;
        summary.truncated = tail.hitCap;
        return summary;
}
