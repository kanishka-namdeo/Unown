/**
 * screens/recovery-screen.ts — the observability round's triage surface: one
 * screen that answers "did anything break, and what is the fix for each".
 *
 * The audit's finding (docs/tui-observability-audit.md flag D2): recovery
 * data already existed but was SCATTERED — failed jobs in Router, failed
 * runs in Learning Lab, denials in Hooks, dead letters only in /engine. A
 * returning operator had to visit four screens to check one question. The
 * Recovery screen composes them worst-first, each row with its consequence
 * and its drill-in (Enter jumps to the owning screen), reusing the existing
 * resources (jobs/runs/hooks) — no new engine endpoint, no new payload.
 *
 * The clean bill is a first-class state: an all-green engine prints the
 * green rows (✓ jobs all passing · ✓ runs green · ✓ no recent denies) —
 * "recovery" is also where you CHECK that nothing broke, and silence would
 * be ambiguous.
 */

import { matchesKey } from "@earendil-works/pi-tui";
import type { HookEntry, Job, RecoveryPlmResponse, Run } from "../dashboard-types.ts";
import type { Screen, ScreenDeps, SelectionWindow } from "../screen.ts";
import { SelectionWindow as Window } from "../screen.ts";
import { ageStamp, errorState, heading, loadingState, timeAgo, trunc } from "../widgets/bits.ts";

/** One composed attention row: what broke, when, and where the fix lives. */
interface AttentionRow {
	/** Worst-first rank: 0 = engine/connection, 1 = failed job, 2 = failed run, 3 = denial. */
	rank: number;
	glyph: "✗" | "⏸";
	label: string;
	detail: string;
	/** The screen that owns the fix (Enter drills in). */
	drill: string;
}

