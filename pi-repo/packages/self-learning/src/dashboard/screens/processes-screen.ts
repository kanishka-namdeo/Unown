/**
 * screens/processes-screen.ts — the PLM round's Process View.
 *
 * The mission's Agent Operations Dashboard asks for a live census of
 * active/failed/blocked/waiting/completed processes with the state machine
 * visible. This screen renders the engine's /api/processes registry: the
 * status census (worst-first), the transition analytics (what actually
 * happens over time — CREATED→RUNNING→SUCCEEDED is the happy path), the
 * per-kind rollup, and the recent process list with owner, duration and
 * tool usage. Every number is receipts-only: a fresh install prints the
 * honest-absence states, never zeros dressed as data.
 *
 * Drill-in (Enter): the selected process's transition HISTORY — the full
 * event chain with reasons (the audit surface the registry guarantees:
 * "no process may bypass lifecycle states" is visible here as the chain).
 */

import { matchesKey } from "@earendil-works/pi-tui";
import type { ProcessAnalytics, ProcessEventRow, ProcessesResponse, ProcessRow } from "../dashboard-types.ts";
import type { Screen, ScreenDeps, SelectionWindow } from "../screen.ts";
import { SelectionWindow as Window } from "../screen.ts";
import { errorState, heading, loadingState, timeAgo, trunc } from "../widgets/bits.ts";

const STATUS_GLYPH: Record<string, string> = {
	CREATED: "◦",
	PLANNED: "◇",
	QUEUED: "≡",
	RUNNING: "▶",
	WAITING: "⏸",
	BLOCKED: "⊘",
	RETRYING: "↻",
	VALIDATING: "✓?",
	SUCCEEDED: "✓",
	FAILED: "✗",
	ABANDONED: "∅",
	ARCHIVED: "▤",
};

const STATUS_COLOR: Record<string, string> = {
	RUNNING: "accent",
	RETRYING: "warning",
	VALIDATING: "info",
	WAITING: "warning",
	BLOCKED: "error",
	SUCCEEDED: "success",
	FAILED: "error",
	ABANDONED: "muted",
	ARCHIVED: "dim",
};

function duration(ms: number | null | undefined): string {
	if (ms === null || ms === undefined) return "—";
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
	return `${Math.round(ms / 3_600_000)}h`;
}

