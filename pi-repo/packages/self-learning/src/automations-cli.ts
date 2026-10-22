/**
 * automations-cli.ts — `unown routines` (and its historical alias
 * `unown automations`): the shell surface for scheduled recurring agent runs
 * (follows the mcp-cli.ts module contract: pure argv → stdout/stderr/
 * exitCode, engine reached over REST at ENGINE_URL, nothing done in-process).
 *
 *   unown routines list [--all] [--json]
 *   unown routines create --title T --prompt P
 *                        (--cron "0 9 * * 1-5" | --every "2d at 09:00"
 *                         | --after "3d" | --delay-minutes N)
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
 *   unown routines delete <id>
 *
 * Schedule kinds (docs/routines.md): cron (5-field, evaluated in the
 * routine's timezone), every (schedule-anchored interval; d/w step by wall
 * clock), after (completion-anchored — re-arms N after each run finishes),
 * delay-minutes (one-shot). Default misfire policy is skip (a missed slot is
 * recorded and skipped); catch-up runs a missed slot once on wake (launchd
 * semantics, 24h horizon).
 */
import { ENGINE_URL } from "./term.ts";
import { engineFetch } from "./engine-auth.ts";

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
                        (--cron <expr> | --every <spec> | --after <spec> | --delay-minutes <n>)
                        [--timezone <IANA>] [--until <date>] [--misfire skip|catch-up]
                        [--mode read-only|standard] [--model <id>] [--max-runs <n>] [--workspace <path>]
  unown routines edit <id> [--title <t>] [--prompt <p>] [--cron <e> | --every <s> | --after <s>]
                       [--timezone <tz>] [--until <date> | --clear-until] [--misfire skip|catch-up|default]
                       [--mode <m>] [--model <id>] [--max-runs <n>]
  unown routines pause <id> | resume <id>
  unown routines run <id>          run now (manual; never consumes maxRuns)
  unown routines skip <id>         skip the next occurrence (recorded in history)
  unown routines snooze <id> <minutes>
  unown routines history <id> [--limit <n>] [--json]
  unown routines delete <id>

