/**
 * usage-cli.ts — `unown usage`: the token & cost report for the LLM bridge
 * (the opencode/Cursor-style usage surface).
 *
 *   unown usage                    last 24h, per-model table + totals
 *   unown usage --days 7           a wider window
 *   unown usage --model kimi-k2.5  one model (requested OR routed-to id)
 *   unown usage --json             machine-readable summary
 *
 * Data sources, in order:
 *   1. the bridge's GET /v1/usage aggregate endpoint — when the bridge is up
 *      (PI_BRIDGE_URL, default http://127.0.0.1:3031, same convention as
 *      store.ts's BRIDGE_URL; BRIDGE_API_KEY sent as a bearer when set)
 *   2. direct read of the bridge's usage-log.jsonl — when the bridge is
 *      down. The file is found with the same resolution the bridge writes
 *      with: $UNOWN_BRIDGE_STATE_DIR, else <unown repo>/.run (walking up
 *      from the cwd and this module's own checkout), else
 *      $UNOWN_HOME/bridge (default ~/.unown/bridge). Running from outside
 *      the repo without the env override may not see the bridge's file —
 *      the honest fallback error says exactly that.
 *
 * The pure core below (line parser, pricing, aggregation, backward tail
 * reader, state-dir resolution) MIRRORS mini-services/llm-bridge/usage.ts —
 * the bridge cannot be imported from this package (it lives outside the
 * vendored pi-repo tree and must stay dependency-free). The mirror is kept
 * honest by test/usage-cli.test.ts, which pins the SAME golden fixture the
 * bridge's own usage.test.ts pins: if either side drifts, its test fails.
 *
 * Module contract: mcp-cli.ts / automations-cli.ts — pure argv →
 * {stdout, stderr, exitCode}. NO store.ts import (it opens SQLite at module
 * scope); this file touches only node:fs/node:path/node:os and fetch.
 */
