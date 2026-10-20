# Subagents

Fresh-context unown agents the model can spawn mid-session with the `task` tool — the built-ins, your own `.unown/agents/*.md` definitions, and their limits.

- [The task tool](#the-task-tool)
- [Structured outputs](#structured-outputs)
- [Worktree isolation](#worktree-isolation)
- [The interactive fleet (async subagents)](#the-interactive-fleet-async-subagents)
- [Fire-and-forget spawns](#fire-and-forget-spawns)
- [Steering and control: task_control](#steering-and-control-task_control)
- [Questions mid-task: ask_question](#questions-mid-task-ask_question)
- [The fleet widget and /tasks](#the-fleet-widget-and-tasks)
- [Fleet state on disk](#fleet-state-on-disk)
- [Built-in agents](#built-in-agents)
- [The advertised catalog](#the-advertised-catalog)
- [Authoring custom agents](#authoring-custom-agents)
- [Per-agent routing](#per-agent-routing)
- [Fallback models](#fallback-models)
- [Context briefs](#context-briefs)
- [The BLOCKED protocol](#the-blocked-protocol)
- [The completion guard](#the-completion-guard)
- [How the model invokes them](#how-the-model-invokes-them)
- [What subagents cannot do](#what-subagents-cannot-do)
- [When to use subagents](#when-to-use-subagents)

Related pages: [usage](usage.md) · [skills](skills.md) · [memory](memory.md) · [recipes](recipes.md)

## The task tool

The `task` tool (registered in every session that is not itself a subagent) launches a **unown subagent with a fresh context window** to work on one self-contained task. Under the hood each subagent is a full `unown` subprocess — `unown --mode json -p --no-session` — with the agent definition's toolset and system prompt attached via `--tools` and `--append-system-prompt`, and its routing overrides (see [Per-agent routing](#per-agent-routing)) via `--model`, `--effort`, `--mcp-servers` and `--no-agents-md`.

Because it is a real unown process, a subagent gets everything a terminal session gets:

- the same tiered [memory](memory.md) injected,
- the same [guardrails](usage.md#guardrails) (bash deny-list, write-path jail, syntax gate),
- and on exit it writes its own session note, tagged `[subagent]`, for AutoDream to consolidate — **subagents learn too**.

The subagent does not see the parent conversation. The parent gets back a report: exit status, turns, tokens in/out, tool-call count, and the subagent's final message.

## Structured outputs

Any task call (single or batch item) can demand a **typed reply** with `output_schema` — a JSON Schema the subagent's *final message* must satisfy. The reply is parsed as JSON (bare JSON, a fenced `json` code block, or one JSON object surrounded by prose all work) and validated locally; an invalid reply is retried up to two times with the **exact, path-annotated defects** quoted back to the child (`$.findings[0].severity: expected low | medium | high, got "critical"`), after which:

- `schema_mode: "permissive"` (the default) returns the raw reply **with a visible warning** — good enough to read, honest about the miss;
- `schema_mode: "strict"` reports the failure as an error and returns no data.

A valid reply is returned to the parent as a fenced JSON block — the structured data *is* the report. A malformed `output_schema` fails immediately, before any subagent is spawned (no paid run on a broken contract). Use it whenever the parent wants to *consume* the result programmatically — findings lists, inventories, typed reports — instead of re-parsing prose.

## Worktree isolation

A writing subagent normally shares your working tree. Pass `worktree_isolation: true` (single task or batch item) and the subagent instead runs in **its own git worktree** — an isolated checkout of the repo at HEAD, created at `<repo>/.unown/worktrees/<id>` — so parallel writers can never collide with each other or with your uncommitted work.

The contract: isolation is opt-in and **fail-closed** — outside a git repository (or with `UNOWN_WORKTREE_ISOLATION=0`) the spawn is rejected with a typed failure, never silently downgraded to the shared tree. When the subagent finishes, a **clean, commit-less** worktree is removed again automatically; a tree with uncommitted files or new commits is **kept** and its path is reported back so you can review and merge it through your normal source-control workflow (nothing is merged automatically, and the parent repo is never touched during the run). Every tree's lifecycle is journaled to `.unown/worktrees/registry.jsonl` (base commit, policy, disposition), probes run with repository **hooks disabled**, and a tree whose state cannot be proven after a crash is quarantined, not deleted.



| Setting | Meaning |
|---|---|
| `UNOWN_WORKTREE_ISOLATION` | `0`/`false`/`no` disables the lane (typed rejections); empty/unset = enabled (the default) |

## Built-in agents

| Name | Tools | Use for |
|---|---|---|
| `general` | full toolset (read/write/edit/bash + todo/note/web_search/webfetch), same tiered memory | Self-contained implementation or investigation tasks that deserve a fresh context |
| `explore` | `read`, `grep`, `find`, `ls` — read-only | Mapping where things live in the repo and returning file:line evidence, whenever broad code search would pollute the parent context |
| `scout` | `read`, `grep`, `find`, `ls` — read-only, cheap routing (qwen3.7-plus, effort low, no MCP, no memory injection) | First-pass recon that comes back SMALL: a compressed inventory + anchors handoff built to protect the parent's context window — cheaper on context than `explore` |
| `background-explore` | `read`, `grep`, `find`, `ls` — read-only | Low-cost background sweeps: same evidence-first shape as `explore`, but routed to a cheaper model (`qwen3.7-plus`) at `effort: low`, loading **no MCP servers** and skipping AGENTS.md/memory injection — the minimal-overhead lane for parallel fact-finding |
| `worker` | full toolset, **completion guard on** | Implementation with evidence: a run that finishes without touching a single file is reported as FAILED (silent no-op success cannot happen), and the reply follows a fixed evidence report — Changed / Commands / Residual risks. Falls back across models on provider failures |
| `reviewer` | `read`, `grep`, `find`, `ls`, `bash` (read-only inspection) | Second pair of eyes: P0/P1/P2 findings with file:line evidence and an explicit merge verdict — BLOCK, OK, or OK with notes. A P0 forces BLOCK |
| `planner` | `read`, `grep`, `find`, `ls`, `write` (plan.md only) | Writes a step-by-step `plan.md` to the project root and STOPS — the plan file is the review gate; read it, edit it, then hand the approved steps to a `worker`. Not listed in the advertised catalog (reached explicitly) |

`general` is the default when no agent is named.

## The advertised catalog

Before each turn, the parent's system prompt carries an `<advertised_subagents>` block: every discovered agent (built-ins + your `.md` files, minus any that set `advertise: false`) with its name and description, plus the one-sentence delegation policy. This is how the model *knows* your project agents exist without guessing names — previously only `general` and `explore` were named in the tool description, and a typo'd agent name cost a corrective round-trip.

The block is byte-budgeted like a prompt citizen, not a dump: at most 16 agents, 12,288 rendered bytes, 512-byte descriptions (truncated byte-safely with an ellipsis). Overflow drops whole agents from the front of discovery order (built-ins go first, so project-specific agents survive) and records the drop with `<omitted count="N"/>`. The catalog tells the model to confirm the exact agent before executing; unknown names still fail fast with the available list.

**Delegation levels** shape the policy sentence (and are the dial for cost-sensitive work):

| `UNOWN_DELEGATION_LEVEL` | Policy sentence the model gets |
|---|---|
| `never` | Delegate only when the user explicitly asks for a subagent. **The catalog is withdrawn entirely** (the `task` tool still works when invoked explicitly) |
| `rarely` | Delegate rarely — only for large, clearly separable investigations the user would expect you to hand off |
| `standard` *(default)* | Delegate focused, self-contained investigations or implementations whenever a fresh context would keep this session sharp |
| `aggressive` | Delegate aggressively — prefer a subagent for most non-trivial investigation and implementation work; keep orchestration and user-facing decisions here |

The level is policy, not plumbing: it never changes what the tools can do, only what the model is told to prefer. (Ported from pi-cciotti's delegation levels + advertised-agent catalog.)

## Authoring custom agents

Agent definitions are Markdown files with YAML frontmatter, discovered from two locations:

- **project**: `<project>/.unown/agents/*.md` — commit these next to the code they know about
- **global**: `~/.unown/agent/agents/*.md` — available in every project

Load order is built-in → global → project; a definition with the same `name` as an earlier one wins, so a project file can override a global one — or even a built-in.

**Frontmatter contract:**

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | The agent name the `task` tool and `/agents` display |
| `description` | yes | Shown to the model when it decides whom to spawn — write it as a retrieval trigger ("Use for ...") |
| `tools` | no | Comma-separated list restricting the subagent's toolset. Omit for the full set. Valid names: `read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, `ls`, plus unown's `todo`, `note`, `fetch_url`, `web_search`, `webfetch` |
| `model` | no | Model id overriding `PI_MODEL_ID` for this agent's runs only (see [Per-agent routing](#per-agent-routing)) |
| `effort` | no | `low` / `medium` / `high` — reasoning effort for this agent's runs (see [Per-agent routing](#per-agent-routing)) |
| `mcpServers` | no | Whitelist of MCP server names this agent may load; an empty list means **load none**. Omit to load all (the default). Also accepted in snake_case (`mcp_servers`) |
| `injectAgentsMd` | no | `false` skips AGENTS.md / per-tier memory injection into the subagent's system prompt (lighter context, lower cost). Default `true`. Also accepted in snake_case (`inject_agents_md`) |
| `advertise` | no | `false` keeps the agent out of the advertised catalog (it still spawns fine when named explicitly — the `planner` shape). Default `true` |
| `completionGuard` | no | `true` turns on the [completion guard](#the-completion-guard) for this agent (the `worker` builtin has it on). Default `false` |
| `fallbackModels` | no | Ordered fallback models for provider-style failures (see [Fallback models](#fallback-models)) |
| `context` | no | `fresh` (default) or `summary` — `summary` prepends a distilled brief of the parent session to the task (see [Context briefs](#context-briefs)) |
| `contextBrief` | no | Role-directed instruction shaping the summary brief (what it keeps) — only used with `context: summary` |

The Markdown **body (everything after the closing `---`) becomes the subagent's system prompt**. Files without valid `name` and `description` frontmatter are skipped silently. Invalid values for the routing fields are dropped, never thrown. Other frontmatter fields are ignored. Run `/agents` in a session to list everything discovered, with source and toolset.

**A complete example** — `<project>/.unown/agents/test-triage.md`:

```markdown
---
name: test-triage
description: Triages a failing test suite and reports the smallest set of genuinely broken tests with their first error lines. Use when many tests fail at once and the cause is unclear.
tools: read, bash, grep, find, ls
---

You are the test triage subagent for this repository. You receive a failing
test run; your job is to separate real failures from noise and report them
compactly so the parent agent can fix causes, not symptoms.

Procedure:

1. Re-run the failing suite yourself and capture the full output. Read it —
   do not trust the summary line.
2. Classify every failure: assertion failure, timeout, environment error
   (missing fixture, port in use), or cascade (a shared setup test failed
   and everything downstream is red).
3. For each genuine failure, extract the first error line with file:line and
   the expected/actual values. One line each.
4. Identify cascades: name the root failing test and list what it blocks.
5. If the suite cannot run at all (install broken, wrong runner), say exactly
   why and stop — do not guess at test outcomes.

Report format:

- Runner and command you executed
- Genuine failures: file:line + first error, one bullet each
- Cascades: root cause test + count of blocked tests
- Environment problems, if any
- Your single best guess at the common root cause, marked clearly as a guess

You are read-only. Do not edit files, do not skip tests, do not re-run with
modified flags to make the suite pass.
```

## Per-agent routing

Each agent definition can pin its own model, reasoning effort, MCP surface and context budget. The `task` tool translates the frontmatter into flags on the spawned subprocess (`buildSubagentArgs` in `subagent-routing.ts`), and the child applies them to its own run before the session starts:

| Field | Child flag | Effect in the spawned run |
|---|---|---|
| `model` | `--model <id>` | sets `PI_MODEL_ID` — the child's `models.json` and bridge requests use that model |
| `effort: low` | `--effort low` | sets `BRIDGE_QWEN_THINKING=0` (thinking off) — short, cheap replies |
| `effort: high` | `--effort high` | sets `BRIDGE_QWEN_THINKING=1` (thinking on) |
| `effort: medium` | `--effort medium` | leaves the bridge's default alone |
| `mcpServers: [a, b]` | `--mcp-servers a,b` | sets `UNOWN_MCP_SERVERS` — the MCP client loads only the whitelisted servers |
| `mcpServers: []` | `--mcp-servers ""` | **loads no MCP servers** (an empty whitelist is meaningful, not a no-op) |
| `injectAgentsMd: false` | `--no-agents-md` | sets `UNOWN_NO_AGENTS_MD=1` — AGENTS.md and the per-tier memory files are not injected |

Resolution order for the model: the agent's `model` field wins, then the `UNOWN_SUBAGENT_MODEL` env var (a global override — route *every* subagent to a local model with one line), then the default the child would otherwise resolve from `PI_MODEL_ID` / `models.json`. An agent that sets none of the four fields spawns exactly as before — routing is opt-in per definition, and `background-explore` is the shipped example of the full shape (cheap model + low effort + no MCP + no memory injection).

The same four flags are accepted on any `unown` launch (TUI or print mode), where they route **that whole session** the same way — `unown --model kimi-k2.5 --effort low -p "summarize the diff"`, or `--mcp-servers github` to start a session with only one MCP server live. See [usage](usage.md) and [configuration](configuration.md).

## Fallback models

A provider outage used to cost the whole delegation: the subagent died with `429 Too Many Requests` (or a silent non-zero exit) and the parent had to re-plan. Agents can now carry an ordered **fallback chain** (`fallbackModels` in frontmatter; the `worker` builtin ships one):

```markdown
---
name: heavy-worker
description: Implementation worker for large refactors.
fallbackModels: qwen3.7-plus, qwen3.6-plus
---
```

The chain is the agent's `model` (when set) followed by the fallbacks, deduplicated. A candidate advances **only** on a provider-style failure — auth (401/403), quota, rate limits (429), 5xx, timeouts, connection resets, or a silent non-zero exit — **and only when the child had done no work yet** (zero tool calls: rotating mid-task would discard real work). A context overflow or a crash after work started never rotates; the failure surfaces to the parent as before.

Hard-failed models get a **30-minute health mark** in `~/.unown/agent/model-health.json` — a tiny shared store every unown process reads, so the outage is paid once per window across a whole fleet of subagents instead of once per spawn. Marks auto-expire; the store is atomic-written and fails closed (an unreadable store means "try the model", never "skip everything"). The run's report lists the models actually attempted (`worker · models kimi-k2.5 → qwen3.7-plus`) and usage is billed across the whole chain, not just the survivor.

## Context briefs

A `context: "summary"` agent does not spawn blind. Before the spawn, one cheap LLM call distills **the parent session's recent conversation** into a compact brief (≤ 4,096 characters) that is prepended to the child's task:

```
Context brief from the parent session:
<the distilled brief>

Task:
<the task>
```

The distillation source is a newest-first projection of the parent session — user text, assistant text, and tool-call *names* only (bodies are the bulk, and the child rarely needs them) — capped at ~24k characters before the prompt is built. The per-agent `contextBrief` frontmatter shapes what the brief keeps (e.g. `quote each decision verbatim` for a decision-consistency reviewer).

The discipline (ported from pi-cciotti's summary context mode):

- **Graceful degradation** — a distillation failure (engine down, empty reply) falls back to the fresh context with a visible warning; it never aborts the delegation.
- **Short sessions skip the paid call** — less than ~80 characters of source means there is nothing worth summarizing.
- Briefs work in **both lanes** — the synchronous `task` tool and the async fleet.

Cheaper than a full fork (the whole conversation copied), more targeted than raw transcript surgery — and the child starts already knowing what the orchestrator has already tried. (Ported from pi-cciotti's `context-brief.ts` + the `defaultContext: summary` agents.)

## The BLOCKED protocol

Every subagent's system prompt carries boundary instructions ending in one rule: if the task cannot be safely or legitimately completed — missing access, ambiguous target, destructive-looking request — the child returns exactly:

```
BLOCKED: <short reason>
```

instead of improvising a partial answer. The parent parses the marker (tolerantly: fenced, padded, or as the first line — but never a mid-document mention, so discussing the protocol is not using it) and routes it back as a **first-class outcome**: the run's header reads `## worker (BLOCKED; …)`, the reason is quoted in bold, and the parent model can re-plan. A BLOCKED reply is not an error — it is the honest refusal lane that keeps silent no-op "success" out of your transcript. (Ported from pi-cciotti's `CHILD_SUBAGENT_BOUNDARY_INSTRUCTIONS`.)

## The completion guard

"The subagent said it fixed the bug" is not evidence. Agents with `completionGuard: true` (the `worker` builtin) are wrapped in a deterministic git fingerprint check:

1. **Before** the spawn, the run directory's working tree is snapshotted (changed-path list from `git status --porcelain -z` plus a SHA-256 digest of `git diff HEAD`, both with `core.fsmonitor=false` to dodge stale daemons).
2. **After** the run, a second snapshot is taken.
3. Identical snapshots + exit 0 + not BLOCKED ⇒ the run is reported as **FAILED** with `Subagent completed without making edits for an implementation task.` — the no-op cannot masquerade as success.

The guard is honest about its own limits: outside a git repository (or when git itself fails) it reports `unavailable` rather than guessing, and a mutation surfaces as evidence — `worker: ✓ 6 turns, 12 tools [guard passed · 3 path(s) mutated: src/a.ts, …]`. Worktree-isolated runs guard inside their worktree, so the lane composes. (Ported from pi-cciotti's mutation-evidence completion guard.)

## How the model invokes them

The model calls the `task` tool with either a single job or a batch:

- `{ "agent": "explore", "task": "Find every caller of parseConfig() and cite file:line" }`
- `{ "tasks": [ { "agent": "explore", "task": "..." }, { "agent": "explore", "task": "..." }, ... ] }` — up to 4 tasks per call, executed in parallel.

The task string is all the subagent ever sees — it does not see the parent conversation, so it must be self-contained: file paths, error text, and the definition of "done" included. Unknown agent names fail with the list of available agents. A parallel call mixing agents is fine:

```json
{ "tasks": [
  { "agent": "explore", "task": "Map where auth middleware is registered; cite file:line." },
  { "agent": "explore", "task": "List every test file touching login; note which use mocks." },
  { "agent": "general", "task": "Write scripts/audit-headers.ts that fails on missing license headers; run it and report the output." }
] }
```

**What comes back.** Each job returns one section, headed with the run's vitals and followed by the subagent's final message (or stderr, if it produced no output):

```
## explore (ok; 6 turns, 45k in / 3k out, 14 tool calls)

src/middleware/auth.ts:12 registers requireAuth on the router...
```

The header carries the [BLOCKED](#the-blocked-protocol) status (`## worker (BLOCKED; …)`), the [guard](#the-completion-guard) failure (`## worker (GUARD FAILED; …)`), and the [fallback chain](#fallback-models) when it rotated (`· models kimi-k2.5 → qwen3.7-plus`). The compact TUI result line marks blocked runs `⊘` and guard failures `✗`.

Parallel results are separated by `---` and returned in the order they were requested. The parent's copy is capped (see below), so tell subagents to end with a concise summary, not a transcript dump.

## The interactive fleet (async subagents)

Everything above is the **synchronous lane**: the `task` call blocks until every child finishes, and the report lands in the tool result. The fleet is the second lane — **`async: true`** — where the call returns an immediate ack and the subagent runs in the background as a live member of your session. It is a port of [amosblomqvist/pi-interactive-subagents](https://github.com/amosblomqvist/pi-interactive-subagents) rebuilt without tmux on plain subprocesses and atomic control files, so the lane is identical on Windows, macOS and Linux — no PTY, no OS-specific terminal plumbing.

The two lanes compose with everything the sync lane has: agent definitions and routing (`--model`/`--effort`/`--mcp-servers`), the [BLOCKED protocol](#the-blocked-protocol), the [completion guard](#the-completion-guard), [fallback models](#fallback-models) and [worktree isolation](#worktree-isolation). What changes is the delivery model:

| | Sync lane (default) | Async lane (`async: true`) |
|---|---|---|
| The call returns | when every child finished | immediately, with an ack |
| The result arrives | in the tool result | later, as its own message that triggers a new turn |
| Mid-run control | none (abort kills the batch) | `task_control` steer / stop / status / list |
| Child questions | impossible ([BLOCKED](#the-blocked-protocol) instead) | `ask_question` — the child parks until you answer |
| After the run | nothing persists | resumable by name, full context intact |
| Where you watch it | the transcript | the fleet widget above the editor + the footer |

## Fire-and-forget spawns

Add `async: true` to any task call (single or batch item) and optionally give the child a `name` you can steer it by later:

```json
{ "agent": "explore", "async": true, "name": "mapper",
  "task": "Map the src/ tree and report the main modules with file:line anchors." }
```

The tool returns an ack immediately — the call never blocks — and the session keeps running:

```
## mapper (explore · async)
Started in the background. The result will arrive as its own message; steer it
with task_control {action:"steer", id:"mapper", message:"…"} or check
task_control {action:"status", id:"mapper"}.
```

When the child finishes, its report arrives as a **new message that triggers a new turn** — the same mechanism as a user steer — so an unattended orchestrator still reacts to results. The report header carries the run's vitals:

```
Subagent mapper (explore) finished in 01:42
6 turns · 14 tool calls · 45k in / 3k out

<src/middleware/auth.ts:12 registers requireAuth on the router …>

Follow up with task_control {action:"steer", id:"mapper", message:"…"} to
continue this subagent with full context.
```

`BLOCKED` and `FAILED` runs use their own header verbs and append the reason; a result body is capped at 16,000 characters. Two async specifics to know:

- **`output_schema` is sync-only** — structured replies need the blocking lane; an async call carrying a schema is rejected with a typed failure before anything spawns.
- **`name` is a label, not an id** — names are deduplicated (`scout`, `scout-2`, …) and what every control action addresses. Without one, the child is reachable only by its generated id (shown in `/tasks`).

Batch spawns (`tasks: [...]`, still max 4) run one fleet child per item, and a shared `name` deduplicates across the batch. Abort signals are ignored on this lane by design — stopping a child is `task_control`'s job, not the tool call's.

**Completion batching:** successful results coalesce — a 150 ms debounce window (bounded by a 1 s max wait) collects every child that finishes together into ONE batched message, so a fan-out of N children wakes the parent **once**, not N times. Failures and BLOCKED replies bypass the batch and race in immediately — bad news never waits for good. (Ported from pi-cciotti's completion batching.)

## Steering and control: task_control

The `task_control` tool is the fleet's control surface:

| Action | Parameters | What it does |
|---|---|---|
| `steer` | `id`, `message` | Delivers a message to a **running** child — absorbed into its current turn. On a **finished** child it **resumes** it (below). |
| `stop` | `id` | Stops a running child: a polite wrap-up instruction, then a tree kill 3 s later. The stop is reported as the child's result. |
| `status` | `id` | One child's live state: task, turns, tool count, steer count, token usage, current tool, and a pending question when parked. |
| `list` | — | Everything: running children with live state, then the finished ones that are resumable by name. |

**Steering a running child** is a mid-task course correction: the message is queued into the child's control inbox (an atomic file it polls every 250 ms) and delivered through pi's native steer path — it becomes part of the child's current turn, not a new session. A child that just received a steer never reads as stalled.

**Steering a finished child resumes it.** The child relaunches with its **original session file and loadout** — the same transcript, model, effort, toolset, MCP whitelist and system prompt — and your message is its follow-up task. Full context carries over; nothing is re-explained. Resume is fail-closed: if the session file or the loadout sidecar is gone, the steer is refused (`cannot resume` / `refusing to relaunch unrestricted`) — never silently downgraded to a fresh unrestricted child. Finished children stay resumable through the [registry](#fleet-state-on-disk) after the session that spawned them ends.

The `/tasks` session command prints the same picture as `task_control list` without a tool round-trip: running children plus the resume registry.

## Questions mid-task: ask_question

A fleet child can ask **the orchestrating agent** one clarifying question mid-task — the `ask_question` tool, registered in the child's session only when the fleet lane is active. It is not a channel to the human user; it is the child saying "I cannot proceed safely without one more fact":

```
Subagent mapper (explore) asks a question after 00:31:

Should the module map include test files, or production code only?

Answer it with task_control {action:"steer", id:"mapper", message:"<your answer>"}
— the subagent is parked until you do (or times out).
```

While parked, the child sits **inside the tool call** — no turns burn, no tokens flow — and the fleet widget shows it as `waiting for your answer`. The answer is a plain `task_control steer`: the child-side poller consumes the steered text as the answer (a steer while parked *is* the answer) and the child continues with `[orchestrator's answer] <text>` as its next instruction.

The park is bounded at **10 minutes**. With no answer the child is told to proceed with its best judgment, state the assumption in its final report — or reply `BLOCKED: <reason>` when the task genuinely cannot proceed without the answer. `ask_question` degrades to the same best-judgment guidance when no ask channel exists (a child spawned outside the fleet lane), so the tool's contract is the same everywhere.

## The fleet widget and /tasks

While any async child runs, the TUI grows a **fleet widget above the editor** — one row per child, live, theme-aware:

```
╭─ Subagents ── 2 running ────────────
  ⟳ 01:04 mapper — running · grep
  ?  00:12 triage — waiting for your answer
╰─────────────────────────────────────
```

Row glyphs: `⟳` running (with the current tool), `○` starting, `?` waiting for your answer, `!` stalled. The list caps at 8 rows (`+N more running.` under it), and the footer carries the one-line summary (`fleet: 2 subagents running · 1 awaiting answer`). When the last child finishes the widget lingers ~1.5 s and disappears.

The watcher behind it polls every second. A child with no activity for **120 s** flips to `stalled` (`!` — steer or stop it); a child parked on a question never stalls (the reply is the orchestrator's obligation, not the child's). Everything the widget shows is derived from the child's own event stream — turns, tools, tokens, current tool — not scraped from a terminal.

## Fleet state on disk

The fleet keeps its runtime state in `<project>/.unown/fleet/` (gitignored — per-machine, per-session, never shared):

```
.unown/fleet/
├── registry.json                  # finished children, resumable by name (32 most recent)
├── <id>.control.json              # parent → child inbox (atomic writes, drained by the child)
├── <id>.ask.json                  # child → parent ask channel (deleted once answered)
└── sessions/                      # per-child transcript + resume contract
    ├── mapper-<id>.jsonl          # the child's full session (--session target)
    ├── mapper-<id>.jsonl.loadout.json        # model/effort/tools/mcp/system-prompt
    └── mapper-<id>.jsonl.system-prompt.md
```

The **registry** is what makes `task_control steer` work across sessions: name → session file, status, finish time and a one-line summary, bounded to the 32 most-recent entries. The **loadout sidecar** is the resume contract — everything needed to relaunch the same child later; resume refuses rather than guess when it is missing. Registry and inbox files are atomic-written and fail closed (a corrupt file reads as empty, never throws).

Print-mode orchestrators (`unown -p`) are not left behind: the run appends an untypeable sentinel message the fleet's input handler intercepts, and the process **waits (up to the fleet timeout) for all children to finish** — async results arrive as real turns while the process is alive, so headless runs deliver the full fleet story to stdout.

**Limits** (the honest table):

| Limit | Value | Override |
|---|---|---|
| Hard cap on one async child | 900 s | `UNOWN_FLEET_TIMEOUT_MS` (values < 1000 fall back to the default) |
| Completion batching window | 150 ms debounce / 1 s max wait | — || Stall watchdog (no child activity) | 120 s | — |
| ask_question park timeout | 600 s | — |
| Watcher cadence / control poll | 1 s / 250 ms | — |
| Result body / question / stderr caps | 16,000 / 4,000 / 2,000 chars | — |
| Registry size / `list` / `/tasks` rows | 32 / 16 / 10 | — |
| Widget rows (then `+N more`) | 8 | — |

## What subagents cannot do

- **No nesting.** Subagents run with `UNOWN_SUBAGENT=1`, which unregisters the `task` tool inside them — a subagent cannot spawn further subagents.
- **No interactive human.** A subagent cannot ask *you* questions — it can refuse honestly via the [BLOCKED protocol](#the-blocked-protocol) instead of improvising. (An [async fleet child](#questions-mid-task-ask_question) can ask the *orchestrating agent* — that channel exists, and parks, and times out; the human is never prompted.)
- **Restricted tools.** The definition's `tools` list is passed as `--tools` to the subprocess; the built-in `explore` agent, for example, physically cannot write.
- **Time limit.** Sync-lane subagents are killed after 300 seconds (SIGTERM, then SIGKILL). Async fleet children get 900 s (see the [limits table](#fleet-state-on-disk)).
- **Output caps.** The final report is capped at 16,000 characters; stderr at 2,000.
- **No persisted sessions (sync lane).** Sync subagents run with `--no-session` — their runs leave notes, not session files. Async children are the exception: each keeps a full session file under `.unown/fleet/sessions/`, which is exactly what [resume](#steering-and-control-task_control) replays.
- **No pre-flight probe.** The endpoint check runs in the parent only.

## When to use subagents

- **Fresh context** — a focused investigation (trace one bug, audit one module) whose intermediate tool output would otherwise flood and eventually compact the parent session.
- **Parallel exploration** — several independent questions about the codebase answered at once via `tasks: [...]`.
- **Background delegation** — `async: true` hands the job to the [fleet](#the-interactive-fleet-async-subagents) and keeps the session responsive; steer it mid-run, answer its questions, resume it by name when the result raises a follow-up.
- **Cheap background fact-finding** — `background-explore` runs the same evidence-first sweep as `explore` on a cheaper model at low effort, without MCP servers or memory injection, when the parent just needs facts cited and the question does not deserve a full unown context.
- **Isolated read-only sweeps** — `explore` maps the repo and returns cited evidence with zero risk of touching anything.
- **Self-contained implementation** — hand `general` a well-specified task and review its report instead of watching twenty tool calls scroll by.

The rule of thumb the tool description gives the model: prefer `task` whenever a focused investigation would pollute the current session's context.
