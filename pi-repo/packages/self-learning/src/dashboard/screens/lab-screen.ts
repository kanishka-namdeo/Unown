/**
 * screens/lab-screen.ts — the mine→patch→ship evidence view. Three sections
 * on keys 1/2/3: the cycle timeline, the improvements each cycle mints
 * (diagnosis → proposal → memory patch → evidence runs), and the raw run log
 * with full transcripts. Every shipped rule traces to its baseline and
 * candidate runs — "show me the receipts".
 */

import { matchesKey } from "@earendil-works/pi-tui";
import type {
	Cycle,
	CyclesResponse,
	Improvement,
	ImprovementsResponse,
	LearningAnalyticsRow,
	LearningAttributionResponse,
	Run,
	RunDetail,
	RunsResponse,
	TranscriptEntry,
} from "../dashboard-types.ts";
import type { Screen, ScreenDeps, SelectionWindow } from "../screen.ts";
import { SelectionWindow as Window } from "../screen.ts";
import {
	ageStamp,
	badge,
	emptyState,
	errorState,
	formatDuration,
	formatTokens,
	heading,
	loadingState,
	pill,
	statusTone,
	timeAgo,
	toneToken,
	trunc,
	wrap,
} from "../widgets/bits.ts";

export function createLabScreen(deps: ScreenDeps): Screen {
	const { store, theme, requestRender } = deps;
	let viewport = 24;
	let section: "cycles" | "improvements" | "runs" = "cycles";
	let mode: "list" | "detail" = "list";

	// Improvement detail: the card comes from the list snapshot; the evidence
	// runs are drill-in fetches (both must land before the section renders).
	let detailImprovement: Improvement | null = null;
	let evidenceLoading = false;
	let evidenceError: string | null = null;
	let baselineRun: RunDetail | null = null;
	let candidateRun: RunDetail | null = null;
	let evidenceSeq = 0;

	// Run detail: prompt + transcript + verify output (drill-in fetch).
	let detailRun: RunDetail | null = null;
	let runError: string | null = null;
	let runSeq = 0;

	// Detail views own their scroll offset (the shell only sizes the viewport).
	let detailScroll = 0;
	let detailLines = 0;

	// Header (heading + section line + blank) + section heading + age stamp.
	const FIXED_ROWS = 5;

	const cycles = (): Cycle[] => store.snapshot<CyclesResponse>("cycles").data?.cycles ?? [];
	const improvements = (): Improvement[] =>
		store.snapshot<ImprovementsResponse>("improvements").data?.improvements ?? [];
	const runs = (): Run[] => store.snapshot<RunsResponse>("runs").data?.runs ?? [];
	// The PLM round (2026-10-30): the learning attribution ledger — every
	// claimed improvement with its proof chain (before/after, retained,
	// regression check). Rendered as the lab's footer scorecard.
	const learning = (): LearningAnalyticsRow | null =>
		store.snapshot<LearningAttributionResponse>("plmLearning").data?.analytics ?? null;

	const cyclesWin: SelectionWindow = new Window(
		() => cycles().length,
		() => Math.max(1, viewport - FIXED_ROWS),
	);
	const improvementsWin: SelectionWindow = new Window(
		() => improvements().length,
		() => Math.max(1, viewport - FIXED_ROWS),
	);
	const runsWin: SelectionWindow = new Window(
		() => runs().length,
		() => Math.max(1, viewport - FIXED_ROWS),
	);

	const activeWindow = (): SelectionWindow =>
		section === "cycles" ? cyclesWin : section === "improvements" ? improvementsWin : runsWin;

	function shortId(id: string): string {
		return id.length > 8 ? `${id.slice(0, 8)}…` : id;
	}

	function field(label: string, value: string): string {
		return `${theme.fg("muted", `${label} `)}${theme.fg("text", value)}`;
	}

	/** `✓ passed` / `⟳ running` / `✗ failed` — glyph + tone from statusTone. */
	function runStatus(status: string): string {
		const glyph = status === "passed" ? "✓" : status === "running" ? "⟳" : "✗";
		return theme.fg(toneToken(statusTone(status)), `${glyph} ${status}`);
	}

	function renderCycleRow(cycle: Cycle, selected: boolean, width: number): string {
		const cursor = selected ? theme.fg("accent", "▸ ") : "  ";
		const task = theme.fg(selected ? "text" : "muted", cycle.task_name ?? cycle.task_id);
		const row =
			`${cursor}${task} · ${badge(theme, cycle.status, statusTone(cycle.status))}` +
			` · ${theme.fg("dim", `iter ${cycle.iteration}`)}` +
			` · ${theme.fg("dim", `shipped ${cycle.shipped}`)}` +
			` · ${theme.fg("dim", timeAgo(cycle.created_at))}`;
		return trunc(row, width);
	}

	function renderImprovementRow(imp: Improvement, selected: boolean, width: number): string {
		const cursor = selected ? theme.fg("accent", "▸ ") : "  ";
		const tier = theme.fg(selected ? "text" : "muted", `${imp.target_tier} tier`);
		const version =
			imp.memory_version != null ? ` ${theme.fg("dim", "→")} ${pill(theme, `v${imp.memory_version}`, "zinc")}` : "";
		const row =
			`${cursor}${badge(theme, imp.status, statusTone(imp.status))} · ${tier}${version}` +
			` · ${theme.fg("dim", imp.task_id)}` +
			` · ${theme.fg("dim", `${imp.score_before}→${imp.score_after}`)}` +
			` · ${theme.fg("dim", timeAgo(imp.created_at))}`;
		return trunc(row, width);
	}

	function renderRunRow(run: Run, selected: boolean, width: number): string {
		const cursor = selected ? theme.fg("accent", "▸ ") : "  ";
		const task = theme.fg(selected ? "text" : "muted", run.task_id);
		// M11 consumer of the engine's M6-2 live registry: a RUNNING run's
		// The DB row is written at finalize, so mid-run it reads `0 tools ·
		// 0 tok · —` — which is what this row used to show while the agent was
		// on its ninth turn, i.e. a live run indistinguishable from a stalled one.
		const live = run.status === "running" ? store.liveRun(run.id) : null;
		const toolCalls = live ? live.toolCalls : run.tool_calls;
		const tokens = formatTokens(live ? live.tokensIn + live.tokensOut : run.tokens_in + run.tokens_out);
		const duration = formatDuration(
			live ? live.elapsedMs : run.ended_at != null ? run.ended_at - run.started_at : null,
		);
		const liveTail = live
			? ` · ${theme.fg("dim", `${live.turns} turns · ${live.lastTool?.tool ?? "thinking"}`)}`
			: "";
		const row =
			`${cursor}${runStatus(run.status)} · ${theme.fg("muted", run.kind)} · ${task}` +
			` · ${theme.fg("dim", `${toolCalls} tools`)}` +
			` · ${theme.fg("dim", `${tokens} tok`)}` +
			` · ${theme.fg("dim", duration)}${liveTail}` +
			` · ${theme.fg("dim", timeAgo(run.started_at))}`;
		return trunc(row, width);
	}

	function windowedRows<T>(
		list: T[],
		win: SelectionWindow,
		render: (item: T, selected: boolean, width: number) => string,
		width: number,
	): string[] {
		const view = Math.max(1, viewport - FIXED_ROWS - 1);
		win.resync();
		const lines: string[] = [];
		for (let i = win.scroll; i < Math.min(list.length, win.scroll + view); i++) {
			lines.push(render(list[i]!, i === win.selected, width));
		}
		const more = list.length - view - win.scroll;
		if (more > 0) lines.push(theme.fg("dim", `  … ${more} more (j/k, PgDn)`));
		return lines;
	}

	function renderCycles(width: number): string[] {
		const snap = store.snapshot<CyclesResponse>("cycles");
		if (snap.error && !snap.data) return errorState(theme, snap.error, width);
		if (!snap.data) return loadingState(theme, "cycles");
		const list = cycles();
		if (list.length === 0) return emptyState(theme, "no cycles yet", "the harness mines one task at a time");
		return windowedRows(list, cyclesWin, renderCycleRow, width);
	}

	function renderImprovements(width: number): string[] {
		const snap = store.snapshot<ImprovementsResponse>("improvements");
		if (snap.error && !snap.data) return errorState(theme, snap.error, width);
		if (!snap.data) return loadingState(theme, "improvements");
		const list = improvements();
		if (list.length === 0) return emptyState(theme, "no improvements yet", "patches ship from failed baselines");
		return windowedRows(list, improvementsWin, renderImprovementRow, width);
	}

	function renderRuns(width: number): string[] {
		const snap = store.snapshot<RunsResponse>("runs");
		if (snap.error && !snap.data) return errorState(theme, snap.error, width);
		if (!snap.data) return loadingState(theme, "runs");
		const list = runs();
		if (list.length === 0) return emptyState(theme, "no runs yet", "runs appear as the harness cycles");
		return windowedRows(list, runsWin, renderRunRow, width);
	}

	// ---- detail views ----

	function evidenceLines(label: string, runId: string, run: RunDetail, width: number): string[] {
		const status = theme.fg(toneToken(statusTone(run.status)), run.status);
		const duration = formatDuration(run.ended_at != null ? run.ended_at - run.started_at : null);
		const lines = [
			trunc(
				`${theme.fg("muted", `${label} `)}${theme.fg("text", shortId(runId))} · ${status} · ${theme.fg("dim", duration)}`,
				width,
			),
		];
		const summary = run.verify_output?.summary;
		if (summary) {
			for (const l of wrap(summary, Math.max(20, width - 4))) lines.push(theme.fg("dim", `  ${l}`));
		}
		return lines;
	}

	function improvementDetailLines(width: number): string[] {
		const imp = detailImprovement;
		if (!imp) return loadingState(theme, "improvement");
		const lines: string[] = [heading(theme, `improvement · ${imp.task_id}`), ""];
		lines.push(`${theme.fg("muted", "status ")}${badge(theme, imp.status, statusTone(imp.status))}`);
		lines.push(field("target tier", imp.target_tier));
		lines.push(field("memory version", imp.memory_version != null ? `v${imp.memory_version}` : "—"));
		lines.push(field("created", timeAgo(imp.created_at)));
		lines.push(field("decided", imp.decided_at != null ? timeAgo(imp.decided_at) : "—"));
		lines.push("");
		lines.push(heading(theme, "diagnosis"));
		for (const l of wrap(imp.diagnosis, Math.max(20, width - 2))) lines.push(theme.fg("text", l));
		lines.push("");
		lines.push(heading(theme, "proposal"));
		for (const l of wrap(imp.proposal, Math.max(20, width - 2))) lines.push(theme.fg("text", l));
		lines.push("");
		lines.push(heading(theme, "memory patch"));
		for (const l of imp.patch.split("\n")) lines.push(trunc(theme.fg("dim", `  ${l}`), width));
		lines.push("");
		lines.push(heading(theme, "evidence"));
		if (evidenceError) {
			lines.push(...errorState(theme, evidenceError, width));
		} else if (evidenceLoading || !baselineRun || !candidateRun) {
			lines.push(...loadingState(theme, "evidence runs"));
		} else {
			lines.push(...evidenceLines("baseline", imp.baseline_run_id, baselineRun, width));
			lines.push(...evidenceLines("candidate", imp.candidate_run_id, candidateRun, width));
		}
		lines.push("");
		lines.push(theme.fg("dim", "esc back"));
		return lines;
	}

	function transcriptLines(entry: TranscriptEntry, width: number): string[] {
		switch (entry.type) {
			case "text": {
				const out: string[] = [];
				for (const l of wrap(entry.text, Math.max(20, width - 2))) out.push(theme.fg("dim", l));
				return out;
			}
			case "tool_start":
				return [trunc(theme.fg("accent", `→ tool ${entry.tool}`), width)];
			case "tool_end": {
				const line = `← tool ${entry.tool} · ${entry.isError ? "error" : "ok"}`;
				return [trunc(theme.fg(entry.isError ? "error" : "dim", line), width)];
			}
		}
	}

	function runDetailLines(width: number): string[] {
		if (runError) return errorState(theme, runError, width);
		if (!detailRun) return loadingState(theme, "run");
		const t = detailRun;
		const lines: string[] = [heading(theme, `run · ${shortId(t.id)}`), ""];
		lines.push(`${theme.fg("muted", "status ")}${runStatus(t.status)}`);
		lines.push(field("kind", t.kind));
		lines.push(field("task", t.task_id));
		// M6-2: while the run is in flight the live registry IS the counters —
		// the persisted row reads zeros until finalize, so printing them here
		// would tell the user an active run has done nothing. Re-read every
		// render: the Learning Lab polls liveRuns on the 4s fast lane, so this
		// block moves without re-opening the run.
		const live = t.status === "running" ? store.liveRun(t.id) : null;
		if (live) {
			lines.push(
				`${theme.fg("warning", "⟳ live ")}${theme.fg(
					"text",
					`${formatDuration(live.elapsedMs)} · ${live.turns} turns · ${live.toolCalls} tools · ${formatTokens(
						live.tokensIn + live.tokensOut,
					)} tok`,
				)}`,
			);
			if (live.lastTool) {
				const phase = live.lastTool.phase === "start" ? "running" : live.lastTool.isError ? "errored" : "done";
				lines.push(theme.fg("dim", `  tool ${live.lastTool.tool} ${phase} · ${live.toolsUsed.length} distinct`));
			} else {
				lines.push(theme.fg("dim", "  model is composing its first tool call"));
			}
			if (live.contextTokens > 0) lines.push(field("context", `${formatTokens(live.contextTokens)} tok in window`));
			for (const l of wrap(live.lastTextPreview, Math.max(20, width - 4)).slice(0, 3)) {
				lines.push(theme.fg("dim", `  ${l}`));
			}
		} else {
			if (t.status === "running")
				lines.push(theme.fg("dim", "no live entry — the engine reports this run not in flight"));
			lines.push(field("tokens", `↑${formatTokens(t.tokens_in)} ↓${formatTokens(t.tokens_out)}`));
			lines.push(field("tools", `${t.tool_calls}`));
			lines.push(field("turns", `${t.turns}`));
		}
		// Wave 5 (M4-c D2): the OS jail this run actually ran under —
		// 'process' means the weaker TS path jail (no OS sandbox), which
		// deserves the warning tone; NULL (pre-wave rows) renders nothing.
		if (t.sandbox_isolation) {
			lines.push(
				`${theme.fg("muted", "isolation ")}${
					t.sandbox_isolation === "process"
						? theme.fg("warning", `${t.sandbox_isolation} (no OS jail)`)
						: theme.fg("success", t.sandbox_isolation)
				}`,
			);
		}
		if (t.verify_output) {
			const v = t.verify_output;
			lines.push(
				trunc(
					v.passed
						? theme.fg("success", `✓ verify passed · ${v.summary}`)
						: theme.fg("error", `✗ verify failed · ${v.summary}`),
					width,
				),
			);
		} else {
			lines.push(theme.fg("dim", "verify pending"));
		}
		if (t.error) {
			for (const l of wrap(`✗ ${t.error}`, Math.max(20, width - 2))) lines.push(theme.fg("error", l));
		}
		lines.push("");
		lines.push(heading(theme, "prompt"));
		if (t.prompt) {
			for (const l of wrap(t.prompt, Math.max(20, width - 2)).slice(0, 10)) lines.push(theme.fg("mdCodeBlock", l));
		} else {
			lines.push(theme.fg("dim", "—"));
		}
		lines.push("");
		lines.push(heading(theme, "transcript"));
		if (t.transcript.length === 0) lines.push(theme.fg("dim", "—"));
		for (const entry of t.transcript) lines.push(...transcriptLines(entry, width));
		lines.push("");
		lines.push(theme.fg("dim", "esc back"));
		return lines;
	}

	function scrollDetail(delta: number): boolean {
		detailScroll = Math.max(0, Math.min(detailScroll + delta, Math.max(0, detailLines - viewport)));
		return true;
	}

	const halfPage = (): number => Math.max(1, Math.floor(viewport / 2));

	function openImprovement(imp: Improvement): void {
		mode = "detail";
		detailScroll = 0;
		detailImprovement = imp;
		evidenceLoading = true;
		evidenceError = null;
		baselineRun = null;
		candidateRun = null;
		const seq = ++evidenceSeq;
		void Promise.all([store.runDetail(imp.baseline_run_id), store.runDetail(imp.candidate_run_id)])
			.then(([baseline, candidate]) => {
				if (seq !== evidenceSeq) return;
				baselineRun = baseline;
				candidateRun = candidate;
			})
			.catch((e) => {
				if (seq !== evidenceSeq) return;
				evidenceError = (e as Error).message;
			})
			.finally(() => {
				if (seq !== evidenceSeq) return;
				evidenceLoading = false;
				requestRender();
			});
	}

	function openRun(run: Run): void {
		mode = "detail";
		detailScroll = 0;
		detailRun = null;
		runError = null;
		const seq = ++runSeq;
		void store
			.runDetail(run.id)
			.then((r) => {
				if (seq !== runSeq) return;
				detailRun = r;
			})
			.catch((e) => {
				if (seq !== runSeq) return;
				runError = (e as Error).message;
			})
			.finally(() => {
				if (seq !== runSeq) return;
				requestRender();
			});
	}

	const screen: Screen = {
		render(width: number): string[] {
			if (mode === "detail") {
				const lines = section === "improvements" ? improvementDetailLines(width) : runDetailLines(width);
				detailLines = lines.length;
				detailScroll = Math.max(0, Math.min(detailScroll, Math.max(0, detailLines - viewport)));
				return lines.slice(detailScroll, detailScroll + viewport);
			}
			const seg = (active: boolean, text: string) => theme.fg(active ? "accent" : "dim", text);
			const dot = theme.fg("dim", " · ");
			const lines = [
				heading(theme, "learning lab"),
				`${seg(section === "cycles", "cycles")}${dot}${seg(section === "improvements", "improvements")}${dot}${seg(section === "runs", "runs")}`,
				"",
			];
			if (section === "cycles") {
				lines.push(heading(theme, "cycles"));
				lines.push(...renderCycles(width));
			} else if (section === "improvements") {
				lines.push(heading(theme, "improvements"));
				lines.push(...renderImprovements(width));
			} else {
				lines.push(heading(theme, "runs"));
				lines.push(...renderRuns(width));
			}
			// The learning attribution scorecard (receipts-only):
			// improvements claimed vs retained vs regressed, and
			// the proof coverage.
			const l = learning();
			if (l && l.total > 0) {
				lines.push("");
				const rate = l.retentionRate;
				const rateText = rate === null ? "not measured" : `${Math.round(rate * 100)}%`;
				lines.push(
					trunc(
						theme.fg(
							"muted",
							`attribution: ${l.total} improvement${l.total === 1 ? "" : "s"} claimed · ${l.retained} retained · ${l.regressions} regressed · retention ${rateText}`,
						),
						width,
					),
				);
				lines.push(
					trunc(
						theme.fg(
							"dim",
							`proof coverage: ${l.withBenchmark}/${l.total} with a benchmark · ${l.withMeasuredGain}/${l.total} with a measured gain`,
						),
						width,
					),
				);
			}
			const snap = store.snapshot(section);
			if (snap.ageMs !== null) lines.push(theme.fg("dim", `  data ${ageStamp(theme, snap.ageMs)}`));
			return lines;
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
			if (section === "cycles") {
				return [
					["tab", "sections"],
					["j/k", "select"],
				];
			}
			return [
				["tab", "sections"],
				["enter", "open"],
				["j/k", "select"],
			];
		},

		handleKey(data: string): boolean {
			if (mode === "detail") {
				if (matchesKey(data, "escape")) {
					mode = "list";
					return true;
				}
				if (matchesKey(data, "j") || matchesKey(data, "down")) return scrollDetail(1);
				if (matchesKey(data, "k") || matchesKey(data, "up")) return scrollDetail(-1);
				// g/G jump to the ends (scrollDetail clamps) — the same detail-mode
				// binding every other screen's detail view carries, so the global
				// help card's "g G top / bottom" claim holds here too.
				if (matchesKey(data, "g")) return scrollDetail(-detailLines);
				if (matchesKey(data, "shift+g")) return scrollDetail(detailLines);
				// (deduped: the duplicated condition bound the same key twice —
				// no second paging key was ever documented)
				if (matchesKey(data, "pageDown")) return scrollDetail(halfPage());
				if (matchesKey(data, "pageUp")) return scrollDetail(-halfPage());
				return false;
			}
			// TAB cycles sections — digits are the shell's screen accelerators.
			if (matchesKey(data, "tab")) {
				const order = ["cycles", "improvements", "runs"] as const;
				section = order[(order.indexOf(section) + 1) % order.length]!;
				return true;
			}
			const win = activeWindow();
			if (matchesKey(data, "j") || matchesKey(data, "down")) return win.move(1);
			if (matchesKey(data, "k") || matchesKey(data, "up")) return win.move(-1);
			if (matchesKey(data, "g")) return win.home();
			if (matchesKey(data, "shift+g")) return win.end();
			if (matchesKey(data, "pageDown")) return win.page(1);
			if (matchesKey(data, "pageUp")) return win.page(-1);
			if (matchesKey(data, "enter")) {
				// Cycles have no detail view — the row already tells the story.
				if (section === "cycles") return true;
				if (section === "improvements") {
					const imp = improvements()[improvementsWin.selected];
					if (imp) openImprovement(imp);
					return true;
				}
				const run = runs()[runsWin.selected];
				if (run) openRun(run);
				return true;
			}
			return false;
		},
	};
	return screen;
}
