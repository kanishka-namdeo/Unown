/**
 * screens/automations-screen.ts — Routines: the recurring-task manager (the
 * zcode Automations screen grown the routines v2 semantics — the screen id
 * stays "automations" for deep-links; the title is the product name).
 *
 * The management surface (k9s discipline: a table of resources + keyboard
 * verbs), reverse-engineered from the best schedule managers:
 *
 *   - the LIST is ordered by next occurrence (Things' "Repeating" list) with
 *     paused and terminal routines sunk to the bottom — what runs next is
 *     what you see first
 *   - the DETAIL pane shows the full spec (kind, timezone, misfire policy,
 *     boundaries) plus a streak row: the last 10 runs as ✓/✗/– glyphs, the
 *     health signal habit trackers taught (skips are visible, never hidden)
 *   - the CREATE WIZARD accepts every schedule kind in one field with live
 *     hints: cron "0 9 * * 1-5" · "every 2d at 09:00" · "every 30m" ·
 *     "after 3d" (completion-anchored) · "+90m" (one-shot) · "on <event>"
 *     (M2: webhook-triggered, no clock slot)
 *   - keys: a new · enter open · space pause/resume · n run now · s skip the
 *     next occurrence · S snooze · e edit (field picker → inline input) ·
 *     x delete
 *
 * Schedule semantics mirror the engine exactly (routine-schedule.ts):
 * exactly one of cron/every/after/+Nm; `at HH:MM` only for day/week
 * intervals; timezones are IANA names (empty = engine-local); misfire is
 * skip | catch-up. Standard mode stays the deliberate, highlighted choice —
 * the trust story lives in automations.ts and is not relaxed here.
 */

import { matchesKey } from "@earendil-works/pi-tui";
import { describeHookFilter } from "../../hook-filter.ts";
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

// ---------------------------------------------------------------------------
// Schedule parsing — one input field, every kind (mirrors the engine's
// planSchedule; the wizard validates before submit and surfaces its errors)
// ---------------------------------------------------------------------------

type SchedulePlan =
	| { kind: "cron"; value: string }
	| { kind: "every"; value: string }
	| { kind: "after"; value: string }
	| { kind: "delay"; minutes: number }
	| { kind: "event"; value: string };

