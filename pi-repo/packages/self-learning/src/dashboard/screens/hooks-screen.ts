/**
 * screens/hooks-screen.ts — the policy layer's decision log: every hook
 * event with its decision (deny/augment/log/warn), the MemoryBudget
 * injection-cap receipts, and the full reason + JSON payload behind each
 * row. k cycles the decision filter; enter drills into one event.
 */

import { matchesKey } from "@earendil-works/pi-tui";
import type { HookDecision, HookEntry, HooksResponse } from "../dashboard-types.ts";
import type { Screen, ScreenDeps, SelectionWindow } from "../screen.ts";
import { SelectionWindow as Window } from "../screen.ts";
import {
	ageStamp,
	badge,
	emptyState,
	errorState,
	heading,
	loadingState,
	timeAgo,
	trunc,
	wrap,
} from "../widgets/bits.ts";

type HookFilter = "all" | "deny" | "augment" | "MemoryBudget";

const FILTERS: HookFilter[] = ["all", "deny", "augment", "MemoryBudget"];

export function createHooksScreen(deps: ScreenDeps): Screen {
	const { store, theme, requestRender } = deps;
	let viewport = 24;
	let mode: "list" | "detail" = "list";
	let filter: HookFilter = "all";

	// The detail view works on a captured row so list refreshes never mutate
	// what the user is reading (no async fetch — the row carries everything).
	let detailEntry: HookEntry | null = null;
	let detailScroll = 0;
	let detailLines = 0;

	// Heading + totals line + blank row above the log.
	const FIXED_ROWS = 3;

	const allHooks = (): HookEntry[] => store.snapshot<HooksResponse>("hooks").data?.hooks ?? [];
	const filteredHooks = (): HookEntry[] => allHooks().filter(matchesFilter);

	const win: SelectionWindow = new Window(
		() => filteredHooks().length,
		() => Math.max(1, viewport - FIXED_ROWS),
	);

	function matchesFilter(entry: HookEntry): boolean {
		if (filter === "deny") return entry.decision === "deny";
		if (filter === "augment") return entry.decision === "augment";
		if (filter === "MemoryBudget") return entry.hook === "MemoryBudget";
		return true;
	}

	function decisionChip(decision: HookDecision): string {
		switch (decision) {
			case "deny":
				return badge(theme, "DENY", "rose");
			case "augment":
				return badge(theme, "AUGMENT", "amber");
			case "log-error":
				return badge(theme, "log-error", "rose");
			case "warn":
				return badge(theme, "warn", "amber");
			case "allow":
				return badge(theme, "allow", "dim");
			case "log":
				return badge(theme, "log", "dim");
		}
	}

	function field(label: string, value: string): string {
		return `${theme.fg("muted", `${label} `)}${theme.fg("text", value)}`;
	}

	function headerLines(): string[] {
		const all = allHooks();
		const denies = all.filter((e) => e.decision === "deny").length;
		const augments = all.filter((e) => e.decision === "augment").length;
		const dot = theme.fg("dim", " · ");
		const totals =
			`${theme.fg("dim", `${all.length} events`)}${dot}` +
			`${theme.fg(denies > 0 ? "warning" : "dim", `${denies} denies`)}${dot}` +
			`${theme.fg("dim", `${augments} augments`)}`;
		return [heading(theme, "hooks"), `${totals}   ${theme.fg("muted", "k filter: ")}${theme.fg("text", filter)}`];
	}

	function renderRow(entry: HookEntry, selected: boolean, width: number): string {
		const cursor = selected ? theme.fg("accent", "▸ ") : "  ";
		const when = theme.fg("dim", timeAgo(entry.ts));
		const hook = theme.fg(selected ? "text" : "muted", entry.hook);
		const tool = theme.fg("dim", entry.tool ?? "—");
		const reason = entry.reason ? ` · ${theme.fg("dim", entry.reason)}` : "";
		return trunc(`${cursor}${when} · ${hook} · ${tool} · ${decisionChip(entry.decision)}${reason}`, width);
	}

	function emptyLines(): string[] {
		if (filter === "deny") return emptyState(theme, "no denied tool calls", "the policy held");
		if (filter === "MemoryBudget") return emptyState(theme, "no budget receipts", "memory fits the injection cap");
		if (allHooks().length === 0) return emptyState(theme, "no hook events", "decisions stream in as the engine runs");
		return emptyState(theme, "no events for this filter", "k cycles the filter");
	}

	/** Pretty-print the details payload; null when the raw text is not JSON. */
	function prettyDetails(raw: string): string | null {
		try {
			const parsed: unknown = JSON.parse(raw);
			return JSON.stringify(parsed, null, 2);
		} catch {
			return null;
		}
	}

	function renderList(width: number): string[] {
		const snap = store.snapshot<HooksResponse>("hooks");
		const lines = headerLines();
		if (snap.error && !snap.data) return [...lines, ...errorState(theme, snap.error, width)];
		if (!snap.data) return [...lines, "", ...loadingState(theme, "hook events")];
		const list = filteredHooks();
		if (list.length === 0) return [...lines, "", ...emptyLines()];
		lines.push("");
		const view = Math.max(1, viewport - FIXED_ROWS - 1);
		win.resync();
		for (let i = win.scroll; i < Math.min(list.length, win.scroll + view); i++) {
			lines.push(renderRow(list[i]!, i === win.selected, width));
		}
		const more = list.length - view - win.scroll;
		if (more > 0) lines.push(theme.fg("dim", `  … ${more} more (j/k, PgDn)`));
		if (snap.ageMs !== null) lines.push(theme.fg("dim", `  data ${ageStamp(theme, snap.ageMs)}`));
		return lines;
	}

	function renderDetail(width: number): string[] {
		const entry = detailEntry;
		if (!entry) return loadingState(theme, "hook event");
		const lines: string[] = [heading(theme, `hook · ${entry.hook}`), ""];
		lines.push(field("hook", entry.hook));
		lines.push(field("tool", entry.tool ?? "—"));
		lines.push(`${theme.fg("muted", "decision ")}${decisionChip(entry.decision)}`);
		lines.push(field("when", timeAgo(entry.ts)));
		lines.push("");
		lines.push(heading(theme, "reason"));
		if (entry.reason) {
			for (const l of wrap(entry.reason, Math.max(20, width - 2))) lines.push(theme.fg("text", l));
		} else {
			lines.push(theme.fg("dim", "—"));
		}
		lines.push("");
		lines.push(heading(theme, "details"));
		if (entry.details == null) {
			lines.push(theme.fg("dim", "—"));
		} else {
			const pretty = prettyDetails(entry.details);
			const raw = pretty ?? entry.details;
			for (const l of raw.split("\n")) {
				for (const w of wrap(l, Math.max(20, width - 2))) lines.push(theme.fg("dim", w));
			}
		}
		lines.push("");
		lines.push(theme.fg("dim", "esc back"));
		return lines;
	}

	function scrollDetail(delta: number): boolean {
		detailScroll = Math.max(0, Math.min(detailScroll + delta, Math.max(0, detailLines - viewport)));
		return true;
	}

	const halfPage = (): number => Math.max(1, Math.floor(viewport / 2));

	function cycleFilter(): void {
		const idx = FILTERS.indexOf(filter);
		filter = FILTERS[(idx + 1) % FILTERS.length] ?? "all";
		win.selected = 0;
		win.scroll = 0;
	}

	const screen: Screen = {
		render(width: number): string[] {
			if (mode === "detail") {
				const lines = renderDetail(width);
				detailLines = lines.length;
				detailScroll = Math.max(0, Math.min(detailScroll, Math.max(0, detailLines - viewport)));
				return lines.slice(detailScroll, detailScroll + viewport);
			}
			return renderList(width);
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
			return [
				["enter", "details"],
				["k", `filter: ${filter}`],
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
				if (matchesKey(data, "pageDown") || matchesKey(data, "pageDown")) return scrollDetail(halfPage());
				if (matchesKey(data, "pageUp") || matchesKey(data, "pageUp")) return scrollDetail(-halfPage());
				return false;
			}
			// f cycles the decision filter (the footer shows the current one);
			// j/k and the arrows move the selection.
			if (matchesKey(data, "f")) {
				cycleFilter();
				return true;
			}
			if (matchesKey(data, "j") || matchesKey(data, "down")) return win.move(1);
			if (matchesKey(data, "k") || matchesKey(data, "up")) return win.move(-1);
			if (matchesKey(data, "g")) return win.home();
			if (matchesKey(data, "shift+g")) return win.end();
			if (matchesKey(data, "pageDown") || matchesKey(data, "pageDown")) return win.page(1);
			if (matchesKey(data, "pageUp") || matchesKey(data, "pageUp")) return win.page(-1);
			if (matchesKey(data, "enter")) {
				const entry = filteredHooks()[win.selected];
				if (entry) {
					mode = "detail";
					detailEntry = entry;
					detailScroll = 0;
				}
				return true;
			}
			return false;
		},
	};
	return screen;
}
