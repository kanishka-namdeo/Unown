# SDLC feature parity: what we reverse-engineered and what we adopted

> Purpose: decision record for the 2026-10-18 feature-parity effort — which
> capabilities oh-my-pi, zcode, muse code, codewhale and the other 2026 coding
> agents ship, which of those Unown adopts, in what form, and why the rest stay
> out. Research method: four parallel audit threads (source, docs, npm/GitHub
> forensics) with every claim URL-cited in the research notes
> (`/home/z/my-project/research/2-{a,b,c,d}-*.md`); porting decisions below cite
> the seam each feature lands on.

Related pages: [usage](usage.md) · [BEHAVIOR](BEHAVIOR.md) · [configuration](configuration.md) · [oh-my-pi-swap-assessment](oh-my-pi-swap-assessment.md) · [opencode-swap-assessment](opencode-swap-assessment.md)

- [The candidates](#the-candidates)
- [The gap analysis](#the-gap-analysis)
- [Adopted — shipped in this effort](#adopted--shipped-in-this-effort)
- [Adopted — already present](#adopted--already-present)
- [Deliberately not adopted](#deliberately-not-adopted)
- [The standing invariant](#the-standing-invariant)

## The candidates

| Agent | Vendor | Shape | What it is known for |
|---|---|---|---|
| [oh-my-pi](https://github.com/can1357/oh-my-pi) | Stencil Labs (can1357) | pi fork, ~80k LoC Rust native core | IDE-grade tooling wired into a terminal agent: LSP (14 ops + writethrough format-on-save), DAP debugger (28 ops), tree-sitter ast-grep/ast-edit, hashline edit format, advisor/watchdog second-model review, TTSR stream rules, compaction upgrades (shake/snapcompact), task structured outputs, `/review`, magic keywords, `omp commit` |
| [zcode](https://zcode.z.ai) | Z.ai | desktop ADE + CLI (open-sourced Apache-2.0) | Goal Mode with evidence-verified completion, Repo Wiki (every claim links file:line), Automations (cron), idle-time free tasks, plugin bundles, browser panel, bot channels, remote control |
| muse code | Meta (MSL) | native terminal CLI + SDK | event-sourced append-only sessions, `/rewind`, worktree fan-out subagents, observer agents + reconciler, workflows control room, 18-event hooks, session messaging, staged shell review, co-trained harness |
| [codewhale](https://github.com/codewhale-hq/Codewhale) | codewhale-hq | Rust terminal agent + local Engine | receipts audit ledger (`/undo` `/restore` `/receipts`), fleet ledger, typed workflows, MCP client+server, skills manager with trust, Claude-plugin compat, GitHub PR review Action |
| Claude Code / Codex / Gemini / OpenCode / Amp / Cursor / Windsurf / Devin | — | — | checkpoints/rewind, hooks, subagents/teams, skills, MCP channels, sandboxing, cloud handoff, DeepWiki, auto-memory mining |

## The gap analysis

Unown entered this effort with: tiered memory + AutoDream, self-improving
harness, hooks/guardrails, subagents (`task`), Agent Skills, plan mode, `todo`,
`note`, `fetch_url`, OS-sandboxed engine runs, llm-bridge model routing, the
mission-control dashboard. Compared against the field, the load-bearing gaps
were:

1. **No code intelligence** — no LSP diagnostics/hover/definition/references;
   the only feedback loop on edits was the Bun transpiler syntax gate.
2. **No checkpoints/rewind** — no way to undo an agent turn's file damage, no
   audit ledger of what the session did.
3. **No MCP** — locked out of the entire Model Context Protocol tool
   ecosystem (README said so outright).
4. **No review workflow** — no `/review` with parallel reviewer subagents.
5. **No goal mode** — no evidence-verified objective loop.
6. **No scheduled/automated runs** — the engine learns on intervals but never
   acts on the repo on a schedule.

## Adopted — shipped in this effort

Each entry: feature → source → the seam it landed on in this repo.

| Feature | Source | Unown form |
|---|---|---|
| LSP code intelligence (`lsp` tool: status/diagnostics/hover/definition/references/symbols; auto-detected servers; `.unown/lsp.json` config; PostToolUse diagnostics feedback on every write/edit) | oh-my-pi `lsp` + writethrough | `pi-repo/packages/self-learning/src/lsp.ts`, registered by the unown-tools extension — pure-TS stdio JSON-RPC client, zero deps, cold start never blocks a tool result, degrades silently when no server exists |
| Checkpoints + `/undo` + `/restore` | Claude Code checkpointing · Gemini shadow-git · codewhale receipts | git-based file snapshots per user turn + explicit `/checkpoint`, in the unown-tools extension; session entries record checkpoint ids so `/undo` rewinds files (conversation rewind stays pi's own `/tree`/fork story) |
| Session receipts ledger + `/receipts` | codewhale RECEIPTS | every tool call/result appended to `.unown/receipts/<session>.jsonl` (files touched, commands run, denials, failures, token usage); `/receipts` prints the ordered audit with totals |
| MCP client (stdio + streamable HTTP, `.unown/mcp.json` + `~/.unown/agent/mcp.json` discovery, dynamic tool registration, `/mcp` status command) | Claude Code / codewhale / zcode MCP | `pi-repo/packages/self-learning/src/mcp.ts` — tools surfaced through `pi.registerTool` with `mcp__<server>__<tool>` naming; servers never block session start (lazy connect) |
| `/review` — parallel reviewer subagents, P0–P3 + confidence + verdict | oh-my-pi `/review` · Codex `/review` presets | orchestration over the existing `task` tool: frozen diff snapshot (uncommitted / base-branch / commit), 2–3 reviewer subagents, findings merged + deduped, one verdict |
| `/goal` — durable objective with evidence-verified completion | zcode Goal Mode · muse goals | goal state persisted in session entries; completion requires a verification pass with real evidence (changed files, command output, test results); unfinished todos block completion |
| Scheduled automations (`/loop`-style cron over the engine router) | zcode Automations · muse `/loop` · Claude routines | engine-side `automations` router job reading `.unown/automations.json`, spawning headless `unown -p` runs (deferred — see CHANGELOG for the shipped slice) |

Behavior changes land under the repo's standing policy: CHANGELOG **Agent
Behavior** entries + tests pinning each feature + receipts where measured.

## Adopted — already present

- Subagents with fresh context, parallel batch (`task`) — omp/muse/zcode have
  equivalents; ours predate this effort.
- Agent Skills with progressive disclosure — same standard zcode/muse/codewhale
  adopted; AutoDream mints them.
- Plan mode — omp/muse/zcode/codewhale all have one; ours ships `/plan`.
- Hooks — Claude-style events; ours enforce guardrails at both layers.
- Memory — the 4-tier stack + AutoDream is our own take on zcode's project
  memory / Gemini auto-memory / Devin dreaming; keep ours.

## Deliberately not adopted

| Feature | Source | Why not |
|---|---|---|
| Hashline edit format | oh-my-pi | The grammar's core parser is Rust (`crates/pi-edit`); a TS re-derivation is a project of its own. Our `edit` tool's str_replace contract is stable and model-agnostic; revisit only with measured string-not-found failure rates from our own transcripts |
| DAP debugger tool | oh-my-pi | Pure TS and portable, but a 28-action surface is a maintenance commitment; no user demand yet. First candidate if this list is revisited |
| ast-grep / ast_edit | oh-my-pi | Native (tree-sitter); substitutes (ast-grep CLI) add a runtime dependency the engine sandbox cannot assume |
| TTSR stream rules | oh-my-pi | Requires a mid-stream abort+retry seam in pi-ai's provider loop — a fork-level change to the vendored substrate, against the swap-assessment invariant |
| Advisor/watchdog second model | oh-my-pi | Cost-doubling on every turn; our hooks + harness already play the reviewer role in the learning loop. Revisit as an opt-in profile |
| Event-sourced session replay | muse | pi's session tree + our receipts cover the audit use; full event sourcing is a substrate rewrite |
| Worktree fan-out subagents | muse | Valuable, but the engine sandbox already isolates harness runs; terminal subagents today are spawned sequentially against the shared tree. Candidate for a follow-up |
| Repo Wiki | zcode | Attractive; depends on scheduled background generation, deferred with automations |
| Plugin bundles + marketplace | zcode/codewhale/Claude | Our extension surface is inline + file-based (`.unown/`); a marketplace is ecosystem work, not a feature gap |
| Computer-use / browser automation | omp/zcode | Out of scope for a terminal-first agent this cycle; the dashboard already renders its own surfaces |
| Collab relay / bot channels / remote control | omp/zcode | Hosted-infrastructure features; the dashboard is our observability plane |

## The standing invariant

The oh-my-pi swap assessment's verdict governs here too: **the vendored pi
substrate stays; features land on pi's documented seams** (extension factories,
`pi.registerTool`, `pi.registerCommand`, session entries) or in Unown's own
packages — never as forks of the vendored core. Every port above was
re-derived against pi's current seams, not copied from a fork that assumes a
different runtime.
