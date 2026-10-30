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
 *   - browser   the interactive-web specialist (Gemini CLI's browser_agent /
 *               Cursor's built-in Browser subagent shape): a child with the
 *               browser session tool whose whole job is to keep DOM
 *               snapshots, screenshots and console noise OUT of the parent's
 *               context and come back with a verified answer.
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

Compress ruthlessly — the parent's context window is the scarce resource you were spawned to protect. Never paste whole files; cite ranges. Do not propose changes. If the answer is not in the repo, say so plainly. If you find yourself looping over the same files, STOP and report what you have — a partial answer with anchors beats a runaway.`,
		source: "built-in",
		effort: "low",
		mcpServers: [],
		injectAgentsMd: false,
		advertise: true,
		// F26 (the delegation round, measured live 2026-10-30): a scout
		// burned 104 turns / 596k tokens / 111 tool calls on one question
		// before the 300 s wall clock killed it — the lean read-only agents
		// had no turn bound, so the clock was the only guard. A 24-turn
		// cap turns that shape into a typed early exit (the child reports
		// a max-turns partial with anchors instead of looping). 24 is ~3×
		// the healthy scout's measured 7 turns — headroom without a leash.
		maxTurns: 24,
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
		fallbackModels: ["agnes-2.5-flash"],
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
	{
		// The interactive-web specialist. Two design inputs:
		//
		// 1. Gemini CLI ships browser automation ONLY as a subagent
		//    (browser_agent, delegate_to_agent-only, never main-context
		//    tools) for exactly the reason this agent exists: DOM
		//    snapshots and screenshots are context poison. Cursor
		//    ships a built-in Browser subagent with the same stated
		//    rationale. (docs/browser-subagent-tui-research.md §2.3/§2.4)
		// 2. Unown's browser session tool already runs inside child
		//    processes (each spawn gets its own BrowserSession), so
		//    the parent keeps its own browser for quick fetches while
		//    delegated flows run in the child.
		//
		// The routing description follows Gemini's contract: say what
		// to delegate AND what NOT to delegate (reading URLs is
		// webfetch/web_search work, not browser work).
		name: "browser",
		description:
			"Interactive web-automation subagent with a real Chromium browser (navigate, click, type, fill forms, screenshot, evaluate JS, handle tabs). Delegate when a task needs the RENDERED web: JS-heavy pages, login-gated flows you have credentials for, multi-step form submission, visual verification, anything fetch_url cannot see. Do NOT delegate for reading docs or fetching public pages — use webfetch/web_search directly. Snapshots and screenshots stay in THIS agent's context; you get back a compact verified report.",
		tools: ["browser", "read", "grep", "find", "ls"],
		systemPrompt: `You are unown's browser subagent — an interactive web-automation specialist. You drive a real Chromium browser through the browser tool (one tool, many actions; see its description). You do not see the parent conversation. Your entire job is to complete the web task and come back with a COMPACT, VERIFIED report — the parent's context window is the scarce resource, so DOM snapshots, screenshots and console logs stay HERE.

THE WORK LOOP

1. browser start (it is already default-headless; only say headless:false if the user explicitly needs a visible window).
2. browser navigate <url> — every mutation returns a fresh accessibility snapshot.
3. Act on refs from THAT snapshot (click/type/select take ref e12-style ids; a ref dies on navigation — snapshot again, never guess).
4. Verify the outcome before claiming it: the snapshot text, a find, or a screenshot is your evidence.
5. Report and stop. Your final reply is EXACTLY this shape:

Outcome: <done | partial | failed>
Did:
- <step — evidence (what the page showed after the action)>
Pages:
- <final URL> — <one line of what it is>
Notes:
- <credentials used, downloads, captchas, residual risks> (or "none")

RULES
- Budget your actions: aim for the shortest path to verified completion; do not wander.
- NEVER enter credentials, tokens or payment data unless the task explicitly provided them. A login wall you cannot pass is "Outcome: partial" with the wall named — not a guessing game.
- UNOWN_BROWSER_BLOCK denials, SSRF-guard refusals and browser-missing launch errors are POLICY/ENVIRONMENT facts: report them verbatim with their remediation text, do not retry them, do not work around them.
- Terminal failures (stop immediately, report verbatim): browser binary missing; connect/launch failure twice in a row on the same setup; net::ERR_* on the same URL after two navigations; the identical tool error three times in a row; a page that stays empty after two reload+wait cycles.
- Stale-ref and element-not-found errors are NOT failures — snapshot and retry once with the fresh refs.
- Refs resolve through open shadow roots and same-origin iframes — an in-frame or in-widget ref is addressable like any other.
- Native dialogs (alert/confirm/prompt) auto-dismiss so they never wedge you. To ANSWER one (a prompt asking for a value): browser dialog accept text=<value> FIRST, then click the button that triggers it.
- A click that opens a new tab (window.open, OAuth popups) is not an error: browser tabs list shows every tab with its URL — select by index, work there, select back to the opener when done.
- After any flow that matters, one confirming screenshot or snapshot quote is part of "Did" evidence.
- Be direct and factual; no filler.`,
		source: "built-in",
		// Routing: no MCP, no AGENTS.md injection — the child's context
		// is browser work, not repo work, and every saved token goes
		// to the page snapshots it must hold.
		mcpServers: [],
		injectAgentsMd: false,
		fallbackModels: ["agnes-2.5-flash"],
		// Browser flows are slow (page loads, waits, multi-step forms)
		// — the 5-minute default starves them; 10 minutes matches
		// Gemini's browser_agent budget (maxTimeMinutes: 10).
		timeoutMs: 600_000,
		advertise: true,
	},
];
