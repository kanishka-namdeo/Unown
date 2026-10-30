/**
 * screens/delegation-screen.ts — the delegation round's audit surface: one
 * screen that answers "what did Unown delegate, why, and was it worth it".
 *
 * The round's baseline finding (benchmarks/delegation-round/RESULTS.md): the
 * data existed (spawn vitals in tool results, lifecycle in the fleet journal)
 * but was EPHEMERAL — nothing persisted why a spawn happened, what it cost,
 * or how it ended, and a returning operator had no aggregate at all. This
 * screen renders the engine's /api/delegations ledger (the cross-session
 * aggregate the terminal agent reports into): recent records with their why,
 * cost and receipts-only verdict, per-agent tallies, and the honest-absence
 * states (no records yet; why coverage below 100%).
 *
 * Verdicts are receipts-only (docs/unown-ux-principles.md): a blocked or
 * timed-out run is "not worth it" by its own status; a done run shows FACTS
 * (turns, tokens, seconds) — the screen never grades the model's judgment.
 */

import { matchesKey } from "@earendil-works/pi-tui";
import type { DelegationRecordRow, DelegationTally, DelegationTotals } from "../dashboard-types.ts";
import type { Screen, ScreenDeps, SelectionWindow } from "../screen.ts";
import { SelectionWindow as Window } from "../screen.ts";
import { ageStamp, errorState, heading, loadingState, timeAgo, trunc } from "../widgets/bits.ts";

function compactTokens(n: number | null | undefined): string {
	const v = n ?? 0;
	if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
	if (v >= 1_000) return `${Math.round(v / 1000)}k`;
	return String(v);
}

/** The receipts-only verdict line (mirrors delegation.ts deriveWorthLine). */
function worthLine(r: DelegationRecordRow): string {
	if (r.blocked) return "not worth it — the child refused (BLOCKED)";
	if (r.status === "timeout") return "not worth it — hit the wall-clock budget";
	if (r.status === "spawn_error" || r.status === "aborted") return `not worth it — ${r.status}`;
	if (r.status === "stopped") return "stopped by the orchestrator";
	if (r.status !== "done") return `not worth it — exited non-zero after ${r.turns} turn${r.turns === 1 ? "" : "s"}`;
	const tok = compactTokens((r.tokens_in ?? 0) + (r.tokens_out ?? 0));
	if ((r.tokens_in ?? 0) + (r.tokens_out ?? 0) >= 100_000)
		return `expensive — ${tok} tok for ${r.turns} turns (audit it)`;
	return `ok — ${r.turns} turns, ${tok} tok, ${Math.round((r.elapsed_ms ?? 0) / 1000)}s`;
}

export function createDelegationScreen(deps: ScreenDeps): Screen {
	const { store, theme, requestRender } = deps;
	let viewport = 24;

	const snap = () =>
		store.snapshot<{ delegations: DelegationRecordRow[]; tallies: DelegationTally[]; totals: DelegationTotals }>(
			"delegations",
		);
	const records = () => snap().data?.delegations ?? [];
	const tallies = () => snap().data?.tallies ?? [];
	const totals = () => snap().data?.totals;

	const FIXED_ROWS = 8;
	const win: SelectionWindow = new Window(
		() => records().length,
		() => Math.max(1, viewport - FIXED_ROWS),
	);

	const screen: Screen = {
		render(width: number): string[] {
			const s = snap();
			if (s.error && !s.data) return errorState(theme, s.error, width);
			if (!s.data) return [heading(theme, "delegation"), ...loadingState(theme, "delegation records")];
			const conn = store.connection;
			const connText =
				conn === "up"
					? theme.fg("success", "● engine up")
					: conn === "down"
						? theme.fg("error", "● engine down — the panel below is a cached snapshot")
						: theme.fg("warning", `● engine ${conn}`);
			const lines: string[] = [heading(theme, "delegation")];
			const t = totals();
			if (t) {
				const okRate = t.total && t.ok != null ? Math.round((t.ok / t.total) * 100) : null;
				lines.push(
					`${connText}${theme.fg("dim", ` · ${t.total} delegation${t.total === 1 ? "" : "s"} recorded · ${okRate === null ? "—" : `${okRate}% ok`}`)}`,
				);
			} else {
				lines.push(connText);
			}
			lines.push("");

			const recs = records();
			if (recs.length === 0) {
				lines.push(theme.fg("success", "✓ no delegations recorded yet"));
				lines.push(theme.fg("dim", "  spawn a subagent in any session — the audit lands here as children finish"));
			} else {
				win.resync();
				const view = Math.max(1, viewport - FIXED_ROWS);
				const end = Math.min(recs.length, win.scroll + view);
				for (let i = win.scroll; i < end; i++) {
					const r = recs[i]!;
					const cursor = i === win.selected ? theme.fg("accent", "▸ ") : "  ";
					const ok = r.status === "done" && !r.blocked;
					const glyph = ok ? "✓" : r.blocked ? "⊘" : "✗";
					const color = ok ? "success" : "warning";
					const label = r.name ? `${r.name} (${r.agent})` : r.agent;
					const lane = r.lane === "fleet" ? "async" : "sync";
					lines.push(
						trunc(
							`${cursor}${theme.fg(color, `${glyph} ${label}`)} ${theme.fg("muted", `${lane} · ${timeAgo(r.ts)}`)}`,
							width,
						),
					);
					lines.push(
						trunc(
							`    ${theme.fg("dim", `why: ${r.why ? r.why.replace(/\s+/g, " ").slice(0, 90) : "(not stated)"}`)}`,
							width,
						),
					);
					lines.push(trunc(`    ${theme.fg(color === "success" ? "muted" : color, worthLine(r))}`, width));
				}
				if (recs.length > end) lines.push(theme.fg("dim", `  … ${recs.length - end} more`));
			}

			lines.push("");
			const tall = tallies();
			if (tall.length > 0) {
				lines.push(theme.fg("dim", "by agent:"));
				for (const row of tall.slice(0, 5)) {
					const ok = row.status === "done" && !row.blocked;
					lines.push(
						trunc(
							`  ${ok ? theme.fg("success", "✓") : theme.fg("warning", "·")} ${theme.fg("muted", `${row.agent} · ${row.status} · ${row.count}× · ${compactTokens(row.tokens)} tok · avg ${Math.round(row.avg_turns ?? 0)} turns`)}`,
							width,
						),
					);
				}
			}
			// Why coverage — the round's headline metric, stated honestly.
			if (t && t.total > 0 && t.with_why != null) {
				const pct = Math.round((t.with_why / t.total) * 100);
				lines.push("");
				lines.push(
					trunc(
						theme.fg(
							pct === 100 ? "success" : pct >= 50 ? "warning" : "error",
							`${pct === 100 ? "✓" : "·"} why recorded on ${t.with_why}/${t.total} (${pct}%) of delegations`,
						),
						width,
					),
				);
			}
			lines.push("");
			lines.push(
				theme.fg("dim", "j/k select · R refresh · the fleet journal (.unown/fleet) holds the per-repo detail"),
			);
			const age = s.ageMs;
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
			return [["j/k", "select"]];
		},

		handleKey(data: string): boolean {
			if (matchesKey(data, "j") || matchesKey(data, "down")) return win.move(1);
			if (matchesKey(data, "k") || matchesKey(data, "up")) return win.move(-1);
			if (matchesKey(data, "g")) return win.home();
			if (matchesKey(data, "shift+g")) return win.end();
			if (matchesKey(data, "pageDown")) return win.page(1);
			if (matchesKey(data, "pageUp")) return win.page(-1);
			return false;
		},
	};
	return screen;
}
