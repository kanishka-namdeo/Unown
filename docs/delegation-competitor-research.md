# Delegation round — the competitor research

> The verdict up front: **the field has converged on subagents as a primitive (own context, own tools, spawned mid-session), but delegation QUALITY is still unmeasured almost everywhere — and the loudest user complaints are about exactly that.** GitHub is the exception that proves the value: their June 2026 "smarter subagent delegation" change, built from LLM trajectory analysis of real failures, cut tool failures per session by 23% and subagent LLM duration by 12–18% with no quality regression. Nobody ships a delegation AUDIT (why was this spawned, what did it cost, was it worth it), nobody journals the delegation decision itself, and every measured system reports the same failure shapes: vague briefs → duplicate work, invisible background agents, silent spawn-then-idle "pause button" delegation, and un-bounded subagent token burn. That gap is this round's surface.

- [Method](#method)
- [The field, system by system](#the-field-system-by-system)
- [The measurement landscape](#the-measurement-landscape)
- [The failure taxonomy (MAST)](#the-failure-taxonomy-mast)
- [Unown's gap analysis](#unowns-gap-analysis)
- [What this round adopts, and what it rejects](#what-this-round-adopts-and-what-it-rejects)

Related pages: [the delegation round session record](delegation-round-session.md) · [the subagents reference](subagents.md) · [the observability round research](observability-competitor-research.md) · [the UX principles](unown-ux-principles.md)

## Method

Sixty-plus primary sources fetched live (2026-10-30): Anthropic engineering blogs and Claude Code docs/changelog/issues (GitHub issue API), GitHub engineering posts (Copilot CLI delegation, harness evaluation, HydraFusion, context/model routing), Cursor and Devin docs, Amp docs, OpenHands, Aider/SWE-agent, the four framework docs (OpenAI Agents SDK, LangChain/LangGraph, AutoGen, CrewAI), arXiv papers (MAST, τ-bench/τ²-bench, METR, Voyager, Reflexion, ExpeL, DGM), OpenTelemetry GenAI semantic conventions, and OpenClaw's self-learning/memory specs. Claims are tiered `[V]` (verified at the cited page this sweep), `[C]` (claimed upstream, not re-derived), `[U]` (unverified). Unown's own subagent surface was mapped file-by-file in the same pass (`fleet.ts`, `fleet-runtime.ts`, `fleet-reaper.ts`, `subagent-catalog.ts`, `subagent-routing.ts`, `subagent-builtins.ts`, `tools.ts` task-tool registration, `test/` pins) so the gap analysis compares shipped behavior against shipped behavior.

## The field, system by system

### Claude Code (Anthropic)

- **Subagents are versioned Markdown+frontmatter routed by description, with a context budget for the catalog** — non-built-in descriptions over 15,000 tokens trigger a startup warning; detail lives in each agent's system prompt, loaded only when that agent runs (progressive disclosure). Built-ins: read-only `Explore` (quick/medium/very-thorough effort levels), `Plan`, `general-purpose`; Explore/Plan skip CLAUDE.md to stay cheap. `[V]` https://code.claude.com/docs/en/sub-agents
- **Agent Teams (experimental)**: lead + peer teammates with JSON mailbox files, a shared task list with file-lock claiming, and hook-enforced quality gates where **exit code 2 from a `TaskCompleted` hook blocks completion and sends feedback to keep the agent working**. `[V]` https://code.claude.com/docs/en/agent-teams
- **The multi-agent research system quantifies when delegation pays**: Opus-4-lead + Sonnet subagents beat single-agent Opus 4 by 90.2% on internal research evals; multi-agent burns ~15× chat tokens; **token usage alone explained ~80% of variance** on BrowseComp. Their task briefs MUST carry objective, output format, tools/sources, and task boundaries — "we found subagents duplicating work when task briefs were vague" (3 subagents independently researching the same 2025 supply chain). Effort scaling: simple → 1 agent / 3–10 tool calls; complex → 10+ subagents. Subagents write artifacts to the filesystem and return references — avoiding the "game of telephone". `[V]` https://www.anthropic.com/engineering/built-multi-agent-research-system
- **Their evaluation recipe**: ~20 real queries, a single LLM-judge call scoring 0.0–1.0 + pass/fail against a rubric (factual accuracy, citation accuracy, completeness, source quality, tool efficiency), human review on top; evaluate END STATE, not turn-by-turn. A tool-testing agent that rewrote tool descriptions cut task-completion time 40%. `[V]` (same URL)
- **Real user pain, in their own tracker**: background subagents give zero visibility and the model "waits silently for 15+ minutes" — the issue explicitly asks for **premises-before-delegation** ("state what it decided and assumed BEFORE delegating so I can correct early") `[V]` https://github.com/anthropics/claude-code/issues/95730; a measured 2.41B-token run (98% cache reads; 71% of subagent tokens spent after each agent's 80th step) asks for per-subagent token visibility and step/context limits `[V]` https://github.com/anthropics/claude-code/issues/106025; subagent model/effort invisible in transcripts `[V]` #95823; context re-transmitted + parallel duplicates `[V]` #104543.
- **Changelog direction**: resumable/inspectable subagent transcripts, forks, nested spawn depth caps (`CLAUDE_CODE_MAX_SUBAGENT_DEPTH`), per-subagent `autoCompactWindow`, named subagents message each other, `SubagentStart`/`SubagentStop` hooks. `[V]` https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md

### GitHub Copilot CLI

- **"Smarter subagent delegation" (June 2026) — the most direct precedent for this round.** LLM analysis of full trajectories found: subagents invoked for already-narrow tasks, repeated/overlapping searches, **sequential delegation (the subagent as a pause button)**, failure-prone paths (stale file paths). Fix: an orchestration policy — narrowest effective path first, escalate only when complexity/uncertainty creates value, subagents as a parallelism tool, and SPECIFIC handoffs (what the user asked / what's already known / what the subagent owns / what result is needed). A/B: **tool failures/session −23%, search-tool failures −27%, P95 wait −5%, failed subagent search calls −15%, subagent LLM duration avg/P95 −12%/−18%, no quality regression.** `[V]` https://github.blog/ai-and-ml/how-we-made-github-copilot-cli-more-selective-about-delegation/
- **Harness evaluation methodology**: hold model/task/context/effort/tools/MCP constant; report **resolution rate vs cost-per-task**; every agent-model config run **≥5 times with ±1σ ellipses**. `[V]` https://github.blog/ai-and-ml/github-copilot/evaluating-performance-and-efficiency-of-the-github-copilot-agentic-harness-across-models-and-tasks/
- **HydraFusion**: per-request workflow selection among Single / Cascade (cheap draft + quality gate + escalate) / Critique (draft + independent read-only cross-model critic + one revision) — +4.9pp quality at 67% lower cost on TerminalBench 2.1. `[V]` https://github.blog/ai-and-ml/github-copilot/project-hydrafusion-frontier-quality-via-multi-model-orchestration/
- **Cache-aware routing**: model switches happen only at cache boundaries (first turn, post-compaction) because mid-conversation switches break prompt-cache savings. `[V]` https://github.blog/ai-and-ml/github-copilot/getting-more-from-each-token-how-copilot-improves-context-handling-and-model-routing/

### Cursor, Devin, Amp

- **Cursor**: built-in Explore (faster model — "10 parallel searches in the time a single main-agent search would take") and Browser subagents were **designed from telemetry of conversations where context-window limits were hit**; Cloud Agents emit verification artifacts (screenshots, videos, logs) "so you can see exactly what changed and how the agent verified its work". `[V]` https://cursor.com/docs/subagents · https://cursor.com/docs/cloud-agent
- **Devin**: a coordinator breaks work into packages, spins managed Devins each in an isolated VM with **ACU budgets**, messages them mid-flight, is woken when children finish, and can sleep/terminate stragglers; "dynamic workflows" record orchestration as resumable scripts; Session Insights analyzes completed sessions (cost overrun breakdowns: "this used 42 ACUs, expected ~12 — where did time go?"), and **improve-playbook-from-failure** turns failing sessions into playbook revisions — failure analysis as a user-facing workflow. `[V]` https://docs.devin.ai/work-with-devin/advanced-capabilities · https://docs.devin.ai/product-guides/session-insights
- **Amp**: `Task` subagents work end-to-end and accept follow-ups **reusing their full earlier context**; read-only specialist roles (Oracle/Librarian/Finder) as plugins; cheap "system models" handle side work. `[V]` https://ampcode.com/docs/models-and-subagents

### Frameworks

- **OpenAI Agents SDK**: handoffs-as-tools with typed input schemas, `on_handoff` callbacks, input filters (strip/trim handed history). `[V]` https://openai.github.io/agents-python/handoffs/
- **LangChain/LangGraph**: subagents are stateless tools invoked by a supervisor (all memory in the main agent — clean context per call); Deep Agents add async background subagents. `[V]` https://docs.langchain.com/oss/python/langchain/multi-agent/subagents
- **AutoGen 0.4**: event-driven async teams, pluggable speaker selection (RoundRobin/Selector/Swarm/Magentic-One), resumable team state. `[V]` https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/teams.html
- **CrewAI**: hierarchical process with a manager LLM that decomposes and delegates; optional pre-execution planning step. `[V]` https://docs.crewai.com/concepts/crews
- **The shared blind spot**: all four provide topology (who talks to whom), NONE measure delegation quality — measurement lives in external trajectory analysis (Copilot's LLM trajectory diagnosis, MAST annotation, LangSmith agentevals). Frameworks "create extra layers of abstraction that obscure the underlying prompts and responses, making them harder to debug" (Anthropic's own warning). `[V]` https://www.anthropic.com/research/building-effective-agents

## The measurement landscape

The metrics the field actually uses, with formulas — this round's benchmark scores are built from these:

- **Resolution rate** — resolved/total, judged on END STATE (test pass, DB-state match à la τ-bench), not text. **pass^k** = P(all k independent trials succeed) — reliability across repetitions (τ-bench: gpt-4o <50% pass^1, <25% pass^8 on retail). `[V]` https://arxiv.org/abs/2406.12045
- **Cost per resolved task** — total tokens/$ across parent + all subagents ÷ resolved tasks; resolution-vs-cost scatter with ≥5 runs and ±1σ (GitHub's harness evals). `[V]` (GitHub URL above)
- **Handoff quality** — GitHub's four elements (what the user asked / what's known / what the subagent owns / what result is needed); Anthropic's brief elements (objective, output format, tools/sources, boundaries). Scored per spawn. `[V]` (both URLs above)
- **Duplicate-work rate** — overlapping tool calls/queries across parent+children; the direct product of vague briefs (Anthropic) and a MAST inter-agent-misalignment mode. `[V]`
- **Sequential-delegation ratio** — spawn-then-idle vs spawn-and-continue; GitHub's "subagent as pause button" finding. `[V]`
- **Token-efficiency ratio** — tokens(A)/tokens(B) at equal resolution, holding model/task/context/tools constant (GitHub methodology). `[V]`
- **Cache efficiency** — cache-read fraction of total tokens; Manus calls KV-cache hit rate "the single most important metric for a production-stage AI agent". `[C]` https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
- **Intervention rate** — steer/takeover/BLOCKED-unsolved per task; τ²-bench shows human-coordination performance is separable from reasoning performance. `[V]` https://arxiv.org/abs/2506.07982
- **METR time horizon** — the 50%-success task length, doubling ~every 7 months since 2019; the natural framing for "how long can the fleet run unattended". `[V]` https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/
- **Trajectory match** — strict/unordered/subset/superset vs a reference trajectory, plus LLM-judge rubric scores (LangSmith agentevals). `[V]` https://docs.langchain.com/langsmith/trajectory-evals
- **OpenTelemetry GenAI agent spans** — `create_agent`, `invoke_agent`, `plan`, `execute_tool`, agent-as-a-tool, with `gen_ai.*` attributes (agent name, token usage) — the interoperability target for any agent journal. `[V]` https://github.com/open-telemetry/semantic-conventions-genai

## The failure taxonomy (MAST)

**"Why Do Multi-Agent LLM Systems Fail?"** — 14 failure modes in 3 categories, derived from 150 traces with expert annotators (κ=0.88) plus a matching LLM-as-judge pipeline `[V]` https://arxiv.org/abs/2503.13657. The categories Unown's delegation ledger can detect deterministically or near-deterministically:

| MAST category | Mode | Unown signal |
|---|---|---|
| Specification & system design | imperfect task decomposition, unclear roles, missing global goal | handoff missing objective/boundary (task-string check) |
| Inter-agent misalignment | information loss, duplicate work, premature termination | duplicate spawn detection; BLOCKED rate; empty-result spawns |
| Task verification | failure to validate, unverified assumptions | completion guard failures; verify markers in results |

This round's benchmark scores each baseline spawn against the handoff and waste signals; the failure ledger (validation-log) codes in-round failures against the MAST names where they fit.

## Unown's gap analysis

Mapped against the shipped surface (v0.0.45 — the fleet, the journal, the guards, the catalog):

| Capability | Field best practice | Unown v0.0.45 | Gap |
|---|---|---|---|
| Typed handoff | GitHub's 4-element handoff; Anthropic's brief elements | free-text `task` string only — briefs vary wildly per model turn | **the `why` + handoff-shape guidance is absent** |
| Premises-before-delegation | Claude Code issue #95730's explicit ask | nothing recorded before the spawn; the parent's reasoning is invisible | **no delegation decision record** |
| Delegation audit | Devin's session insights (cost breakdowns) | journal records identity+lifecycle only — no task text, no `why`, no tokens, no duration | **the audit ledger does not exist** |
| Per-spawn cost visibility | Claude Code #106025's ask | cost lives in the one-shot tool-result header, then evaporates | **no aggregate, no persistence** |
| Duplicate detection | MAST / Anthropic duplicate-work finding | none | **no signal** |
| Spawn-and-continue | GitHub's pause-button finding | possible via async lane, but never measured or encouraged | **no metric, no policy nudge** |
| Worth-it verdict | Devin's "where did the time go" | nothing — a failed 40k-token spawn looks identical to a cheap win in the transcript | **no outcome-vs-cost view** |
| Specialist coverage | Cursor roles, Amp roles, Devin packages | 8 builtins + 4 project agents, but no debug/test/security/docs specialists | **missing roles the mission names** |
| Learning from delegation failures | Devin improve-playbook-from-failure; OpenClaw bounded lesson capture | subagent notes consolidate via AutoDream, but delegation DECISIONS never do | **the ledger must feed the loop** |

## What this round adopts, and what it rejects

**Adopts** (with receipts in the round's RESULTS):

1. **The `why` field on every delegation** — premises-before-delegation, journaled + displayed (Claude Code #95730; GitHub handoffs). One line the parent must write before spawning; the audit's spine.
2. **The delegation audit ledger** — journal entries gain task/why/usage/duration/outcome; a per-session card (`/delegation`), an aggregate engine endpoint + dashboard screen, and a CLI (`unown delegations`) (Devin session insights; OTel span shapes).
3. **Handoff-shape steering in the task tool description** — objective, known context, boundary, done-definition (GitHub + Anthropic briefs) — prompt-level, measured by the benchmark.
4. **Duplicate + pause-button detection** — same-agent similar-task spawns and spawn-then-idle windows become deterministic metrics (MAST; GitHub).
5. **Specialist builtins**: `debug`, `test`, `security-reviewer`, `documenter` (Cursor/Amp roles; the mission's list) + this repo's curators as project agents.
6. **The benchmark-before-features order** — baseline on 0.0.45, after on 0.0.46, ≥5-run lanes where the metered endpoint allows, ±σ reported (GitHub harness evals; Anthropic's 20-query recipe).
7. **Outcome-vs-cost verdicts, honestly derived** — receipts only (exit status, guard, BLOCKED, tokens) with "worth it: unknown" when unmeasured (the UX principles' epistemics rule).

**Rejects**:

- **Full OTel export** — the journal stays repo-local JSONL; OTel mapping is a future adapter, not this round's surface.
- **Nested subagent spawning** — Claude Code needed depth caps after shipping it; Unown's single level is a strength (fresh-context discipline), and the mission's value is in QUALITY, not depth.
- **Inter-agent mailboxes/teams** — the async fleet + steering already covers the control loop; a second message fabric forks the data (violates the placement law).
- **LLM-judged worth-it verdicts in the product path** — the LLM judge lives in the BENCHMARK only; the product derives verdicts from receipts (the model never grades itself in chrome).