export function createProcessesScreen(deps: ScreenDeps): Screen {
	const { store, theme, requestRender } = deps;
	let viewport = 24;
	let selectedDetail: { row: ProcessRow; events: ProcessEventRow[] } | null = null;
	let detailLoading = false;

	const snap = () => store.snapshot<ProcessesResponse>("processes");
	const rows = () => snap().data?.processes ?? [];
	const analytics = () => snap().data?.analytics;

	const FIXED_ROWS = 9;
	const win: SelectionWindow = new Window(
		() => rows().length,
		() => Math.max(1, viewport - FIXED_ROWS),
	);

	const screen: Screen = {
		render(width: number): string[] {
			// ---- drill-in: the selected process's transition history ----
			if (selectedDetail) {
				const d = selectedDetail;
				const lines: string[] = [heading(theme, `process · ${d.row.objective.slice(0, 60)}`)];
				const glyph = STATUS_GLYPH[d.row.status] ?? "?";
				const color = STATUS_COLOR[d.row.status] ?? "muted";
				lines.push(
					trunc(
						`${theme.fg(color, `${glyph} ${d.row.status}`)} ${theme.fg("dim", `${d.row.kind} · owner ${d.row.owner ?? "?"} · attempt ${d.row.attempt}`)}`,
						width,
					),
				);
				if (d.row.status_reason) lines.push(trunc(theme.fg("dim", `reason: ${d.row.status_reason}`), width));
				const tools = d.row.tool_usage ? (JSON.parse(d.row.tool_usage) as { calls?: number; errors?: number }) : {};
				const tokens = d.row.token_usage ? (JSON.parse(d.row.token_usage) as { in?: number; out?: number }) : {};
				lines.push(
					trunc(
						theme.fg(
							"dim",
							`usage: ${tools.calls ?? 0} tool call(s) (${tools.errors ?? 0} error(s)) · ${tokens.in ?? 0}/${tokens.out ?? 0} tok · ${duration(d.row.duration_ms)}`,
						),
						width,
					),
				);
				if (d.row.lessons) lines.push(trunc(theme.fg("warning", `lessons: ${d.row.lessons}`), width));
				lines.push("");
				lines.push(theme.fg("muted", "transition history"));
				for (const e of d.events) {
					const from = e.from_status ?? "(birth)";
					const toGlyph = STATUS_GLYPH[e.to_status] ?? "?";
					const toColor = STATUS_COLOR[e.to_status] ?? "muted";
					lines.push(
						trunc(
							`  ${theme.fg("dim", `${from} →`)} ${theme.fg(toColor, `${toGlyph} ${e.to_status}`)} ${theme.fg("dim", timeAgo(e.ts))}${e.reason ? ` · ${e.reason.slice(0, 60)}` : ""}`,
							width,
						),
					);
				}
				lines.push("");
				lines.push(theme.fg("dim", "esc: back to the registry"));
				return lines;
			}

			const s = snap();
			if (s.error && !s.data) return errorState(theme, s.error, width);
			if (!s.data) return [heading(theme, "processes"), ...loadingState(theme, "the process registry")];
			const conn = store.connection;
			const connText =
				conn === "up"
					? theme.fg("success", "● engine up")
					: conn === "down"
						? theme.fg("error", "● engine down — cached snapshot")
						: theme.fg("warning", `● engine ${conn}`);
			const lines: string[] = [heading(theme, "processes")];
			const a = analytics();
			if (a) {
				const c = a.current;
				const live = (c["RUNNING"] ?? 0) + (c["RETRYING"] ?? 0) + (c["VALIDATING"] ?? 0);
				const waiting = (c["WAITING"] ?? 0) + (c["BLOCKED"] ?? 0);
				lines.push(
					trunc(
						`${connText}${theme.fg("dim", ` · ${a.total} tracked · ${live} live · ${waiting} parked · ${c["SUCCEEDED"] ?? 0} ok · ${c["FAILED"] ?? 0} failed`)}`,
						width,
					),
				);
				const top = a.transitionCounts.slice(0, 4).map((t) => `${t.from}→${t.to} ×${t.count}`);
				if (top.length > 0) lines.push(trunc(theme.fg("dim", `transitions: ${top.join(" · ")}`), width));
				if (a.avgDurationMs !== null)
					lines.push(
						trunc(
							theme.fg(
								"dim",
								`avg duration ${duration(a.avgDurationMs)} · kinds: ${a.byKind
									.slice(0, 4)
									.map((k) => `${k.kind} ${k.count}`)
									.join(" · ")}`,
							),
							width,
						),
					);
			} else {
				lines.push(connText);
			}
			lines.push("");

			const list = rows();
			if (list.length === 0) {
				lines.push(theme.fg("success", "✓ no processes tracked yet"));
				lines.push(
					theme.fg("dim", "  engine jobs, agent runs, dreams and terminal sessions land here as they happen"),
				);
			} else {
				win.resync();
				const view = Math.max(1, viewport - FIXED_ROWS);
				const end = Math.min(list.length, win.scroll + view);
				for (let i = win.scroll; i < end; i++) {
					const r = list[i]!;
					const cursor = i === win.selected ? theme.fg("accent", "▸ ") : "  ";
					const glyph = STATUS_GLYPH[r.status] ?? "?";
					const color = STATUS_COLOR[r.status] ?? "muted";
					const tools = r.tool_usage ? (JSON.parse(r.tool_usage) as { calls?: number }) : {};
					lines.push(
						trunc(
							`${cursor}${theme.fg(color, `${glyph} ${r.status}`)} ${theme.fg("muted", r.kind)} ${theme.fg("dim", `· ${r.owner ?? "?"} · ${duration(r.duration_ms)} · ${tools.calls ?? 0} calls · ${timeAgo(r.created_at)}`)}`,
							width,
						),
					);
					lines.push(trunc(`    ${theme.fg("dim", r.objective.slice(0, 100))}`, width));
				}
				if (list.length > end) lines.push(theme.fg("dim", `  … ${list.length - end} more`));
			}
			lines.push("");
			lines.push(theme.fg("dim", "↑↓ navigate · enter: transition history · r: refresh"));
			return lines;
		},

		setViewport(height: number): void {
			viewport = height;
		},

		footerHints(): [string, string][] {
			return selectedDetail
				? [
						["esc", "back"],
						["r", "refresh"],
					]
				: [
						["↑↓", "select"],
						["enter", "history"],
						["r", "refresh"],
					];
		},

		handleKey(data: string): boolean {
			if (matchesKey(data, "escape") && selectedDetail) {
				selectedDetail = null;
				requestRender();
				return true;
			}
			if (matchesKey(data, "j") || matchesKey(data, "down")) return win.move(1);
			if (matchesKey(data, "k") || matchesKey(data, "up")) return win.move(-1);
			if (matchesKey(data, "g")) return win.home();
			if (matchesKey(data, "shift+g")) return win.end();
			if (matchesKey(data, "r")) {
				void store.refresh("processes");
				requestRender();
				return true;
			}
			if (matchesKey(data, "enter") || matchesKey(data, "return")) {
				if (selectedDetail || detailLoading) return true;
				const list = rows();
				const selected = list[win.selected];
				if (!selected) return true;
				detailLoading = true;
				void (async () => {
					try {
						const detail = await store.processDetail(selected.id);
						selectedDetail = { row: detail, events: detail.events ?? [] };
					} catch {
						// the row may be pruned mid-flight — stay on the list
					} finally {
						detailLoading = false;
						requestRender();
					}
				})();
				return true;
			}
			return false;
		},
	};
	return screen;
}