function parseSchedule(text: string): { ok: true; plan: SchedulePlan } | { ok: false; error: string } {
	const t = text.trim();
	if (!t) return { ok: false, error: "enter a cron expression, every/after interval, +Nm, or on <event>" };
	if (/^on\s+/i.test(t)) {
		// M2: an event routine — "on issue.opened". The engine's event-name
		// charset (lowercase dot/underscore/hyphen, 1..64) is the whole check.
		const name = t.replace(/^on\s+/i, "");
		if (!/^[a-z0-9._-]{1,64}$/.test(name)) {
			return { ok: false, error: 'event names are lowercase dot/underscore/hyphen tokens, e.g. "on issue.opened"' };
		}
		return { ok: true, plan: { kind: "event", value: name } };
	}
	if (t.startsWith("+")) {
		const n = Number(t.slice(1).replace(/m$/i, ""));
		if (!Number.isFinite(n) || n < 1 || n > 525_600) return { ok: false, error: "delay must be +1..+525600 minutes" };
		return { ok: true, plan: { kind: "delay", minutes: Math.round(n) } };
	}
	if (/^every\b/i.test(t)) {
		const spec = t.replace(/^every\s+/i, "");
		if (
			!/^\d+\s*(m|min|mins|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)(\s*(at|@)\s*[0-2]?\d:[0-5]\d)?$/i.test(spec)
		) {
			return { ok: false, error: 'interval looks like "every 30m", "every 2d", "every 2d at 09:00"' };
		}
		return { ok: true, plan: { kind: "every", value: spec } };
	}
	if (/^after\b/i.test(t)) {
		const spec = t.replace(/^after\s+/i, "");
		if (!/^\d+\s*(m|min|mins|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)$/i.test(spec)) {
			return { ok: false, error: 'completion-anchored looks like "after 45m" or "after 3d" (no "at")' };
		}
		return { ok: true, plan: { kind: "after", value: spec } };
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

/** The lifecycle sort key: active routines by next occurrence first, then
 *  paused, then terminal — Things' Repeating-list ordering. */
function routineSortKey(a: Automation): number {
	if (a.lifecycle === "active") return a.next_run_at ?? Number.MAX_SAFE_INTEGER - 1;
	if (a.lifecycle === "paused") return Number.MAX_SAFE_INTEGER - 1;
	return Number.MAX_SAFE_INTEGER;
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

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
	let edit: EditForm | null = null;
	let snooze: { input: InlineInput; id: string } | null = null;

	const snap = () => store.snapshot<AutomationsResponse>("automations");
	const automations = (): Automation[] =>
		(snap().data?.automations ?? []).slice().sort((x, y) => routineSortKey(x) - routineSortKey(y));
	const win: SelectionWindow = new Window(
		() => automations().length,
		() => Math.max(1, viewport - FIXED_ROWS),
	);

	function current(): Automation | null {
		const list = automations();
		if (mode === "detail" && detailId) return list.find((a) => a.id === detailId) ?? null;
		return list[win.selected] ?? null;
	}

	/** The card's schedule chip: the engine's human description. */
	function scheduleChip(a: Automation): string {
		if (a.schedule_kind === "event") {
			// `on <event>` first; the filter (described) trails, truncated
			// hard — the row is a scannable index, the detail pane carries
			// the full spec.
			const filter = a.event_filter ? ` · ${describeHookFilter(a.event_filter)}` : "";
			return theme.fg("dim", trunc(`on ${a.event_kind ?? "?"}${filter}`, 42));
		}
		if (a.schedule) return theme.fg("dim", a.schedule);
		if (a.cron_expr) return `${theme.fg("muted", "cron ")}${theme.fg("dim", a.cron_expr)}`;
		if (typeof a.delay_ms === "number") return theme.fg("dim", `one-shot ${inAbout(a.delay_ms - Date.now())}`);
		return theme.fg("dim", "one-shot");
	}

	function runsChip(a: Automation): string {
		const max = typeof a.max_runs === "number" ? `/${a.max_runs}` : "";
		return theme.fg("dim", `${a.run_count ?? 0}${max} runs`);
	}

	/** The streak row: last 10 runs as glyphs (habit-tracker health). */
	function streakRow(rs: AutomationRun[] | null): string {
		if (!rs || rs.length === 0) return theme.fg("dim", "no runs yet");
		const glyphs = rs
			.slice(0, 10)
			.reverse()
			.map((r) => {
				const g = runGlyph(r.status);
				const tone =
					r.status === "succeeded"
						? "success"
						: r.status === "failed"
							? "error"
							: r.status === "running"
								? "accent"
								: "dim";
				return theme.fg(tone, g);
			})
			.join(theme.fg("dim", " "));
		return `${theme.fg("muted", "last 10:")} ${glyphs}`;
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
		const title = theme.fg(selected ? "text" : "muted", trunc(a.title ?? a.id, 24));
		const life = theme.fg(
			toneToken(a.lifecycle === "active" ? "emerald" : a.lifecycle === "paused" ? "amber" : "dim"),
			a.lifecycle ?? "?",
		);
		const modeTxt = a.mode === "standard" ? badge(theme, "standard", "amber") : theme.fg("dim", "read-only");
		// M6: an armed retry chain outranks the schedule chips — it goes
		// before them so narrow terminals still surface the live state.
		const pendingRetry =
			typeof a.retry_next_at === "number" && a.retry_next_at !== null
				? ` ${theme.fg("dim", "·")} ${theme.fg("warning", `⟳ retry ${inAbout(a.retry_next_at - Date.now())}`)}`
				: "";
		const next = theme.fg(
			"dim",
			typeof a.next_run_at === "number" ? `next ${inAbout(a.next_run_at - Date.now())}` : "—",
		);
		return trunc(
			`${cursor}${dot} ${title} ${theme.fg("dim", "·")} ${life} ${theme.fg("dim", "·")} ${modeTxt}${pendingRetry} ` +
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
		lines.push(heading(theme, `routines${s.data ? ` (${list.length})` : ""}`));
		if (s.data && list.length === 0) {
			lines.push(
				...emptyState(
					theme,
					"no routines yet",
					'a creates one — "every 2d at 09:00", "after 3d", cron, or +90m · `unown routines create` works too',
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
			lines.push(...loadingState(theme, "routines"));
		}
		if (s.ageMs !== null) lines.push(theme.fg("dim", `  data ${ageStamp(theme, s.ageMs)}`));
		return lines;
	}

	function renderRunRow(r: AutomationRun, width: number): string[] {
		const status = theme.fg(toneToken(statusTone(r.status ?? "skipped")), `${runGlyph(r.status)} ${r.status ?? "?"}`);
		const trig = theme.fg(
			"dim",
			r.trigger_kind === "retry" && r.attempt ? `retry #${r.attempt}` : (r.trigger_kind ?? "?"),
		);
		const dur = theme.fg("dim", r.ended_at ? formatDuration(r.ended_at - r.started_at) : "running");
		const turns = theme.fg("dim", `${r.turns ?? 0} turns`);
		const tok = theme.fg("dim", `${formatTokens((r.tokens_in ?? 0) + (r.tokens_out ?? 0))} tok`);
		const when = theme.fg("dim", timeAgo(r.started_at));
		// M5: the delivery outcome rides the run row (sent / suppressed / failed).
		const delivered = r.delivered
			? theme.fg(
					r.delivered.startsWith("failed") ? "error" : "dim",
					` · ${r.delivered.startsWith("failed") ? `deliver ${r.delivered}` : r.delivered === "sent" ? "↗ delivered" : "∅ NO_REPLY"}`,
				)
			: "";
		const lines = [
			trunc(
				`  ${status} ${theme.fg("dim", "·")} ${trig} ${theme.fg("dim", "·")} ${dur} ${theme.fg("dim", "·")} ` +
					`${turns} ${theme.fg("dim", "·")} ${tok} ${theme.fg("dim", "·")} ${when}${delivered}`,
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
		if (!a) return [theme.fg("dim", "routine deleted · esc back")];
		const lines: string[] = [];
		const field = (label: string, value: string) =>
			`${theme.fg("muted", label.padEnd(9))} ${theme.fg("text", value)}`;
		lines.push(heading(theme, `routine · ${trunc(a.title ?? a.id, 50)}`), "");
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
		lines.push(field("schedule", a.schedule ?? a.cron_expr ?? "one-shot"));
		if (a.schedule_kind === "event") {
			// M2: the trigger spec + the last event runs (the runs list
			// below carries trigger_kind 'event' rows with their outcomes).
			lines.push(field("trigger", `event ${a.event_kind ?? "?"} (never from the clock)`));
			lines.push(field("filter", a.event_filter ? describeHookFilter(a.event_filter) : "— (any payload)"));
		}
		lines.push(field("timezone", a.timezone ?? "engine local"));
		lines.push(field("misfire", a.misfire ?? "skip (default)"));
		// M5 policies: the monitoring/delivery knobs (absent on old engines → "—").
		lines.push(field("hours", a.active_hours ?? "always"));
		lines.push(field("yield", a.idle_only ? "idle-only (skips while a human works)" : "—"));
		lines.push(
			field(
				"deliver",
				a.deliver_url
					? `${trunc(String(a.deliver_url).replace(/^[a-z]+:\/\//, ""), Math.max(20, width - 20))} · NO_REPLY suppresses`
					: "—",
			),
		);
		lines.push(field("jitter", a.jitter_secs ? `0..${a.jitter_secs}s on computed slots` : "—"));
		// M6: the failed-run retry policy + any armed chain (the
		// operationally-live state — a pending retry is why a "failed"
		// routine may still recover without intervention).
		lines.push(
			field(
				"retries",
				a.retry_max ? `${a.retry_max} on failure (first ${a.retry_backoff_secs ?? 300}s, doubling, cap 1h)` : "—",
			),
		);
		if (typeof a.retry_next_at === "number" && a.retry_next_at !== null) {
			const attemptNo = a.retry_attempt ?? 2;
			const recovers = a.retry_of_run ? ` · recovers ${String(a.retry_of_run).slice(0, 13)}` : "";
			lines.push(
				theme.fg(
					"warning",
					`${"pending".padEnd(9)} retry attempt ${attemptNo} ${inAbout(a.retry_next_at - Date.now())} (never consumes a slot)${recovers}`,
				),
			);
		}
		lines.push(
			field(
				"bounds",
				`max ${typeof a.max_runs === "number" ? a.max_runs : "∞"} scheduled runs` +
					(a.until_ms ? ` · until ${new Date(a.until_ms).toLocaleDateString()}` : ""),
			),
		);
		lines.push(field("runs", `${a.run_count ?? 0} total · ${a.scheduled_run_count ?? 0} scheduled`));
		lines.push(field("next", typeof a.next_run_at === "number" ? inAbout(a.next_run_at - Date.now()) : "—"));
		lines.push(field("last", timeAgo(a.last_run_at)));
		lines.push("", streakRow(runs), "");
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
		lines.push(
			theme.fg(
				"dim",
				"esc back · j/k scroll · space pause/resume · n run now · s skip next · S snooze · e edit · x delete",
			),
		);
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
			lines.push(heading(theme, "new routine · title"), "");
			lines.push(f.title.renderField(theme, "title", width));
			lines.push(theme.fg("dim", '  a short title, e.g. "weekday 9am dev brief"'));
			return lines;
		}
		if (f.step === 1) {
			lines.push(heading(theme, "new routine · prompt"), "");
			lines.push(dimField("title", trunc(f.title.text, 60)));
			lines.push("");
			lines.push(f.prompt.renderField(theme, "prompt", width));
			lines.push(theme.fg("dim", "  the unattended task — nobody answers questions mid-run; state the deliverable"));
			return lines;
		}
		if (f.step === 2) {
			lines.push(heading(theme, "new routine · schedule"), "");
			lines.push(dimField("title", trunc(f.title.text, 60)));
			lines.push("");
			lines.push(f.schedule.renderField(theme, "schedule", width));
			lines.push(
				theme.fg(
					"dim",
					'  cron "0 9 * * 1-5" · "every 30m" · "every 2d at 09:00" · "after 3d" (from completion) · "+90m" (one-shot) · "on <event>" (webhook-triggered)',
				),
			);
			return lines;
		}
		if (f.step === 3) {
			lines.push(heading(theme, "new routine · timezone"), "");
			lines.push(dimField("title", trunc(f.title.text, 60)));
			lines.push("");
			lines.push(f.timezone.renderField(theme, "timezone", width));
			lines.push(
				theme.fg("dim", '  optional IANA name, e.g. "America/New_York" — empty follows the engine\'s local clock'),
			);
			return lines;
		}
		if (f.step === 4) {
			lines.push(heading(theme, "new routine · missed runs"), "");
			lines.push(dimField("title", trunc(f.title.text, 60)));
			lines.push("");
			const options: [string, string][] = [
				["skip", "a slot missed while asleep/engine-down is recorded and skipped (cron-classic)"],
				["catch-up", "a missed slot under 24h old runs ONCE on wake (launchd-style)"],
			];
			options.forEach(([name, desc], i) => {
				const sel = i === f.misfireIdx;
				const cursor = sel ? theme.fg("accent", "▸ ") : "  ";
				lines.push(
					trunc(`${cursor}${theme.fg(sel ? "text" : "muted", name.padEnd(10))} ${theme.fg("dim", desc)}`, width),
				);
			});
			return lines;
		}
		if (f.step === 5) {
			lines.push(heading(theme, "new routine · mode"), "");
			lines.push(dimField("title", trunc(f.title.text, 60)));
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
		if (f.step === 6) {
			lines.push(heading(theme, "new routine · model"), "");
			lines.push(dimField("title", trunc(f.title.text, 60)));
			lines.push("");
			lines.push(f.model.renderField(theme, "model", width));
			lines.push(theme.fg("dim", "  optional — empty uses the engine's default model"));
			return lines;
		}
		if (f.step === 7) {
			lines.push(heading(theme, "new routine · retries"), "");
			lines.push(dimField("title", trunc(f.title.text, 60)));
			lines.push("");
			lines.push(f.retries.renderField(theme, "retries", width));
			lines.push(
				theme.fg("dim", '  "3" re-runs a failed occurrence up to 3 times · "3 900" sets the first backoff to 900s'),
			);
			lines.push(
				theme.fg(
					"dim",
					"  (doubling per attempt, cap 1h) · empty = off (default — unattended retries spend tokens)",
				),
			);
			return lines;
		}
		// step 8 — confirm
		const plan = parseSchedule(f.schedule.text);
		const tz = f.timezone.text.trim();
		lines.push(heading(theme, "new routine · confirm"), "");
		lines.push(`${theme.fg("muted", "title ")}${theme.fg("text", trunc(f.title.text.trim(), 60))}`);
		lines.push(`${theme.fg("muted", "prompt ")}${theme.fg("dim", trunc(f.prompt.text.trim() || "(empty)", 70))}`);
		lines.push(
			`${theme.fg("muted", "schedule ")}${
				plan.ok
					? theme.fg(
							"text",
							plan.plan.kind === "cron"
								? `cron ${plan.plan.value}`
								: plan.plan.kind === "every"
									? `every ${plan.plan.value}`
									: plan.plan.kind === "after"
										? `after ${plan.plan.value} (from completion)`
										: plan.plan.kind === "event"
											? `on ${plan.plan.value} (fires when the event arrives)`
											: `one-shot in ${plan.plan.minutes}m`,
						)
					: theme.fg("error", "(invalid — esc and re-enter)")
			}`,
		);
		lines.push(`${theme.fg("muted", "timezone ")}${tz ? theme.fg("text", tz) : theme.fg("dim", "engine local")}`);
		lines.push(`${theme.fg("muted", "misfire ")}${theme.fg("text", f.misfireIdx === 1 ? "catch-up" : "skip")}`);
		lines.push(
			`${theme.fg("muted", "mode ")}${theme.fg(f.modeIdx === 1 ? "warning" : "text", f.modeIdx === 1 ? "standard" : "read-only")}`,
		);
		lines.push(
			`${theme.fg("muted", "model ")}${f.model.text.trim() ? theme.fg("text", f.model.text.trim()) : theme.fg("dim", "engine default")}`,
		);
		const retryPlan = parseRetrySpec(f.retries.text);
		lines.push(
			`${theme.fg("muted", "retries ")}${
				retryPlan.ok && retryPlan.retryMax
					? theme.fg(
							"text",
							`${retryPlan.retryMax} on failure · first backoff ${retryPlan.retryBackoffSecs ?? 300}s (doubling, cap 1h)`,
						)
					: theme.fg("dim", "off")
			}`,
		);
		lines.push(
			theme.fg(
				"dim",
				"  workspace defaults to the engine process cwd (`unown routines create --workspace` targets a project)",
			),
		);
		lines.push("");
		lines.push(theme.fg("dim", "y create · esc cancel"));
		return lines;
	}

	function renderEdit(width: number): string[] {
		const f = edit;
		if (!f) return renderList(width);
		const a = automations().find((x) => x.id === f.id);
		if (!a) return [theme.fg("dim", "routine deleted · esc back")];
		const lines: string[] = [];
		lines.push(heading(theme, `edit routine · ${trunc(a.title ?? a.id, 40)}`), "");
		if (f.field === null) {
			const fields: string[] = [
				"title",
				"prompt",
				"schedule",
				"timezone",
				"misfire",
				"mode",
				"model",
				"until",
				"max runs",
				"retries",
			];
			fields.forEach((name, i) => {
				const sel = i === f.pickIdx;
				const cursor = sel ? theme.fg("accent", "▸ ") : "  ";
				lines.push(trunc(`${cursor}${theme.fg(sel ? "text" : "muted", name)}`, width));
			});
			lines.push("");
			lines.push(
				theme.fg("dim", "  enter edits the field · esc back (schedule edits re-arm the next run from now)"),
			);
			return lines;
		}
		if (f.field === "misfire" || f.field === "mode") {
			const options: [string, string][] =
				f.field === "misfire"
					? [
							["skip", "record and skip missed slots"],
							["catch-up", "run a missed slot once on wake (under 24h)"],
						]
					: [
							["read-only", "no shell, no writes (recommended)"],
							["standard", "the full session toolset"],
						];
			lines.push(heading(theme, `edit · ${f.field}`), "");
			options.forEach(([name, desc], i) => {
				const sel = i === f.pickIdx;
				const cursor = sel ? theme.fg("accent", "▸ ") : "  ";
				lines.push(
					trunc(`${cursor}${theme.fg(sel ? "text" : "muted", name.padEnd(10))} ${theme.fg("dim", desc)}`, width),
				);
			});
			lines.push("");
			lines.push(theme.fg("dim", "enter applies · esc back"));
			return lines;
		}
		lines.push(heading(theme, `edit · ${f.field}`), "");
		lines.push(f.input.renderField(theme, f.field, width));
		const hints: Record<string, string> = {
			title: "the display name",
			prompt: "the unattended task (state the deliverable)",
			schedule: 'cron · "every 2d at 09:00" · "every 30m" · "after 3d" · "+90m" — re-arms from now',
			timezone: 'IANA name, e.g. "Europe/Berlin" — empty = engine local',
			model: "empty = engine default",
			until: '"YYYY-MM-DD" or "YYYY-MM-DD HH:MM" — empty clears the boundary',
			"max runs": "a number, or empty for no cap",
			retries: '"3" or "3 900" (max · first backoff secs) — empty CLEARS the policy and disarms a pending retry',
		};
		if (hints[f.field]) lines.push(theme.fg("dim", `  ${hints[f.field]}`));
		lines.push("");
		lines.push(theme.fg("dim", "enter applies · esc back"));
		return lines;
	}

	function renderSnooze(width: number): string[] {
		if (!snooze) return renderList(width);
		const lines: string[] = [];
		lines.push(heading(theme, "snooze next occurrence"), "");
		lines.push(snooze.input.renderField(theme, "minutes", width));
		lines.push(
			theme.fg("dim", "  push the next run out by N minutes (1..525600) — the history keeps the original slot"),
		);
		lines.push("");
		lines.push(theme.fg("dim", "enter snoozes · esc cancels"));
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
		const tz = f.timezone.text.trim();
		if (tz && !isValidTz(tz)) {
			toast(`unknown timezone "${tz}" (IANA names, e.g. America/New_York)`, "amber");
			f.step = 3;
			return;
		}
		const retry = parseRetrySpec(f.retries.text);
		if (!retry.ok) {
			toast(retry.error, "amber");
			f.step = 7;
			return;
		}
		const body: Record<string, unknown> = {
			title,
			prompt,
			mode: f.modeIdx === 1 ? "standard" : "read-only",
			model: f.model.text.trim() || null,
			timezone: tz || null,
			misfire: f.misfireIdx === 1 ? "catch-up" : "skip",
		};
		if (retry.retryMax !== null) {
			body.retryMax = retry.retryMax;
			if (retry.retryBackoffSecs !== null) body.retryBackoffSecs = retry.retryBackoffSecs;
		}
		if (plan.plan.kind === "cron") body.cron = plan.plan.value;
		else if (plan.plan.kind === "every") body.every = plan.plan.value;
		else if (plan.plan.kind === "after") body.after = plan.plan.value;
		else if (plan.plan.kind === "event") body.event = plan.plan.value;
		else body.delayMinutes = plan.plan.minutes;
		void store
			.createAutomation(body)
			.then(() => {
				toast("routine created", "emerald");
				if (form === f) form = null;
			})
			.catch((e) => toast((e as Error).message, "rose"))
			.finally(() => requestRender());
	}

	function submitEdit(): void {
		const f = edit;
		if (!f || f.field === null) return;
		const apply = (patch: Record<string, unknown>) =>
			void store
				.patchAutomation(f.id, patch)
				.then(() => {
					toast("routine updated", "emerald");
					if (edit === f) edit = null;
				})
				.catch((e) => toast((e as Error).message, "rose"))
				.finally(() => requestRender());
		switch (f.field) {
			case "title": {
				if (!f.input.text.trim()) return void toast("title cannot be empty", "amber");
				apply({ title: f.input.text.trim() });
				return;
			}
			case "prompt": {
				if (!f.input.text.trim()) return void toast("prompt cannot be empty", "amber");
				apply({ prompt: f.input.text.trim() });
				return;
			}
			case "schedule": {
				const plan = parseSchedule(f.input.text);
				if (!plan.ok) return void toast(plan.error, "amber");
				if (plan.plan.kind === "event") {
					// The engine refuses schedule edits on event rows (delete +
					// recreate keeps the trigger spec honest); same answer here.
					return void toast(
						"an event routine's trigger cannot be edited in place — delete and recreate it",
						"amber",
					);
				}
				const patch: Record<string, unknown> = {};
				if (plan.plan.kind === "cron") patch.cron = plan.plan.value;
				else if (plan.plan.kind === "every") patch.every = plan.plan.value;
				else if (plan.plan.kind === "after") patch.after = plan.plan.value;
				else patch.delayMinutes = plan.plan.minutes;
				apply(patch);
				return;
			}
			case "timezone": {
				const tz = f.input.text.trim();
				if (tz && !isValidTz(tz)) return void toast(`unknown timezone "${tz}"`, "amber");
				apply({ timezone: tz || null });
				return;
			}
			case "model":
				apply({ model: f.input.text.trim() || null });
				return;
			case "until": {
				const raw = f.input.text.trim();
				if (raw === "") return void apply({ until: null });
				const ms = Date.parse(
					raw.includes("T") || /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw : `${raw.replace(" ", "T")}`,
				);
				if (!Number.isFinite(ms)) return void toast('until needs "YYYY-MM-DD" or "YYYY-MM-DD HH:MM"', "amber");
				apply({ until: ms });
				return;
			}
			case "max runs": {
				const raw = f.input.text.trim();
				if (raw === "") return void apply({ maxRuns: null });
				const n = Number(raw);
				if (!Number.isInteger(n) || n < 1)
					return void toast("max runs needs a positive integer (or empty)", "amber");
				apply({ maxRuns: n });
				return;
			}
			case "retries": {
				const parsed = parseRetrySpec(f.input.text);
				if (!parsed.ok) return void toast(parsed.error, "amber");
				if (parsed.retryMax === null) {
					// Empty = CLEAR — the deliberate delete of the policy
					// (also disarms a pending retry chain engine-side).
					apply({ retryMax: null });
					return;
				}
				const patch: Record<string, unknown> = { retryMax: parsed.retryMax };
				if (parsed.retryBackoffSecs !== null) patch.retryBackoffSecs = parsed.retryBackoffSecs;
				apply(patch);
				return;
			}
		}
	}

	function isValidTz(tz: string): boolean {
		try {
			new Intl.DateTimeFormat("en-US", { timeZone: tz });
			return true;
		} catch {
			return false;
		}
	}

	function handleFormKey(data: string): boolean {
		const f = form;
		if (!f) return false;
		if (matchesKey(data, "escape")) {
			form = null;
			return true;
		}
		if (f.step === 4 || f.step === 5) {
			if (matchesKey(data, "j") || matchesKey(data, "down")) {
				if (f.step === 4) f.misfireIdx = (f.misfireIdx + 1) % 2;
				else f.modeIdx = (f.modeIdx + 1) % 2;
				return true;
			}
			if (matchesKey(data, "k") || matchesKey(data, "up")) {
				if (f.step === 4) f.misfireIdx = (f.misfireIdx + 1) % 2;
				else f.modeIdx = (f.modeIdx + 1) % 2;
				return true;
			}
		}
		if (f.step === 8) {
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
			if (f.step === 3) {
				const tz = f.timezone.text.trim();
				if (tz && !isValidTz(tz)) {
					toast(`unknown timezone "${tz}"`, "amber");
					return true;
				}
			}
			if (f.step === 7) {
				const retry = parseRetrySpec(f.retries.text);
				if (!retry.ok) {
					toast(retry.error, "amber");
					return true;
				}
			}
			f.step += 1;
			return true;
		}
		const input =
			f.step === 0
				? f.title
				: f.step === 1
					? f.prompt
					: f.step === 2
						? f.schedule
						: f.step === 3
							? f.timezone
							: f.step === 6
								? f.model
								: f.step === 7
									? f.retries
									: null;
		if (input) input.insert(data);
		return true;
	}

	function handleEditKey(data: string): boolean {
		const f = edit;
		if (!f) return false;
		if (matchesKey(data, "escape")) {
			if (f.field === null) edit = null;
			else {
				f.field = null;
				f.pickIdx = 0;
			}
			return true;
		}
		if (f.field === null) {
			const fields = 10;
			if (matchesKey(data, "j") || matchesKey(data, "down")) {
				f.pickIdx = Math.min(fields - 1, f.pickIdx + 1);
				return true;
			}
			if (matchesKey(data, "k") || matchesKey(data, "up")) {
				f.pickIdx = Math.max(0, f.pickIdx - 1);
				return true;
			}
			if (matchesKey(data, "enter")) {
				const names = [
					"title",
					"prompt",
					"schedule",
					"timezone",
					"misfire",
					"mode",
					"model",
					"until",
					"max runs",
					"retries",
				] as const;
				const pick = names[f.pickIdx];
				if (pick === "misfire" || pick === "mode") {
					f.field = pick;
					f.pickIdx = 0;
				} else {
					f.field = pick;
					const a = automations().find((x) => x.id === f.id);
					const initial =
						pick === "title"
							? (a?.title ?? "")
							: pick === "prompt"
								? (a?.prompt ?? "")
								: pick === "schedule"
									? "" // typed fresh — the old spec would collide with the new one
									: pick === "timezone"
										? (a?.timezone ?? "")
										: pick === "model"
											? (a?.model ?? "")
											: pick === "until"
												? a?.until_ms
													? new Date(a.until_ms).toISOString().slice(0, 16).replace("T", " ")
													: ""
												: pick === "retries"
													? a?.retry_max
														? a.retry_backoff_secs
															? `${a.retry_max} ${a.retry_backoff_secs}`
															: String(a.retry_max)
														: ""
													: a?.max_runs !== null && a?.max_runs !== undefined
														? String(a.max_runs)
														: "";
					f.input = new InlineInput(200);
					for (const ch of initial) f.input.insert(ch);
				}
				return true;
			}
			return true;
		}
		if (f.field === "misfire" || f.field === "mode") {
			if (matchesKey(data, "j") || matchesKey(data, "down") || matchesKey(data, "k") || matchesKey(data, "up")) {
				f.pickIdx = (f.pickIdx + 1) % 2;
				return true;
			}
			if (matchesKey(data, "enter")) {
				void store
					.patchAutomation(
						f.id,
						f.field === "misfire"
							? { misfire: f.pickIdx === 1 ? "catch-up" : "skip" }
							: { mode: f.pickIdx === 1 ? "standard" : "read-only" },
					)
					.then(() => {
						toast("routine updated", "emerald");
						if (edit === f) edit = null;
					})
					.catch((e) => toast((e as Error).message, "rose"))
					.finally(() => requestRender());
				return true;
			}
			return true;
		}
		if (matchesKey(data, "enter")) {
			submitEdit();
			return true;
		}
		f.input.insert(data);
		return true;
	}

	function handleSnoozeKey(data: string): boolean {
		if (!snooze) return false;
		if (matchesKey(data, "escape")) {
			snooze = null;
			return true;
		}
		if (matchesKey(data, "enter")) {
			const n = Number(snooze.input.text.trim());
			if (!Number.isFinite(n) || n < 1 || n > 525_600) {
				toast("snooze minutes must be 1..525600", "amber");
				return true;
			}
			const id = snooze.id;
			void store
				.snoozeAutomation(id, Math.round(n))
				.then((a) => {
					toast(`snoozed ${a.next_run_at ? inAbout(a.next_run_at - Date.now()) : ""}`.trim(), "zinc");
				})
				.catch((e) => toast((e as Error).message, "rose"))
				.finally(() => {
					if (snooze?.id === id) snooze = null;
					requestRender();
				});
			return true;
		}
		snooze.input.insert(data);
		return true;
	}

	// ---- the screen ---------------------------------------------------------

	const screen: Screen = {
		render(width: number): string[] {
			if (snooze) return renderSnooze(width);
			if (edit) return renderEdit(width);
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

		wantsTextInput(): boolean {
			return form !== null || edit !== null || snooze !== null;
		},

		footerHints(): [string, string][] {
			if (snooze) {
				return [
					["esc", "cancel"],
					["enter", "snooze"],
				];
			}
			if (edit) {
				return edit.field === null
					? [
							["esc", "back"],
							["j/k", "field"],
							["enter", "edit"],
						]
					: [
							["esc", "back"],
							["enter", "apply"],
						];
			}
			if (form) {
				switch (form.step) {
					case 4:
					case 5:
						return [
							["esc", "cancel"],
							["j/k", "choice"],
							["enter", "next"],
						];
					case 7:
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
					["s", "skip next"],
					["S", "snooze"],
					["e", "edit"],
					["x", "delete"],
				];
			}
			return [
				["a", "new"],
				["enter", "open"],
				["space", "pause/resume"],
				["n", "run now"],
				["s", "skip next"],
				["S", "snooze"],
				["e", "edit"],
				["x", "delete"],
				["j/k", "select"],
			];
		},

		handleKey(data: string): boolean {
			// Overlays own their keys while open.
			if (snooze) return handleSnoozeKey(data);
			if (edit) return handleEditKey(data);
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
						timezone: new InlineInput(60),
						model: new InlineInput(120),
						retries: new InlineInput(24),
						modeIdx: 0,
						misfireIdx: 0,
					};
					return true;
				}
			}

			const a = current();
			if (!a) return false;

			if (matchesKey(data, "space")) {
				if (a.lifecycle !== "active" && a.lifecycle !== "paused") {
					toast(`a ${a.lifecycle} routine is terminal — create a new one (a)`, "amber");
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
						toast(r.ok ? "routine run started" : (r.error ?? "run not started"), r.ok ? "emerald" : "rose"),
					)
					.catch((e) => toast((e as Error).message, "rose"));
				return true;
			}

			if (matchesKey(data, "s")) {
				if (a.schedule_kind === "event") {
					toast(
						"an event routine has no next occurrence — it fires when its event arrives (pause instead)",
						"amber",
					);
					return true;
				}
				void store
					.skipAutomation(a.id)
					.then((u) =>
						toast(`skipped — next ${u.next_run_at ? inAbout(u.next_run_at - Date.now()) : "—"}`, "zinc"),
					)
					.catch((e) => toast((e as Error).message, "rose"));
				return true;
			}

			if (matchesKey(data, "shift+s")) {
				if (a.schedule_kind === "event") {
					toast("an event routine has no next occurrence to snooze (pause instead)", "amber");
					return true;
				}
				if (a.lifecycle !== "active") {
					toast(`only an active routine can be snoozed (this one is ${a.lifecycle})`, "amber");
					return true;
				}
				snooze = { input: new InlineInput(10), id: a.id };
				return true;
			}

			if (matchesKey(data, "e")) {
				if (a.lifecycle === "completed" || a.lifecycle === "failed") {
					toast(`a ${a.lifecycle} routine is terminal — create a new one (a)`, "amber");
					return true;
				}
				edit = { id: a.id, field: null, pickIdx: 0, input: new InlineInput(200) };
				return true;
			}

			if (matchesKey(data, "x")) {
				const id = a.id;
				const title = a.title ?? a.id;
				confirm(`delete routine "${title}"? its run history goes with it`, () => {
					void store
						.deleteAutomation(id)
						.then((r) => {
							toast(r.ok ? "deleted" : "unknown routine", r.ok ? "zinc" : "rose");
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

/** The create wizard (inline step machine, no overlay). */
interface CreateForm {
	/** 0 title · 1 prompt · 2 schedule · 3 timezone · 4 misfire · 5 mode · 6 model · 7 retries · 8 confirm. */
	step: number;
	title: InlineInput;
	prompt: InlineInput;
	schedule: InlineInput;
	timezone: InlineInput;
	model: InlineInput;
	/** M6: the retry spec — "N" or "N backoff-secs" (parseRetrySpec); empty = off. */
	retries: InlineInput;
	/** 0 read-only · 1 standard (the deliberate choice). */
	modeIdx: number;
	/** 0 skip · 1 catch-up. */
	misfireIdx: number;
}

/** The edit flow: field picker → inline input (or option list). */
interface EditForm {
	id: string;
	field:
		| "title"
		| "prompt"
		| "schedule"
		| "timezone"
		| "misfire"
		| "mode"
		| "model"
		| "until"
		| "max runs"
		| "retries"
		| null;
	pickIdx: number;
	input: InlineInput;
}

/** Parse the wizard/edit retry spec (M6): "" = off, "3" = up to 3 re-runs
 *  of a failed occurrence (engine-default 300s first backoff), "3 900" =
 *  the same with a 900s first backoff. Returns nulls when the policy is off. */
function parseRetrySpec(
	raw: string,
): { ok: true; retryMax: number | null; retryBackoffSecs: number | null } | { ok: false; error: string } {
	const t = raw.trim();
	if (t === "") return { ok: true, retryMax: null, retryBackoffSecs: null };
	const m = t.match(/^(\d{1,2})(?:\s+(\d{1,4}))?$/);
	if (!m) return { ok: false, error: 'retries needs "N" or "N backoff-secs", e.g. "3" or "3 900"' };
	const max = Number(m[1]);
	if (max < 0 || max > 10) return { ok: false, error: "retry-max is 0..10 (each re-run spends tokens)" };
	if (m[2] === undefined) return { ok: true, retryMax: max === 0 ? null : max, retryBackoffSecs: null };
	const backoff = Number(m[2]);
	if (max === 0) return { ok: false, error: 'a backoff needs a retry-max above 0 — "3 900"' };
	if (backoff < 30 || backoff > 3600) return { ok: false, error: "the first backoff is 30..3600 seconds" };
	return { ok: true, retryMax: max, retryBackoffSecs: backoff };
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