import { existsSync, openSync, closeSync, fstatSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface CliResult {
	stdout?: string;
	stderr?: string;
	exitCode: number;
}

export const USAGE_HELP = `unown usage — token & cost report for the LLM bridge

Usage:
  unown usage [--days <n>] [--model <id>] [--json]

  --days <n>     window in days, default 1 (the last 24h)
  --model <id>   filter to one model (by requested or routed-to id)
  --json         machine-readable summary (totals / byModel / byDay)

Reads the bridge's GET /v1/usage when the bridge is up (PI_BRIDGE_URL,
default http://127.0.0.1:3031). When the bridge is down it reads the
bridge's usage-log.jsonl directly — that needs the default state dir
(UNOWN_BRIDGE_STATE_DIR, else <unown repo>/.run, else ~/.unown/bridge).

Costs are ESTIMATES from the bridge's built-in price table. Pin exact
prices with UNOWN_PRICE_<MODEL>_IN / UNOWN_PRICE_<MODEL>_OUT (USD per 1M
tokens), where <MODEL> is the id uppercased with non-alphanumerics as "_":
  UNOWN_PRICE_KIMI_K2_5_IN=0.55
  UNOWN_PRICE_KIMI_K2_5_OUT=2.15

Privacy: only token counts, model ids, timestamps, durations and status are
logged — never prompts or message content. Docs: docs/usage-tracking.md`;

// ---------------------------------------------------------------------------
// Mirrored pure core (see the module header — keeps parity with
// mini-services/llm-bridge/usage.ts; both are pinned by mirrored fixtures).
// ---------------------------------------------------------------------------

export interface UsageRecord {
	ts: number;
	model: string;
	upstreamModel?: string;
	stream?: boolean;
	promptTokens: number;
	completionTokens: number;
	cachedTokens?: number;
	durationMs: number;
	status: "ok" | "error";
	error?: string;
}

export interface UsageSummary {
	since: number;
	days: number;
	model: string | null;
	totals: {
		requests: number;
		errors: number;
		promptTokens: number;
		completionTokens: number;
		cachedTokens: number;
		costUsd: number | null;
	};
	byModel: Array<{ model: string; requests: number; promptTokens: number; completionTokens: number; tokens: number; costUsd: number | null; avgDurationMs: number }>;
	byDay: Array<{ date: string; requests: number; tokens: number; costUsd: number | null }>;
	skippedLines: number;
	linesRead: number;
	truncated: boolean;
	pricing: { estimate: boolean; overridden: string[]; unknownModels: string[] };
}

const DAY_MS = 86_400_000;
const USAGE_LOG_FILE_NAME = "usage-log.jsonl";
/** Mirrors the bridge's read budget (see usage.ts there). */
const USAGE_TAIL_MAX_LINES = 50_000;
const READ_CHUNK_BYTES = 64 * 1024;

export interface ModelPrice {
	inputUsdPer1M: number;
	outputUsdPer1M: number;
}

/**
 * Built-in model pricing — USD per 1M tokens. ESTIMATE — mirror of
 * MODEL_PRICES_ESTIMATE in mini-services/llm-bridge/usage.ts (kept in sync
 * by the mirrored fixture tests). Override via UNOWN_PRICE_<MODEL>_IN/_OUT.
 */
export const MODEL_PRICES_ESTIMATE: Record<string, ModelPrice> = {
	"kimi-k2.5": { inputUsdPer1M: 0.6, outputUsdPer1M: 2.5 },
	"qwen3.7-plus": { inputUsdPer1M: 0.8, outputUsdPer1M: 3.0 },
	"qwen3.6-plus": { inputUsdPer1M: 0.8, outputUsdPer1M: 3.0 },
};

export function priceEnvVarSuffix(model: string): string {
	return model.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

export function resolveModelPrice(model: string, env: Record<string, string | undefined>): (ModelPrice & { source: "env" | "estimate" }) | null {
	const suffix = priceEnvVarSuffix(model);
	const inRaw = env[`UNOWN_PRICE_${suffix}_IN`] || "";
	const outRaw = env[`UNOWN_PRICE_${suffix}_OUT`] || "";
	if (inRaw && outRaw) {
		const inN = Number(inRaw);
		const outN = Number(outRaw);
		if (Number.isFinite(inN) && Number.isFinite(outN) && inN >= 0 && outN >= 0) {
			return { inputUsdPer1M: inN, outputUsdPer1M: outN, source: "env" };
		}
	}
	const base = MODEL_PRICES_ESTIMATE[model];
	return base ? { ...base, source: "estimate" } : null;
}

function roundCostUsd(x: number): number {
	return Math.round(x * 1e8) / 1e8;
}

export function dayKeyUtc(ts: number): string {
	return new Date(ts).toISOString().slice(0, 10);
}

function looksLikeUnownRepo(dir: string): boolean {
	try {
		return existsSync(join(dir, "mini-services", "llm-bridge")) && existsSync(join(dir, "package.json"));
	} catch {
		return false;
	}
}

/** Mirror of the bridge's state-dir resolution (see usage.ts there). */
export function resolveUsageStateDir(env: Record<string, string | undefined>, startDirs: string | string[]): string {
	const explicit = (env.UNOWN_BRIDGE_STATE_DIR ?? "").trim();
	if (explicit) return explicit;
	const dirs = Array.isArray(startDirs) ? startDirs : [startDirs];
	for (const start of dirs) {
		let dir = resolve(start);
		for (;;) {
			if (looksLikeUnownRepo(dir)) return join(dir, ".run");
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	}
	const home = env.UNOWN_HOME || join(homedir(), ".unown");
	return join(home, "bridge");
}

/** Tolerant JSONL line parse — mirror of the bridge's parseUsageLine. */
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

/**
 * Backward tail read of one JSONL file — mirror of the bridge's
 * readUsageTail: stops at the first out-of-window record, tolerates
 * malformed lines (skipped + counted), honors the line cap.
 */
function readUsageTail(file: string, sinceTs: number, maxLines: number): { records: UsageRecord[]; skipped: number; linesRead: number; hitCap: boolean; stoppedAtOldRecord: boolean } {
	const out: UsageRecord[] = [];
	let skipped = 0;
	let linesRead = 0;
	let hitCap = false;
	let stoppedAtOldRecord = false;
	if (maxLines <= 0 || !existsSync(file)) return { records: out, skipped, linesRead, hitCap, stoppedAtOldRecord };
	let fd: number | undefined;
	try {
		fd = openSync(file, "r");
		const size = fstatSync(fd).size;
		let pos = size;
		let pending: Buffer = Buffer.alloc(0);
		const processLine = (lineBuf: Buffer): boolean => {
			if (lineBuf.length === 0) return true;
			linesRead++;
			const rec = parseUsageLine(lineBuf.toString("utf8"));
			if (!rec) {
				skipped++;
				if (linesRead >= maxLines) hitCap = true;
				return linesRead < maxLines;
			}
			if (rec.ts < sinceTs) {
				stoppedAtOldRecord = true;
				return false;
			}
			out.push(rec);
			if (linesRead >= maxLines) hitCap = true;
			return linesRead < maxLines;
		};
		scan: while (pos > 0) {
			const len = Math.min(READ_CHUNK_BYTES, pos);
			pos -= len;
			const buf = Buffer.alloc(len);
			readSync(fd, buf, 0, len, pos);
			let data = Buffer.concat([buf, pending]);
			for (;;) {
				const nl = data.lastIndexOf(0x0a);
				if (nl === -1) break;
				const line = data.subarray(nl + 1);
				data = data.subarray(0, nl);
				if (!processLine(line)) break scan;
			}
			pending = data;
		}
		if (!stoppedAtOldRecord && !hitCap && pending.length > 0) processLine(pending);
		return { records: out.reverse(), skipped, linesRead, hitCap, stoppedAtOldRecord };
	} catch {
		return { records: out.reverse(), skipped, linesRead, hitCap, stoppedAtOldRecord };
	} finally {
		if (fd !== undefined) {
			try {
				closeSync(fd);
			} catch {
				/* ignore */
			}
		}
	}
}

function readUsageTails(files: string[], sinceTs: number, maxLines: number) {
	const all: UsageRecord[] = [];
	let skipped = 0;
	let linesRead = 0;
	for (const file of files) {
		const remaining = maxLines - linesRead;
		if (remaining <= 0) return { records: all, skipped, linesRead, hitCap: true };
		const res = readUsageTail(file, sinceTs, remaining);
		skipped += res.skipped;
		linesRead += res.linesRead;
		all.unshift(...res.records);
		if (res.hitCap) return { records: all, skipped, linesRead, hitCap: true };
		if (res.stoppedAtOldRecord) return { records: all, skipped, linesRead, hitCap: false };
	}
	return { records: all, skipped, linesRead, hitCap: false };
}

/** Mirror of the bridge's aggregateUsage — see usage.ts there for semantics. */
export function aggregateUsage(records: UsageRecord[], opts: { sinceTs: number; days: number; model?: string; env: Record<string, string | undefined> }): UsageSummary {
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
	}
	const zero = (): Bucket => ({ requests: 0, errors: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, durationMsTotal: 0, costUsd: 0, anyUnpriced: false, anyEstimate: false });
	const totals = zero();
	const byModel = new Map<string, Bucket>();
	const byDay = new Map<string, Bucket>();
	const unknownModels = new Set<string>();
	const overridden = new Set<string>();

	for (const rec of records) {
		if (rec.ts < opts.sinceTs) continue;
		if (wanted && rec.model !== wanted && rec.upstreamModel !== wanted) continue;
		const price = resolveModelPrice(rec.model, opts.env) ?? resolveModelPrice(rec.upstreamModel ?? "", opts.env);
		const cost = price ? roundCostUsd((rec.promptTokens / 1e6) * price.inputUsdPer1M + (rec.completionTokens / 1e6) * price.outputUsdPer1M) : null;
		if (!price) unknownModels.add(rec.model);
		else if (price.source === "env") overridden.add(rec.model);
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
			}
		};
		apply(totals);
		const groupKey = wanted ?? rec.model;
		let bucket = byModel.get(groupKey);
		if (!bucket) byModel.set(groupKey, (bucket = zero()));
		apply(bucket);
		const dayKey = dayKeyUtc(rec.ts);
		let day = byDay.get(dayKey);
		if (!day) byDay.set(dayKey, (day = zero()));
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
			.map(([date, b]) => ({ date, requests: b.requests, tokens: b.promptTokens + b.completionTokens, costUsd: b.anyUnpriced ? null : roundCostUsd(b.costUsd) }))
			.sort((a, b) => (a.date < b.date ? -1 : 1)),
		skippedLines: 0,
		linesRead: 0,
		truncated: false,
		pricing: { estimate: totals.anyEstimate, overridden: [...overridden].sort(), unknownModels: [...unknownModels].sort() },
	};
}

// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

export interface UsageFlags {
	days: number;
	model?: string;
	json: boolean;
	help: boolean;
	error?: string;
}

export function parseUsageFlags(argv: string[]): UsageFlags {
	const flags: UsageFlags = { days: 1, json: false, help: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const valueOf = (inline?: string): string | undefined => (inline !== undefined ? inline : argv[++i]);
		const [name, inline] = arg.includes("=") ? (arg.split("=", 2) as [string, string]) : [arg, undefined];
		if (name === "--days") {
			const raw = valueOf(inline);
			const n = Number(raw);
			if (raw === undefined || !Number.isInteger(n) || n < 1 || n > 365) {
				flags.error = `--days expects an integer 1-365 (got ${raw ?? "nothing"})`;
				return flags;
			}
			flags.days = n;
		} else if (name === "--model") {
			const raw = valueOf(inline);
			if (!raw) {
				flags.error = "--model expects a model id";
				return flags;
			}
			flags.model = raw;
		} else if (name === "--json") {
			flags.json = true;
		} else if (name === "-h" || name === "--help") {
			flags.help = true;
		} else if (arg.startsWith("--")) {
			flags.error = `unknown flag "${arg}"`;
			return flags;
		} else {
			flags.error = `unexpected argument "${arg}" (usage takes flags only)`;
			return flags;
		}
	}
	return flags;
}

