/**
 * screens/memory-screen.ts — the tiered memory the engine injects into every
 * prompt: engine tiers with their shared injection budget, per-project memory
 * tiers, and a version-history drill-in with one-key rollback (a rollback
 * writes a new version, so history is never destroyed).
 *
 * M11: a history row now opens a VERSION DIFF (`enter`) — that version against
 * its predecessor, with a +N/−M tally. The engine already stores every
 * version's full text, so "what did that dream change?" used to be answerable
 * only by reading two whole dumps and comparing them by eye.
 *
 * Follows the overview-screen pattern: SelectionWindow over the list,
 * list⇄detail modes, per-mode footer hints, and the loading/empty/error
 * states from widgets/bits.ts.
 */

import { generateDiffString } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import type { Screen, ScreenDeps, SelectionWindow } from "../screen.ts";
import { SelectionWindow as Window } from "../screen.ts";
import type {
	MemoryHistoryEntry,
	MemoryResponse,
	ProjectMemoryResponse,
} from "../dashboard-types.ts";
import {
	ageStamp,
	badge,
	emptyState,
	errorState,
	formatTokens,
	heading,
	loadingState,
	meter,
	pill,
	timeAgo,
	trunc,
	type Tone,
	wrap,
} from "../widgets/bits.ts";

/** One selectable row: an engine tier or a terminal project's tier. */
interface MemItem {
	kind: "engine" | "project";
	/** Tier id used against the API ("policy", "project:<slug>"). */
	tierId: string;
	/** Display label (engine tiers uppercased, projects by slug). */
	label: string;
	version: number;
	chars: number;
	updatedAt: number | null;
	/** Engine tiers carry their content; project tiers get it from history. */
	content: string | null;
}

/**
 * M11: one version's unified diff against its predecessor — the answer to "what
 * did that dream actually change?", which the screen used to make the reader
 * reconstruct by comparing two whole dumps by eye. Every tier write is already
 * versioned with its full text (`memory_versions.content`, store.ts), so this is
 * a render gap, not a data gap.
 *
 * Exported and pure because the pairing rule is the part that can be wrong: the
 * engine returns history rows in whatever order, so "the previous version" is
 * the greatest version number BELOW the target, not the neighbouring array slot —
 * and the first version has no predecessor, which is reported as such rather
 * than diffed against an empty string that would print the whole block as added.
 */
export function memoryVersionDiff(
	entries: MemoryHistoryEntry[],
	version: number,
): { text: string; prevVersion: number | null } | null {
	const target = entries.find((e) => e.version === version);
	if (!target) return null;
	let prev: MemoryHistoryEntry | null = null;
	for (const e of entries) {
		if (e.version < target.version && (!prev || e.version > prev.version)) prev = e;
	}
	return {
		prevVersion: prev ? prev.version : null,
		text: generateDiffString(prev ? prev.content : target.content, target.content).diff,
	};
}

