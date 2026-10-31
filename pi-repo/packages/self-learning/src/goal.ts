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
 *   - `checkGoalCompletion` is the completion gate: the tag must be present
 *     (as its OWN line in the final reply — a mid-text mention is not a
 *     completion claim), every session todo must be done (zcode's
 *     unfinished-todos-block rule — and at least one todo must EXIST, so a
 *     model that simply never tracks todos cannot pass vacuously), and the
 *     message must cite evidence of BOTH kinds — ≥1 changed-file path AND
 *     ≥1 command-output marker (distinct kinds kill the single-line
 *     "> Fixed src/app.ts" passes; blockquoted text never counts) —
 *     agent-honest, not cryptographic, and documented as such
 *
 * The command surface: /goal <objective>, /goal (status), /goal pause,
 * /goal resume, /goal clear, plus the --goal CLI flag for headless runs.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { loadHubPrefs } from "./settings/prefs.ts";
import { resolveUnownHome } from "./unown-home.ts";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface GoalState {
    text: string;
    status: "active" | "paused" | "complete";
    createdAt: number;
    completedAt?: number;
    completedEvidence?: string[];
    /** Turns injected while active (the budget counter — additive, optional). */
    turns?: number;
    /** S2-13: a command that must exit 0 before completion counts
     *  (/goal verify <command>). Absent = the evidence gate alone. */
    verifyCommand?: string;
}

/** Parse /goal command args into an action. */
export function parseGoalCommand(
    args: string,
): { action: "set" | "status" | "pause" | "resume" | "clear" | "history" | "verify"; text?: string } {
    const trimmed = (args ?? "").trim();
    if (!trimmed) return { action: "status" };
    const lower = trimmed.toLowerCase();
    if (lower === "pause") return { action: "pause" };
    if (lower === "resume") return { action: "resume" };
    if (lower === "clear" || lower === "stop" || lower === "done") return { action: "clear" };
    if (lower === "history") return { action: "history" };
    if (lower.startsWith("verify")) {
        const rest = trimmed.slice("verify".length).trim();
        return { action: "verify", text: rest };
    }
    return { action: "set", text: trimmed };
}

/** The per-turn context injected while a goal is active. The optional
 *  budget line (settings-hub.json → goalBudgetTurns) is shown when set, so
 *  the model knows the grind has a ceiling before auto-pause. */
export function goalContextMessage(goal: GoalState): string {
    const elapsedMin = Math.max(1, Math.round((Date.now() - goal.createdAt) / 60000));
    const budgetLine =
        goalBudgetTurnsSetting() > 0
            ? `\n- Budget: this goal auto-pauses after ${goalBudgetTurnsSetting()} turns (${goal.turns ?? 0} used). If the budget runs out before the objective is met, say so plainly — do not tag.`
            : "";
    return `[GOAL ACTIVE — ${elapsedMin} min elapsed]
Objective: ${goal.text}

Rules for completing this goal:
- Work incrementally; track the steps with the todo tool (completion requires todos to exist and all be done).
- When (and ONLY when) the objective is fully achieved, end your reply with a line containing the exact tag [GOAL:COMPLETE].
- The completion message must cite REAL evidence of BOTH kinds: at least one changed file path AND at least one command output or test result (e.g. a $-prefixed command line or a "<n>/<n> passed" tally). One kind alone does not count; quoted/echoed text does not count.
- If any todo is unfinished, the goal is not complete — do not emit the tag.
- If the goal turns out to be infeasible, say so plainly instead of tagging.${budgetLine}`;
}

/** The hub-owned goal budget (0 = off). Read live so /settings changes apply
 *  to the very next turn without a restart. */
export function goalBudgetTurnsSetting(): number {
    try {
        const prefs = loadHubPrefs();
        if (Number.isFinite(prefs.goalBudgetTurns) && prefs.goalBudgetTurns >= 0) return Math.trunc(prefs.goalBudgetTurns);
    } catch {
        /* default off */
    }
    return 0;
}

// ---------------------------------------------------------------------------
// The completion gate
// ---------------------------------------------------------------------------

export interface CompletionCheck {
    complete: boolean;
    reasons: string[];
    evidence: string[];
}

/** T6: the completion tag counts only as its OWN line in the final message
 *  (leading/trailing whitespace tolerated — "its own line after trim") — a
 *  mid-text mention (the agent discussing the tag) is not a completion
 *  claim. Case-insensitive, matching the old GOAL_TAG. */
const GOAL_TAG_LINE = /^\s*\[GOAL:COMPLETE\]\s*$/i;

/** T6 helper shared by the gate and the agent_end pre-check (so a mid-text
 *  tag neither completes the goal nor triggers reject-noise every turn). */
export function hasGoalTag(message: string): boolean {
    return message.split("\n").some((line) => GOAL_TAG_LINE.test(line));
}

