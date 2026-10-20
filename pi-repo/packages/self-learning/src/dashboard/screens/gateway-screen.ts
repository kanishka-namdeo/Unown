/**
 * screens/gateway-screen.ts — LLM bridge traffic: request/error/token KPIs,
 * a per-model table (the "what did the engine spend tokens on" answer), a
 * latency sparkline over the last 40 completions, and the request log as
 * dim informational rows. Enter drills into one model's share + its log.
 *
 * Data is the /api/bridge snapshot (log entries oldest→newest, ≤200). The
 * store polls the active screen every 4s and SSE invalidates on run finish —
 * no manual refresh key (the app shell owns `r`), so the footer stays lean.
 */

import { matchesKey } from "@earendil-works/pi-tui";
import type { BridgeLogEntry, BridgeResponse } from "../dashboard-types.ts";
import type { Screen, ScreenDeps, SelectionWindow } from "../screen.ts";
import { SelectionWindow as Window } from "../screen.ts";
import {
	ageStamp,
	emptyState,
	errorState,
	formatTokens,
	heading,
	loadingState,
	sparkline,
	timeAgo,
	trunc,
} from "../widgets/bits.ts";

/** Per-model aggregate over the bridge log (requests, tokens, latency). */
interface ModelAgg {
	model: string;
	requests: number;
	inTok: number;
	outTok: number;
	totalMs: number;
	entries: BridgeLogEntry[];
}