export function createMemoryScreen(deps: ScreenDeps): Screen {
	const { store, theme, toast, requestRender, confirm } = deps;
	let viewport = 24;
	let mode: "list" | "detail" = "list";
	let subMode: "content" | "history" | "diff" = "content";
	let detailItem: MemItem | null = null;
	let detailHistory: MemoryHistoryEntry[] = [];
	let detailLoading = false;
	let detailError: string | null = null;
	let detailScroll = 0;
	let detailLines = 0;
	let topRow = 0;

	const BUDGET_CHARS = 80_000;
	/** Hard cap on the rendered diff body — a memory tier is bounded by the
	 *  injection budget, but a whole-block diff would still flood the pane. */
	const DIFF_LINE_CAP = 400;

	function items(): MemItem[] {
		const tiers = store.snapshot<MemoryResponse>("memory").data?.tiers ?? [];
		const projects = store.snapshot<ProjectMemoryResponse>("memoryProjects").data?.projects ?? [];
		return [
			...tiers.map(
				(t): MemItem => ({
					kind: "engine",
					tierId: t.tier,
					label: t.tier.toUpperCase(),
					version: t.version,
					chars: t.chars,
					updatedAt: t.updatedAt,
					content: t.content,
				}),
			),
			...projects.map(
				(p): MemItem => ({
					kind: "project",
					tierId: p.tier,
					label: p.slug,
					version: p.version,
					chars: p.chars,
					updatedAt: p.updatedAt,
					content: null,
				}),
			),
		];
	}

	// Headings + budget + blank + age stamp ≈ the chrome around the tier rows.
	const win: SelectionWindow = new Window(
		() => items().length,
		() => Math.max(1, viewport - 5),
	);
	// The detail view's second cursor: version-history rows (TAB focuses it).
	const historyWin: SelectionWindow = new Window(
		() => detailHistory.length,
		() => Math.max(1, viewport),
	);

	function changedByTone(who: string): Tone {
		switch (who) {
			case "autodream":
				return "emerald";
			case "harness":
				return "amber";
			case "seed":
				return "dim";
			default:
				// manual, rollback, and anything the engine grows later.
				return "zinc";
		}
	}

	function renderEngineRow(it: MemItem, selected: boolean, width: number): string {
		const cursor = selected ? theme.fg("accent", "▸ ") : "  ";
		const name = theme.fg("text", it.label.padEnd(8));
		const meta = theme.fg("dim", `· ${formatTokens(it.chars)} chars · updated ${timeAgo(it.updatedAt)}`);
		return trunc(`${cursor}${name} ${pill(theme, `v${it.version}`)} ${meta}`, width);
	}

	function renderProjectRow(it: MemItem, selected: boolean, width: number): string {
		const cursor = selected ? theme.fg("accent", "▸ ") : "  ";
		const slug = theme.fg("text", it.label);
		const meta = theme.fg("dim", `· ${formatTokens(it.chars)} chars · updated ${timeAgo(it.updatedAt)}`);
		return trunc(`${cursor}${slug}  ${pill(theme, `v${it.version}`)} ${meta}`, width);
	}

	function renderHistoryRow(e: MemoryHistoryEntry, selected: boolean, width: number): string {
		const cursor = selected ? theme.fg("accent", "▸ ") : "  ";
		const by = badge(theme, e.changed_by, changedByTone(e.changed_by));
		const note = e.note ? theme.fg("muted", trunc(e.note, 40)) : theme.fg("dim", "no note");
		return trunc(
			`${cursor}${pill(theme, `v${e.version}`)} ${theme.fg("dim", "·")} ${by} ${theme.fg("dim", "·")} ${note} ${theme.fg("dim", `· ${timeAgo(e.created_at)}`)}`,
			width,
		);
	}

	/** Project tiers have no content in the list response — the newest
	 * history entry carries it. */
	function contentFromHistory(): string | null {
		let best: MemoryHistoryEntry | null = null;
		for (const e of detailHistory) {
			if (!best || e.version > best.version) best = e;
		}
		return best ? best.content : null;
	}

	function renderList(width: number): string[] {
		const memSnap = store.snapshot<MemoryResponse>("memory");
		const projSnap = store.snapshot<ProjectMemoryResponse>("memoryProjects");
		const mem = memSnap.data;
		const all = items();
		const engineItems = all.filter((it) => it.kind === "engine");
		const projectItems = all.filter((it) => it.kind === "project");
		win.resync();
		const rows: string[] = [];
		const rowItem: number[] = []; // selectable item index per row (-1 = chrome)
		const push = (line: string, item = -1): void => {
			rows.push(line);
			rowItem.push(item);
		};

		push(heading(theme, "engine tiers"));
		if (memSnap.error && !mem) {
			for (const l of errorState(theme, memSnap.error, width)) push(l);
		} else if (!mem) {
			for (const l of loadingState(theme, "memory")) push(l);
		} else {
			engineItems.forEach((it, i) => push(renderEngineRow(it, win.selected === i, width), i));
			const resolved = mem.resolvedChars;
			push(
				`${theme.fg("muted", "injection budget ")}${meter(
					theme,
					resolved / BUDGET_CHARS,
					14,
					`${formatTokens(resolved)}/80k chars resolved into every prompt`,
				)}`,
			);
		}

		push("");
		push(heading(theme, "project memories"));
		if (projSnap.error && !projSnap.data) {
			for (const l of errorState(theme, projSnap.error, width)) push(l);
		} else if (!projSnap.data) {
			for (const l of loadingState(theme, "project memories")) push(l);
		} else if (projectItems.length === 0) {
			for (const l of emptyState(
				theme,
				"no project memories yet",
				"terminal sessions leave notes; AutoDream consolidates them per project",
			))
				push(l);
		} else {
			projectItems.forEach((it, j) =>
				push(
					renderProjectRow(it, win.selected === engineItems.length + j, width),
					engineItems.length + j,
				),
			);
		}

		// Row-space window (the two-section list makes item-space slicing
		// awkward): keep the selected row on screen, never past the last page.
		const view = Math.max(1, viewport - 1); // one row reserved for the age stamp
		const selRow = rowItem.indexOf(win.selected);
		if (selRow >= 0) {
			if (selRow < topRow) topRow = selRow;
			else if (selRow >= topRow + view) topRow = selRow - view + 1;
		}
		topRow = Math.max(0, Math.min(topRow, Math.max(0, rows.length - view)));
		const out = rows.slice(topRow, topRow + view);
		if (memSnap.ageMs !== null) {
			out.push(theme.fg("dim", `  data ${ageStamp(theme, memSnap.ageMs)}`));
		}
		return out;
	}

	/**
	 * M11: the version-diff view. Entered with `enter` on a history row; the
	 * block is scrollable with the same keys as the content view. Lines are
	 * coloured by their diff prefix here rather than through pi's renderDiff so
	 * the dashboard's own theme stays the single palette authority.
	 */
	function renderDiffBlock(width: number): string[] {
		const entry = detailHistory[historyWin.selected];
		const item = detailItem;
		if (!entry || !item) return [heading(theme, "diff"), theme.fg("dim", "· no version selected — esc back")];
		const diff = memoryVersionDiff(detailHistory, entry.version);
		const by = badge(theme, entry.changed_by, changedByTone(entry.changed_by));
		const lines: string[] = [
			heading(theme, `diff · ${item.label} v${entry.version}${diff?.prevVersion != null ? ` vs v${diff.prevVersion}` : ""}`),
			theme.fg("dim", `  ${by} · ${timeAgo(entry.created_at)} · ${formatTokens(entry.content.length)} chars`),
			"",
		];
		if (!diff) {
			lines.push(theme.fg("dim", "· this version is no longer in the history payload"));
			lines.push(theme.fg("dim", "  esc back to the version list"));
			return lines.map((l) => trunc(l, width));
		}
		if (diff.prevVersion === null) {
			lines.push(theme.fg("muted", `· v${entry.version} is the first recorded version — there is no earlier state to diff against`));
			lines.push(theme.fg("dim", `  ${formatTokens(entry.content.length)} chars written by ${entry.changed_by}`));
			lines.push("");
			for (const l of wrap(entry.content, Math.max(20, width - 2)).slice(0, DIFF_LINE_CAP)) lines.push(theme.fg("text", l));
			return lines.map((l) => trunc(l, width));
		}
		const body = diff.text.split("\n");
		let added = 0;
		let removed = 0;
		for (const l of body) {
			if (l.startsWith("+") && !l.startsWith("+++")) added++;
			else if (l.startsWith("-") && !l.startsWith("---")) removed++;
		}
		const tail = body.length > DIFF_LINE_CAP ? theme.fg("dim", ` · truncated at ${DIFF_LINE_CAP} lines`) : "";
		lines.push(`${theme.fg("success", `+${added}`)}${theme.fg("dim", " / ")}${theme.fg("error", `−${removed}`)}${tail}`);
		lines.push("");
		for (const l of body.slice(0, DIFF_LINE_CAP)) {
			// pi's generateDiffString prefixes every line with its line number
			// ("+3 c"), so the marker is the FIRST character — read it before the
			// number, or the colouring silently falls through to context for every
			// added and removed line.
			const marker = l.charAt(0);
			if (marker === "@") lines.push(trunc(theme.fg("accent", l), width));
			else if (marker === "+") lines.push(trunc(theme.fg("success", l), width));
			else if (marker === "-") lines.push(trunc(theme.fg("error", l), width));
			else lines.push(trunc(theme.fg("dim", l), width));
		}
		lines.push("");
		lines.push(theme.fg("dim", "j/k scroll · esc back to the version list"));
		return lines;
	}

	function renderDetail(width: number): string[] {
		if (detailError) return errorState(theme, detailError, width);
		const item = detailItem;
		if (!item) return loadingState(theme, "memory");
		// The diff view owns its own block; it scrolls with the same window rule
		// as the content view, so detailScroll means one thing across both.
		if (subMode === "diff") {
			const diffLines = renderDiffBlock(width);
			const view = Math.max(1, viewport);
			detailLines = diffLines.length;
			detailScroll = Math.max(0, Math.min(detailScroll, Math.max(0, diffLines.length - view)));
			return diffLines.slice(detailScroll, detailScroll + view);
		}
		const lines: string[] = [];
		lines.push(heading(theme, `memory · ${item.label}`));
		lines.push(
			theme.fg(
				"dim",
				`  v${item.version} · ${formatTokens(item.chars)} chars · updated ${timeAgo(item.updatedAt)}`,
			),
		);
		lines.push("");
		const content = item.content ?? contentFromHistory();
		if (content) {
			for (const l of wrap(content, Math.max(20, width - 2))) lines.push(theme.fg("text", l));
		} else if (detailLoading) {
			lines.push(...loadingState(theme, "history"));
		} else {
			lines.push(theme.fg("dim", "· no content yet"));
		}
		lines.push("");
		lines.push(heading(theme, "version history"));
		const histStart = lines.length;
		historyWin.resync();
		if (detailHistory.length > 0) {
			detailHistory.forEach((e, i) =>
				lines.push(renderHistoryRow(e, subMode === "history" && i === historyWin.selected, width)),
			);
		} else if (detailLoading) {
			lines.push(...loadingState(theme, "history"));
		} else {
			lines.push(theme.fg("dim", "· no versions yet"));
		}
		lines.push("");
		lines.push(
			theme.fg(
				"dim",
				subMode === "history"
					? "b rollback to the selected version · esc back"
					: "tab version history · esc back",
			),
		);
		// One window over the whole block; in history mode keep the selected
		// version row inside it.
		const view = Math.max(1, viewport);
		if (subMode === "history" && detailHistory.length > 0) {
			const selRow = histStart + historyWin.selected;
			if (selRow < detailScroll) detailScroll = selRow;
			else if (selRow >= detailScroll + view) detailScroll = selRow - view + 1;
		}
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
				if (subMode === "diff")
					return [
						["j/k", "scroll"],
						["esc", "version list"],
					];
				return subMode === "history"
					? [
							["enter", "diff"],
							["b", "rollback"],
							["tab", "content"],
							["esc", "back"],
					]
					: [
							["tab", "history"],
							["esc", "back"],
					];
			}
			return [
				["enter", "open"],
				["j/k", "select"],
			];
		},

		handleKey(data: string): boolean {
			if (mode === "detail") {
				// esc from the diff view returns to the version rows, not to the tier
				// list — the reader is inside one tier's history.
				if (subMode === "diff" && matchesKey(data, "escape")) {
					subMode = "history";
					return true;
				}
				if (matchesKey(data, "escape")) {
					mode = "list";
					return true;
				}
				if (matchesKey(data, "tab")) {
					// diff and content both collapse back to the version rows; from the
					// rows, TAB opens the content view (the original two-way toggle).
					subMode = subMode === "history" ? "content" : "history";
					return true;
				}
				if (subMode === "diff") {
					// Scrolling keys only — the selected version is fixed while reading.
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
				if (subMode === "history") {
					if (matchesKey(data, "j") || matchesKey(data, "down")) return historyWin.move(1);
					if (matchesKey(data, "k") || matchesKey(data, "up")) return historyWin.move(-1);
					if (matchesKey(data, "g")) return historyWin.home();
					if (matchesKey(data, "shift+g")) return historyWin.end();
					if (matchesKey(data, "pageDown")) return historyWin.page(1);
					if (matchesKey(data, "pageUp")) return historyWin.page(-1);
					// M11: enter on a version row opens its diff against the predecessor.
					if (matchesKey(data, "enter")) {
						if (!detailHistory[historyWin.selected]) return false;
						subMode = "diff";
						detailScroll = 0;
						return true;
					}
					if (matchesKey(data, "b")) {
						const entry = detailHistory[historyWin.selected];
						const item = detailItem;
						if (!entry || !item) return false;
						confirm(
							`rollback ${item.tierId} to v${entry.version}? (a new version is written — always reversible)`,
							() => {
								void store
									.rollbackMemory(item.tierId, entry.version)
									.then((r) =>
										toast(
											r.ok ? `memory rolled back to v${entry.version}` : "rollback failed",
											r.ok ? "emerald" : "rose",
										),
									)
									.catch((e) => toast((e as Error).message, "rose"));
							},
						);
						return true;
					}
					return false;
				}
				// content sub-mode: scroll the whole detail block.
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
				const item = items()[win.selected];
				if (item) {
					mode = "detail";
					subMode = "content";
					detailItem = item;
					detailHistory = [];
					detailError = null;
					detailLoading = true;
					detailScroll = 0;
					historyWin.selected = 0;
					historyWin.scroll = 0;
					void store
						.memoryHistory(item.tierId)
						.then((h) => {
							detailHistory = h;
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
			return false;
		},
	};
	return screen;
}
