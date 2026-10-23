/**
 * automations-cli.ts — `unown routines` (and its historical alias
 * `unown automations`): the shell surface for scheduled recurring agent runs
 * (follows the mcp-cli.ts module contract: pure argv → stdout/stderr/
 * exitCode, engine reached over REST at ENGINE_URL, nothing done in-process).
 *
 *   unown routines list [--all] [--json]
 *   unown routines create --title T --prompt P
 *                        (--cron "0 9 * * 1-5" | --every "2d at 09:00"
 *                         | --after "3d" | --delay-minutes N
 *                         | --on-event <name> [--filter <expr>])
 *                        [--timezone America/New_York] [--until 2026-12-31]
 *                        [--misfire skip|catch-up] [--mode read-only|standard]
 *                        [--model M] [--max-runs N] [--workspace PATH]
 *   unown routines edit <id> [--title T] [--prompt P] [--cron C | --every E | --after A]
 *                          [--timezone TZ] [--until D | --clear-until]
 *                          [--misfire skip|catch-up|default] [--mode M]
 *                          [--model M] [--max-runs N]
 *   unown routines pause <id> | resume <id>
 *   unown routines run <id>        # manual run-now (does not consume maxRuns)
 *   unown routines skip <id>       # skip the next occurrence (recorded)
 *   unown routines snooze <id> <minutes>
 *   unown routines history <id> [--limit N] [--json]
 *   unown routines trigger <event> [--payload '<json>']   # local event dispatch
 *   unown routines hook-url        # the curl-able inbound webhook URL
 *   unown routines delete <id>
 *
 * Schedule kinds (docs/routines.md): cron (5-field, evaluated in the
 * routine's timezone), every (schedule-anchored interval; d/w step by wall
 * clock), after (completion-anchored — re-arms N after each run finishes),
 * delay-minutes (one-shot), on-event (M2: dispatched by inbound webhook
 * events, optionally gated by the --filter payload expression — never by
 * the tick). Default misfire policy is skip (a missed slot is recorded and
 * skipped); catch-up runs a missed slot once on wake (launchd semantics,
 * 24h horizon).
 */

import { engineFetch } from "./engine-auth.ts";
import { describeHookFilter } from "./hook-filter.ts";
import { ENGINE_URL } from "./term.ts";

export interface CliResult {
	stdout?: string;
	stderr?: string;
	exitCode: number;
}

