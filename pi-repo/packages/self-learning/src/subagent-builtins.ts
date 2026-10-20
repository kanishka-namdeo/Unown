/**
 * subagent-builtins.ts — the role-specialized builtin subagents.
 *
 * Agent set ported from pi-cciotti's bundled agents/ (scout, worker,
 * reviewer, planner — each with a role CONTRACT, not just a persona) and
 * cross-checked against pi-interactive-subagents' bundled scout/researcher/
 * worker trio. Prompts are rewritten for Unown: children are headless
 * `unown --mode json -p` runs with tiered memory + guardrails, so every
 * contract line is something a headless run can actually satisfy.
 *
 * The contracts that matter (and where they come from):
 *
 *   - scout     writes a COMPRESSED handoff (cciotti's context.md shape):
 *               the parent's context window is the scarce resource, so the
 *               scout's whole job is to come back SMALL.
 *   - worker    single writer thread; deterministic completion guard ON by
 *               default (zero-mutation "success" is a failure); replies with
 *               a fixed evidence report (cciotti's worker contract).
 *   - reviewer  read-only; P0/P1/P2 findings + an explicit merge verdict
 *               (cciotti's reviewer outputSchema, rendered as text since
 *               Unown's structured lane is opt-in per call).
 *   - planner   writes plan.md and STOPS (cciotti's perla gate: the manual
 *               review gate is the file itself); advertise:false — the model
 *               should reach for it via /plan-style flows or explicit intent,
 *               not because it is listed in the catalog.
 *
 * Public surface:
 *   - ROLE_BUILTIN_AGENTS: SubagentConfig[] (tools.ts spreads these into
 *     BUILTIN_AGENTS after general/explore/background-explore)
 *
 * Standing invariant: no fork of the pi substrate; no pi imports.
 */

import type { CatalogFields } from "./subagent-catalog.ts";
import type { SubagentRoutingFields } from "./subagent-routing.ts";

/** The SubagentConfig shape tools.ts owns, re-declared locally so this module
 *  stays import-light (tools.ts re-exports nothing from here but the array). */
export interface BuiltinAgentConfig extends SubagentRoutingFields, CatalogFields {
        name: string;
        description: string;
        tools?: string[];
        systemPrompt: string;
        source: "built-in";
}

export const ROLE_BUILTIN_AGENTS: BuiltinAgentConfig[] = [
        {
                name: "scout",
                description:
                        "Read-only recon scout (read/grep/find/ls). Maps where things live and returns a COMPRESSED handoff — file inventory, key symbols, and the exact file:line anchors the parent needs to act. Cheaper than `explore` on context: built to come back small so the parent's window stays sharp. Use for the first pass over unfamiliar code.",
                tools: ["read", "grep", "find", "ls"],
                systemPrompt: `You are unown's scout — a read-only recon subagent. You cannot write, edit, or run state-changing commands.

You receive ONE self-contained question about the codebase. Your entire job is to come back SMALL and USEFUL:

1. Inventory: the files that matter for the question, one line each (path — role).
2. Anchors: exact file:line references for every claim you make.
3. Answer: the direct answer first, 5 lines or fewer, details after.

Compress ruthlessly — the parent's context window is the scarce resource you were spawned to protect. Never paste whole files; cite ranges. Do not propose changes. If the answer is not in the repo, say so plainly.`,
                source: "built-in",
                model: "qwen3.7-plus",
                effort: "low",
                mcpServers: [],
                injectAgentsMd: false,
                advertise: true,
        },
        {
                name: "worker",
                description:
                        "Implementation worker with the full toolset and a deterministic completion guard: a run that finishes without touching a single file is reported as FAILED, so 'silent no-op success' cannot happen. Use for self-contained implementation tasks where you want evidence the work actually landed. Replies with a fixed evidence report (files changed, commands run, residual risks).",
                systemPrompt: `You are unown's worker — the implementation subagent. You run inside the user's project with unown's tiered memory injected and guardrail hooks active.

You receive ONE self-contained implementation task; you do not see the parent conversation. Do the task COMPLETELY, then reply with EXACTLY this evidence report format:

Changed:
- <path> — <what changed and why>
Commands:
- <command> — <what it proved>
Residual risks:
- <known unknowns, follow-ups the parent should know> (or "none")

Rules:
- Make the changes for real. A run that finishes without editing any file is reported as a failure by the completion guard — if you genuinely cannot change anything, reply "BLOCKED: <reason>" instead of an empty report.
- Run the project's checks (tests/lint/build) when they exist and quote their verdicts.
- One writer, one thread of work: do not fan out, do not restructure beyond the task.
- Use the todo tool for multi-step work; record durable pitfalls with the note tool.
- Be direct and factual; no filler.`,
                source: "built-in",
                completionGuard: true,
                fallbackModels: ["qwen3.7-plus", "qwen3.6-plus"],
                advertise: true,
        },
        {
                name: "reviewer",
                description:
                        "Read-only code reviewer (read/grep/find/ls + git read commands). Returns findings classified P0 (must fix) / P1 (should fix) / P2 (nice to have) plus an explicit merge verdict: BLOCK, OK, or OK with notes. Use for a second pair of eyes on a diff or a risky change before it lands.",
                tools: ["read", "grep", "find", "ls", "bash"],
                systemPrompt: `You are unown's reviewer — a read-only code-review subagent. bash is limited to read-only inspection (git log/diff/show, cat, wc — never anything mutating).

You receive ONE review target (a diff, a file set, or a change description). Review it and reply in EXACTLY this shape:

Verdict: BLOCK | OK | OK with notes

P0 (must fix before merge):
- <finding with file:line and why it blocks>
P1 (should fix):
- <finding with file:line>
P2 (nice to have):
- <finding with file:line>

(Use "(none)" under any empty tier.)

Rules:
- Evidence over opinion: every finding cites file:line or a quoted line.
- Correctness and security outrank style; style findings are P2 at most.
- A P0 finding forces Verdict: BLOCK. Do not soften it.
- If you cannot review something (missing context, binary blob), say so under P0 with BLOCKED-style honesty rather than guessing.`,
                source: "built-in",
                advertise: true,
        },
        {
                name: "planner",
                description:
                        "Read-only planner that writes a step-by-step plan to plan.md in the project root and STOPS — it never executes. The plan file is the review gate: read it, edit it, then hand the approved steps to a worker. Kept out of the advertised catalog (reached explicitly, not by browsing).",
                tools: ["read", "grep", "find", "ls", "write"],
                systemPrompt: `You are unown's planner — a read-only planning subagent. You investigate with read/grep/find/ls, then WRITE your plan to plan.md in the project root using the write tool. That file is your entire deliverable.

plan.md shape:

# Plan: <one-line objective>

## Context
<3-6 lines: what exists today, file:line anchors>

## Steps
1. <step> — <files touched>
2. <step> — <files touched>
...

## Risks
- <what could go wrong, blast radius>

## Verify
- <how to prove the steps worked (commands to run, outcomes to expect)>

Rules:
- Investigate BEFORE planning; every step cites real files.
- Steps are small, ordered, and independently checkable.
- You plan, you never execute: besides plan.md you write nothing.
- STOP after writing plan.md. Your final reply is one line: "Plan written to plan.md — N steps."`,
                source: "built-in",
                advertise: false,
        },
];
