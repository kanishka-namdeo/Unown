/**
 * screens/router-screen.ts — the background jobs that keep the learning loop
 * alive (harness cycle, AutoDream, note sync, task minting, sandbox GC) plus
 * the sandbox workspaces they run in. One combined list: jobs are selectable
 * (space triggers, d toggles), workspace rows ride along as context.
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
	// heading + stat), the bottom note + age stamp.
	const FIXED_ROWS = 9;

	const win: SelectionWindow = new Window(totalRows, () => Math.max(1, viewport - FIXED_ROWS));

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
		const runs = theme.fg("dim", `✓ ${job.run_count} runs`);
		const next =
			job.enabled > 0
				? job.next_run != null
					? theme.fg("dim", `next in ${nextIn(job.next_run)}`)
					: theme.fg("dim", "paused")
				: "";
		const state = job.enabled > 0 ? badge(theme, "enabled", "emerald") : theme.fg("dim", "disabled");
		const running = job.status === "running" ? ` ${badge(theme, "⟳ running", "amber")}` : "";
		const row = `${cursor}${id}${fieldGap()}${schedule}${fieldGap()}${runs}${next ? `${fieldGap()}${next}` : ""}${fieldGap()}${state}${running}`;
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
				lines.push(...emptyState(theme, "no router jobs", "the router boots with seven jobs"));
			}
			const view = Math.max(1, viewport - FIXED_ROWS);
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
			if (matchesKey(data, "pageDown") || matchesKey(data, "pageDown")) return win.page(1);
			if (matchesKey(data, "pageUp") || matchesKey(data, "pageUp")) return win.page(-1);
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
