/**
 * screens/automations-screen.ts — scheduled unattended runs (the zcode port's
 * dashboard surface): lifecycle cards with cron hints + next-fire, a scrollable
 * detail with the run history (output/error receipts), and the create wizard
 * (title → prompt → schedule → mode → model → confirm).
 *
 * Schedule semantics mirror the engine exactly: a 5-field LOCAL cron string
 * (body `cron`) or a one-shot `+Nm` parsed to body `delayMinutes` (1..525600)
 * — never both (planSchedule rejects the pair). `space` toggles lifecycle
 * active⇄paused (completed/failed are terminal); manual runs never consume
 * maxRuns. Standard mode is the deliberate, highlighted choice — the trust
 * story lives in automations.ts and is not relaxed here.
 */

import { matchesKey } from "@earendil-works/pi-tui";
import type { Automation, AutomationRun, AutomationsResponse } from "../dashboard-types.ts";
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
	InlineInput,
	loadingState,
	statusTone,
	timeAgo,
	toneToken,
	trunc,
	wrap,
} from "../widgets/bits.ts";

/** Rows the heading, more-line and age stamp occupy above the cards. */
const FIXED_ROWS = 3;

/** The create wizard (inline step machine, no overlay). */
interface CreateForm {
	/** 0 title · 1 prompt · 2 schedule · 3 mode · 4 model · 5 confirm. */
	step: number;
	title: InlineInput;
	prompt: InlineInput;
	schedule: InlineInput;
	model: InlineInput;
	/** 0 read-only · 1 standard (the deliberate choice). */
	modeIdx: number;
}

type SchedulePlan = { kind: "cron"; value: string } | { kind: "delay"; minutes: number };

/** `+90m` → one-shot delay minutes; anything else must be a 5-field cron. */
function parseSchedule(text: string): { ok: true; plan: SchedulePlan } | { ok: false; error: string } {
	const t = text.trim();
	if (!t) return { ok: false, error: "enter a cron expression or +Nm" };
	if (t.startsWith("+")) {
		const n = Number(t.slice(1).replace(/m$/i, ""));
		if (!Number.isFinite(n) || n < 1 || n > 525_600) return { ok: false, error: "delay must be +1..+525600 minutes" };
		return { ok: true, plan: { kind: "delay", minutes: Math.round(n) } };
	}
	if (t.split(/\s+/).length !== 5)
		return { ok: false, error: "cron needs 5 fields (minute hour day-of-month month day-of-week)" };
	return { ok: true, plan: { kind: "cron", value: t } };
}

/** Future-facing timeAgo twin: "in 90m", "in 2h", "due" when past. */
function inAbout(ms: number): string {
	if (ms <= 0) return "due";
	const s = Math.floor(ms / 1000);
	if (s < 90) return `in ${s}s`;
	const m = Math.floor(s / 60);
	if (m < 90) return `in ${m}m`;
	const h = Math.floor(m / 60);
	if (h < 48) return `in ${h}h`;
	return `in ${Math.round(h / 24)}d`;
}