export function createGatewayScreen(deps: ScreenDeps): Screen {
	const { store, theme, requestRender } = deps;
	let viewport = 24;
	let mode: "list" | "detail" = "list";
	let detailModel: string | null = null;
	let detailScroll = 0;

	const snap = () => store.snapshot<BridgeResponse>("bridge");
	const log = (): BridgeLogEntry[] => snap().data?.log ?? [];

	/** Group the log by model, busiest first. */
	function models(): ModelAgg[] {
		const map = new Map<string, ModelAgg>();
		for (const e of log()) {
			const model = e?.model;
			if (!model) continue;
			let agg = map.get(model);
			if (!agg) {
				agg = { model, requests: 0, inTok: 0, outTok: 0, totalMs: 0, entries: [] };
				map.set(model, agg);
			}
			agg.requests += 1;
			agg.inTok += e.promptTokens ?? 0;
			agg.outTok += e.completionTokens ?? 0;
			agg.totalMs += e.durationMs ?? 0;
			agg.entries.push(e);
		}
		return [...map.values()].sort((a, b) => b.requests - a.requests || a.model.localeCompare(b.model));
	}

	const win: SelectionWindow = new Window(
		() => models().length,
		() => Math.max(1, viewport - 10 - logRows()),
	);

	/** How many request-log rows fit under the model table (~10 on tall screens). */
	function logRows(): number {
		return Math.max(0, Math.min(10, viewport - 14));
	}

	// ---- rendering ----------------------------------------------------------

	function renderKpis(data: BridgeResponse, width: number): string[] {
		const entries = data.log ?? [];
		const inTok = entries.reduce((a, e) => a + (e.promptTokens ?? 0), 0);
		const outTok = entries.reduce((a, e) => a + (e.completionTokens ?? 0), 0);
		const avg =
			entries.length > 0 ? Math.round(entries.reduce((a, e) => a + (e.durationMs ?? 0), 0) / entries.length) : 0;
		const errors = data.errors ?? 0;
		const sep = theme.fg("dim", "·");
		return [
			trunc(
				`${theme.fg("muted", "requests ")}${theme.fg("text", `${data.requests ?? 0}`)} ${sep} ` +
					`${theme.fg("muted", "errors ")}${theme.fg(errors > 0 ? "error" : "dim", `${errors}`)} ${sep} ` +
					`${theme.fg("muted", "tokens ")}${theme.fg("dim", `↑${formatTokens(inTok)} ↓${formatTokens(outTok)}`)} ${sep} ` +
					`${theme.fg("muted", "avg ")}${theme.fg("dim", `${avg}ms`)}`,
				width,
			),
		];
	}

	function renderLatency(width: number): string[] {
		const entries = log().slice(-40);
		if (entries.length === 0) return [];
		const span = width - 16;
		if (span < 8) return [];
		return [
			theme.fg("dim", "latency (last 40)"),
			sparkline(
				theme,
				entries.map((e) => e.durationMs ?? 0),
				span,
				"amber",
			),
		];
	}

	function renderModelRow(m: ModelAgg, selected: boolean, width: number): string {
		const cursor = selected ? theme.fg("accent", "▸ ") : "  ";
		const name = theme.fg(selected ? "text" : "muted", m.model);
		const reqs = theme.fg("dim", `${m.requests} reqs`);
		const toks = theme.fg("dim", `↑${formatTokens(m.inTok)} ↓${formatTokens(m.outTok)}`);
		const avg = theme.fg("dim", `avg ${Math.round(m.totalMs / Math.max(1, m.requests))}ms`);
		return trunc(
			`${cursor}${name} ${theme.fg("dim", "·")} ${reqs} ${theme.fg("dim", "·")} ${toks} ${theme.fg("dim", "·")} ${avg}`,
			width,
		);
	}

	function renderLogRow(e: BridgeLogEntry, width: number, indent = "  "): string {
		const when = theme.fg("dim", timeAgo(e.ts));
		const model = theme.fg("muted", e.model ?? "?");
		const stream = theme.fg("dim", e.stream ? "stream" : "sync");
		const finish = theme.fg("dim", e.finishReason || "—");
		const toks = theme.fg("dim", `↑${formatTokens(e.promptTokens ?? 0)} ↓${formatTokens(e.completionTokens ?? 0)}`);
		const dur = theme.fg("dim", `${Math.round(e.durationMs ?? 0)}ms`);
		return trunc(
			`${indent}${when} ${theme.fg("dim", "·")} ${model} ${theme.fg("dim", "·")} ${stream} ${theme.fg("dim", "·")} ` +
				`${finish} ${theme.fg("dim", "·")} ${toks} ${theme.fg("dim", "·")} ${dur}`,
			width,
		);
	}

	function renderList(width: number): string[] {
		const s = snap();
		const lines: string[] = [];
		if (s.error && !s.data) {
			lines.push(...errorState(theme, s.error, width));
			lines.push("");
		}
		const data = s.data;
		if (data) {
			lines.push(...renderKpis(data, width));
			const latency = renderLatency(width);
			if (latency.length > 0) {
				lines.push("");
				lines.push(...latency);
			}
		} else if (!s.error) {
			lines.push(...loadingState(theme, "bridge log"));
		}
		lines.push("");
		const table = models();
		lines.push(heading(theme, `models${data ? ` (${table.length})` : ""}`));
		if (data && table.length === 0) {
			lines.push(
				...emptyState(
					theme,
					"no bridge traffic yet",
					"the llm-bridge logs every chat completion it proxies",
					width,
				),
			);
		} else if (data) {
			win.resync();
			const view = Math.max(1, viewport - 10 - logRows());
			const slice = table.slice(win.scroll, win.scroll + view);
			slice.forEach((m, i) => {
				lines.push(renderModelRow(m, win.scroll + i === win.selected, width));
			});
			const more = table.length - view - win.scroll;
			if (more > 0) lines.push(theme.fg("dim", `  … ${more} more (j/k, PgDn)`));
		}
		if (data && log().length > 0) {
			lines.push("");
			lines.push(heading(theme, "request log"));
			const recent = [...log()].slice(-logRows()).reverse();
			for (const e of recent) lines.push(renderLogRow(e, width));
		}
		if (s.ageMs !== null) lines.push(theme.fg("dim", `  data ${ageStamp(theme, s.ageMs)}`));
		return lines;
	}

	function renderDetail(width: number): string[] {
		const agg = models().find((m) => m.model === detailModel) ?? null;
		if (!agg) return [theme.fg("dim", "model no longer in the log · esc back")];
		const entries = log();
		const lines: string[] = [];
		const field = (label: string, value: string) =>
			`${theme.fg("muted", label.padEnd(9))} ${theme.fg("text", value)}`;
		lines.push(heading(theme, `model · ${agg.model}`), "");
		lines.push(field("requests", `${agg.requests}`));
		lines.push(field("tokens", `↑${formatTokens(agg.inTok)} ↓${formatTokens(agg.outTok)}`));
		lines.push(field("avg", `${Math.round(agg.totalMs / Math.max(1, agg.requests))}ms`));
		lines.push(
			field("share", `${Math.round((agg.requests / Math.max(1, entries.length)) * 100)}% of gateway traffic`),
		);
		lines.push("");
		lines.push(heading(theme, `requests (${agg.entries.length})`));
		const recent = [...agg.entries].slice(-40).reverse();
		if (recent.length === 0) lines.push(...emptyState(theme, "no requests for this model", undefined, width));
		for (const e of recent) lines.push(renderLogRow(e, width));
		lines.push("");
		lines.push(theme.fg("dim", "esc back · j/k scroll"));
		const view = Math.max(1, viewport);
		const max = Math.max(0, lines.length - view);
		if (detailScroll > max) detailScroll = max;
		if (detailScroll < 0) detailScroll = 0;
		return lines.slice(detailScroll, detailScroll + view);
	}

	// ---- the screen ---------------------------------------------------------

	const screen: Screen = {
		render(width: number): string[] {
			if (mode === "detail") return renderDetail(width);
			return renderList(width);
		},

		invalidate(): void {
			requestRender();
		},

		setViewport(height: number): void {
			viewport = height;
		},

		footerHints(): [string, string][] {
			if (mode === "detail")
				return [
					["esc", "back"],
					["j/k", "scroll"],
				];
			return [
				["enter", "model detail"],
				["j/k", "select"],
			];
		},

		handleKey(data: string): boolean {
			if (mode === "detail") {
				if (matchesKey(data, "escape")) {
					mode = "list";
					return true;
				}
				if (matchesKey(data, "j") || matchesKey(data, "down")) {
					detailScroll += 1;
					return true;
				}
				if (matchesKey(data, "k") || matchesKey(data, "up")) {
					detailScroll = Math.max(0, detailScroll - 1);
					return true;
				}
				if (matchesKey(data, "g")) {
					detailScroll = 0;
					return true;
				}
				if (matchesKey(data, "shift+g")) {
					detailScroll = 1 << 30; // clamped against the built lines at render
					return true;
				}
				if (matchesKey(data, "pageDown")) {
					detailScroll += Math.max(1, viewport - 1);
					return true;
				}
				if (matchesKey(data, "pageUp")) {
					detailScroll = Math.max(0, detailScroll - Math.max(1, viewport - 1));
					return true;
				}
				return false;
			}
			if (matchesKey(data, "j") || matchesKey(data, "down")) return win.move(1);
			if (matchesKey(data, "k") || matchesKey(data, "up")) return win.move(-1);
			if (matchesKey(data, "g")) return win.home();
			if (matchesKey(data, "shift+g")) return win.end();
			if (matchesKey(data, "pageDown")) return win.page(1);
			if (matchesKey(data, "pageUp")) return win.page(-1);
			if (matchesKey(data, "enter")) {
				const m = models()[win.selected];
				if (m) {
					mode = "detail";
					detailModel = m.model;
					detailScroll = 0;
				}
				return true;
			}
			return false;
		},
	};
	return screen;
}
