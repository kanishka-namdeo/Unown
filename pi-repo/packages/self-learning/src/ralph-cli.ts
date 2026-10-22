/**
 * ralph-cli.ts — `unown ralph`: the shell surface for the Ralph loop
 * (M4; the loop itself lives in src/ralph.ts).
 *
 *   unown ralph "<task>" [--iterations N] [--model <id>] [--reviewer-model <id>]
 *                        [--workspace <path>] [--json]
 *
 * Cross-model is the point of the pattern (goose's tutorial: use a DIFFERENT
 * reviewer model — a second opinion from the same model that did the work is
 * a weaker second opinion). The help text says so; --reviewer-model is
 * accepted-but-optional because single-model loops are still useful.
 *
 * Exit codes: 0 = SHIP (the reviewer shipped the work); 1 = the iteration
 * budget ran out (work inspected, not shipped — honest, actionable); 2 =
 * usage error.
 */
import { resolve } from "node:path";
import { capIterations, RALPH_DEFAULT_ITERATIONS, RALPH_MAX_ITERATIONS, runRalphLoop, type RalphLoopResult } from "./ralph.ts";

export const RALPH_USAGE = `unown ralph — the worker→reviewer loop (fresh context every iteration)

Usage:
  unown ralph "<task>" [flags]

  A worker session does the task, a reviewer session (ideally a DIFFERENT
  model) judges the repository state and answers VERDICT: SHIP or REVISE;
  a revise writes feedback and the next worker iteration starts fresh —
  state is handed off through files (.unown/ralph/<run>/), never history.

Flags:
  --iterations <n>        iteration budget (default ${RALPH_DEFAULT_ITERATIONS}, max ${RALPH_MAX_ITERATIONS})
  --model <id>            worker model (default: the configured model)
  --reviewer-model <id>   reviewer model — use a DIFFERENT model than the
                          worker; that is the point of the pattern
  --workspace <path>      where the work happens (default: cwd)
  --json                  machine-readable result record

Exit codes: 0 shipped · 1 iteration budget exhausted (not shipped) · 2 usage.

Docs: docs/ralph.md (the decision record + goose sources).`;

export interface CliResult {
        stdout?: string;
        stderr?: string;
        exitCode: number;
}

function flagValue(argv: string[], name: string): string | undefined {
        const i = argv.indexOf(name);
        return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

/** Render one loop's outcome for the terminal (the --json shape is the
 * RalphLoopResult verbatim). */
function render(res: RalphLoopResult): string {
        const lines: string[] = [];
        lines.push(`ralph ${res.runId} — "${res.task.slice(0, 120)}${res.task.length > 120 ? "…" : ""}"`);
        lines.push(`  workspace: ${res.workspace} · budget ${res.maxIterations} iterations${res.baseline ? ` · baseline ${res.baseline.slice(0, 12)}` : ""}`);
        for (const it of res.iterations) {
                const verdict = it.verdictExplicit ? it.verdict.toUpperCase() : `REVISE (no VERDICT line — defaulted)`;
                lines.push(
                        `  iteration ${it.iteration}: worker exit ${it.worker.exitCode} (${it.worker.turns} turns) · reviewer exit ${it.reviewer.exitCode} (${it.reviewer.turns} turns) → ${verdict}`,
                );
        }
        lines.push(
                res.final === "ship"
                        ? `  SHIPPED after ${res.iterations.length} iteration(s) · ${res.tokensIn}+${res.tokensOut} tokens`
                        : `  NOT SHIPPED — ${res.maxIterations} iteration(s) spent, the last feedback is in feedback.md`,
        );
        lines.push(`  files: ${res.dir}/ (task.md · summary.md · feedback.md · verdict.md)`);
        return lines.join("\n") + "\n";
}

export async function runRalphCommand(argv: string[], opts: { cwd: string }): Promise<CliResult> {
        const positional = argv.filter((a) => !a.startsWith("-"));
        if (argv.includes("-h") || argv.includes("--help") || positional[0] === "help") {
                return { stdout: RALPH_USAGE, exitCode: 0 };
        }
        const task = positional.join(" ").trim();
        if (!task) {
                return { stderr: `unown ralph needs a task in quotes — e.g. unown ralph "fix the flaky router test"\n\n${RALPH_USAGE}`, exitCode: 2 };
        }
        const rawIterations = flagValue(argv, "--iterations");
        let iterations = RALPH_DEFAULT_ITERATIONS;
        if (rawIterations !== undefined) {
                const n = Number(rawIterations);
                const capped = capIterations(n);
                if (!capped.ok) return { stderr: `unown ralph: ${capped.error}\n\n${RALPH_USAGE}`, exitCode: 2 };
                iterations = capped.iterations;
        }
        const workspace = resolve(flagValue(argv, "--workspace") ?? opts.cwd);
        const workerModel = flagValue(argv, "--model") ?? null;
        const reviewerModel = flagValue(argv, "--reviewer-model") ?? null;

        const res = await runRalphLoop({ task, workspace, maxIterations: iterations, workerModel, reviewerModel });
        if (argv.includes("--json")) {
                return { stdout: JSON.stringify(res, null, 2) + "\n", exitCode: res.final === "ship" ? 0 : 1 };
        }
        return { stdout: render(res), exitCode: res.final === "ship" ? 0 : 1 };
}
