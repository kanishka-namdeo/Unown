/**
 * goal.ts — durable, evidence-verified objectives (/goal).
 *
 * Reverse-engineered from zcode's Goal Mode ("after each round a separate
 * verification pass requiring real evidence — changed files, command output,
 * test results; unfinished todos block completion; state survives restart")
 * and muse code's goals ("requirement-by-requirement completion check"),
 * reduced to a state machine that rides the unown-tools extension:
 *
 *   - goal state persists as a session entry (`unown-goal`) so it survives
 *     /new /resume /fork — the same mechanism plan-mode and todos use
 *   - while active, every turn gets a goal context message: the objective,
 *     the requirement that completion claims cite REAL evidence (changed
 *     file paths, command output, test results), and the [GOAL:COMPLETE]
 *     tag contract
 *   - `checkGoalCompletion` is the completion gate: the tag must be present,
 *     every session todo must be done (zcode's unfinished-todos-block rule),
 *     and the message must carry evidence markers (file paths or command
 *     output quotes) — agent-honest, not cryptographic, and documented as
 *     such
 *
 * The command surface: /goal <objective>, /goal (status), /goal pause,
 * /goal resume, /goal clear, plus the --goal CLI flag for headless runs.
 */
import { isAbsolute, join } from "node:path";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface GoalState {
    text: string;
    status: "active" | "paused" | "complete";
    createdAt: number;
    completedAt?: number;
    completedEvidence?: string[];
}

/** Parse /goal command args into an action. */
export function parseGoalCommand(args: string): { action: "set" | "status" | "pause" | "resume" | "clear"; text?: string } {
    const trimmed = (args ?? "").trim();
    if (!trimmed) return { action: "status" };
    const lower = trimmed.toLowerCase();
    if (lower === "pause") return { action: "pause" };
    if (lower === "resume") return { action: "resume" };
    if (lower === "clear" || lower === "stop" || lower === "done") return { action: "clear" };
    return { action: "set", text: trimmed };
}

/** The per-turn context injected while a goal is active. */
export function goalContextMessage(goal: GoalState): string {
    const elapsedMin = Math.max(1, Math.round((Date.now() - goal.createdAt) / 60000));
    return `[GOAL ACTIVE — ${elapsedMin} min elapsed]
Objective: ${goal.text}

Rules for completing this goal:
- Work incrementally; track the steps with the todo tool.
- When (and ONLY when) the objective is fully achieved, end your reply with a line containing the exact tag [GOAL:COMPLETE].
- The completion line must cite REAL evidence: changed file paths, commands you ran with their output, or test results. A claim without evidence does not count.
- If any todo is unfinished, the goal is not complete — do not emit the tag.
- If the goal turns out to be infeasible, say so plainly instead of tagging.`;
}

// ---------------------------------------------------------------------------
// The completion gate
// ---------------------------------------------------------------------------

export interface CompletionCheck {
    complete: boolean;
    reasons: string[];
    evidence: string[];
}

const GOAL_TAG = /\[GOAL:COMPLETE\]/i;
const EVIDENCE_PATH = /(?:^|\s)(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+|[A-Za-z0-9_-]+\.(?:ts|tsx|js|jsx|py|go|rs|c|cpp|java|rb|php|sh|md|json|yaml|yml|toml))(?:$|[\s,:;)\]})])/;
const EVIDENCE_OUTPUT = /(?:^|\s)(?:\$ |> |exit (?:code )?[01]\b|tests? (?:passed|failed)|\d+\/\d+ (?:passed|ok|green)|PASS|FAIL)/i;

/**
 * The completion gate. `message` is the assistant's final reply; `todos` is
 * the live todo list ({done}). Completion requires the tag, all todos done,
 * and at least two distinct evidence markers (paths and/or command output).
 */
export function checkGoalCompletion(message: string, todos: Array<{ done: boolean }>): CompletionCheck {
    const reasons: string[] = [];
    const evidence: string[] = [];
    if (!GOAL_TAG.test(message)) reasons.push("no [GOAL:COMPLETE] tag in the final reply");
    const open = todos.filter((t) => !t.done).length;
    if (open > 0) reasons.push(`${open} unfinished todo(s)`);
    for (const line of message.split("\n")) {
        // A single line can carry both kinds of marker (path + result).
        if (EVIDENCE_PATH.test(line)) evidence.push(`file: ${line.trim().slice(0, 120)}`);
        if (EVIDENCE_OUTPUT.test(line)) evidence.push(`output: ${line.trim().slice(0, 120)}`);
    }
    if (evidence.length < 2) reasons.push(`insufficient evidence cited (${evidence.length} marker(s), need ≥2: changed-file paths and/or command output)`);
    return { complete: reasons.length === 0, reasons, evidence: [...new Set(evidence)] };
}

/** Status line for /goal. */
export function renderGoalStatus(goal: GoalState | null): string {
    if (!goal) return "No goal set. Usage: /goal <objective> — durable, evidence-verified completion; /goal pause|resume|clear.";
    const age = new Date(goal.createdAt).toISOString().slice(0, 19).replace("T", " ");
    const status =
        goal.status === "complete"
            ? `COMPLETE (finished ${new Date(goal.completedAt ?? goal.createdAt).toISOString().slice(0, 19).replace("T", " ")})`
            : goal.status.toUpperCase();
    const evidence = goal.completedEvidence?.length ? `\nEvidence: ${goal.completedEvidence.slice(0, 5).join(" | ")}` : "";
    return `Goal [${status}] (since ${age}): ${goal.text}${evidence}`;
}

/** Resolve a claimed evidence path against the project (display helper). */
export function resolveEvidencePath(cwd: string, raw: string): string {
    const cleaned = raw.trim().replace(/^["'`]|["'`]$/g, "");
    return isAbsolute(cleaned) ? cleaned : join(cwd, cleaned);
}