export function createRecoveryScreen(deps: ScreenDeps): Screen {
	const { store, theme, requestRender, openScreen } = deps;
	let viewport = 24;

	const jobs = (): Job[] => store.snapshot<{ jobs: Job[] }>("jobs").data?.jobs ?? [];
	const runs = (): Run[] => store.snapshot<{ runs: Run[] }>("runs").data?.runs ?? [];
	const hooks = (): HookEntry[] => store.snapshot<{ hooks: HookEntry[] }>("hooks").data?.hooks ?? [];
	// The PLM round (2026-10-30): the recovery ENGINE's own ledger — attempts,
	// validated recoveries, the recurring failure categories. Same screen, one
	// fetch, ranked under the live attention rows.
	const plm = (): RecoveryPlmResponse | null => store.snapshot<RecoveryPlmResponse>("plmRecovery").data ?? null;

	/** Failed runs, newest first, capped (the Learning Lab stays the deep surface). */
	function failedRuns(list: Run[]): Run[] {
		return list
			.filter((r) => r.status === "failed" || r.status === "error")
			.sort((a, b) => b.started_at - a.started_at)
			.slice(0, 6);
	}

	/** Denials, newest first, capped. Old denies are history, not attention. */
	function recentDenials(list: HookEntry[]): HookEntry[] {
		const day = 24 * 60 * 60 * 1000;
		const cutoff = Date.now() - day;
		return list
			.filter((e) => e.decision === "deny" && e.ts >= cutoff)
			.sort((a, b) => b.ts - a.ts)
			.slice(0, 6);
	}

	/** Compose the attention rows, worst-first. The list is recomputed every
	 * render from the store snapshots — no hidden state, no staleness. */
	function attentionRows(): AttentionRow[] {
		const rows: AttentionRow[] = [];
		const jobList = jobs();
		const runList = runs();
		const hookList = hooks();
		for (const job of jobList.filter((j) => j.last_ok === 0)) {
			const err = (job.last_error ?? "no error recorded").replace(/\s+/g, " ").slice(0, 80);
			rows.push({
				rank: 1,
				glyph: "✗",
				label: "job",
				detail: `${job.id} · ran ${job.last_run != null ? timeAgo(job.last_run) : "?"} · ${err}`,
				drill: "router",
			});
		}
		for (const run of failedRuns(runList)) {
			const err = (run.error ?? "no error recorded").replace(/\s+/g, " ").slice(0, 80);
			rows.push({
				rank: 2,
				glyph: "✗",
				label: "run",
				detail: `${run.kind} · task ${run.task_id} · ${timeAgo(run.started_at)} · ${err}`,
				drill: "lab",
			});
		}
		for (const deny of recentDenials(hookList)) {
			const reason = (deny.reason ?? "no reason recorded").replace(/\s+/g, " ").slice(0, 80);
			rows.push({
				rank: 3,
				glyph: "⏸",
				label: "denied",
				detail: `${deny.hook}${deny.tool ? ` · ${deny.tool}` : ""} · ${timeAgo(deny.ts)} · ${reason}`,
				drill: "hooks",
			});
		}
		return rows.sort((a, b) => a.rank - b.rank);
	}

	const FIXED_ROWS = 7;
	const win: SelectionWindow = new Window(
		() => attentionRows().length,
		() => Math.max(1, viewport - FIXED_ROWS),
	);

	/** The green rows — the clean bill must be explicit, never silence. */
	function greenLines(width: number): string[] {
		const lines: string[] = [];
		const jobList = jobs();
		const failing = jobList.filter((j) => j.last_ok === 0).length;
		lines.push(
			trunc(
				theme.fg(
					failing === 0 ? "success" : "dim",
					`${failing === 0 ? "✓" : "·"} jobs — ${jobList.length} total, ${failing} failed last run`,
				),
				width,
			),
		);
		const runFails = failedRuns(runs()).length;
		lines.push(
			trunc(
				theme.fg(
					runFails === 0 ? "success" : "dim",
					`${runFails === 0 ? "✓" : "·"} runs — last 100: ${runFails} failed/errored`,
				),
				width,
			),
		);
		const denials = recentDenials(hooks()).length;
		lines.push(
			trunc(
				theme.fg(
					denials === 0 ? "success" : "dim",
					`${denials === 0 ? "✓" : "·"} hooks — ${denials} deny decision(s) in the last 24h`,
				),
				width,
			),
		);
		return lines;
	}

	const screen: Screen = {
		render(width: number): string[] {
			const jobsSnap = store.snapshot<{ jobs: Job[] }>("jobs");
			if (jobsSnap.error && !jobsSnap.data) return errorState(theme, jobsSnap.error, width);
			if (!jobsSnap.data) return [heading(theme, "recovery"), ...loadingState(theme, "attention items")];
			const rows = attentionRows();
			const conn = store.connection;
			const connText =
				conn === "up"
					? theme.fg("success", "● engine up")
					: conn === "down"
						? theme.fg(
								"error",
								"● engine down — the banner shows the retry; every panel below is a cached snapshot",
							)
						: theme.fg("warning", `● engine ${conn}`);
			const lines: string[] = [heading(theme, "recovery")];
			lines.push(
				`${connText}${theme.fg("dim", ` · ${rows.length} item${rows.length === 1 ? "" : "s"} needing attention`)}`,
			);
			lines.push("");
			if (rows.length === 0) {
				lines.push(theme.fg("success", "✓ nothing needs attention — the clean bill"));
			} else {
				win.resync();
				const view = Math.max(1, viewport - FIXED_ROWS);
				const end = Math.min(rows.length, win.scroll + view);
				for (let i = win.scroll; i < end; i++) {
					const row = rows[i]!;
					const cursor = i === win.selected ? theme.fg("accent", "▸ ") : "  ";
					const color = row.rank <= 2 ? "error" : "warning";
					lines.push(
						trunc(
							`${cursor}${theme.fg(color, `${row.glyph} ${row.label}:`)} ${theme.fg("muted", row.detail)}${theme.fg("dim", `  → ${row.drill}`)}`,
							width,
						),
					);
				}
				if (rows.length > end) lines.push(theme.fg("dim", `  … ${rows.length - end} more`));
			}
			lines.push("");
			lines.push(...greenLines(width));
			// The recovery engine's own scorecard (the mission's Recovery View):
			// attempts, validated recoveries, recurring categories — receipts-only.
			const p = plm();
			if (p) {
				const a = p.analytics;
				lines.push("");
				lines.push(theme.fg("muted", "recovery engine"));
				const rate = a.recoverySuccessRate;
				const rateText = rate === null ? "not measured yet" : `${Math.round(rate * 100)}% over ${a.total} event(s)`;
				lines.push(
					trunc(
						theme.fg(
							rate === null ? "dim" : rate >= 0.8 ? "success" : "warning",
							`${rate === null ? "·" : "✓"} recovery score — ${rateText}`,
						),
						width,
					),
				);
				const recurring = a.recurring.slice(0, 3).map((c) => `${c.name} ×${c.count}`);
				if (recurring.length > 0)
					lines.push(trunc(theme.fg("dim", `  recurring: ${recurring.join(" · ")}`), width));
				const recent = (p.events ?? []).slice(0, 3);
				for (const e of recent) {
					const statusGlyph = e.status === "validated" ? "✓" : e.status === "failed" ? "✗" : "◦";
					const color = e.status === "validated" ? "success" : e.status === "failed" ? "error" : "dim";
					lines.push(
						trunc(
							`  ${theme.fg(color, `${statusGlyph} ${e.category}`)} ${theme.fg("dim", `· ${e.recovery_action ?? "?"} · ${e.status} · ${timeAgo(e.ts)}`)}`,
							width,
						),
					);
				}
				if ((p.events ?? []).length === 0)
					lines.push(theme.fg("dim", "  · no failures observed in the window — nothing to recover"));
			}
			lines.push("");
			lines.push(theme.fg("dim", "enter drills into the owning screen · R refreshes"));
			const age = jobsSnap.ageMs;
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
			return [
				["enter", "drill in"],
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
			if (matchesKey(data, "enter") || matchesKey(data, "return")) {
				const rows = attentionRows();
				const row = rows[win.selected];
				if (row) openScreen(row.drill);
				return true;
			}
			return false;
		},
	};
	return screen;
}