Schedule kinds:
  --cron "0 9 * * 1-5"      5-field cron in the routine's timezone (default: local)
  --every "30m"             interval from the schedule's own slots
  --every "2d at 09:00"     day/week intervals step by WALL CLOCK (DST-safe); "at" pins the time
  --after "3d"              N units after each run COMPLETES (regenerating; never overdue)
  --delay-minutes <n>       one-shot, once after N minutes
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
                        data: { error: `the self-learning engine is not reachable at ${ENGINE_URL}\n  routines need the engine running: unown engine start` },
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
        return `${a.id}  ${a.title}\n    ${a.schedule ?? a.cron_expr ?? "one-shot"} · mode ${a.mode} · ${a.lifecycle} · runs ${a.run_count}\n    next: ${next} · last: ${last}`;
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
                if (hasFlag(argv, "--json")) return { stdout: JSON.stringify(rows, null, 2) + "\n", exitCode: 0 };
                if (rows.length === 0) {
                        const anyAtAll = (res.data.automations ?? []).length > 0;
                        return {
                                stdout:
                                        (anyAtAll
                                                ? `No routines in this project (${(res.data.automations ?? []).length} filtered; --all lists every workspace).`
                                                : 'No routines yet. Create one:\n  unown routines create --title \'morning brief\' --every "1d at 09:00" \\\n      --prompt "Summarize yesterday\'s commits and open TODOs; report risks."') + "\n",
                                exitCode: 0,
                        };
                }
                return { stdout: rows.map(describeRow).join("\n\n") + "\n", exitCode: 0 };
        }

        if (sub === "create") {
                const title = flagValue(argv, "--title");
                const prompt = flagValue(argv, "--prompt");
                const cron = flagValue(argv, "--cron");
                const every = flagValue(argv, "--every");
                const after = flagValue(argv, "--after");
                const delayMinutes = flagNumber(argv, "--delay-minutes");
                const timezone = flagValue(argv, "--timezone");
                const until = flagValue(argv, "--until");
                const misfire = flagValue(argv, "--misfire");
                const mode = flagValue(argv, "--mode") === "standard" ? "standard" : "read-only";
                const model = flagValue(argv, "--model");
                const maxRuns = flagNumber(argv, "--max-runs");
                const workspace = flagValue(argv, "--workspace") ?? opts.cwd;
                const scheduleCount = [cron, every, after, delayMinutes].filter((v) => v !== undefined).length;
                if (!title || !prompt || scheduleCount !== 1) {
                        return { stderr: `create needs --title, --prompt and exactly ONE of (--cron | --every | --after | --delay-minutes)\n\n${AUTOMATIONS_USAGE}`, exitCode: 1 };
                }
                if (misfire !== undefined && misfire !== "skip" && misfire !== "catch-up") {
                        return { stderr: `--misfire must be skip or catch-up\n\n${AUTOMATIONS_USAGE}`, exitCode: 1 };
                }
                const body: Record<string, unknown> = { title, prompt, workspace, mode, model: model ?? null, maxRuns: maxRuns ?? null };
                if (cron !== undefined) body.cron = cron;
                if (every !== undefined) body.every = every;
                if (after !== undefined) body.after = after;
                if (delayMinutes !== undefined) body.delayMinutes = delayMinutes;
                if (timezone !== undefined) body.timezone = timezone;
                if (misfire !== undefined) body.misfire = misfire;
                if (until !== undefined) {
                        const parsed = parseUntil(until);
                        if (typeof parsed === "object") return { stderr: parsed.error, exitCode: 1 };
                        body.until = parsed;
                }
                const res = await api("POST", "/api/automations", body);
                if (!res.ok) return { stderr: String(res.data?.error ?? "create failed"), exitCode: 1 };
                const a = res.data.automation;
                return {
                        stdout:
                                `Created ${a.id} ("${a.title}")\n` +
                                `  schedule: ${a.schedule ?? a.cron_expr ?? "one-shot"}\n` +
                                `  mode: ${a.mode}${a.model ? ` · model: ${a.model}` : ""}${a.max_runs ? ` · max scheduled runs: ${a.max_runs}` : ""}${a.timezone ? ` · tz: ${a.timezone}` : ""}\n` +
                                `  next run: ${a.next_run_at ? new Date(a.next_run_at).toLocaleString() : "—"}\n` +
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
                if (Object.keys(patch).length === 0) return { stderr: `edit needs at least one field flag\n\n${AUTOMATIONS_USAGE}`, exitCode: 1 };
                const res = await api("PATCH", `/api/automations/${encodeURIComponent(id)}`, patch);
                if (!res.ok) return { stderr: String(res.data?.error ?? "edit failed"), exitCode: 1 };
                const a = res.data.automation;
                return { stdout: `Updated ${a.id} — ${a.schedule ?? a.lifecycle}, next run ${a.next_run_at ? new Date(a.next_run_at).toLocaleString() : "—"}.`, exitCode: 0 };
        }

        if (sub === "pause" || sub === "resume") {
                const id = rest[1];
                if (!id) return { stderr: `${sub} needs an id\n\n${AUTOMATIONS_USAGE}`, exitCode: 1 };
                const res = await api("PATCH", `/api/automations/${encodeURIComponent(id)}`, { lifecycle: sub === "pause" ? "paused" : "active" });
                if (!res.ok) return { stderr: String(res.data?.error ?? `${sub} failed`), exitCode: 1 };
                const a = res.data.automation;
                return { stdout: `${a.id} is ${a.lifecycle}${a.next_run_at ? `; next run ${new Date(a.next_run_at).toLocaleString()}` : ""}.`, exitCode: 0 };
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
                return { stdout: `Skipped the next occurrence of ${a.title} — next run ${a.next_run_at ? new Date(a.next_run_at).toLocaleString() : "—"}.`, exitCode: 0 };
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
                return { stdout: `Snoozed ${a.title} by ${minutes}m — next run ${a.next_run_at ? new Date(a.next_run_at).toLocaleString() : "—"}.`, exitCode: 0 };
        }

        if (sub === "history") {
                const id = rest[1];
                if (!id) return { stderr: `history needs an id\n\n${AUTOMATIONS_USAGE}`, exitCode: 1 };
                const limit = flagNumber(argv, "--limit") ?? 20;
                const res = await api("GET", `/api/automations/${encodeURIComponent(id)}/runs?limit=${limit}`);
                if (!res.ok) return { stderr: String(res.data?.error ?? "history failed"), exitCode: 1 };
                const runs = res.data.runs ?? [];
                if (hasFlag(argv, "--json")) return { stdout: JSON.stringify(runs, null, 2) + "\n", exitCode: 0 };
                if (runs.length === 0) return { stdout: `No runs recorded yet for ${id}.`, exitCode: 0 };
                const lines = runs.map(
                        (r: any) =>
                                `${r.status.padEnd(9)} ${new Date(r.started_at).toLocaleString()}  (${r.trigger_kind}${r.exit_code !== null ? `, exit ${r.exit_code}` : ""}${r.turns ? `, ${r.turns} turns` : ""})\n` +
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

        return { stderr: `unknown subcommand "${sub}"\n\n${AUTOMATIONS_USAGE}`, exitCode: 1 };
}
