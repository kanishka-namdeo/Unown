/**
 * screens/skills-screen.ts — the dream-minted Agent Skills: per-project
 * skills with shipped/retired status, the SKILL.md body drill-in, the
 * version list with one-key rollback, and retire (the engine's only
 * file deletion).
 *
 * Follows the overview-screen pattern: SelectionWindow over the list,
 * list⇄detail modes (TAB switches body-scroll ⇄ version-select), per-mode
 * footer hints, and the loading/empty/error states from widgets/bits.ts.
 */

import { matchesKey } from "@earendil-works/pi-tui";
import type { Screen, ScreenDeps, SelectionWindow } from "../screen.ts";
import { SelectionWindow as Window } from "../screen.ts";
import type { Skill, SkillVersion, SkillsResponse } from "../dashboard-types.ts";
import {
	ageStamp,
	badge,
	emptyState,
	errorState,
	heading,
	loadingState,
	pill,
	timeAgo,
	trunc,
	type Tone,
	wrap,
} from "../widgets/bits.ts";

export function createSkillsScreen(deps: ScreenDeps): Screen {
	const { store, theme, toast, requestRender, confirm } = deps;
	let viewport = 24;
	let mode: "list" | "detail" = "list";
	let subMode: "body" | "versions" = "body";
	let detailSkill: Skill | null = null;
	let detailVersions: SkillVersion[] = [];
	let detailLoading = false;
	let detailError: string | null = null;
	let detailScroll = 0;
	let detailLines = 0;

	// Heading + more-line + age stamp.
	const FIXED_ROWS = 3;

	function skills(): Skill[] {
		return store.snapshot<SkillsResponse>("skills").data?.skills ?? [];
	}

	const win: SelectionWindow = new Window(
		() => skills().length,
		() => Math.max(1, viewport - FIXED_ROWS),
	);
	// The detail view's second cursor: version rows (TAB focuses it).
	const versionWin: SelectionWindow = new Window(
		() => detailVersions.length,
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

	function renderSkillRow(s: Skill, selected: boolean, width: number): string {
		const cursor = selected ? theme.fg("accent", "▸ ") : "  ";
		const name = theme.fg("text", s.name);
		const project = theme.fg("dim", s.project_slug);
		const status = badge(theme, s.status, s.status === "shipped" ? "emerald" : "dim");
		const desc = theme.fg("dim", trunc(s.description, Math.max(12, width - 34)));
		return trunc(
			`${cursor}${name} ${theme.fg("dim", "·")} ${project} ${theme.fg("dim", "·")} ${status} ${pill(theme, `v${s.version}`)} ${theme.fg("dim", "·")} ${desc}`,
			width,
		);
	}

	function renderVersionRow(v: SkillVersion, selected: boolean, width: number): string {
		const cursor = selected ? theme.fg("accent", "▸ ") : "  ";
		const by = badge(theme, v.changed_by, changedByTone(v.changed_by));
		const note = v.note ? theme.fg("muted", trunc(v.note, 40)) : theme.fg("dim", "no note");
		return trunc(
			`${cursor}${pill(theme, `v${v.version}`)} ${theme.fg("dim", "·")} ${by} ${theme.fg("dim", "·")} ${note} ${theme.fg("dim", `· ${timeAgo(v.created_at)}`)}`,
			width,
		);
	}

	function renderList(width: number): string[] {
		const snap = store.snapshot<SkillsResponse>("skills");
		const list = skills();
		win.resync();
		const lines: string[] = [];
		lines.push(heading(theme, "skills"));
		if (snap.error && !snap.data) {
			lines.push(...errorState(theme, snap.error, width));
		} else if (!snap.data) {
			lines.push(...loadingState(theme, "skills"));
		} else if (list.length === 0) {
			lines.push(
				...emptyState(
					theme,
					"no skills minted yet",
					"AutoDream mints recurring multi-step procedures into per-project skills",
				),
			);
		} else {
			const view = Math.max(1, viewport - FIXED_ROWS);
			win.ensureVisible();
			const end = Math.min(list.length, win.scroll + view);
			for (let i = win.scroll; i < end; i++) {
				lines.push(renderSkillRow(list[i]!, i === win.selected, width));
			}
			const more = list.length - win.scroll - view;
			if (more > 0) lines.push(theme.fg("dim", `  … ${more} more (j/k, PgDn)`));
		}
		const age = snap.ageMs;
		if (age !== null) lines.push(theme.fg("dim", `  data ${ageStamp(theme, age)}`));
		return lines;
	}

	function renderDetail(width: number): string[] {
		if (detailError) return errorState(theme, detailError, width);
		const s = detailSkill;
		if (!s) return loadingState(theme, "skill");
		const lines: string[] = [];
		lines.push(heading(theme, `skill · ${s.name}`));
		lines.push("");
		const field = (label: string, value: string): string =>
			`${theme.fg("muted", `${label} `)}${theme.fg("text", value)}`;
		lines.push(field("project", s.project_slug));
		lines.push(field("status", s.status));
		lines.push(field("version", `v${s.version}`));
		lines.push(field("updated", timeAgo(s.updated_at)));
		lines.push("");
		lines.push(heading(theme, "description"));
		for (const l of wrap(s.description, Math.max(20, width - 2))) lines.push(theme.fg("text", l));
		lines.push("");
		lines.push(heading(theme, "skill body"));
		if (s.body) {
			for (const l of wrap(s.body, Math.max(20, width - 2))) lines.push(theme.fg("mdCodeBlock", l));
		} else {
			lines.push(theme.fg("dim", "· no body"));
		}
		lines.push("");
		lines.push(heading(theme, "versions"));
		const verStart = lines.length;
		versionWin.resync();
		if (detailVersions.length > 0) {
			detailVersions.forEach((v, i) =>
				lines.push(renderVersionRow(v, subMode === "versions" && i === versionWin.selected, width)),
			);
		} else if (detailLoading) {
			lines.push(...loadingState(theme, "versions"));
		} else {
			lines.push(theme.fg("dim", "· no versions yet"));
		}
		lines.push("");
		lines.push(
			theme.fg(
				"dim",
				subMode === "versions"
					? "b rollback to the selected version · x retire · esc back"
					: "tab versions · esc back",
			),
		);
		// One window over the whole block; in versions mode keep the selected
		// version row inside it.
		const view = Math.max(1, viewport);
		if (subMode === "versions" && detailVersions.length > 0) {
			const selRow = verStart + versionWin.selected;
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
				return subMode === "versions"
					? [
							["b", "rollback"],
							["x", "retire"],
							["tab", "body"],
							["esc", "back"],
					]
					: [
							["tab", "versions"],
							["esc", "back"],
					];
			}
			return [
				["enter", "skill"],
				["j/k", "select"],
			];
		},

		handleKey(data: string): boolean {
			if (mode === "detail") {
				if (matchesKey(data, "escape")) {
					mode = "list";
					return true;
				}
				if (matchesKey(data, "tab")) {
					subMode = subMode === "body" ? "versions" : "body";
					return true;
				}
				if (subMode === "versions") {
					if (matchesKey(data, "j") || matchesKey(data, "down")) return versionWin.move(1);
					if (matchesKey(data, "k") || matchesKey(data, "up")) return versionWin.move(-1);
					if (matchesKey(data, "g")) return versionWin.home();
					if (matchesKey(data, "shift+g")) return versionWin.end();
					if (matchesKey(data, "pageDown")) return versionWin.page(1);
					if (matchesKey(data, "pageUp")) return versionWin.page(-1);
					if (matchesKey(data, "b")) {
						const v = detailVersions[versionWin.selected];
						const s = detailSkill;
						if (!v || !s) return false;
						confirm(`rollback skill to v${v.version}?`, () => {
							void store
								.rollbackSkill(s.id, v.version)
								.then((r) =>
									toast(
										r.ok ? `skill rolled back to v${v.version}` : "rollback failed",
										r.ok ? "emerald" : "rose",
									),
								)
								.catch((e) => toast((e as Error).message, "rose"));
						});
						return true;
					}
					if (matchesKey(data, "x")) {
						const s = detailSkill;
						if (!s) return false;
						confirm(
							`retire this skill? the engine deletes ${s.project_path}/.unown/skills/${s.name}/ — this is the only place it ever deletes files`,
							() => {
								void store
									.retireSkill(s.id)
									.then((r) => toast(r.ok ? "skill retired" : "retire failed", r.ok ? "emerald" : "rose"))
									.catch((e) => toast((e as Error).message, "rose"));
							},
						);
						return true;
					}
					return false;
				}
				// body sub-mode: scroll the whole detail block.
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
				const s = skills()[win.selected];
				if (s) {
					mode = "detail";
					subMode = "body";
					detailSkill = null;
					detailVersions = [];
					detailError = null;
					detailLoading = true;
					detailScroll = 0;
					versionWin.selected = 0;
					versionWin.scroll = 0;
					void store
						.skillDetail(s.id)
						.then((d) => {
							detailSkill = d.skill;
							detailVersions = d.versions;
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
