/**
 * screens/tools-screen.ts — the PLM round's Tool View.
 *
 * The mission's Agent Operations Dashboard asks for tool reliability, cost,
 * latency, success rate and recovery rate with rankings and recommendations
 * — "detect underperforming tools." This screen renders the engine's
 * /api/tools aggregate: the headline census (invocations, success rate,
 * category split), per-tool reliability rows (success rate, avg/p95
 * duration, retry load, engine/terminal lane split, failure classes), the
 * recommendation list (worst severity first — each finding carries its own
 * fix line), and the recent invocation feed. Receipts-only: a fresh install
 * prints the honest-absence state, never fabricated rankings.
 */

import { matchesKey } from "@earendil-works/pi-tui";
import type { ToolsResponse } from "../dashboard-types.ts";
import type { Screen, ScreenDeps, SelectionWindow } from "../screen.ts";
import { SelectionWindow as Window } from "../screen.ts";
import { errorState, heading, loadingState, trunc } from "../widgets/bits.ts";

function duration(ms: number | null | undefined): string {
	if (ms === null || ms === undefined) return "—";
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.round(ms / 60_000)}m`;
}

function pct(rate: number | null | undefined): string {
	if (rate === null || rate === undefined) return "—";
	return `${Math.round(rate * 100)}%`;
}

const SEVERITY_COLOR: Record<string, string> = {
	high: "error",
	medium: "warning",
	low: "info",
};

export function createToolsScreen(deps: ScreenDeps): Screen {
	const { store, theme, requestRender } = deps;
	let viewport = 24;

	const snap = () => store.snapshot<ToolsResponse>("plmTools");
	const tools = () => snap().data?.tools ?? [];
	const recommendations = () => snap().data?.recommendations ?? [];
	const totals = () => snap().data?.totals;

	const FIXED_ROWS = 9;
	const win: SelectionWindow = new Window(
		() => tools().length,
		() => Math.max(1, viewport - FIXED_ROWS),
	);

	const screen: Screen = {
		render(width: number): string[] {
			const s = snap();
			if (s.error && !s.data) return errorState(theme, s.error, width);
			if (!s.data) return [heading(theme, "tools"), ...loadingState(theme, "the tool lifecycle ledger")];
			const conn = store.connection;
			const connText =
				conn === "up"
					? theme.fg("success", "● engine up")
					: conn === "down"
						? theme.fg("error", "● engine down — cached snapshot")
						: theme.fg("warning", `● engine ${conn}`);
			const lines: string[] = [heading(theme, "tools")];
			const t = totals();
			if (t) {
				const cats = t.byCategory.slice(0, 5).map((c) => `${c.category} ${c.count}`);
				lines.push(
					trunc(
						`${connText}${theme.fg("dim", ` · ${t.invocations} invocation(s) · ${pct(t.invocations > 0 ? t.successRate : null)} success`)}`,
						width,
					),
				);
				if (cats.length > 0) lines.push(trunc(theme.fg("dim", `categories: ${cats.join(" · ")}`), width));
			} else {
				lines.push(connText);
			}
			lines.push("");

			// ---- recommendations first (the actionable surface) ----
			const recs = recommendations();
			if (recs.length > 0) {
				lines.push(theme.fg("muted", "recommendations"));
				for (const r of recs.slice(0, 4)) {
					const color = SEVERITY_COLOR[r.severity] ?? "muted";
					lines.push(trunc(`  ${theme.fg(color, `▲ ${r.finding}`)}`, width));
					lines.push(trunc(theme.fg("dim", `    → ${r.recommendation}`), width));
				}
				lines.push("");
			}

			const list = tools();
			if (list.length === 0) {
				lines.push(theme.fg("success", "✓ no tool invocations recorded yet"));
				lines.push(theme.fg("dim", "  engine runs and terminal sessions report every tool call here"));
			} else {
				lines.push(theme.fg("muted", "per-tool reliability"));
				win.resync();
				const view = Math.max(1, viewport - FIXED_ROWS - (recs.length > 0 ? 4 + recs.length * 2 : 0));
				const end = Math.min(list.length, win.scroll + Math.max(1, view));
				for (let i = win.scroll; i < end; i++) {
					const r = list[i]!;
					const cursor = i === win.selected ? theme.fg("accent", "▸ ") : "  ";
					const rate = r.invocations > 0 ? r.successRate : null;
					const color = rate === null ? "muted" : rate >= 0.9 ? "success" : rate >= 0.7 ? "warning" : "error";
					const lanes = `${r.lanes.engine}e/${r.lanes.terminal}t`;
					lines.push(
						trunc(
							`${cursor}${theme.fg(color, `${r.tool} ${pct(rate)}`)} ${theme.fg("dim", `· ${r.invocations} calls · avg ${duration(r.avgDurationMs)} · p95 ${duration(r.p95DurationMs)} · ${lanes}${r.retries > 0 ? ` · ${r.retries} retries` : ""}`)}`,
							width,
						),
					);
					if (r.failures > 0 && r.failureClasses.length > 0) {
						const top = r.failureClasses
							.slice(0, 3)
							.map((f) => `${f.type} ×${f.count}`)
							.join(", ");
						lines.push(trunc(theme.fg("dim", `    failures: ${top}`), width));
					}
				}
				if (list.length > end) lines.push(theme.fg("dim", `  … ${list.length - end} more`));
			}
			lines.push("");
			lines.push(theme.fg("dim", "↑↓ navigate · r: refresh"));
			return lines;
		},

		setViewport(height: number): void {
			viewport = height;
		},

		footerHints(): [string, string][] {
			return [
				["↑↓", "select"],
				["r", "refresh"],
			];
		},

		handleKey(data: string): boolean {
			if (matchesKey(data, "r")) {
				void store.refresh("plmTools");
				requestRender();
				return true;
			}
			return false;
		},
	};
	return screen;
}
