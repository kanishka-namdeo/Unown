/**
 * screens/notes-screen.ts — the session-note inbox AutoDream feeds on: the
 * filterable note list (all / terminal / benchmark / pending), full-content
 * drill-in, an inline composer that delivers a note to the engine for the
 * current project, and a one-key outbox sync.
 *
 * Follows the overview-screen pattern: SelectionWindow over the list,
 * list⇄detail modes, per-mode footer hints, and the loading/empty/error
 * states from widgets/bits.ts.
 */

import { matchesKey } from "@earendil-works/pi-tui";
import type { Note, NotesResponse } from "../dashboard-types.ts";
import type { Screen, ScreenDeps, SelectionWindow } from "../screen.ts";
import { SelectionWindow as Window } from "../screen.ts";
import {
	ageStamp,
	badge,
	emptyState,
	errorState,
	heading,
	InlineInput,
	loadingState,
	pill,
	type Tone,
	timeAgo,
	trunc,
	wrap,
} from "../widgets/bits.ts";

export function createNotesScreen(deps: ScreenDeps): Screen {
	const { store, theme, toast, requestRender } = deps;
	let viewport = 24;
	let mode: "list" | "detail" | "compose" = "list";
	let filter: "all" | "terminal" | "benchmark" | "pending" = "all";
	let detailNote: Note | null = null;
	let detailScroll = 0;
	let detailLines = 0;
	const input = new InlineInput(20_000);

	const FILTERS: ("all" | "terminal" | "benchmark" | "pending")[] = ["all", "terminal", "benchmark", "pending"];

	// Filter header + blank + heading + more-line + age stamp.
	const FIXED_ROWS = 5;

	function notes(): Note[] {
		return store.snapshot<NotesResponse>("notes").data?.notes ?? [];
	}

	function filtered(): Note[] {
		const all = notes();
		switch (filter) {
			case "terminal":
				return all.filter((n) => n.kind === "terminal");
			case "benchmark":
				return all.filter((n) => n.kind === "benchmark");
			case "pending":
				return all.filter((n) => n.dream_id === null);
			default:
				return all;
		}
	}

	const win: SelectionWindow = new Window(
		() => filtered().length,
		() => Math.max(1, viewport - FIXED_ROWS),
	);

	function kindTone(n: Note): Tone {
		return n.kind === "terminal" ? "emerald" : "zinc";
	}

	function dreamChip(n: Note): string {
		return n.dream_id === null ? badge(theme, "PENDING", "amber") : theme.fg("dim", "dreamed");
	}

	function renderNoteRow(n: Note, selected: boolean, width: number): string {
		const cursor = selected ? theme.fg("accent", "▸ ") : "  ";
		const kind = pill(theme, n.kind ?? "note", kindTone(n));
		const project = theme.fg("dim", n.project_slug ?? "—");
		const firstLine = (n.content.split("\n")[0] ?? "").trim();
		const preview = theme.fg("muted", trunc(firstLine, 64));
		return trunc(
			`${cursor}${kind} ${project} ${theme.fg("dim", "·")} ${dreamChip(n)} ${theme.fg("dim", `· ${timeAgo(n.created_at)} ·`)} ${preview}`,
			width,
		);
	}

	function renderList(width: number): string[] {
		const snap = store.snapshot<NotesResponse>("notes");
		const all = notes();
		const list = filtered();
		win.resync();
		const lines: string[] = [];
		const counts = snap.data
			? `· ${all.length} notes · ${all.filter((n) => n.kind === "terminal").length} terminal · ${all.filter((n) => n.kind === "benchmark").length} benchmark · ${all.filter((n) => n.dream_id === null).length} pending`
			: "· loading…";
		lines.push(`${theme.fg("muted", "filter ")}${theme.fg("accent", filter)} ${theme.fg("dim", counts)}`);
		lines.push("");
		lines.push(heading(theme, "notes"));
		if (snap.error && !snap.data) {
			lines.push(...errorState(theme, snap.error, width));
		} else if (!snap.data) {
			lines.push(...loadingState(theme, "notes"));
		} else if (list.length === 0) {
			lines.push(
				...emptyState(
					theme,
					filter === "all" ? "no notes yet" : `no ${filter} notes`,
					"terminal sessions and benchmark runs leave notes; AutoDream dreams them into memory",
				),
			);
		} else {
			const view = Math.max(1, viewport - FIXED_ROWS);
			win.ensureVisible();
			const end = Math.min(list.length, win.scroll + view);
			for (let i = win.scroll; i < end; i++) {
				lines.push(renderNoteRow(list[i]!, i === win.selected, width));
			}
			const more = list.length - win.scroll - view;
			if (more > 0) lines.push(theme.fg("dim", `  … ${more} more (j/k, PgDn)`));
		}
		const age = snap.ageMs;
		if (age !== null) lines.push(theme.fg("dim", `  data ${ageStamp(theme, age)}`));
		return lines;
	}

	function renderDetail(width: number): string[] {
		const n = detailNote;
		if (!n) return loadingState(theme, "note");
		const lines: string[] = [];
		lines.push(heading(theme, "note"));
		lines.push("");
		lines.push(
			`${pill(theme, n.kind ?? "note", kindTone(n))} ${theme.fg("dim", n.project_slug ?? "—")} ${theme.fg("dim", `· ${timeAgo(n.created_at)} ·`)} ${dreamChip(n)}`,
		);
		lines.push("");
		for (const l of wrap(n.content, Math.max(20, width - 2))) lines.push(theme.fg("text", l));
		lines.push("");
		lines.push(theme.fg("dim", "esc back"));
		const view = Math.max(1, viewport);
		detailLines = lines.length;
		detailScroll = Math.max(0, Math.min(detailScroll, Math.max(0, lines.length - view)));
		return lines.slice(detailScroll, detailScroll + view);
	}

	function renderCompose(width: number): string[] {
		const lines: string[] = [];
		lines.push(heading(theme, "compose note"));
		lines.push("");
		lines.push(input.renderField(theme, "note", width));
		lines.push("");
		lines.push(theme.fg("dim", "enter send · esc cancel · delivered to the engine for the current project (cwd)"));
		return lines;
	}

	const screen: Screen = {
		render(width: number): string[] {
			if (mode === "compose") return renderCompose(width);
			if (mode === "detail") return renderDetail(width);
			return renderList(width);
		},

		invalidate(): void {
			requestRender();
		},

		setViewport(height: number): void {
			viewport = height;
		},

		wantsTextInput(): boolean {
			return mode === "compose";
		},

		footerHints(): [string, string][] {
			if (mode === "compose") {
				return [
					["enter", "send"],
					["esc", "cancel"],
				];
			}
			if (mode === "detail") {
				return [["esc", "back"]];
			}
			return [
				["enter", "read"],
				["c", "compose"],
				["f", `filter: ${filter}`],
				["s", "sync"],
				["j/k", "select"],
			];
		},

		handleKey(data: string): boolean {
			if (mode === "compose") {
				// The composer owns every printable key; only what it declines
				// (enter, escape) carries meaning here.
				if (input.insert(data)) return true;
				if (matchesKey(data, "enter")) {
					const text = input.text.trim();
					if (text.length === 0) {
						toast("note is empty", "amber");
						return true;
					}
					input.clear();
					mode = "list";
					void store
						.createNote(text, process.cwd())
						.then((r) => toast(r.ok ? "note delivered" : "note rejected", r.ok ? "emerald" : "rose"))
						.catch((e) => toast((e as Error).message, "rose"));
					return true;
				}
				if (matchesKey(data, "escape")) {
					input.clear();
					mode = "list";
					return true;
				}
				return false;
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
			if (matchesKey(data, "f")) {
				filter = FILTERS[(FILTERS.indexOf(filter) + 1) % FILTERS.length] ?? "all";
				win.resync();
				return true;
			}
			if (matchesKey(data, "g")) return win.home();
			if (matchesKey(data, "shift+g")) return win.end();
			if (matchesKey(data, "pageDown")) return win.page(1);
			if (matchesKey(data, "pageUp")) return win.page(-1);
			if (matchesKey(data, "c")) {
				input.clear();
				mode = "compose";
				return true;
			}
			if (matchesKey(data, "s")) {
				void store
					.syncNotes()
					.then((r) =>
						toast(r.ok ? `${r.synced} notes synced from the outbox` : "sync failed", r.ok ? "zinc" : "rose"),
					)
					.catch((e) => toast((e as Error).message, "rose"));
				return true;
			}
			if (matchesKey(data, "enter")) {
				const n = filtered()[win.selected];
				if (n) {
					mode = "detail";
					detailNote = n;
					detailScroll = 0;
				}
				return true;
			}
			return false;
		},
	};
	return screen;
}