export function createAutomationsScreen(deps: ScreenDeps): Screen {
	const { store, theme, toast, requestRender, confirm } = deps;
	let viewport = 24;
	let mode: "list" | "detail" = "list";
	let detailId: string | null = null;
	let detailScroll = 0;
	let runs: AutomationRun[] | null = null;
	let runsLoading = false;
	let runsError: string | null = null;
	let form: CreateForm | null = null;

	const snap = () => store.snapshot<AutomationsResponse>("automations");
	const automations = (): Automation[] => snap().data?.automations ?? [];
	const win: SelectionWindow = new Window(
		() => automations().length,
		() => Math.max(1, viewport - FIXED_ROWS),
	);

	function current(): Automation | null {
		const list = automations();
		if (mode === "detail" && detailId) return list.find((a) => a.id === detailId) ?? null;
		return list[win.selected] ?? null;
	}

	/** The card's schedule chip: `cron <human hint>` or `one-shot in Xm`. */
	function scheduleChip(a: Automation): string {
		if (a.cron_expr) {
			return `${theme.fg("muted", "cron ")}${theme.fg("dim", a.schedule || a.cron_expr)}`;
		}
		if (typeof a.delay_ms === "number") {
			return theme.fg("dim", `one-shot ${inAbout(a.delay_ms - Date.now())}`);
		}
		return theme.fg("dim", "one-shot");
	}

	function runsChip(a: Automation): string {
		const max = typeof a.max_runs === "number" ? `/${a.max_runs}` : "";
		return theme.fg("dim", `${a.run_count ?? 0}${max} runs`);
	}

	// ---- rendering ----------------------------------------------------------

	function renderRow(a: Automation, selected: boolean, width: number): string {
		const cursor = selected ? theme.fg("accent", "▸ ") : "  ";
		const dot =
			a.lifecycle === "active"
				? theme.fg("success", "●")
				: a.lifecycle === "paused"
					? theme.fg("warning", "⏸")
					: a.lifecycle === "failed"
						? theme.fg("muted", "○")
						: theme.fg("muted", "●");
		const title = theme.fg(selected ? "text" : "muted", trunc(a.title ?? a.id, 26));
		const life = theme.fg(
			toneToken(a.lifecycle === "active" ? "emerald" : a.lifecycle === "paused" ? "amber" : "dim"),
			a.lifecycle ?? "?",
		);
		const modeTxt = a.mode === "standard" ? badge(theme, "standard", "amber") : theme.fg("dim", "read-only");
		const next = theme.fg(
			"dim",
			typeof a.next_run_at === "number" ? `next ${inAbout(a.next_run_at - Date.now())}` : "—",
		);
		return trunc(
			`${cursor}${dot} ${title} ${theme.fg("dim", "·")} ${life} ${theme.fg("dim", "·")} ${modeTxt} ` +
				`${theme.fg("dim", "·")} ${scheduleChip(a)} ${theme.fg("dim", "·")} ${runsChip(a)} ${theme.fg("dim", "·")} ${next}`,
			width,
		);
	}

	function renderList(width: number): string[] {
		const s = snap();
		const lines: string[] = [];
		if (s.error && !s.data) {
			lines.push(...errorState(theme, s.error, width));
			lines.push("");
		}
		const list = automations();
		lines.push(heading(theme, `automations${s.data ? ` (${list.length})` : ""}`));
		if (s.data && list.length === 0) {
			lines.push(
				...emptyState(
					theme,
					"no automations yet",
					"a creates one (title, prompt, cron or +Nm, mode) · `unown automations create` works too",
					width,
				),
			);
		} else if (s.data) {
			win.resync();
			const view = Math.max(1, viewport - FIXED_ROWS);
			const slice = list.slice(win.scroll, win.scroll + view);
			slice.forEach((a, i) => {
				lines.push(renderRow(a, win.scroll + i === win.selected, width));
			});
			const more = list.length - view - win.scroll;
			if (more > 0) lines.push(theme.fg("dim", `  … ${more} more (j/k, PgDn)`));
		} else if (!s.error) {
			lines.push(...loadingState(theme, "automations"));
		}
		if (s.ageMs !== null) lines.push(theme.fg("dim", `  data ${ageStamp(theme, s.ageMs)}`));
		return lines;
	}

	function renderRunRow(r: AutomationRun, width: number): string[] {
		const status = theme.fg(toneToken(statusTone(r.status ?? "skipped")), `${runGlyph(r.status)} ${r.status ?? "?"}`);
		const trig = theme.fg("dim", r.trigger_kind ?? "?");
		const dur = theme.fg("dim", r.ended_at ? formatDuration(r.ended_at - r.started_at) : "running");
		const turns = theme.fg("dim", `${r.turns ?? 0} turns`);
		const tok = theme.fg("dim", `${formatTokens((r.tokens_in ?? 0) + (r.tokens_out ?? 0))} tok`);
		const when = theme.fg("dim", timeAgo(r.started_at));
		const lines = [
			trunc(
				`  ${status} ${theme.fg("dim", "·")} ${trig} ${theme.fg("dim", "·")} ${dur} ${theme.fg("dim", "·")} ` +
					`${turns} ${theme.fg("dim", "·")} ${tok} ${theme.fg("dim", "·")} ${when}`,
				width,
			),
		];
		if (r.error) lines.push(theme.fg("error", trunc(`    ${r.error}`, width)));
		if (r.output) {
			for (const l of wrap(String(r.output), Math.max(20, width - 6)).slice(0, 2)) {
				lines.push(theme.fg("dim", `    ${l}`));
			}
		}
		return lines;
	}

	function renderDetail(width: number): string[] {
		const a = automations().find((x) => x.id === detailId) ?? null;
		if (!a) return [theme.fg("dim", "automation deleted · esc back")];
		const lines: string[] = [];
		const field = (label: string, value: string) =>
			`${theme.fg("muted", label.padEnd(9))} ${theme.fg("text", value)}`;
		lines.push(heading(theme, `automation · ${trunc(a.title ?? a.id, 50)}`), "");
		lines.push(field("title", a.title ?? a.id));
		lines.push(field("lifecycle", a.lifecycle ?? "?"));
		lines.push(
			field(
				"mode",
				a.mode === "standard"
					? theme.fg("warning", "standard (full toolset)")
					: theme.fg("text", "read-only (no shell, no writes)"),
			),
		);
		lines.push(field("model", a.model || "engine default"));
		lines.push(field("workspace", trunc(a.workspace ?? "—", Math.max(20, width - 12))));
		lines.push(
			field(
				"schedule",
				a.cron_expr
					? `${a.cron_expr}${a.schedule ? ` · ${a.schedule}` : ""}`
					: typeof a.delay_ms === "number"
						? `one-shot ${inAbout(a.delay_ms - Date.now())} · fires once, then completes`
						: "one-shot",
			),
		);
		lines.push(
			field(
				"runs",
				`${a.run_count ?? 0} total · ${a.scheduled_run_count ?? 0} scheduled · max ${typeof a.max_runs === "number" ? a.max_runs : "∞"}`,
			),
		);
		lines.push(field("next", typeof a.next_run_at === "number" ? inAbout(a.next_run_at - Date.now()) : "—"));
		lines.push(field("last", timeAgo(a.last_run_at)));
		lines.push("");
		lines.push(heading(theme, "prompt"));
		for (const l of wrap(a.prompt ?? "", Math.max(20, width - 2)).slice(0, 20)) {
			lines.push(theme.fg("text", l));
		}
		lines.push("");
		lines.push(heading(theme, "runs"));
		if (runsError) {
			lines.push(...errorState(theme, runsError, width));
		} else if (runsLoading && !runs) {
			lines.push(...loadingState(theme, "runs"));
		} else if (!runs || runs.length === 0) {
			lines.push(
				...emptyState(
					theme,
					"no runs recorded yet",
					"n triggers one now (manual runs never consume maxRuns)",
					width,
				),
			);
		} else {
			for (const r of runs) lines.push(...renderRunRow(r, width));
		}
		lines.push("");
		lines.push(theme.fg("dim", "esc back · j/k scroll · space pause/resume · n run now · x delete"));
		const view = Math.max(1, viewport);
		const max = Math.max(0, lines.length - view);
		if (detailScroll > max) detailScroll = max;
		if (detailScroll < 0) detailScroll = 0;
		return lines.slice(detailScroll, detailScroll + view);
	}

	function renderForm(width: number): string[] {
		const f = form;
		if (!f) return renderList(width);
		const lines: string[] = [];
		const dimField = (label: string, value: string) => `${theme.fg("muted", label)} ${theme.fg("dim", value)}`;
		if (f.step === 0) {
			lines.push(heading(theme, "new automation · title"), "");
			lines.push(f.title.renderField(theme, "title", width));
			lines.push(theme.fg("dim", '  a short title, e.g. "weekday 9am dev brief"'));
			return lines;
		}
		if (f.step === 1) {
			lines.push(heading(theme, "new automation · prompt"), "");
			lines.push(dimField("title", trunc(f.title.text, 60)));
			lines.push("");
			lines.push(f.prompt.renderField(theme, "prompt", width));
			lines.push(theme.fg("dim", "  the unattended task — nobody answers questions mid-run; state the deliverable"));
			return lines;
		}
		if (f.step === 2) {
			lines.push(heading(theme, "new automation · schedule"), "");
			lines.push(dimField("title", trunc(f.title.text, 60)));
			lines.push("");
			lines.push(f.schedule.renderField(theme, "schedule", width));
			lines.push(theme.fg("dim", '  cron expression (e.g. "0 9 * * 1") OR "+90m" for a one-shot in 90 minutes'));
			return lines;
		}
		if (f.step === 3) {
			lines.push(heading(theme, "new automation · mode"), "");
			lines.push(dimField("title", trunc(f.title.text, 60)));
			lines.push(dimField("schedule", f.schedule.text.trim()));
			lines.push("");
			const options: [string, string][] = [
				["read-only", "read, grep, find, ls, lsp + web reads — no shell, no writes (recommended)"],
				["standard", "the full session toolset — choose deliberately"],
			];
			options.forEach(([name, desc], i) => {
				const sel = i === f.modeIdx;
				const cursor = sel ? theme.fg("accent", "▸ ") : "  ";
				lines.push(
					trunc(`${cursor}${theme.fg(sel ? "text" : "muted", name.padEnd(10))} ${theme.fg("dim", desc)}`, width),
				);
			});
			return lines;
		}
		if (f.step === 4) {
			lines.push(heading(theme, "new automation · model"), "");
			lines.push(dimField("title", trunc(f.title.text, 60)));
			lines.push("");
			lines.push(f.model.renderField(theme, "model", width));
			lines.push(theme.fg("dim", "  optional — empty uses the engine's default model"));
			return lines;
		}
		// step 5 — confirm
		const plan = parseSchedule(f.schedule.text);
		lines.push(heading(theme, "new automation · confirm"), "");
		lines.push(`${theme.fg("muted", "title ")}${theme.fg("text", trunc(f.title.text.trim(), 60))}`);
		lines.push(`${theme.fg("muted", "prompt ")}${theme.fg("dim", trunc(f.prompt.text.trim() || "(empty)", 70))}`);
		lines.push(
			`${theme.fg("muted", "schedule ")}${
				plan.ok
					? theme.fg(
							"text",
							plan.plan.kind === "cron" ? `cron ${plan.plan.value}` : `one-shot in ${plan.plan.minutes}m`,
						)
					: theme.fg("error", "(invalid — re-enter on esc restart)")
			}`,
		);
		lines.push(
			`${theme.fg("muted", "mode ")}${theme.fg(f.modeIdx === 1 ? "warning" : "text", f.modeIdx === 1 ? "standard" : "read-only")}`,
		);
		lines.push(
			`${theme.fg("muted", "model ")}${f.model.text.trim() ? theme.fg("text", f.model.text.trim()) : theme.fg("dim", "engine default")}`,
		);
		lines.push(
			theme.fg(
				"dim",
				"  workspace defaults to the engine process cwd (`unown automations create --workspace` targets a project)",
			),
		);
		lines.push("");
		lines.push(theme.fg("dim", "y create · esc cancel"));
		return lines;
	}

	// ---- actions ------------------------------------------------------------

	function openDetail(a: Automation): void {
		mode = "detail";
		detailId = a.id;
		detailScroll = 0;
		runs = null;
		runsError = null;
		runsLoading = true;
		const id = a.id;
		void store
			.automationRuns(id)
			.then((r) => {
				if (detailId === id) runs = r;
			})
			.catch((e) => {
				if (detailId === id) runsError = (e as Error).message;
			})
			.finally(() => {
				runsLoading = false;
				requestRender();
			});
	}

	function submitCreateForm(): void {
		const f = form;
		if (!f) return;
		const title = f.title.text.trim();
		const prompt = f.prompt.text.trim();
		if (!title) {
			toast("title required", "amber");
			f.step = 0;
			return;
		}
		if (!prompt) {
			toast("prompt required (the unattended task to run)", "amber");
			f.step = 1;
			return;
		}
		const plan = parseSchedule(f.schedule.text);
		if (!plan.ok) {
			toast(plan.error, "amber");
			f.step = 2;
			return;
		}
		const body: Record<string, unknown> = {
			title,
			prompt,
			mode: f.modeIdx === 1 ? "standard" : "read-only",
			model: f.model.text.trim() || null,
		};
		if (plan.plan.kind === "cron") body.cron = plan.plan.value;
		else body.delayMinutes = plan.plan.minutes;
		void store
			.createAutomation(body)
			.then(() => {
				toast("automation created", "emerald");
				if (form === f) form = null;
			})
			.catch((e) => toast((e as Error).message, "rose"))
			.finally(() => requestRender());
	}

	function handleFormKey(data: string): boolean {
		const f = form;
		if (!f) return false;
		if (matchesKey(data, "escape")) {
			form = null;
			return true;
		}
		if (f.step === 3) {
			if (matchesKey(data, "j") || matchesKey(data, "down")) {
				f.modeIdx = (f.modeIdx + 1) % 2;
				return true;
			}
			if (matchesKey(data, "k") || matchesKey(data, "up")) {
				f.modeIdx = (f.modeIdx + 1) % 2;
				return true;
			}
		}
		if (f.step === 5) {
			if (matchesKey(data, "y")) submitCreateForm();
			return true;
		}
		if (matchesKey(data, "enter")) {
			if (f.step === 0 && !f.title.text.trim()) {
				toast("title required", "amber");
				return true;
			}
			if (f.step === 1 && !f.prompt.text.trim()) {
				toast("prompt required", "amber");
				return true;
			}
			if (f.step === 2) {
				const plan = parseSchedule(f.schedule.text);
				if (!plan.ok) {
					toast(plan.error, "amber");
					return true;
				}
			}
			f.step += 1;
			return true;
		}
		const input =
			f.step === 0 ? f.title : f.step === 1 ? f.prompt : f.step === 2 ? f.schedule : f.step === 4 ? f.model : null;
		if (input) input.insert(data);
		return true;
	}

	// ---- the screen ---------------------------------------------------------

	const screen: Screen = {
		render(width: number): string[] {
			if (form) return renderForm(width);
			if (mode === "detail") return renderDetail(width);
			return renderList(width);
		},

		invalidate(): void {
			requestRender();
		},

		setViewport(height: number): void {
			viewport = height;
		},

		footerHints(): [string, string][] {
			if (form) {
				switch (form.step) {
					case 3:
						return [
							["esc", "cancel"],
							["j/k", "mode"],
							["enter", "next"],
						];
					case 5:
						return [
							["esc", "cancel"],
							["y", "create"],
						];
					default:
						return [
							["esc", "cancel"],
							["enter", "next"],
						];
				}
			}
			if (mode === "detail") {
				return [
					["esc", "back"],
					["space", "pause/resume"],
					["n", "run now"],
					["x", "delete"],
				];
			}
			return [
				["a", "new"],
				["enter", "open"],
				["space", "pause/resume"],
				["n", "run now"],
				["x", "delete"],
				["j/k", "select"],
			];
		},

		handleKey(data: string): boolean {
			// The create wizard owns j/k/enter/esc/y while it is open.
			if (form) return handleFormKey(data);

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
					detailScroll = Math.max(0, detailScroll - 1);
					return true;
				}
				if (matchesKey(data, "g")) {
					detailScroll = 0;
					return true;
				}
				if (matchesKey(data, "shift+g")) {
					detailScroll = 1 << 30; // clamped against the built lines at render
					return true;
				}
				if (matchesKey(data, "pageDown")) {
					detailScroll += Math.max(1, viewport - 1);
					return true;
				}
				if (matchesKey(data, "pageUp")) {
					detailScroll = Math.max(0, detailScroll - Math.max(1, viewport - 1));
					return true;
				}
			} else {
				if (matchesKey(data, "j") || matchesKey(data, "down")) return win.move(1);
				if (matchesKey(data, "k") || matchesKey(data, "up")) return win.move(-1);
				if (matchesKey(data, "g")) return win.home();
				if (matchesKey(data, "shift+g")) return win.end();
				if (matchesKey(data, "pageDown")) return win.page(1);
				if (matchesKey(data, "pageUp")) return win.page(-1);
				if (matchesKey(data, "enter")) {
					const a = automations()[win.selected];
					if (a) openDetail(a);
					return true;
				}
				if (matchesKey(data, "a")) {
					form = {
						step: 0,
						title: new InlineInput(80),
						prompt: new InlineInput(2000),
						schedule: new InlineInput(60),
						model: new InlineInput(120),
						modeIdx: 0,
					};
					return true;
				}
			}

			const a = current();
			if (!a) return false;

			if (matchesKey(data, "space")) {
				if (a.lifecycle !== "active" && a.lifecycle !== "paused") {
					toast(`a ${a.lifecycle} automation is terminal — create a new one (a)`, "amber");
					return true;
				}
				const next = a.lifecycle === "active" ? "paused" : "active";
				void store
					.patchAutomation(a.id, { lifecycle: next })
					// The engine answers PATCH with { automation } — resolution
					// itself is the success signal (see the report note).
					.then(() => toast(next === "paused" ? "paused" : "resumed", "zinc"))
					.catch((e) => toast((e as Error).message, "rose"));
				return true;
			}

			if (matchesKey(data, "n")) {
				void store
					.runAutomation(a.id)
					.then((r) =>
						toast(r.ok ? "automation run started" : (r.error ?? "run not started"), r.ok ? "emerald" : "rose"),
					)
					.catch((e) => toast((e as Error).message, "rose"));
				return true;
			}

			if (matchesKey(data, "x")) {
				const id = a.id;
				const title = a.title ?? a.id;
				confirm(`delete automation "${title}"? its run history goes with it`, () => {
					void store
						.deleteAutomation(id)
						.then((r) => {
							toast(r.ok ? "deleted" : "unknown automation", r.ok ? "zinc" : "rose");
							if (r.ok && detailId === id) {
								mode = "list";
								detailId = null;
							}
						})
						.catch((e) => toast((e as Error).message, "rose"));
				});
				return true;
			}

			return false;
		},
	};
	return screen;
}

/** Run-status glyph (repo vocabulary: ✓ ✗ ⟳ –). */
function runGlyph(status: string | null | undefined): string {
	switch (status) {
		case "succeeded":
			return "✓";
		case "failed":
			return "✗";
		case "running":
			return "⟳";
		default:
			return "–";
	}
}
