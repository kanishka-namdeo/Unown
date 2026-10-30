/**
 * screens/dreams-screen.ts — AutoDream runs: the consolidation log with
 * per-run stats (notes in → merged/pruned/added), the canary/guard note and
 * dream output drill-in, the notes each dream consumed, and a one-key
 * "dream now" trigger.
 *
 * Follows the overview-screen pattern: SelectionWindow over the list,
 * list⇄detail modes, per-mode footer hints, and the loading/empty/error
 * states from widgets/bits.ts.
 */

import { matchesKey } from "@earendil-works/pi-tui";
import type { Dream, DreamNote, DreamsResponse, OverviewResponse } from "../dashboard-types.ts";
import type { Screen, ScreenDeps, SelectionWindow } from "../screen.ts";
import { SelectionWindow as Window } from "../screen.ts";
import {
	ageStamp,
	badge,
	emptyState,
	errorState,
	heading,
	loadingState,
	statusTone,
	timeAgo,
	trunc,
	wrap,
} from "../widgets/bits.ts";

export function createDreamsScreen(deps: ScreenDeps): Screen {
	const { store, theme, toast, requestRender } = deps;
	let viewport = 24;
	let mode: "list" | "detail" = "list";
	let detailDream: Dream | null = null;
	let consumedNotes: DreamNote[] = [];
	let notesLoading = false;
	let notesError: string | null = null;
	let detailScroll = 0;
	let detailLines = 0;

	// Pending header + blank + heading + more-line + age stamp.
	const FIXED_ROWS = 5;

	function dreams(): Dream[] {
		return store.snapshot<DreamsResponse>("dreams").data?.dreams ?? [];
	}

	const win: SelectionWindow = new Window(
		() => dreams().length,
		() => Math.max(1, viewport - FIXED_ROWS),
	);

	function statusText(d: Dream): string {
		return d.status === "gated" ? "gated (canary)" : d.status;
	}

	function renderDreamRow(d: Dream, selected: boolean, width: number): string {
		const cursor = selected ? theme.fg("accent", "▸ ") : "  ";
		const status = badge(theme, statusText(d), statusTone(d.status));
		const stats = theme.fg(
			"muted",
			`${d.notes_in} notes → ${d.entries_merged} merged · ${d.entries_pruned} pruned · ${d.entries_added} added`,
		);
		return trunc(
			`${cursor}${status} ${theme.fg("dim", "·")} ${stats} ${theme.fg("dim", `· ${timeAgo(d.started_at)}`)}`,
			width,
		);
	}

	function renderList(width: number): string[] {
		const snap = store.snapshot<DreamsResponse>("dreams");
		const pending = store.snapshot<OverviewResponse>("overview").data?.kpis.notes.pending ?? null;
		const list = dreams();
		win.resync();
		const lines: string[] = [];
		lines.push(
			`${theme.fg("muted", "pending notes ")}${
				pending === null ? theme.fg("dim", "…") : theme.fg(pending > 0 ? "warning" : "dim", `${pending}`)
			}   ${theme.fg("accent", "D")} ${theme.fg("dim", "run autodream now")}`,
		);
		lines.push("");
		lines.push(heading(theme, "dreams"));
		if (snap.error && !snap.data) {
			lines.push(...errorState(theme, snap.error, width));
		} else if (!snap.data) {
			lines.push(...loadingState(theme, "dreams"));
		} else if (list.length === 0) {
			lines.push(
				...emptyState(theme, "no dreams yet", "AutoDream consolidates pending notes when the engine idles"),
			);
		} else {
			const view = Math.max(1, viewport - FIXED_ROWS);
			win.ensureVisible();
			const end = Math.min(list.length, win.scroll + view);
			for (let i = win.scroll; i < end; i++) {
				lines.push(renderDreamRow(list[i]!, i === win.selected, width));
			}
			const more = list.length - win.scroll - view;
			if (more > 0) lines.push(theme.fg("dim", `  … ${more} more (j/k, PgDn)`));
		}
		const age = snap.ageMs;
		if (age !== null) lines.push(theme.fg("dim", `  data ${ageStamp(theme, age)}`));
		return lines;
	}

	function renderDetail(width: number): string[] {
		const d = detailDream;
		if (!d) return loadingState(theme, "dream");
		const lines: string[] = [];
		lines.push(heading(theme, `dream · ${statusText(d)}`));
		lines.push("");
		const field = (label: string, value: string): string =>
			`${theme.fg("muted", `${label} `)}${theme.fg("text", value)}`;
		lines.push(field("status", statusText(d)));
		lines.push(field("notes in", `${d.notes_in}`));
		lines.push(field("merged · pruned · added", `${d.entries_merged} · ${d.entries_pruned} · ${d.entries_added}`));
		lines.push(field("started", timeAgo(d.started_at)));
		if (d.ended_at !== null) lines.push(field("ended", timeAgo(d.ended_at)));
		if (d.note) {
			lines.push("");
			lines.push(heading(theme, "canary / guard note"));
			for (const l of wrap(d.note, Math.max(20, width - 2))) lines.push(theme.fg("mdQuote", l));
		}
		lines.push("");
		lines.push(heading(theme, "dream output"));
		if (d.output) {
			for (const l of wrap(d.output, Math.max(20, width - 2))) lines.push(theme.fg("text", l));
		} else {
			lines.push(theme.fg("dim", "· no output"));
		}
		lines.push("");
		lines.push(heading(theme, "consumed notes"));
		if (notesError) {
			lines.push(...errorState(theme, notesError, width));
		} else if (consumedNotes.length === 0) {
			if (notesLoading) {
				lines.push(...loadingState(theme, "consumed notes"));
			} else {
				lines.push(theme.fg("dim", "· no notes recorded"));
			}
		} else {
			for (const n of consumedNotes) {
				lines.push(
					`${theme.fg("muted", "-")} ${theme.fg("text", n.project_slug ?? "benchmark note")} ${theme.fg("dim", `· ${timeAgo(n.created_at)}`)}`,
				);
				for (const l of wrap(n.content, Math.max(20, width - 4)).slice(0, 3)) {
					lines.push(theme.fg("dim", `  ${l}`));
				}
			}
		}
		lines.push("");
		lines.push(theme.fg("dim", "esc back · D run autodream now"));
		const view = Math.max(1, viewport);
		detailLines = lines.length;
		detailScroll = Math.max(0, Math.min(detailScroll, Math.max(0, lines.length - view)));
		return lines.slice(detailScroll, detailScroll + view);
	}

	const screen: Screen = {
		render(width: number): string[] {
			return mode === "detail" ? renderDetail(width) : renderList(width);
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
					["j/k", "scroll"],
				];
			}
			return [
				["enter", "dream"],
				["D", "dream now"],
				["j/k", "select"],
			];
		},

		handleKey(data: string): boolean {
			// D works everywhere — the list and the drill-in alike.
			if (matchesKey(data, "shift+d")) {
				void store
					.runDream()
					.then((r) => {
						if (r.started) toast("autodream started", "emerald");
						else if (r.skipped) toast(r.skipped, "amber");
						else if (r.error) toast(r.error, "rose");
						else toast("autodream not started", "amber");
					})
					.catch((e) => toast((e as Error).message, "rose"));
				return true;
			}
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
					detailScroll -= 1;
					return true;
				}
				if (matchesKey(data, "g")) {
					detailScroll = 0;
					return true;
				}
				if (matchesKey(data, "shift+g")) {
					detailScroll = Math.max(0, detailLines - Math.max(1, viewport));
					return true;
				}
				if (matchesKey(data, "pageDown")) {
					detailScroll += Math.max(1, viewport);
					return true;
				}
				if (matchesKey(data, "pageUp")) {
					detailScroll -= Math.max(1, viewport);
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
				const d = dreams()[win.selected];
				if (d) {
					mode = "detail";
					detailDream = d;
					consumedNotes = [];
					notesError = null;
					notesLoading = true;
					detailScroll = 0;
					void store
						.dreamNotes(d.id)
						.then((ns) => {
							consumedNotes = ns;
						})
						.catch((e) => {
							notesError = (e as Error).message;
						})
						.finally(() => {
							notesLoading = false;
							requestRender();
						});
				}
				return true;
			}
			return false;
		},
	};
	return screen;
}