// ---------------------------------------------------------------------------
// Formatting (pure — the table tests pin these)
// ---------------------------------------------------------------------------

export function formatInt(n: number): string {
	return n.toLocaleString("en-US");
}

export function formatCostUsd(cost: number | null, estimate: boolean): string {
	if (cost === null) return "—";
	return `${estimate ? "~$" : "$"}${cost.toFixed(4)}`;
}

export function formatDuration(ms: number): string {
	return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function padColumns(rows: string[][]): string[] {
	const widths: number[] = [];
	for (const row of rows) for (let c = 0; c < row.length; c++) widths[c] = Math.max(widths[c] ?? 0, row[c].length);
	return rows.map((row) =>
		row
			.map((cell, c) => (c === 0 ? cell.padEnd(widths[c]) : cell.padStart(widths[c])))
			.join("  ")
			.trimEnd(),
	);
}

export interface RenderOptions {
	/** Optional provenance line (e.g. "source: <file> (direct read — bridge unreachable)"). */
	sourceNote?: string;
}

/** Render the human table for a usage summary. Pure. */
export function renderUsageTable(summary: UsageSummary, opts: RenderOptions = {}): string {
	const estimate = summary.pricing.estimate;
	const header = `LLM usage — last ${summary.days} day${summary.days === 1 ? "" : "s"} (since ${new Date(summary.since).toISOString().replace("T", " ").slice(0, 16)} UTC)${summary.model ? ` · model: ${summary.model}` : ""}`;
	if (summary.totals.requests === 0) {
		return `${header}\n\nNo usage recorded in this window.\nStart a session (or run the engine) and check back — every proxied chat completion is logged.`;
	}
	const rows: string[][] = [["MODEL", "REQUESTS", "TOKENS IN", "TOKENS OUT", "COST", "AVG LATENCY"]];
	for (const m of summary.byModel) {
		rows.push([m.model, formatInt(m.requests), formatInt(m.promptTokens), formatInt(m.completionTokens), formatCostUsd(m.costUsd, estimate), formatDuration(m.avgDurationMs)]);
	}
	const totalAvg = summary.totals.requests ? Math.round(summary.byModel.reduce((acc, m) => acc + m.avgDurationMs * m.requests, 0) / summary.totals.requests) : 0;
	rows.push(["TOTAL", formatInt(summary.totals.requests), formatInt(summary.totals.promptTokens), formatInt(summary.totals.completionTokens), formatCostUsd(summary.totals.costUsd, estimate), formatDuration(totalAvg)]);
	const lines = [header, "", ...padColumns(rows)];
	if (summary.totals.errors > 0) lines.push("", `${formatInt(summary.totals.errors)} request(s) ended in error (still counted; their token usage is whatever the upstream reported).`);
	if (estimate) lines.push("", "costs are ~estimates — set UNOWN_PRICE_<MODEL>_IN/OUT (USD per 1M tokens) to pin exact prices");
	if (summary.pricing.unknownModels.length) lines.push(`no price data for: ${summary.pricing.unknownModels.join(", ")} — their cost shows as — (override with UNOWN_PRICE_<MODEL>_IN/OUT)`);
	if (summary.truncated) lines.push("note: the usage log read hit its line cap — older entries in this window may be missing");
	if (summary.skippedLines > 0) lines.push(`note: ${summary.skippedLines} malformed log line(s) skipped`);
	if (opts.sourceNote) lines.push(opts.sourceNote);
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

export interface UsageCommandOptions {
	env?: Record<string, string | undefined>;
	/** Injectable clock (tests). */
	now?: () => number;
}

/** The bridge base URL — same convention as store.ts's BRIDGE_URL, without importing it (SQLite at module scope). */
export function resolveBridgeUrl(env: Record<string, string | undefined>): string {
	return (env.PI_BRIDGE_URL || "http://127.0.0.1:3031").replace(/\/+$/, "");
}

/** Fetch GET /v1/usage from the bridge; null when unreachable/malformed. */
export async function fetchBridgeUsage(baseUrl: string, days: number, model: string | undefined, apiKey: string | undefined): Promise<UsageSummary | null> {
	const qs = new URLSearchParams({ days: String(days) });
	if (model) qs.set("model", model);
	try {
		const res = await fetch(`${baseUrl}/v1/usage?${qs}`, {
			headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
			signal: AbortSignal.timeout(4000),
		});
		if (!res.ok) return null;
		const data: any = await res.json();
		if (typeof data?.since !== "number" || !data?.totals || !Array.isArray(data?.byModel) || !Array.isArray(data?.byDay)) return null;
		return data as UsageSummary;
	} catch {
		return null;
	}
}

export async function runUsageCommand(argv: string[], opts: UsageCommandOptions = {}): Promise<CliResult> {
	const env = opts.env ?? process.env;
	const now = opts.now ?? Date.now;
	const flags = parseUsageFlags(argv);
	if (flags.help) return { stdout: USAGE_HELP, exitCode: 0 };
	if (flags.error) return { stderr: `${flags.error}\n\n${USAGE_HELP}`, exitCode: 1 };

	const bridgeUrl = resolveBridgeUrl(env);
	const fromBridge = await fetchBridgeUsage(bridgeUrl, flags.days, flags.model, env.BRIDGE_API_KEY || undefined);
	if (fromBridge) {
		if (flags.json) {
			return { stdout: `${JSON.stringify({ source: "bridge", bridgeUrl, summary: fromBridge }, null, 2)}\n`, exitCode: 0 };
		}
		return { stdout: `${renderUsageTable(fromBridge)}\n`, exitCode: 0 };
	}

	// Bridge down → direct read of the bridge's JSONL log (default state dir).
	const stateDir = resolveUsageStateDir(env, [process.cwd(), import.meta.dir]);
	const file = join(stateDir, USAGE_LOG_FILE_NAME);
	if (!existsSync(file)) {
		return {
			stderr:
				`the bridge is not reachable at ${bridgeUrl} and no usage log exists at ${file}\n` +
				`  start the stack: bun run agent:start   (then: unown usage)\n` +
				`  or point at the log:  UNOWN_BRIDGE_STATE_DIR=<bridge state dir> unown usage`,
			exitCode: 1,
		};
	}
	const sinceTs = now() - flags.days * DAY_MS;
	const tail = readUsageTails([file, `${file}.1`], sinceTs, USAGE_TAIL_MAX_LINES);
	const summary = aggregateUsage(tail.records, { sinceTs, days: flags.days, model: flags.model, env });
	summary.skippedLines = tail.skipped;
	summary.linesRead = tail.linesRead;
	summary.truncated = tail.hitCap;
	if (flags.json) {
		return { stdout: `${JSON.stringify({ source: "file", file, summary }, null, 2)}\n`, exitCode: 0 };
	}
	return { stdout: `${renderUsageTable(summary, { sourceNote: `source: ${file} (direct read — the bridge at ${bridgeUrl} was unreachable)` })}\n`, exitCode: 0 };
}
