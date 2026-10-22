/**
 * screens/router-screen.ts — the background jobs that keep the learning loop
 * alive (harness cycle, AutoDream, note sync, task minting, sandbox GC) plus
 * the sandbox workspaces they run in. One combined list: jobs are selectable
 * (space triggers, d toggles), workspace rows ride along as context.
 *
 * M11: each job row carries its OUTCOME, not just its schedule. `runsSeg` makes
 * the tally glyph a verdict (✓ passed / ✗ errored / no glyph = never completed
 * since the columns landed), `ran <age>` shows when the last run started, and
 * any failed job is named again in a banner under the list with its duration and
 * the recorded error. The engine columns behind them live in store.ts (jobs
 * last_ok / last_error / last_duration_ms), written by router.execute().
 */

import { matchesKey } from "@earendil-works/pi-tui";
import type { Job, JobsResponse, Sandbox, SandboxesResponse } from "../dashboard-types.ts";
import type { Screen, ScreenDeps, SelectionWindow } from "../screen.ts";
import { SelectionWindow as Window } from "../screen.ts";
import {
	ageStamp,
	badge,
	emptyState,
	errorState,
	formatInterval,
	heading,
	loadingState,
	timeAgo,
	trunc,
} from "../widgets/bits.ts";

export function createRouterScreen(deps: ScreenDeps): Screen {
	const { store, theme, toast, requestRender, confirm } = deps;
	let viewport = 24;

	const jobs = (): Job[] => store.snapshot<JobsResponse>("jobs").data?.jobs ?? [];
	const sandboxes = (): Sandbox[] => store.snapshot<SandboxesResponse>("sandboxes").data?.sandboxes ?? [];

	// Jobs first, then sandboxes — one selection window spans the combined list.
	const totalRows = (): number => jobs().length + sandboxes().length;

	// Header (heading + stat + blank), sandboxes section furniture (blank +
	// heading + stat), the bottom note + age stamp. The M11 failure banner is
	// extra non-selectable furniture, so the reserved row count moves with it —
	// a fixed constant here would let the banner push selectable rows off-screen.
	const FIXED_ROWS = 9;
	const fixedRows = (): number => FIXED_ROWS + failureBannerHeight(jobs());

	const win: SelectionWindow = new Window(totalRows, () => Math.max(1, viewport - fixedRows()));

	function selectedJob(): Job | null {
		const list = jobs();
		return win.selected < list.length ? (list[win.selected] ?? null) : null;
	}

	function dreamJob(list: Job[]): Job | null {
		return (
			list.find((j) => j.id === "auto-dream") ??
			list.find((j) => j.id.includes("dream") || j.name.toLowerCase().includes("dream")) ??
			null
		);
	}

	function fieldGap(): string {
		return theme.fg("dim", " · ");
	}

	function nextIn(nextRun: number): string {
		const ms = nextRun - Date.now();
		return ms > 0 ? formatInterval(ms) : "due";
	}

	/**
	 * M11: the runs count is a VERDICT glyph, not a tally decoration. The row
	 * used to print `✓ N runs` for every job unconditionally, which claimed a
	 * passing history for a job whose last run errored — and the engine had no
	 * outcome column to contradict it. `✗` = the LAST run failed, `✓` = it
	 * passed, no glyph = no run has completed since the outcome columns landed
	 * (unknown, honestly, rather than silently read as a pass).
	 */
	function runsSeg(job: Job): string {
		const count = `${job.run_count} runs`;
		if (job.last_ok === 1) return theme.fg("dim", `✓ ${count}`);
		if (job.last_ok === 0) return theme.fg("error", `✗ ${count}`);
		return theme.fg("dim", count);
	}

	/** When the last run STARTED (last_run is the execute() timestamp). */
	function lastRunSeg(job: Job): string {
		if (job.last_run == null) return "";
		return theme.fg("dim", `ran ${timeAgo(job.last_run)}`);
	}

	/** The jobs whose LAST run failed — one source of truth for both the banner's
	 *  height (which reserves the selectable rows) and its lines, so the two can
	 *  never disagree and push rows off-screen. */
	function failedJobs(list: Job[]): Job[] {
		return list.filter((j) => j.last_ok === 0);
	}

	/** Rows failureLines() will emit for the current list — literally its output
	 *  length (its first element is the blank separator), so the reservation and
	 *  the drawing cannot disagree. Width is irrelevant: failureLines truncates,
	 *  it never wraps. */
	function failureBannerHeight(list: Job[]): number {
		return failureLines(list, 120).length;
	}

	/**
	 * M11: the failure banner. A row-level `✗` is easy to scroll past, and the
	 * whole defect being fixed is that a job failing on every cycle was
	 * indistinguishable from an idle engine — so any errored job names itself,
	 * how long ago, how long it took (19m58s = the watchdog; 0.2s = a crash)
	 * and the error the engine recorded.
	 */
	function failureLines(list: Job[], width: number): string[] {
		const failed = failedJobs(list);
		if (failed.length === 0) return [];
		const out: string[] = ["", theme.fg("error", `⚠ ${failed.length} job(s) failed their last run`)];
		for (const j of failed.slice(0, 4)) {
			const dur = j.last_duration_ms != null ? ` after ${formatInterval(j.last_duration_ms)}` : "";
			const err = (j.last_error ?? "no error recorded").replace(/\s+/g, " ").slice(0, 90);
			out.push(trunc(theme.fg("dim", `  ${j.id} · ${timeAgo(j.last_run)}${dur} · ${err}`), width));
		}
		if (failed.length > 4) out.push(theme.fg("dim", `  … ${failed.length - 4} more`));
		return out;
	}

	function headerLines(): string[] {
		const list = jobs();
		const dream = dreamJob(list);
		let next = theme.fg("dim", "next auto-dream unknown");
		if (dream && dream.next_run != null) {
			const due = dream.next_run - Date.now();
			next = theme.fg("text", due > 0 ? `next auto-dream in ${formatInterval(due)}` : "next auto-dream due");
		}
		return [heading(theme, "router jobs"), `${theme.fg("dim", `${list.length} jobs`)}${fieldGap()}${next}`];
	}

	function renderJobRow(job: Job, selected: boolean, width: number): string {
		const cursor = selected ? theme.fg("accent", "▸ ") : "  ";
		const id = theme.fg(selected ? "text" : "muted", job.id);
		const schedule =
			job.kind === "event"
				? theme.fg("dim", `event ${job.event ?? "—"}`)
				: theme.fg("dim", `interval ${job.schedule_ms != null ? formatInterval(job.schedule_ms) : "—"}`);
		const runs = runsSeg(job);
		const ran = lastRunSeg(job);
		const next =
			job.enabled > 0
				? job.next_run != null
					? theme.fg("dim", `next in ${nextIn(job.next_run)}`)
					: theme.fg("dim", "paused")
				: "";
		const state = job.enabled > 0 ? badge(theme, "enabled", "emerald") : theme.fg("dim", "disabled");
		const running = job.status === "running" ? ` ${badge(theme, "⟳ running", "amber")}` : "";
		const row = `${cursor}${id}${fieldGap()}${schedule}${fieldGap()}${runs}${next ? `${fieldGap()}${next}` : ""}${fieldGap()}${state}${running}${ran ? `${fieldGap()}${ran}` : ""}`;
		return trunc(row, width);
	}

	/** Workspace rows are informational: dim, no selection cursor. */
	function renderSandboxRow(sb: Sandbox, width: number): string {
		const label = sb.label !== "" ? sb.label : sb.id;
		return trunc(theme.fg("dim", `  ${label} · ${sb.files} files · ${timeAgo(sb.createdAt)}`), width);
	}

	function sandboxStat(list: Sandbox[]): string {
		const files = list.reduce((n, sb) => n + sb.files, 0);
		const oldest = list.reduce<number | null>(
			(min, sb) => (min == null || sb.createdAt < min ? sb.createdAt : min),
			null,
		);
		const oldestText = oldest != null ? timeAgo(oldest).replace(/ ago$/, "") : "—";
		return theme.fg("dim", `${list.length} workspaces · ${files} files total · oldest ${oldestText}`);
	}

	function triggerSelected(job: Job): void {
		void store
			.triggerJob(job.id)
			.then((r) => {
				if (r.ok) toast(`job triggered · ${job.id}`, "emerald");
				else toast(r.error ?? "trigger failed", "rose");
			})
			.catch((e) => toast((e as Error).message, "rose"));
	}

	function toggleSelected(job: Job): void {
		confirm(`toggle ${job.id}?`, () => {
			void store
				.toggleJob(job.id)
				.then((r) => {
					if (r.ok) toast(`${job.id} toggled`, "emerald");
					else toast(r.error ?? "toggle failed", "rose");
				})
				.catch((e) => toast((e as Error).message, "rose"));
		});
	}

	const screen: Screen = {
		render(width: number): string[] {
			const jobsSnap = store.snapshot<JobsResponse>("jobs");
			const sbSnap = store.snapshot<SandboxesResponse>("sandboxes");
			if (jobsSnap.error && !jobsSnap.data) return errorState(theme, jobsSnap.error, width);
			if (!jobsSnap.data) return [heading(theme, "router jobs"), ...loadingState(theme, "jobs")];
			const lines: string[] = [...headerLines(), ""];
			const jobList = jobs();
			const sbList = sandboxes();
			if (jobList.length === 0) {
				lines.push(...emptyState(theme, "no router jobs", "the router boots with nine jobs"));
			}
			const view = Math.max(1, viewport - fixedRows());
			win.resync();
			const total = totalRows();
			const end = Math.min(total, win.scroll + view);
			for (let i = win.scroll; i < end; i++) {
				if (i < jobList.length) {
					lines.push(renderJobRow(jobList[i]!, i === win.selected, width));
					continue;
				}
				const sbIndex = i - jobList.length;
				// Section furniture: entering the sandbox range, or pinned to the
				// top of the window when the scroll is already inside it.
				if (sbIndex === 0 || i === win.scroll) {
					lines.push("");
					lines.push(heading(theme, "sandboxes"));
					lines.push(sandboxStat(sbList));
				}
				lines.push(renderSandboxRow(sbList[sbIndex]!, width));
			}
			// M11: directly under the list it describes, and only when something
			// actually failed — an all-green router prints nothing here.
			lines.push(...failureLines(jobList, width));
			if (sbList.length === 0 && end >= total) {
				lines.push("");
				lines.push(heading(theme, "sandboxes"));
				if (sbSnap.error && !sbSnap.data) lines.push(...errorState(theme, sbSnap.error, width));
				else if (!sbSnap.data) lines.push(...loadingState(theme, "sandboxes"));
				else lines.push(...emptyState(theme, "no workspaces", "fresh workspaces appear when the harness runs"));
			}
			lines.push("");
			lines.push(theme.fg("dim", "sandbox-gc prunes workspaces every 15m"));
			if (jobsSnap.ageMs !== null) lines.push(theme.fg("dim", `  data ${ageStamp(theme, jobsSnap.ageMs)}`));
			return lines;
		},

		invalidate(): void {
			requestRender();
		},

		setViewport(height: number): void {
			viewport = height;
		},

		footerHints(): [string, string][] {
			return [
				["space", "trigger"],
				["d", "toggle"],
				["j/k", "select"],
			];
		},

		handleKey(data: string): boolean {
			if (matchesKey(data, "j") || matchesKey(data, "down")) return win.move(1);
			if (matchesKey(data, "k") || matchesKey(data, "up")) return win.move(-1);
			if (matchesKey(data, "g")) return win.home();
			if (matchesKey(data, "shift+g")) return win.end();
			// (deduped: the duplicated condition bound the same key twice —
			// no second paging key was ever documented)
			if (matchesKey(data, "pageDown")) return win.page(1);
			if (matchesKey(data, "pageUp")) return win.page(-1);
			// Job actions apply to the selected JOB row only (workspace rows
			// carry no actions).
			const job = selectedJob();
			if (matchesKey(data, "space") || matchesKey(data, "t")) {
				if (!job) return false;
				triggerSelected(job);
				return true;
			}
			if (matchesKey(data, "d")) {
				if (!job) return false;
				toggleSelected(job);
				return true;
			}
			return false;
		},
	};
	return screen;
}
