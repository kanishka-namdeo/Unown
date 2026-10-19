# Subagents

Fresh-context unown agents the model can spawn mid-session with the `task` tool — the built-ins, your own `.unown/agents/*.md` definitions, and their limits.

- [The task tool](#the-task-tool)
- [Structured outputs](#structured-outputs)
- [Worktree isolation](#worktree-isolation)
- [Built-in agents](#built-in-agents)
- [Authoring custom agents](#authoring-custom-agents)
- [Per-agent routing](#per-agent-routing)
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
| `background-explore` | `read`, `grep`, `find`, `ls` — read-only | Low-cost background sweeps: same evidence-first shape as `explore`, but routed to a cheaper model (`qwen3.7-plus`) at `effort: low`, loading **no MCP servers** and skipping AGENTS.md/memory injection — the minimal-overhead lane for parallel fact-finding |

`general` is the default when no agent is named.

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

Parallel results are separated by `---` and returned in the order they were requested. The parent's copy is capped (see below), so tell subagents to end with a concise summary, not a transcript dump.

## What subagents cannot do

- **No nesting.** Subagents run with `UNOWN_SUBAGENT=1`, which unregisters the `task` tool inside them — a subagent cannot spawn further subagents.
- **Restricted tools.** The definition's `tools` list is passed as `--tools` to the subprocess; the built-in `explore` agent, for example, physically cannot write.
- **Time limit.** Each subagent is killed after 300 seconds (SIGTERM, then SIGKILL).
- **Output caps.** The final report is capped at 16,000 characters; stderr at 2,000.
- **No persisted sessions.** Subagents run with `--no-session` — their runs leave notes, not session files.
- **No pre-flight probe.** The endpoint check runs in the parent only.

## When to use subagents

- **Fresh context** — a focused investigation (trace one bug, audit one module) whose intermediate tool output would otherwise flood and eventually compact the parent session.
- **Parallel exploration** — several independent questions about the codebase answered at once via `tasks: [...]`.
- **Cheap background fact-finding** — `background-explore` runs the same evidence-first sweep as `explore` on a cheaper model at low effort, without MCP servers or memory injection, when the parent just needs facts cited and the question does not deserve a full unown context.
- **Isolated read-only sweeps** — `explore` maps the repo and returns cited evidence with zero risk of touching anything.
- **Self-contained implementation** — hand `general` a well-specified task and review its report instead of watching twenty tool calls scroll by.

The rule of thumb the tool description gives the model: prefer `task` whenever a focused investigation would pollute the current session's context.
