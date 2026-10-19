/**
 * automations-cli.ts — `unown automations <sub>` (the zcode port's shell
 * surface; follows the mcp-cli.ts module contract: pure argv → stdout/stderr/
 * exitCode, engine reached over REST at ENGINE_URL, nothing done in-process).
 *
 *   unown automations list
 *   unown automations create --title T --prompt P --cron "0 9 * * 1-5"
 *                            [--delay-minutes N] [--mode read-only|standard]
 *                            [--model M] [--max-runs N] [--workspace PATH]
 *   unown automations edit <id> [--title T] [--prompt P] [--cron C] [--mode M]
 *   unown automations pause <id> | resume <id>
 *   unown automations run <id>        # manual run-now (does not consume maxRuns)
 *   unown automations history <id> [--limit N]
 *   unown automations delete <id>
 */
import { ENGINE_URL } from "./term.ts";

export interface CliResult {
        stdout?: string;
        stderr?: string;
        exitCode: number;
}

export const AUTOMATIONS_USAGE = `unown automations — scheduled recurring agent runs (need the engine: bun run agent:start)

Usage:
  unown automations list
  unown automations create --title <t> --prompt <p> (--cron <expr> | --delay-minutes <n>)
                           [--mode read-only|standard] [--model <id>] [--max-runs <n>]
                           [--workspace <path>]
  unown automations edit <id> [--title <t>] [--prompt <p>] [--cron <expr>] [--mode <m>]
  unown automations pause <id> | resume <id>
  unown automations run <id>          run now (manual; never consumes maxRuns)
  unown automations history <id> [--limit <n>]
  unown automations delete <id>

Cron is a standard 5-field expression in the LOCAL timezone, e.g. "0 9 * * 1-5".
Default mode is read-only: the unattended run reports on the repo without shell
or write access. "standard" grants the full toolset — choose it deliberately.
Docs: docs/subagents.md is for subagents; automations live in docs/usage.md.`;

async function api(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
        try {
                const res = await fetch(`${ENGINE_URL}${path}`, {
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
                        data: { error: `the self-learning engine is not reachable at ${ENGINE_URL}\n  automations need the stack running: bun run agent:start` },
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

export async function runAutomationsCommand(argv: string[], opts: { cwd: string }): Promise<CliResult> {
        const rest = argv.filter((a) => !a.startsWith("--") || a.includes("="));
        const sub = rest[0] ?? "list";

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
                if (rows.length === 0) {
                        const anyAtAll = (res.data.automations ?? []).length > 0;
                        return {
                                stdout: anyAtAll
                                        ? `No automations in this project (${(res.data.automations ?? []).length} filtered; --all lists every workspace).`
                                        : "No automations yet. Create one:\n  unown automations create --title 'morning brief' --cron '0 9 * * 1-5' \\\n      --prompt \"Summarize yesterday's commits and open TODOs; report risks.\"",
                                exitCode: 0,
                        };
                }
                const lines = rows.map((a: any) => {
                        const next = a.next_run_at ? new Date(a.next_run_at).toLocaleString() : "—";
                        const last = a.lastRun ? `${a.lastRun.status} ${new Date(a.lastRun.started_at).toLocaleString()}` : "never";
                        return `${a.id}  ${a.title}\n    ${a.schedule ?? a.cron_expr ?? "one-shot"} · mode ${a.mode} · ${a.lifecycle} · runs ${a.run_count}\n    next: ${next} · last: ${last}`;
                });
                return { stdout: lines.join("\n\n"), exitCode: 0 };
        }

        if (sub === "create") {
                const title = flagValue(argv, "--title");
                const prompt = flagValue(argv, "--prompt");
                const cron = flagValue(argv, "--cron");
                const delayMinutes = flagNumber(argv, "--delay-minutes");
                const mode = flagValue(argv, "--mode") === "standard" ? "standard" : "read-only";
                const model = flagValue(argv, "--model");
                const maxRuns = flagNumber(argv, "--max-runs");
                const workspace = flagValue(argv, "--workspace") ?? opts.cwd;
                if (!title || !prompt || (cron === undefined && delayMinutes === undefined)) {
                        return { stderr: `create needs --title, --prompt and (--cron | --delay-minutes)\n\n${AUTOMATIONS_USAGE}`, exitCode: 1 };
                }
                const res = await api("POST", "/api/automations", {
                        title,
                        prompt,
                        workspace,
                        cron,
                        delayMinutes,
                        mode,
                        model: model ?? null,
                        maxRuns: maxRuns ?? null,
                });
                if (!res.ok) return { stderr: String(res.data?.error ?? "create failed"), exitCode: 1 };
                const a = res.data.automation;
                return {
                        stdout:
                                `Created ${a.id} ("${a.title}")\n` +
                                `  schedule: ${a.cron_expr ? `${a.cron_expr} (${a.schedule})` : `one-shot in ${Math.round(((a.delay_ms ?? 0) - Date.now()) / 60000)} min`}\n` +
                                `  mode: ${a.mode}${a.model ? ` · model: ${a.model}` : ""}${a.max_runs ? ` · max scheduled runs: ${a.max_runs}` : ""}\n` +
                                `  next run: ${a.next_run_at ? new Date(a.next_run_at).toLocaleString() : "—"}\n` +
                                `  workspace: ${a.workspace}\n` +
                                `Inspect: unown automations history ${a.id} · trigger now: unown automations run ${a.id}`,
                        exitCode: 0,
                };
        }

        if (sub === "edit") {
                const id = rest[1];
                if (!id) return { stderr: `edit needs an id\n\n${AUTOMATIONS_USAGE}`, exitCode: 1 };
                const patch: Record<string, unknown> = {};
                for (const flag of ["--title", "--prompt", "--cron", "--mode"] as const) {
                        const v = flagValue(argv, flag);
                        if (v !== undefined) patch[flag.slice(2)] = v;
                }
                if (Object.keys(patch).length === 0) return { stderr: `edit needs at least one of --title --prompt --cron --mode`, exitCode: 1 };
                const res = await api("PATCH", `/api/automations/${encodeURIComponent(id)}`, patch);
                if (!res.ok) return { stderr: String(res.data?.error ?? "edit failed"), exitCode: 1 };
                const a = res.data.automation;
                return { stdout: `Updated ${a.id} — ${a.lifecycle}, next run ${a.next_run_at ? new Date(a.next_run_at).toLocaleString() : "—"}.`, exitCode: 0 };
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
                return { stdout: `Run started for ${id} — check progress: unown automations history ${id}`, exitCode: 0 };
        }

        if (sub === "history") {
                const id = rest[1];
                if (!id) return { stderr: `history needs an id\n\n${AUTOMATIONS_USAGE}`, exitCode: 1 };
                const limit = flagNumber(argv, "--limit") ?? 20;
                const res = await api("GET", `/api/automations/${encodeURIComponent(id)}/runs?limit=${limit}`);
                if (!res.ok) return { stderr: String(res.data?.error ?? "history failed"), exitCode: 1 };
                const runs = res.data.runs ?? [];
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
                return { stdout: `Deleted automation ${id}.`, exitCode: 0 };
        }

        return { stderr: `unknown subcommand "${sub}"\n\n${AUTOMATIONS_USAGE}`, exitCode: 1 };
}
