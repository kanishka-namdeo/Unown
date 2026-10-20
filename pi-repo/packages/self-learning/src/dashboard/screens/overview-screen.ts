/**
 * screens/overview-screen.ts — the learning loop at a glance: KPI band,
 * cumulative-pass sparkline, live activity rail, and the benchmark task
 * table with run/mint actions. The default screen.
 *
 * This file is the reference implementation of the screen pattern (the other
 * screens follow its structure): SelectionWindow over the primary list,
 * setViewport sizing, list⇄detail drill modes, footerHints vocabulary, and
 * error/empty/loading states from widgets/bits.ts.
 */

import { matchesKey } from "@earendil-works/pi-tui";
import type { Screen, ScreenDeps, SelectionWindow } from "../screen.ts";
import { SelectionWindow as Window } from "../screen.ts";
import type { OverviewResponse, Task, TaskDetail } from "../dashboard-types.ts";
import {
	ageStamp,
	badge,
	difficultyStars,
	emptyState,
	errorState,
	formatTokens,
	heading,
	loadingState,
	meter,
	sparkline,
	statusTone,
	timeAgo,
	trunc,
	toneToken,
	type Tone,
	wrap,
} from "../widgets/bits.ts";

export function createOverviewScreen(deps: ScreenDeps): Screen {
	const { store, theme, toast, requestRender, confirm } = deps;
	let viewport = 24;
	let mode: "list" | "detail" = "list";
	let detailTask: TaskDetail | null = null;
	let detailLoading = false;
	let detailError: string | null = null;

	const tasks = (): Task[] => store.snapshot<{ tasks: Task[] }>("tasks").data?.tasks ?? [];
	const win: SelectionWindow = new Window(
		() => tasks().length,
		() => Math.max(1, viewport - FIXED_ROWS),
	);

	// Rows the KPI + trend + activity blocks occupy above the task table.
	const FIXED_ROWS = 12;

	function overview(): OverviewResponse | null {
		return store.snapshot<OverviewResponse>("overview").data;
	}

	function renderKpis(width: number, ov: OverviewResponse): string[] {
		const k = ov.kpis;
		const lines: string[] = [];
		// Row 1: the loop's health — pass rate meter + counts.
		const rate = k.totalRuns > 0 ? k.passed / k.totalRuns : 0;
		const rateText = k.totalRuns === 0 ? "no runs yet" : `${k.passed}/${k.totalRuns} · ${Math.round(rate * 100)}%`;
		lines.push(
			`${theme.fg("muted", "pass rate ")}${meter(theme, rate, 12)} ${theme.fg("dim", rateText)}   ${theme.fg("muted", "errors ")}${theme.fg(k.errors > 0 ? "error" : "dim", `${k.errors}`)}`,
		);
		// Row 2: learning suite + shipped + dreams + pending notes.
		const suite = k.suite
			? `${k.suite.passing}/${k.suite.total} passing${k.suite.saturated ? theme.fg("warning", " · saturated") : ""}`
			: "—";
		lines.push(
			`${theme.fg("muted", "suite ")}${theme.fg("text", suite)}   ${theme.fg("muted", "shipped ")}${theme.fg("success", `${k.improvementsShipped}`)}   ${theme.fg("muted", "dreams ")}${theme.fg("text", `${k.dreams}`)}   ${theme.fg("muted", "notes ")}${theme.fg(k.notes.pending > 0 ? "warning" : "dim", `${k.notes.pending} pending`)}`,
		);
		// Row 3: memory versions + hook surface + token spend.
		const mv = Object.entries(ov.memoryVersions)
			.map(([tier, v]) => `${tier} v${v}`)
			.join(" ");
		lines.push(
			`${theme.fg("muted", "memory ")}${theme.fg("text", mv || "—")}   ${theme.fg("muted", "hooks ")}${theme.fg(k.hooks.denies > 0 ? "warning" : "dim", `${k.hooks.denies} denies`)}   ${theme.fg("muted", "tokens ")}${theme.fg("dim", `↑${formatTokens(k.tokens.in)} ↓${formatTokens(k.tokens.out)}`)}`,
		);
		return lines;
	}

	function renderTrend(width: number, ov: OverviewResponse): string[] {
		const values = ov.trend.map((p) => p.cumulativePass);
		if (values.length === 0) return [];
		const span = width - 18;
		if (span < 8) return [];
		return [
			`${theme.fg("muted", "cumulative pass ")}${sparkline(theme, values, span, "emerald")}${theme.fg("dim", ` ${values.length} runs`)}`,
		];
	}

	function renderActivity(width: number): string[] {
		const ring = store.activityRing();
		if (ring.length === 0) return [];
		const rows = Math.min(4, ring.length);
		const lines = [heading(theme, "activity")];
		for (const item of ring.slice(0, rows)) {
			const when = theme.fg("dim", timeAgo(item.ts).padStart(7));
			lines.push(trunc(`${when} ${theme.fg(toneToken(item.tone as Tone), item.text)}`, width));
		}
		return lines;
	}

	function renderTaskRow(task: Task, selected: boolean, width: number): string {
		const cursor = selected ? theme.fg("accent", "▸ ") : "  ";
		const stars = theme.fg("warning", difficultyStars(task.difficulty));
		const name = theme.fg(selected ? "text" : "muted", task.name.padEnd(24));
		const passes = task.pass_count ?? task.passes;
		const fails = task.fail_count ?? task.fails;
		const pf = `${theme.fg("success", `✓${passes}`)} ${theme.fg("error", `✗${fails}`)}`;
		const origin = task.origin === "minted" ? badge(theme, "minted", "amber") : theme.fg("dim", "seed");
		const status =
			task.status && task.status !== "regression"
				? badge(theme, task.status, task.status === "capability" ? "emerald" : "zinc")
				: "";
		const row = `${cursor}${stars} ${name} ${pf}  ${origin}${status ? ` ${status}` : ""}  ${theme.fg("dim", `${task.improvements} impl`)}`;
		return trunc(row, width);
	}

	function renderTasks(width: number): string[] {
		const snap = store.snapshot<{ tasks: Task[] }>("tasks");
		const ov = overview();
		const busy = ov?.routerBusy === true;
		const lines = [heading(theme, busy ? "benchmark tasks · engine busy" : "benchmark tasks")];
		if (snap.error && !snap.data) return [...lines, ...errorState(theme, snap.error, width)];
		if (!snap.data) return [...lines, ...loadingState(theme, "tasks")];
		const list = tasks();
		if (list.length === 0) return [...lines, ...emptyState(theme, "no benchmark tasks", "the suite seeds on first engine boot")];
		const view = Math.max(1, viewport - FIXED_ROWS - 1);
		win.ensureVisible();
		const slice = list.slice(win.scroll, win.scroll + view);
		slice.forEach((task) => {
			lines.push(renderTaskRow(task, tasks().indexOf(task) === win.selected, width));
		});
		const more = list.length - view - win.scroll;
		if (more > 0) lines.push(theme.fg("dim", `  … ${more} more (j/k, PgDn)`));
		return lines;
	}

	function renderDetail(width: number): string[] {
		if (detailError) return errorState(theme, detailError, width);
		if (!detailTask) return loadingState(theme, "task");
		const t = detailTask;
		const lines = [heading(theme, `task · ${t.name}`), ""];
		const field = (label: string, value: string) =>
			`${theme.fg("muted", `${label} `)}${theme.fg("text", value)}`;
		lines.push(field("difficulty", difficultyStars(t.difficulty)));
		lines.push(field("category", t.category));
		lines.push(
			field(
				"passes",
				`${t.pass_count ?? t.passes} ✓ / ${t.fail_count ?? t.fails} ✗`,
			),
		);
		if (t.origin) lines.push(field("origin", `${t.origin}${t.status ? ` · ${t.status}` : ""}`));
		lines.push("");
		lines.push(heading(theme, "description"));
		for (const l of wrap(t.description, Math.max(20, width - 2))) lines.push(theme.fg("text", l));
		if (t.prompt) {
			lines.push("");
			lines.push(heading(theme, "prompt"));
			for (const l of wrap(t.prompt, Math.max(20, width - 2)).slice(0, 12)) lines.push(theme.fg("mdCodeBlock", l));
		}
		lines.push("");
		lines.push(heading(theme, "seeded files"));
		for (const p of Object.keys(t.files)) lines.push(theme.fg("muted", `  ${p}`));
		lines.push("");
		lines.push(theme.fg("dim", "esc back · t run cycle · m mint task"));
		return lines;
	}

	const screen: Screen = {
		render(width: number): string[] {
			if (mode === "detail") return renderDetail(width);
			const ov = overview();
			const snap = store.snapshot<OverviewResponse>("overview");
			const lines: string[] = [];
			if (snap.error && !snap.data) {
				lines.push(...errorState(theme, snap.error, width));
				lines.push("");
			}
			if (ov) {
				lines.push(...renderKpis(width, ov));
				const trend = renderTrend(width, ov);
				if (trend.length) {
					lines.push("");
					lines.push(...trend);
				}
			} else if (!snap.error) {
				lines.push(...loadingState(theme, "overview"));
			}
			// The activity rail collapses on short viewports (embedded mount).
			if (viewport >= 18) {
				const act = renderActivity(width);
				if (act.length) {
					lines.push("");
					lines.push(...act);
				}
			}
			lines.push("");
			lines.push(...renderTasks(width));
			// Data-age honesty stamp (k9s cached-as-of).
			const age = snap.ageMs;
			if (age !== null) lines.push(theme.fg("dim", `  data ${ageStamp(theme, age)}`));
			return lines;
		},

		invalidate(): void {
			requestRender();
		},

		setViewport(height: number): void {
			viewport = height;
		},

		footerHints(): [string, string][] {
			if (mode === "detail") {
				return [
					["esc", "back"],
					["t", "run cycle"],
					["m", "mint task"],
				];
			}
			return [
				["enter", "task"],
				["t", "run cycle"],
				["m", "mint"],
				["j/k", "select"],
			];
		},

		handleKey(data: string): boolean {
			if (matchesKey(data, "j") || matchesKey(data, "down")) return win.move(1);
			if (matchesKey(data, "k") || matchesKey(data, "up")) return win.move(-1);
			if (matchesKey(data, "g")) return win.home();
			if (matchesKey(data, "shift+g")) return win.end();
			if (matchesKey(data, "pageDown")) return win.page(1);
			if (matchesKey(data, "pageUp")) return win.page(-1);
			if (mode === "detail" && matchesKey(data, "escape")) {
				mode = "list";
				return true;
			}
			if (matchesKey(data, "enter")) {
				const list = tasks();
				const task = list[win.selected];
				if (task && mode === "list") {
					mode = "detail";
					detailTask = null;
					detailError = null;
					detailLoading = true;
					void store
						.taskDetail(task.id)
						.then((t) => {
							detailTask = t;
						})
						.catch((e) => {
							detailError = (e as Error).message;
						})
						.finally(() => {
							detailLoading = false;
							requestRender();
						});
				}
				return true;
			}
			if (matchesKey(data, "t")) {
				const task = tasks()[win.selected];
				if (!task) return false;
				void store
					.runTaskCycle(task.id)
					.then((r) => {
						if (r.started) toast(`cycle started · ${task.name}`, "emerald");
						else if (r.error) toast(r.error, "rose");
					})
					.catch((e) => toast((e as Error).message, "rose"));
				return true;
			}
			if (matchesKey(data, "m")) {
				confirm("mine the most recent failed run into a new task?", () => {
					void store
						.mintTask()
						.then((r) => toast(`mint ${r.outcome.status}${r.outcome.reason ? ` · ${r.outcome.reason}` : ""}`, r.outcome.status === "minted" ? "emerald" : "amber"))
						.catch((e) => toast((e as Error).message, "rose"));
				});
				return true;
			}
			return false;
		},
	};
	return screen;
}