export const AUTOMATIONS_USAGE = `unown routines — scheduled recurring agent runs (need the engine: unown engine start)
("unown automations" is the historical alias — same command)

Usage:
  unown routines list [--all] [--json]
  unown routines create --title <t> --prompt <p>
                        (--cron <expr> | --every <spec> | --after <spec> | --delay-minutes <n>
                         | --on-event <name> [--filter <expr>])
                        [--timezone <IANA>] [--until <date>] [--misfire skip|catch-up]
                        [--mode read-only|standard] [--model <id>] [--max-runs <n>] [--workspace <path>]
                        [--active-hours "09:00-18:00"] [--idle-only] [--deliver <url>] [--jitter <sec>]
                        [--retry-max <n>] [--retry-backoff <sec>]
  unown routines edit <id> [--title <t>] [--prompt <p>] [--cron <e> | --every <s> | --after <s>]
                       [--timezone <tz>] [--until <date> | --clear-until] [--misfire skip|catch-up|default]
                       [--mode <m>] [--model <id>] [--max-runs <n>]
                       [--active-hours <win> | --clear-active-hours] [--idle-only | --no-idle-only]
                       [--deliver <url> | --clear-deliver] [--jitter <sec> | --clear-jitter]
                       [--retry-max <n> | --clear-retry] [--retry-backoff <sec>]
  unown routines pause <id> | resume <id>
  unown routines run <id>          run now (manual; never consumes maxRuns)
  unown routines skip <id>         skip the next occurrence (recorded in history)
  unown routines snooze <id> <minutes>
  unown routines history <id> [--limit <n>] [--json]
  unown routines trigger <event> [--payload '<json>']   dispatch an event locally (same path as a webhook)
  unown routines hook-url          print the inbound webhook URL (its secret IS the auth)
  unown routines delete <id>

Schedule kinds:
  --cron "0 9 * * 1-5"      5-field cron in the routine's timezone (default: local)
  --every "30m"             interval from the schedule's own slots
  --every "2d at 09:00"     day/week intervals step by WALL CLOCK (DST-safe); "at" pins the time
  --after "3d"              N units after each run COMPLETES (regenerating; never overdue)
  --delay-minutes <n>       one-shot, once after N minutes
  --on-event <name>         M2: runs when a matching event arrives (POST /api/hooks/<id>
                            or 'unown routines trigger <name>'); never from the clock
  --filter '<expr>'         payload gate for --on-event, e.g. 'payload.action == "opened"'
                            (paths, ==/!=, integer ordering, contains(), exists(), ! and AND)

Monitoring + delivery (M5, time-based rows; delivery works for events too):
  --active-hours "09:00-18:00"  dispatch window in the routine's timezone (may wrap
                            midnight: "18:00-06:00"); cron/every slots outside it are
                            skipped and advanced, once/after are held for the window
  --idle-only               yield to the foreground: the slot is skipped (or held)
                            while a human is using an agent — bridge interactive
                            traffic within the last minute or engine runs in flight
  --deliver <url>           POST a fixed JSON result payload to this URL after each
                            run (Slack-compatible incoming webhooks, n8n, any
                            receiver); an output containing NO_REPLY suppresses
                            delivery (the quiet-result contract)
  --jitter <sec>            1..600: randomize computed cron/every slots by 0..N
                            seconds — de-herd the top-of-hour crons

Reliability (M6, works for every kind — events included):
  --retry-max <n>           0..10: re-run a FAILED occurrence up to N more
                            times (default 0 = off; unattended runs spend
                            tokens, retries are deliberate). Retries land in
                            history as trigger 'retry' (attempt 2+), linked
                            to the original run — they never consume a slot
                            or the maxRuns budget
  --retry-backoff <sec>     30..3600: wait before the FIRST retry (default
                            300); later attempts double it, capped at 1h.
                            A retry older than 24h (engine down or paused)
                            is recorded 'retry_stale' and cleared
  chained routines          every completed run broadcasts the internal
                            'routine.finished' event — an --on-event routine
                            scoped to it ('--on-event routine.finished
                            --filter 'routineId == "<id>" status == "succeeded"'')
                            runs as the next hop (GitHub's workflow_run
                            pattern). Chains deeper than 3 hops are refused
                            and recorded ('chain_depth_capped'); the
                            routine.* namespace cannot arrive from outside
Default mode is read-only: the unattended run reports on the repo without shell
or write access. "standard" grants the full toolset — choose it deliberately.
Docs: docs/routines.md.`;

async function api(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
	try {
		const res = await engineFetch(`${ENGINE_URL}${path}`, {
			method,
			headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
			body: body !== undefined ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(10_000),
		});
		const data = (await res.json().catch(() => ({}))) as any;
		return { ok: res.ok, status: res.status, data };
	} catch {
		return {
			ok: false,
			status: 0,
			data: {
				error: `the self-learning engine is not reachable at ${ENGINE_URL}\n  routines need the engine running: unown engine start`,
			},
		};
	}
}