// T1 evidence regexes (tightened, R-b workflows audit + §5.4 fixtures):
//
// FILE-PATH evidence — a path token that actually looks like a repo path:
// word/dot/slash/hyphen chars ending in a dot + a 1–8 char extension
// (`src/auth.ts`, `packages/self-learning/review.ts`). The old alternation
// counted bare slash-words ("tabs/spaces", "either/or") as paths; the
// extension requirement kills those (and keeps `Makefile`-style dotless
// names out, as before).
const EVIDENCE_PATH = /\b[\w./-]+\.[A-Za-z0-9]{1,8}\b/;
//
// COMMAND-OUTPUT evidence — a line that looks like real runner output, kept
// deliberately conservative (the old regex matched `PASS`/`FAIL` anywhere,
// `> ` blockquotes and bare `exit 0` — "will pass review" and "$ 100"
// counted as output evidence):
//   1. `^\s*[$%]\s`        a shell prompt line (`$ npm test`, `% make check`)
//   2. `exit code <n>`      an explicit runner exit report (the word "code"
//                          is required — a bare "exit 0" is trivially
//                          forgeable prose)
//   3. `<n>/<n> passed|failed|ok|green`   a test tally ("12/12 passed")
//   4. `tests? passed|failed`            a test outcome phrase ("tests passed"
//                          — "the tests will pass" still does NOT match)
const EVIDENCE_OUTPUT =
    /^\s*[$%]\s|exit code\s*:?\s*\d+\b|\b\d+\s*\/\s*\d+\s+(?:passed|failed|ok|green)\b|\btests?\s+(?:passed|failed)\b/i;
//
// Blockquoted lines (`> …`) are dropped before ANY evidence matching: quoted
// text is not the agent's own evidence (the audit's "> Fixed src/app.ts"
// false positive satisfied the ≥2-marker gate alone).
const BLOCKQUOTE = /^\s*>/;

/**
 * The completion gate (hardened, R-b T1/T2/T6). `message` is the assistant's
 * final reply; `todos` is the live todo list ({done}). Completion requires:
 *   - the [GOAL:COMPLETE] tag on its OWN line in the final reply (T6)
 *   - at least one tracked todo, all done (T2: an empty list rejects —
 *     verifiable completion needs a todo trail, not a vacuous "all done")
 *   - ≥1 file-path evidence AND ≥1 command-output evidence marker (T1:
 *     distinct kinds — two paths on one line no longer pass)
 */
export function checkGoalCompletion(message: string, todos: Array<{ done: boolean }>): CompletionCheck {
    const reasons: string[] = [];
    const evidence: string[] = [];
    if (!hasGoalTag(message)) reasons.push("no [GOAL:COMPLETE] tag as its own line in the final reply");
    if (todos.length === 0) {
        reasons.push(
            "no todos tracked — track the goal's steps with the todo tool before claiming completion (an empty list is not verifiable)",
        );
    } else {
        const open = todos.filter((t) => !t.done).length;
        if (open > 0) reasons.push(`${open} unfinished todo(s)`);
    }
    let hasPathEvidence = false;
    let hasOutputEvidence = false;
    for (const line of message.split("\n")) {
        if (BLOCKQUOTE.test(line)) continue; // quoted text is not evidence
        // One line may carry both kinds (path + outcome) — the DISTINCT-KIND
        // requirement is what kills single-kind gaming.
        if (EVIDENCE_PATH.test(line)) {
            hasPathEvidence = true;
            evidence.push(`file: ${line.trim().slice(0, 120)}`);
        }
        if (EVIDENCE_OUTPUT.test(line)) {
            hasOutputEvidence = true;
            evidence.push(`output: ${line.trim().slice(0, 120)}`);
        }
    }
    if (!hasPathEvidence || !hasOutputEvidence) {
        const missing = [!hasPathEvidence && "≥1 changed-file path", !hasOutputEvidence && "≥1 command-output marker"]
            .filter(Boolean)
            .join(" and ");
        reasons.push(`insufficient evidence cited (need distinct kinds: ${missing})`);
    }
    return { complete: reasons.length === 0, reasons, evidence: [...new Set(evidence)] };
}

// ---------------------------------------------------------------------------
// Session-entry restore (T7)
// ---------------------------------------------------------------------------

/** T7: validate a persisted `unown-goal` entry before it becomes live state.
 *  Returns `{ goal: null }` for a legitimate clear (`data: null`/undefined)
 *  and `{ goal: null, warning }` for a drifted/old shape — missing text,
 *  unknown status, non-object — so /goal renders "No goal set" instead of
 *  crashing on `goal.status.toUpperCase()`. */
