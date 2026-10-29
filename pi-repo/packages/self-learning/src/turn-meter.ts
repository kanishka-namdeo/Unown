/**
 * turn-meter.ts — the per-turn session meter for the TUI footer.
 *
 * The 2026-10 convergence round: per-turn cost/token visibility is table
 * stakes now — Goose ships a per-message tokens/cost/TTFT row since v1.42
 * (Aug 2026), Gemini CLI's /stats shows model + tool subviews, and Claude
 * Code's statusline keeps context% + cost on screen at all times. Unown had
 * the DATA everywhere (/context, /usage, /session) but no LIVE line — you
 * had to run a command to see what the last turn cost.
 *
 * This module is the pure core: format a compact, ASCII, one-row footer
 * chip from the facts a turn boundary already has —
 *
 *   turn 3.4s · ctx 62% · in 45.2k out 1.1k (cached 42k) · ~$0.0084
 *
 * rendered through pi's `ctx.ui.setStatus("turn", ...)` seam (the same
 * joined footer row the goal chip and the flights hint use). Session
 * rollup semantics follow /usage's attribution (sessionUsageSummary:
 * assistant + toolResult/compaction usage), so the chip's numbers always
 * agree with the command surfaces. Cost uses the usage-cli pricing model
 * (UNOWN_PRICE_<MODEL>_IN/_OUT overrides, then the built-in estimate table,
 * then omitted — an unknown model's price is never invented).
 *
 * Pure module: no pi imports, no fs. The wiring lives in tools.ts
 * (`pi.on("turn_start")` / `pi.on("turn_end")`), gated by
 * UNOWN_TURN_METER=0 (default on) and ctx.hasUI.
 */

export const TURN_METER_ENV = "UNOWN_TURN_METER";

export interface TurnUsageDelta {
	/** Cumulative session input tokens at this turn boundary. */
	tokensIn: number;
	/** Cumulative session output tokens at this turn boundary. */
	tokensOut: number;
	/** Cumulative session cache-read tokens at this turn boundary. */
	cacheRead: number;
	/** The model id whose pricing applies (e.g. "agnes-3.0-flash"). */
	model?: string;
}

export interface TurnMeterInput {
	usage: TurnUsageDelta;
	/** Wall-clock duration of the turn just completed (ms). */
	durationMs: number;
	/** Time-to-first-token: when the host observed the first streamed
	 *  assistant chunk (ms after turn start) — the latency the user FELT.
	 *  Omitted when the host cannot observe it (non-streaming runs). */
	firstTokenMs?: number;
	/** Live context utilization, when the host reports it: tokens + window. */
	context?: { tokens: number; contextWindow: number };
	/** Env (injected for tests); reads UNOWN_TURN_METER and the price overrides. */
	env?: Record<string, string | undefined>;
	/** Pricing resolver — defaults to usage-cli's resolveModelPrice. */
	resolvePrice?: (
		model: string,
		env: Record<string, string | undefined>,
	) => { inputUsdPer1M: number; outputUsdPer1M: number } | null | undefined;
}

export interface TurnMeterResult {
	text: string;
	enabled: boolean;
}

/** Is the meter on? (default on; UNOWN_TURN_METER=0 disables) */
export function turnMeterEnabled(env: Record<string, string | undefined> = process.env): boolean {
	return (env[TURN_METER_ENV] ?? "") !== "0";
}

/** Compact token count: 942 → "942", 12_345 → "12.3k", 1_234_567 → "1.23M". */
export function compactTokens(n: number): string {
	if (!Number.isFinite(n) || n < 0) return "0";
	if (n < 1_000) return String(Math.round(n));
	if (n < 1_000_000) {
		const v = n / 1_000;
		return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}k`;
	}
	return `${Math.round(n / 10_000) / 100}M`;
}

/** Compact duration: 830ms → "0.8s", 34_200ms → "34s", 92_000ms → "1.5m". */
export function compactDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "0s";
	if (ms < 1_000) return "<1s";
	if (ms < 60_000) return `${Math.round(ms / 100) / 10}s`;
	return `${Math.round(ms / 6_000) / 10}m`;
}

/**
 * Estimate USD for the session rollup. Mirrors /usage's arithmetic: the
 * full input token count is priced (the estimate tables predate per-token
 * cache pricing, so cache reads are not discounted — the "~" prefix and
 * the /usage docs already frame this as an estimate).
 */
export function estimateSessionCostUsd(
	usage: TurnUsageDelta,
	resolvePrice: TurnMeterInput["resolvePrice"],
	env: Record<string, string | undefined>,
): number | null {
	if (!usage.model) return null;
	const price = resolvePrice?.(usage.model, env);
	if (!price) return null;
	const inUsd = (usage.tokensIn / 1_000_000) * price.inputUsdPer1M;
	const outUsd = (usage.tokensOut / 1_000_000) * price.outputUsdPer1M;
	return inUsd + outUsd;
}

function formatCost(usd: number): string {
	// Show two decimals above a cent, three below — the ranges a flash-model
	// session actually lands in ($0.0009 … $0.42).
	if (usd >= 0.01) return `$${Math.round(usd * 100) / 100}`;
	return `$${Math.round(usd * 10_000) / 10_000}`;
}

/**
 * Render the footer chip. `usage.tokensIn` etc. are session-cumulative (the
 * /usage attribution), so consecutive turns show a growing total — the same
 * mental model Claude Code's statusline cost uses.
 */
export function formatTurnMeter(input: TurnMeterInput): TurnMeterResult {
	const env = input.env ?? {};
	if (!turnMeterEnabled(env)) return { text: "", enabled: false };

	const parts: string[] = [];
	parts.push(`turn ${compactDuration(input.durationMs)}`);

	// TTFT (the goose v1.42+ row parity): how long the model made the user
	// wait before the first streamed token. Only when the host observed it.
	if (typeof input.firstTokenMs === "number" && Number.isFinite(input.firstTokenMs) && input.firstTokenMs > 0) {
		parts.push(`ttft ${compactDuration(input.firstTokenMs)}`);
	}

	if (input.context && input.context.contextWindow > 0) {
		const pct = Math.min(100, Math.round((input.context.tokens / input.context.contextWindow) * 100));
		parts.push(`ctx ${pct}%`);
	}

	const { tokensIn, tokensOut, cacheRead } = input.usage;
	let tokenPart = `in ${compactTokens(tokensIn)} out ${compactTokens(tokensOut)}`;
	if (cacheRead > 0) tokenPart += ` (cached ${compactTokens(cacheRead)})`;
	parts.push(tokenPart);

	if (input.usage.model) {
		const cost = estimateSessionCostUsd(input.usage, input.resolvePrice, env);
		if (cost !== null) parts.push(`~${formatCost(cost)}`);
	}

	return { text: parts.join(" · "), enabled: true };
}