function flagValue(argv: string[], name: string): string | undefined {
	const i = argv.indexOf(name);
	return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function flagNumber(argv: string[], name: string): number | undefined {
	const raw = flagValue(argv, name);
	if (raw === undefined) return undefined;
	const n = Number(raw);
	return Number.isFinite(n) ? n : undefined;
}

function hasFlag(argv: string[], name: string): boolean {
	return argv.includes(name);
}

/** `--until` accepts a date (YYYY-MM-DD[ HH:MM[:SS]]) or epoch ms. */
function parseUntil(raw: string): number | { error: string } {
	if (/^\d{10,}$/.test(raw.trim())) return Number(raw.trim());
	const iso = raw.includes("T") ? raw : raw.trim().replace(" ", "T");
	const ms = Date.parse(/^\d{4}-\d{2}-\d{2}T/.test(iso) ? iso : `${iso}:00`);
	if (!Number.isFinite(ms)) return { error: `cannot parse until "${raw}" — use YYYY-MM-DD [HH:MM] or epoch ms` };
	return ms;
}

function describeRow(a: any): string {
	const next = a.next_run_at ? new Date(a.next_run_at).toLocaleString() : "—";
	const last = a.lastRun ? `${a.lastRun.status} ${new Date(a.lastRun.started_at).toLocaleString()}` : "never";
	const sched =
		a.schedule_kind === "event"
			? `on ${a.event_kind}${a.event_filter ? ` · ${describeHookFilter(a.event_filter)}` : ""}`
			: (a.schedule ?? a.cron_expr ?? "one-shot");
	const policies = [
		a.active_hours ? `hours ${a.active_hours}` : null,
		a.idle_only ? "idle-only" : null,
		a.deliver_url
			? `→ ${String(a.deliver_url)
					.replace(/^https?:\/\//, "")
					.slice(0, 48)}`
			: null,
		a.jitter_secs ? `jitter ${a.jitter_secs}s` : null,
	].filter(Boolean);
	return (
		`${a.id}  ${a.title}\n` +
		`    ${sched} · mode ${a.mode} · ${a.lifecycle} · runs ${a.run_count}\n` +
		`    next: ${next} · last: ${last}` +
		(policies.length > 0 ? `\n    ${policies.join(" · ")}` : "")
	);
}

export async function runAutomationsCommand(argv: string[], opts: { cwd: string }): Promise<CliResult> {
	const rest = argv.filter((a) => !a.startsWith("--") || a.includes("="));
	const sub = rest[0] ?? "list";
	// Self-heal first (the P3 gap): every OTHER agent touchpoint (note
	// delivery, the live-session footer) ping-and-spawns a down engine —
	// the routines surface used to just error. A user who only ever
	// manages routines (the "no agent in use" story) deserves the same
	// liveness: probe, spawn if down (the crash-loop circuit and the
	// UNOWN_ENGINE_AUTOSTART=0 kill switch still gate it), then proceed.
	// Help/usage print without an engine; `serve`-less verbs are read-mostly,
	// so one bounded wait covers every command uniformly.
	const isHelp = sub === "help" || sub === "--help" || sub === "-h";
	if (!isHelp && process.env.PI_DISABLE_ENGINE_SPAWN !== "1") {
		try {
			const { ensureEngineRunning } = await import("./engine-supervisor.ts");
			await ensureEngineRunning(15_000);
		} catch {
			/* the engine is genuinely down — the per-request error below is the honest report */
		}
	}

	if (hasFlag(argv, "-h") || hasFlag(argv, "--help") || sub === "help") {
		return { stdout: AUTOMATIONS_USAGE, exitCode: 0 };
	}

	if (sub === "list") {
		const res = await api("GET", "/api/automations");
		if (!res.ok) return { stderr: String(res.data?.error ?? "engine unreachable"), exitCode: 1 };
		// `--all` lists every workspace; the default lists this cwd's rows only.
		// (The old predicate `!hasFlag(--all) && workspace === cwd` inverted to
		// always-false under --all — the flag printed NOTHING. Found by live
		// E2E; pinned by test/automations.test.ts "automations CLI".)
		const all = hasFlag(argv, "--all");
		const rows = (res.data.automations ?? []).filter((a: any) => all || a?.workspace === opts.cwd);
		// Event routines sort AFTER scheduled ones (created_at order
		// preserved within each group): they have no next occurrence,
		// so "what runs next" — the list's whole point — stays on top.
		const timed = rows.filter((a: any) => a?.schedule_kind !== "event");
		const events = rows.filter((a: any) => a?.schedule_kind === "event");
		const ordered = [...timed, ...events];
		if (hasFlag(argv, "--json")) return { stdout: `${JSON.stringify(rows, null, 2)}\n`, exitCode: 0 };
		if (rows.length === 0) {
			const anyAtAll = (res.data.automations ?? []).length > 0;
			return {
				stdout:
					(anyAtAll
						? `No routines in this project (${(res.data.automations ?? []).length} filtered; --all lists every workspace).`
						: 'No routines yet. Create one:\n  unown routines create --title \'morning brief\' --every "1d at 09:00" \\\n      --prompt "Summarize yesterday\'s commits and open TODOs; report risks."') +
					"\n",
				exitCode: 0,
			};
		}
		return { stdout: `${ordered.map(describeRow).join("\n\n")}\n`, exitCode: 0 };
	}

	if (sub === "create") {
		const title = flagValue(argv, "--title");
		const prompt = flagValue(argv, "--prompt");
		const cron = flagValue(argv, "--cron");
		const every = flagValue(argv, "--every");
		const after = flagValue(argv, "--after");
		const delayMinutes = flagNumber(argv, "--delay-minutes");
		const onEvent = flagValue(argv, "--on-event");
		const filter = flagValue(argv, "--filter");
		const timezone = flagValue(argv, "--timezone");
		const until = flagValue(argv, "--until");
		const misfire = flagValue(argv, "--misfire");
		const mode = flagValue(argv, "--mode") === "standard" ? "standard" : "read-only";
		const model = flagValue(argv, "--model");
		const maxRuns = flagNumber(argv, "--max-runs");
		const workspace = flagValue(argv, "--workspace") ?? opts.cwd;
		const scheduleCount = [cron, every, after, delayMinutes, onEvent].filter((v) => v !== undefined).length;
		if (!title || !prompt || scheduleCount !== 1) {
			return {
				stderr: `create needs --title, --prompt and exactly ONE of (--cron | --every | --after | --delay-minutes | --on-event)\n\n${AUTOMATIONS_USAGE}`,
				exitCode: 1,
			};
		}
		if (filter !== undefined && onEvent === undefined) {
			return {
				stderr: `--filter gates an event routine — pair it with --on-event\n\n${AUTOMATIONS_USAGE}`,
				exitCode: 1,
			};
		}
		if (misfire !== undefined && misfire !== "skip" && misfire !== "catch-up") {
			return { stderr: `--misfire must be skip or catch-up\n\n${AUTOMATIONS_USAGE}`, exitCode: 1 };
		}
		const body: Record<string, unknown> = {
			title,
			prompt,
			workspace,
			mode,
			model: model ?? null,
			maxRuns: maxRuns ?? null,
		};
		if (cron !== undefined) body.cron = cron;
		if (every !== undefined) body.every = every;
		if (after !== undefined) body.after = after;
		if (delayMinutes !== undefined) body.delayMinutes = delayMinutes;
		if (onEvent !== undefined) {
			body.event = onEvent;
			if (filter !== undefined) body.filter = filter;
		}
		if (timezone !== undefined) body.timezone = timezone;
		if (misfire !== undefined) body.misfire = misfire;
		if (until !== undefined) {
			const parsed = parseUntil(until);
			if (typeof parsed === "object") return { stderr: parsed.error, exitCode: 1 };
			body.until = parsed;
		}
		// M5 policies: the monitoring/delivery knobs.
		const activeHours = flagValue(argv, "--active-hours");
		if (activeHours !== undefined) body.activeHours = activeHours;
		if (hasFlag(argv, "--idle-only")) body.idleOnly = true;
		const deliver = flagValue(argv, "--deliver");
		if (deliver !== undefined) body.deliverUrl = deliver;
		const jitter = flagNumber(argv, "--jitter");
		if (jitter !== undefined) body.jitterSecs = jitter;
		// M6: the failed-run retry policy.
		const retryMax = flagNumber(argv, "--retry-max");
		if (retryMax !== undefined) body.retryMax = retryMax;
		const retryBackoff = flagNumber(argv, "--retry-backoff");
		if (retryBackoff !== undefined) body.retryBackoffSecs = retryBackoff;
		const res = await api("POST", "/api/automations", body);
		if (!res.ok) return { stderr: String(res.data?.error ?? "create failed"), exitCode: 1 };
		const a = res.data.automation;
		return {
			stdout:
				`Created ${a.id} ("${a.title}")\n` +
				`  schedule: ${a.schedule ?? a.cron_expr ?? "one-shot"}\n` +
				`  mode: ${a.mode}${a.model ? ` · model: ${a.model}` : ""}${a.max_runs ? ` · max scheduled runs: ${a.max_runs}` : ""}${a.timezone ? ` · tz: ${a.timezone}` : ""}\n` +
				(a.schedule_kind === "event"
					? `  fires when "${a.event_kind}" arrives (never from the clock; pause still blocks it)\n` +
						`  trigger locally: unown routines trigger ${a.event_kind} · inbound URL: unown routines hook-url\n`
					: `  next run: ${a.next_run_at ? new Date(a.next_run_at).toLocaleString() : "—"}\n`) +
				(a.active_hours ? `  active hours: ${a.active_hours}${a.timezone ? ` (${a.timezone})` : ""}\n` : "") +
				(a.idle_only ? `  idle-only: yields the slot while a human works\n` : "") +
				(a.deliver_url ? `  deliver: ${a.deliver_url}\n` : "") +
				(a.jitter_secs ? `  jitter: 0..${a.jitter_secs}s on computed slots\n` : "") +
				(a.retry_max
					? `  retries: up to ${a.retry_max} on failure (first backoff ${a.retry_backoff_secs ?? 300}s, doubling, cap 1h)\n`
					: "") +
				`  workspace: ${a.workspace}\n` +
				`Inspect: unown routines history ${a.id} · trigger now: unown routines run ${a.id} · manage in the TUI: unown dashboard routines`,
			exitCode: 0,
		};
	}

	if (sub === "edit") {
		const id = rest[1];
		if (!id) return { stderr: `edit needs an id\n\n${AUTOMATIONS_USAGE}`, exitCode: 1 };
		const patch: Record<string, unknown> = {};
		for (const flag of ["--title", "--prompt", "--mode", "--timezone"] as const) {
			const v = flagValue(argv, flag);
			if (v !== undefined) patch[flag.slice(2)] = v;
		}
		for (const flag of ["--cron", "--every", "--after"] as const) {
			const v = flagValue(argv, flag);
			if (v !== undefined) patch[flag.slice(2)] = v;
		}
		const delayMinutes = flagNumber(argv, "--delay-minutes");
		if (delayMinutes !== undefined) patch.delayMinutes = delayMinutes;
		const misfire = flagValue(argv, "--misfire");
		if (misfire !== undefined) patch.misfire = misfire === "default" ? null : misfire;
		const model = flagValue(argv, "--model");
		if (model !== undefined) patch.model = model || null;
		const maxRuns = flagNumber(argv, "--max-runs");
		if (maxRuns !== undefined) patch.maxRuns = maxRuns;
		const until = flagValue(argv, "--until");
		if (until !== undefined) {
			const parsed = parseUntil(until);
			if (typeof parsed === "object") return { stderr: parsed.error, exitCode: 1 };
			patch.until = parsed;
		}
		if (hasFlag(argv, "--clear-until")) patch.until = null;
		if (hasFlag(argv, "--clear-model")) patch.model = null;
		// M5 policies: set/clear via edit (null/"" clears).
		const activeHours = flagValue(argv, "--active-hours");
		if (activeHours !== undefined) patch.activeHours = activeHours;
		if (hasFlag(argv, "--clear-active-hours")) patch.activeHours = null;
		if (hasFlag(argv, "--idle-only")) patch.idleOnly = true;
		if (hasFlag(argv, "--no-idle-only")) patch.idleOnly = false;
		const deliver = flagValue(argv, "--deliver");
		if (deliver !== undefined) patch.deliverUrl = deliver;
		if (hasFlag(argv, "--clear-deliver")) patch.deliverUrl = null;
		const jitter = flagNumber(argv, "--jitter");
		if (jitter !== undefined) patch.jitterSecs = jitter;
		if (hasFlag(argv, "--clear-jitter")) patch.jitterSecs = null;
		// M6: set/clear the retry policy (clear also disarms a pending chain).
		const retryMax = flagNumber(argv, "--retry-max");
		if (retryMax !== undefined) patch.retryMax = retryMax;
		if (hasFlag(argv, "--clear-retry")) patch.retryMax = null;
		const retryBackoff = flagNumber(argv, "--retry-backoff");
		if (retryBackoff !== undefined) patch.retryBackoffSecs = retryBackoff;
		if (Object.keys(patch).length === 0)
			return { stderr: `edit needs at least one field flag\n\n${AUTOMATIONS_USAGE}`, exitCode: 1 };
		const res = await api("PATCH", `/api/automations/${encodeURIComponent(id)}`, patch);
		if (!res.ok) return { stderr: String(res.data?.error ?? "edit failed"), exitCode: 1 };
		const a = res.data.automation;
		return {
			stdout: `Updated ${a.id} — ${a.schedule ?? a.lifecycle}, next run ${a.next_run_at ? new Date(a.next_run_at).toLocaleString() : "—"}.`,
			exitCode: 0,
		};
	}

	if (sub === "pause" || sub === "resume") {
		const id = rest[1];
		if (!id) return { stderr: `${sub} needs an id\n\n${AUTOMATIONS_USAGE}`, exitCode: 1 };
		const res = await api("PATCH", `/api/automations/${encodeURIComponent(id)}`, {
			lifecycle: sub === "pause" ? "paused" : "active",
		});
		if (!res.ok) return { stderr: String(res.data?.error ?? `${sub} failed`), exitCode: 1 };
		const a = res.data.automation;
		return {
			stdout: `${a.id} is ${a.lifecycle}${a.next_run_at ? `; next run ${new Date(a.next_run_at).toLocaleString()}` : ""}.`,
			exitCode: 0,
		};
	}

	if (sub === "run") {
		const id = rest[1];
		if (!id) return { stderr: `run needs an id\n\n${AUTOMATIONS_USAGE}`, exitCode: 1 };
		const res = await api("POST", `/api/automations/${encodeURIComponent(id)}/run`);
		if (!res.ok) return { stderr: String(res.data?.error ?? "run failed"), exitCode: 1 };
		return { stdout: `Run started for ${id} — check progress: unown routines history ${id}`, exitCode: 0 };
	}

	if (sub === "skip") {
		const id = rest[1];
		if (!id) return { stderr: `skip needs an id\n\n${AUTOMATIONS_USAGE}`, exitCode: 1 };
		const res = await api("POST", `/api/automations/${encodeURIComponent(id)}/skip`);
		if (!res.ok) return { stderr: String(res.data?.error ?? "skip failed"), exitCode: 1 };
		const a = res.data.automation;
		return {
			stdout: `Skipped the next occurrence of ${a.title} — next run ${a.next_run_at ? new Date(a.next_run_at).toLocaleString() : "—"}.`,
			exitCode: 0,
		};
	}

	if (sub === "snooze") {
		const id = rest[1];
		const minutes = flagNumber(argv, "--minutes") ?? Number(rest[2]);
		if (!id || !Number.isFinite(minutes) || minutes < 1) {
			return { stderr: `snooze needs an id and minutes (1..525600)\n\n${AUTOMATIONS_USAGE}`, exitCode: 1 };
		}
		const res = await api("POST", `/api/automations/${encodeURIComponent(id)}/snooze`, { minutes });
		if (!res.ok) return { stderr: String(res.data?.error ?? "snooze failed"), exitCode: 1 };
		const a = res.data.automation;
		return {
			stdout: `Snoozed ${a.title} by ${minutes}m — next run ${a.next_run_at ? new Date(a.next_run_at).toLocaleString() : "—"}.`,
			exitCode: 0,
		};
	}

	if (sub === "history") {
		const id = rest[1];
		if (!id) return { stderr: `history needs an id\n\n${AUTOMATIONS_USAGE}`, exitCode: 1 };
		const limit = flagNumber(argv, "--limit") ?? 20;
		const res = await api("GET", `/api/automations/${encodeURIComponent(id)}/runs?limit=${limit}`);
		if (!res.ok) return { stderr: String(res.data?.error ?? "history failed"), exitCode: 1 };
		const runs = res.data.runs ?? [];
		if (hasFlag(argv, "--json")) return { stdout: `${JSON.stringify(runs, null, 2)}\n`, exitCode: 0 };
		if (runs.length === 0) return { stdout: `No runs recorded yet for ${id}.`, exitCode: 0 };
		const lines = runs.map(
			(r: any) =>
				`${r.status.padEnd(9)} ${new Date(r.started_at).toLocaleString()}  (${r.trigger_kind}${r.attempt > 1 ? `, attempt ${r.attempt}` : ""}${r.exit_code !== null ? `, exit ${r.exit_code}` : ""}${r.turns ? `, ${r.turns} turns` : ""})\n` +
				(r.error ? `    error: ${r.error.slice(0, 200)}\n` : "") +
				(r.output ? `    ${String(r.output).slice(0, 300).replace(/\n/g, "\n    ")}` : ""),
		);
		return { stdout: lines.join("\n"), exitCode: 0 };
	}

	if (sub === "delete") {
		const id = rest[1];
		if (!id) return { stderr: `delete needs an id\n\n${AUTOMATIONS_USAGE}`, exitCode: 1 };
		const res = await api("DELETE", `/api/automations/${encodeURIComponent(id)}`);
		if (!res.ok) return { stderr: String(res.data?.error ?? "delete failed"), exitCode: 1 };
		return { stdout: `Deleted routine ${id}.`, exitCode: 0 };
	}

	if (sub === "trigger") {
		const event = rest[1];
		if (!event)
			return {
				stderr: `trigger needs an event name (e.g. unown routines trigger issue.opened)\n\n${AUTOMATIONS_USAGE}`,
				exitCode: 1,
			};
		const payloadRaw = flagValue(argv, "--payload");
		let payload: unknown = {};
		if (payloadRaw !== undefined) {
			try {
				payload = JSON.parse(payloadRaw);
			} catch {
				return { stderr: `--payload must be valid JSON (got: ${payloadRaw.slice(0, 80)})`, exitCode: 1 };
			}
			if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
				return { stderr: "--payload must be a JSON object", exitCode: 1 };
			}
		}
		const res = await api("POST", "/api/automations/event-dispatch", { event, payload });
		if (!res.ok) return { stderr: String(res.data?.error ?? "trigger failed"), exitCode: 1 };
		const results: Array<{ id: string; title: string; outcome: string }> = res.data.results ?? [];
		const fired = results.filter((r) => r.outcome === "dispatched");
		const lines: string[] = [`Event "${event}" → ${res.data.dispatched ?? 0} routine(s) dispatched.`];
		if (results.length === 0) {
			lines.push(
				`No routines listen for "${event}". Create one: unown routines create --title T --prompt P --on-event ${event}`,
			);
		} else {
			for (const r of results) lines.push(`  ${r.id}  ${r.title} — ${r.outcome}`);
		}
		if (fired.length > 0) lines.push(`History: unown routines history ${fired.length === 1 ? fired[0].id : "<id>"}`);
		return { stdout: `${lines.join("\n")}\n`, exitCode: 0 };
	}

	if (sub === "hook-url") {
		const res = await api("GET", "/api/hooks/info");
		if (!res.ok) return { stderr: String(res.data?.error ?? "hook-url failed"), exitCode: 1 };
		const hookId = res.data.hookId as string | undefined;
		if (!hookId) return { stderr: "the engine reports no hook id", exitCode: 1 };
		return {
			stdout:
				`${ENGINE_URL}/api/hooks/${hookId}\n` +
				`POST {"event": "<name>", "payload": {...}} — knowing this URL is the authorization.\n` +
				`Rotate by deleting data/self-learning/hooks.token and restarting the engine.\n`,
			exitCode: 0,
		};
	}

	return { stderr: `unknown subcommand "${sub}"\n\n${AUTOMATIONS_USAGE}`, exitCode: 1 };
}