export function parseGoalEntry(data: unknown): { goal: GoalState | null; warning?: string } {
    if (data === null || data === undefined) return { goal: null };
    if (typeof data !== "object") {
        return { goal: null, warning: "ignoring malformed unown-goal session entry (not an object)" };
    }
    const raw = data as Record<string, unknown>;
    if (typeof raw.text !== "string" || !raw.text.trim()) {
        return { goal: null, warning: "ignoring malformed unown-goal session entry (missing objective)" };
    }
    if (raw.status !== "active" && raw.status !== "paused" && raw.status !== "complete") {
        return {
            goal: null,
            warning: `ignoring malformed unown-goal session entry (unknown status ${JSON.stringify(String(raw.status))})`,
        };
    }
    if (typeof raw.createdAt !== "number" || !Number.isFinite(raw.createdAt)) {
        return { goal: null, warning: "ignoring malformed unown-goal session entry (missing createdAt)" };
    }
    const goal: GoalState = { text: raw.text, status: raw.status, createdAt: raw.createdAt };
    if (typeof raw.completedAt === "number" && Number.isFinite(raw.completedAt)) goal.completedAt = raw.completedAt;
    if (Array.isArray(raw.completedEvidence)) {
        goal.completedEvidence = raw.completedEvidence.filter((e): e is string => typeof e === "string");
    }
    if (typeof raw.turns === "number" && Number.isFinite(raw.turns) && raw.turns >= 0) {
        goal.turns = Math.trunc(raw.turns);
    }
    return { goal };
}

/** Status line for /goal. */
export function renderGoalStatus(goal: GoalState | null): string {
    if (!goal) return "No goal set. Usage: /goal <objective> — durable, evidence-verified completion; /goal pause|resume|clear|history|verify <cmd>.";
    const age = new Date(goal.createdAt).toISOString().slice(0, 19).replace("T", " ");
    const status =
        goal.status === "complete"
            ? `COMPLETE (finished ${new Date(goal.completedAt ?? goal.createdAt).toISOString().slice(0, 19).replace("T", " ")})`
            : goal.status.toUpperCase();
    const evidence = goal.completedEvidence?.length ? `\nEvidence: ${goal.completedEvidence.slice(0, 5).join(" | ")}` : "";
    const verify = goal.verifyCommand ? `\nVerify gate: ${goal.verifyCommand} (must exit 0 before completion counts)` : "";
    const days = goalAgeDays(goal);
    const nudge =
        goal.status !== "complete" && days >= 3
            ? `\n⚠ ${Math.floor(days)} days old — still the goal you want? /goal pause, /goal clear, or replace it (with confirmation).`
            : "";
    return `Goal [${status}] (since ${age}): ${goal.text}${evidence}${verify}${nudge}`;
}

/** Whole days since the goal was set (the age nudge's clock — S2-13). */
export function goalAgeDays(goal: GoalState): number {
    return (Date.now() - goal.createdAt) / 86_400_000;
}

/** Resolve a claimed evidence path against the project (display helper). */
export function resolveEvidencePath(cwd: string, raw: string): string {
    const cleaned = raw.trim().replace(/^["'`]|["'`]$/g, "");
    return isAbsolute(cleaned) ? cleaned : join(cwd, cleaned);
}

// ---------------------------------------------------------------------------
// Goal history (S2-13): every goal that ended — replaced, cleared, or
// completed — lands in ~/.unown/agent/goal-history.jsonl. Append-only,
// call-time home resolution (the unown-home.ts contract), malformed lines
// skipped like every other jsonl lane.
// ---------------------------------------------------------------------------

export interface GoalHistoryEntry {
    text: string;
    outcome: "replaced" | "cleared" | "complete";
    setAt: number;
    endedAt: number;
    turns?: number;
    verifyCommand?: string;
    /** Completion-gate evidence (outcome === "complete" only). */
    completedEvidence?: string[];
}

function goalHistoryPath(): string {
    return join(resolveUnownHome(), "agent", "goal-history.jsonl");
}

export function appendGoalHistory(entry: GoalHistoryEntry): void {
    try {
        const path = goalHistoryPath();
        mkdirSync(dirname(path), { recursive: true });
        appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
    } catch {
        /* history is best-effort — never block a goal transition */
    }
}

export function readGoalHistory(n = 10): GoalHistoryEntry[] {
    try {
        const raw = readFileSync(goalHistoryPath(), "utf8");
        const entries: GoalHistoryEntry[] = [];
        for (const line of raw.split("\n")) {
            const t = line.trim();
            if (!t) continue;
            try {
                entries.push(JSON.parse(t) as GoalHistoryEntry);
            } catch {
                /* skip malformed */
            }
        }
        return entries.slice(-n).reverse();
    } catch {
        return [];
    }
}

export function renderGoalHistory(n = 10): string {
    const entries = readGoalHistory(n);
    if (entries.length === 0) return "No goal history yet — replaced/cleared/completed goals land here.";
    const lines = entries.map((e) => {
        const when = new Date(e.endedAt).toISOString().slice(0, 16).replace("T", " ");
        const turns = e.turns !== undefined ? ` · ${e.turns} turns` : "";
        return `  ${when} [${e.outcome}] ${e.text.slice(0, 70)}${e.text.length > 70 ? "…" : ""}${turns}`;
    });
    return `Goal history (newest first, last ${entries.length}):\n${lines.join("\n")}`;
}
