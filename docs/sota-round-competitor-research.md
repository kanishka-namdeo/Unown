# The SOTA round's competitor research

> **Verdict up front:** seven agent systems were reverse-engineered to ground
> this round — OpenHands, Roo Code (→ Zoo Code), Cline, OpenAI Codex CLI,
> Google Gemini CLI, Aider and Claude Code's public workflows — each read
> against its own repo, docs and changelogs on the round's seven dimensions:
> learning loops, memory systems, benchmark design, planning, failure
> recovery, task decomposition and autonomous debugging. Three late entrants
> were verified mid-round and folded in (ZCode, OpenClaude, Codewhale — §the
> late entrants), making it ten systems total. The headline
> finding: **no competitor ships a closed, self-improving loop** — Gemini CLI
> mines transcripts into human-gated patch inboxes, Claude Code writes its own
> memory notes, OpenHands gates releases with matched-model benchmarks, but
> nobody converts a live failure into a benchmark, fixes the agent, and reruns
> the workflow as one machine. That is exactly the gap this round exists to
> demonstrate. The adoption table is the last section.

- [What each system is](#what-each-system-is)
- [OpenHands — the benchmark discipline](#openhands--the-benchmark-discipline)
- [Roo Code / Zoo Code — the orchestration contract](#roo-code--zoo-code--the-orchestration-contract)
- [Cline — checkpoints and convergence](#cline--checkpoints-and-convergence)
- [Codex CLI — the sandbox purist](#codex-cli--the-sandbox-purist)
- [Gemini CLI — the extraction loop](#gemini-cli--the-extraction-loop)
- [Aider — the benchmark craft](#aider--the-benchmark-craft)
- [Claude Code — the self-improvement playbook](#claude-code--the-self-improvement-playbook)
- [The late entrants — ZCode, OpenClaude, Codewhale](#the-late-entrants--zcode-openclaude-codewhale)
- [The seven-dimension comparison](#the-seven-dimension-comparison)
- [What this round adopted](#what-this-round-adopted)

Related pages: [sentinel round research](sdlc-testing-competitor-research.md)
(the cadence round's reverse-engineering) · [live-preview competitor
research](live-preview-competitor-research.md) (the commerce round) · [memory
competitor research](memory-competitor-research.md) (the standing memory-stack
comparison this round's §memory extends).

## Method

Each system was researched against its own primary sources during the round
(2026-10-28): GitHub repos (READMEs, changelogs, source files), official docs
sites, engineering blogs and, where reachable, benchmark leaderboards. Claims
carry the same tiering as the standing decision-record convention: `[V]`
verified at a cited source, `[C]` upstream-claimed, `[U]` unknown. Two
exceptions to note honestly: `developers.openai.com`/`openai.com` were
network-blocked from the research sandbox (Codex claims lean on repo source
with low-confidence citations marked), and the GA benchmark post for Gemini
CLI (69.6% → 85.6%) now 404s [V], so it is tiered `[C]` — withdrawn pages are
not evidence.

## What each system is

| System | What it is | What this round took from it |
|---|---|---|
| [OpenHands](https://github.com/OpenHands/OpenHands) | All Hands' agent platform (now Agent Canvas + [software-agent-sdk](https://github.com/OpenHands/software-agent-sdk)); the only competitor with a serious public benchmark program | matched-model benchmark gating: prove the *harness* improved, not the model; publish a dated trajectory |
| [Roo Code → Zoo Code](https://github.com/Zoo-Code-Org/Zoo-Code) | the VS Code agent (Roo shut down 2026-05; the community fork continues) | the boomerang orchestration contract: isolated subtask contexts, summary-only returns, tool-less orchestrator |
| [Cline](https://github.com/cline/cline) | the most-deployed agent extension (v4: SDK, CLI, desktop, teams) | shadow-git checkpoint discipline: branch-per-task, exclusion patterns, reflog-safe restore |
| [Codex CLI](https://github.com/openai/codex) | OpenAI's Rust terminal agent, AGENTS.md reference implementation | headless-first JSONL event lane; never-asks default in unattended mode |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Google's open agent, now enterprise-gated | the only competitor mining past transcripts: human-gated patch inbox for memory + SKILL drafts |
| [Aider](https://github.com/Aider-AI/aider) | the benchmark-driven pair programmer; "88% of its last release written by itself" | benchmark craft: pass@1/pass@2, edit-format well-formedness, per-run cost, Docker-deterministic harness |
| Claude Code (public docs) | Anthropic's closed-source CLI with open engineering practice | the self-improvement playbook: find own weaknesses → ablate → soak → gradual rollout; typed agent-written memory notes |
| [ZCode](https://zcode.z.ai/en) | Z.ai's "agentic development environment" — the official GLM harness (desktop + browser + CLI) | the closest shipped competitor loop: background memory curation after each finished round, auto-recalled next session [V: zcode.z.ai/en/docs/memory] |
| [OpenClaude](https://github.com/Twigpine/openclaude) | the provider-agnostic fork of the leaked Claude Code source (34k★) | confirmation by contrast: full skills/subagents surface, **no persistent learning loop** [V] — the loop remains Unown's differentiation |
| [Codewhale](https://github.com/codewhale-hq/Codewhale) | Rust terminal coding agent (any-provider, 41k★, ex-`deepseek-tui`) | receipts/undo audit trail + repo-checked-in workflows [V]; no memory system beyond AGENTS.md [V-absence] |

## OpenHands — the benchmark discipline

The 2026 pivot renamed the main repo to Agent Canvas and moved the agent core
into `software-agent-sdk` (Python SDK + Agent Server) [V]. Three layers matter
to this round:

**Learning loops.** Persistent memory is opt-in (`load_memory=True`): two
tiers — user `~/.openhands/memory/` and project `<workspace>/.openhands/memory/`
— each a curated `MEMORY.md` index (only the index is injected, ~6,000-char
combined budget, oldest lines dropped first) plus daily logs read on demand;
the agent itself writes/merges/prunes near task end, and the project tier is
committable so teams share agent-learned knowledge [V: docs.openhands.dev/sdk/guides/persistent-memory.md].
Injection wraps memory in `<UNTRUSTED_CONTENT>` [V]. Their skill-improvement
meta-loop is documented but human-in-the-loop: OpenTelemetry logs → eval
metrics (suggestion acceptance via LLM-as-judge) → dashboards → proposed
SKILL.md improvements [V: docs.openhands.dev/overview/skills/monitoring.md].

**Benchmarks — the strongest evidence of an agent improving over time.** The
SWE-bench Verified trajectory (embedded leaderboard JSON at swebench.com [V]):
CodeAct v2.1 **53.0%** (2024-10-29, Sonnet 3.5.2) → **60.8%** (2025-02-03,
4× scaled attempts) → **65.8%** (2025-04-15) → **70.4%** (2025-05-24, Sonnet 4)
→ **71.8%** (2025-08-07, GPT-5); the SDK paper (arXiv:2511.03690) then ran
matched-model release comparisons — Sonnet 4: V0 68.0% → SDK 68.0% (parity);
Sonnet 4.5: 64.6% → **72.8%** (+8.2 attributed to harness changes) [V]. A
15-day production A/B reported **61% fewer system-attributable failures** [V].

**Failure recovery.** A Stuck Detector (on by default) watches for five stuck
patterns (e.g. four identical action-observation pairs) and auto-halts [V:
docs.openhands.dev/sdk/guides/agent-stuck-detector.md]; an LLM
fallback chain handles transient provider errors [V]; an LLMSummarizingCondenser
keeps first events + recent messages and summarizes the middle [V].

**Autonomous debugging.** The QA-changes use case is the model to steal: the
agent actually runs the software — spins up servers, opens browsers, makes
HTTP requests, reproduces the bug on base branch — and posts
PASS/FAIL/PARTIAL evidence reports, "knowing when to give up" [V:
docs.openhands.dev/openhands/usage/use-cases/qa-changes.md].

## Roo Code / Zoo Code — the orchestration contract

Roo Code (a Cline fork) was shut down 2026-05; the community Zoo Code fork
continues it (v3.92.x) [V]. No learning loops ship built-in [V — absence];
what exists is agent-*requested* rule/mode synthesis: "ask Zoo Code to create
a mode and it writes the YAML" persisted in `.roomodes` [V]. The valuable
parts are structural:

**Boomerang tasks** (renamed Task Orchestration): the Orchestrator decomposes,
calls `new_task(mode, message)`, the parent pauses, the subtask runs in a
**completely isolated context**, and returns via `attempt_completion(result)`
— the parent resumes with **only the summary** [V: docs.zoocode.dev/features/boomerang-tasks].
The orchestrator deliberately has **no read/write/command tools** to prevent
context poisoning [V]. Subtask metadata carries automatic parent resume and
single-open safety [V: CHANGELOG].

**Checkpoints** switched to a shadow git repository in v3.3.19 — the changelog
credits Cline by name [V] — with task-scoped snapshots, exclusion patterns in
the shadow repo's `.git/info/exclude`, and a 10–60 s init timeout [V:
docs.zoocode.dev/features/checkpoints].

**Context recovery.** Intelligent Context Condensing (on by default): LLM
summary at a % threshold; automatic error recovery on context-limit errors —
detect → truncate 25% → retry [V: docs.zoocode.dev/features/intelligent-context-condensing].

## Cline — checkpoints and convergence

Now v4.1.x with one SDK session layer under every surface (extension, CLI,
desktop, JetBrains, teams, cloud) [V: CHANGELOG]. Semi-automated preference
capture exists — `/newrule` writes a `.clinerules` file from the session [V]
— but no autonomous cross-session memory [V — absence]. Two structural gems:

**Shadow-git checkpoints**, the architecture Roo copied: a shadow repo
separate from project git, a commit after each tool use, branch-per-task
(v3.6.0), per-task initial snapshot, and restore options for files only /
task only / both; restore refuses when commits were made after the checkpoint
(reflog safety) [V: docs.cline.bot/core-workflows/checkpoints.md].

**Harness convergence signals:** consecutive-mistake limits (yolo mode),
experimental "double-check completion" self-verification, compaction through
the SDK with retry-once on overflow [V: CHANGELOG] — and deprecations
announcing that whole layers (Focus Chain, Explain Changes) were removed as
"no longer providing enough benefit on top of the current harness" [V:
docs.cline.bot/resources/deprecations]. The lesson: unverified layers get
deleted; the harness gets leaner and safer each round.

## Codex CLI — the sandbox purist

Rust-based, AGENTS.md-native (it is the reference implementation of the open
agents.md spec) [V]. `/init` scaffolds an AGENTS.md; discovery walks root →
cwd, never past the root marker, with configurable fallback filenames and a
byte cap (`project_doc_max_bytes`); thread instructions cap at 10,000 tokens
[V: codex-rs/core/src/agents_md.rs]. No session-mining loop ships [U — docs
moved behind developers.openai.com, network-blocked from the research sandbox].
What this round takes: **headless as the primary interface** — `codex exec`
emits JSONL events, supports `--output-last-message`, and defaults to
never-asking approvals unattended [V: codex-rs/exec/src/cli.rs]; and the
sandbox ladder `read-only` → `workspace-write` → `danger-full-access` as the
vocabulary for capability fencing [V: codex-rs/protocol/src/config_types.rs].

## Gemini CLI — the extraction loop

The only competitor that mines its own past sessions. Three layers of memory
[V: docs/cli/gemini-md.md, docs/tools/memory.md, docs/cli/auto-memory.md]:
the GEMINI.md hierarchy (global → workspace → just-in-time directory scans),
an in-chat memory tool that routes facts to tiers by editing markdown
directly, and — the differentiator — **Auto Memory (experimental)**: a
background service mines *past idle transcripts* (≥10 user messages, idle
≥3h), drafts memory updates as **unified-diff patch files** and reusable
**SKILL.md drafts** into a project-local inbox; `/memory inbox` reviews,
applies or discards; extraction never auto-applies, redacts secrets [V].
This is Unown's AutoDream with a human gate instead of canary gates — the
comparison is the point.

Other takeaways: Plan Mode with auto model routing (Pro plans → Flash
executes) [V]; checkpointing via a shadow git repo **plus conversation
re- proposal** of the pending tool call [V: docs/cli/checkpointing.md];
headless exit codes 42 (input) / 53 (turn-limit) — a kill-switch worth
copying [V: docs/cli/headless.md].

## Aider — the benchmark craft

The most rigorous public benchmarking in the field, and the methodology this
round's SDLC metrics are modelled on [V: docs/benchmarks.md, benchmark/]:
133→225-of-697 Exercism exercises across six languages (hardest selected by
having 7 top models attempt all 697 and keeping what ≤3 solved [V:
aider.chat/2024/12/21/polyglot.html]); the model sees instructions + stubs,
never the tests; on failure it feeds back the **first 50 lines of test
errors** — i.e. **pass@1 with a retry, reported as pass@1 and pass@2** [V];
also reports edit-format well-formedness %, cost and seconds per case; the
harness strips wall-clock noise and SHA-logs every request, runs in Docker
[V]. The "Singularity: 88%" badge — % of the last release's new code written
by aider itself [V: README] — is the honest ancestor of "Built & Improved
With Unown".

## Claude Code — the self-improvement playbook

Closed-source, but the engineering practice is public and is the direct
ancestor of this round's method. The April-23 postmortem [V:
anthropic.com/research/april-23-postmortem] traces three regressions (a
default reasoning-effort change, a caching bug that cleared thinking history
every turn, a verbosity prompt line), reverts them, and then institutionalises
the loop: **per-model eval suites → line-by-line system-prompt ablations →
soak periods → gradual rollouts**, and back-testing their Code Review agent
against the offending PRs — the agent found the bug the earlier model missed
[V]. Memory is dual-track: human-curated CLAUDE.md tiers (managed → user →
project → on-demand subdirectory files, ~200-line guidance, `@imports`) plus
**agent-written auto memory** (v2.1.59+): the agent saves typed notes
(user/feedback/project/reference) into a per-project memory dir with a capped
(200-line) MEMORY.md index, on by default [V: docs + CHANGELOG]. Long-harness
failure modes are documented frankly: one-shotting, half-implemented-then-lost
context, premature "done" declarations, untested "complete" features — with
progress-file + git-history state as the countermeasure [V:
anthropic.com/research/effective-harnesses-for-long-running-agents].

## The late entrants — ZCode, OpenClaude, Codewhale

The mission's list named three more systems; all three were verified to exist
mid-round (2026-10-28, 25+ fresh queries: GitHub API, npm registry, official
docs, HN Algolia) and are folded in here rather than in a new record.

- **ZCode** [V: zcode.z.ai/en, github.com/zai-org/ZCode (8.3k★)] — Z.ai's
  "agentic development environment" for GLM models: desktop app + browser UI
  + CLI. It ships the **closest thing to Unown's memory loop in the wild**:
  after each finished conversation round, the agent *in the background*
  decides what to keep (preferences, corrections, project goals) and
  auto-recalls it in later sessions; users say "remember X" / "forget Y"
  [V: zcode.z.ai/en/docs/memory]. The honest distinction: ZCode's loop is
  memory-curation only — no benchmark, no harness, no shipped-improvement
  receipts — and a Sept-2026 telemetry controversy (silent workspace uploads,
  later apologized and open-sourced) [V: blog.ferstar.org, HN] is the
  cautionary tale Unown's local-first engine design answers. Z.ai also
  publishes the memory-mechanism doctrine
  (session/project/semantic/episodic/procedural tiers, docs.z.ai/devpack) —
  independently convergent with Unown's tiering [V].
- **OpenClaude** [V: github.com/Twigpine/openclaude (34.2k★)] — the
  provider-agnostic fork of the leaked Claude Code source (leaked 2026-03-31;
  substantially rewritten): multi-provider incl. a GLM coding-plan lane,
  subagents, skills (`SKILL.md`), session resume/fork, background sessions,
  repo map. **No persistent learning loop or memory tier exists in it**
  [V-absence: README/docs search] — inherited the surface, not the postmortem
  discipline. Relevant to Unown only as the widest-distributed proof that
  Claude Code's *surface* is commoditized while its *improvement loop* is not.
- **Codewhale** [V: github.com/codewhale-hq/Codewhale (41.1k★)] — a Rust
  terminal coding agent (any-provider, 40+ providers, Plan/Work/Operate
  modes, fleet subagents, Claude-Code plugin compatibility, receipts/undo).
  No published benchmarks [V-absence], no persistent memory beyond AGENTS.md
  [V-absence]. Its one adoptable pattern: **the receipts/undo audit trail** —
  every agent action logged to a restorable ledger, which is what Unown's
  `.unown/receipts/` already does; the round keeps counting receipts as the
  primary evidence lane.

A second finding from the same pass: **the name "Cascade" was taken** —
Windsurf's flagship AI coding agent is named Cascade (now
`docs.devin.ai/desktop/cascade`, post the Cognition acquisition) and is
already documented as a competitor in
[detached-engine-research.md](detached-engine-research.md#17-windsurf--cascade-now-cognition)
§1.7. The round's app was renamed **Fugue** before the first build session
(the only honest moment to do it: nothing built, nothing embedded, three doc
references). A fugue is independent voices interwoven into one composition —
the exact shape of a workflow automation platform — and the collision search
(Atlassian Loom, Snyk's Fugue, the Fugue CRDT, FugueSQL) found no AI-agent
product holding it [V: 25+ queries].

## The seven-dimension comparison

| Dimension | OpenHands | Roo/Zoo | Cline | Codex CLI | Gemini CLI | Aider | Claude Code |
|---|---|---|---|---|---|---|---|
| **Learning loops** | agent-written 2-tier memory (opt-in) + critic auto-refine + human-gated skill meta-loop [V] | none built-in; agent-authored modes [V] | /newrule semi-capture [V] | /init scaffold only [V] | transcript-mining → human-gated patch inbox [V] | benchmark-driven releases [V] | /init + # + auto memory [V] |
| **Memory systems** | MEMORY.md index + daily logs, 6k budget, UNTRUSTED wrap [V] | rules dirs + mode YAML [V] | .clinerules + conditional glob-path rules [V] | AGENTS.md, byte-capped [V] | GEMINI.md tiers + JIT scans + memory tool [V] | conventions file, manual [V] | CLAUDE.md tiers + typed auto notes, capped index [V] |
| **Benchmarks** | SWE-bench Verified 53.0→76.6% trajectory, matched-model gates [V] | none [V-absence] | none [V-absence] | 72.1% cloud claim only [C] | behavioral evals on tool calls; GA claim withdrawn [C] | polyglot pass@1/@2 + well-formedness + cost [V] | internal evals + ablations; auto-mode classifier stats [V] |
| **Planning** | CodeAct + goals + task-tool subagents [V] | Architect + custom modes [V] | Plan/Act toggle + /deep-planning [V] | /plan mode [V] | Plan Mode + Pro/Flash routing [V] | architect/editor split [V] | plan permission mode + think-budget ladder [V] |
| **Failure recovery** | stuck detector + fallback chain + condenser [V] | shadow-git checkpoints + truncate-25%-retry [V] | shadow-git checkpoints + compact-retry-once [V] | on-failure escalation ladder [V] | checkpoint + conversation restore [V] | lint/test auto-fix loop + /undo [V] | interrupt + /rewind + course-correct [V] |
| **Task decomposition** | task-tool sync subagents + ACP delegation [V] | boomerang: new_task → isolated → summary-only [V] | new_task + spawn_agent + agent teams [V] | none (sandbox isolation) [V] | subagents + worktrees [V] | none [V] | Agent tool + custom subagents + teams [V] |
| **Autonomous debugging** | QA agent runs the app, reproduce-on-base, gives up gracefully [V] | debug mode, no execution verify [V] | live lint/terminal watch + auto-fix [V] | headless JSONL, never-asks [V] | checkpoint re-propose [V] | test-error feedback retry [V] | Code Review agent re-finding its own bug [V] |

## What this round adopted

Eight patterns, mapped onto this round's build (the fourth gallery app, the
benchmark framework, and the learning validation):

1. **Matched-model benchmark gating** (OpenHands) — every improvement claim
   in the Benchmark Improvement Report runs the *same* model (agnes-3.0-flash)
   before and after the change; the harness delta is the only thing measured.
2. **The QA-changes verification loop** (OpenHands) — the round's app must be
   *run* by the agent (server up, HTTP requests, browser screenshots), not
   just type-checked; PASS/FAIL evidence per phase.
3. **Boomerang subtask contract** (Roo/Zoo) — subagent tasks get isolated
   contexts and summary-only returns; the orchestrator does not inherit the
   child's tool noise (this is how the round drives research probes).
4. **Shadow-git discipline** (Cline/Roo) — the build repo keeps per-phase
   commits with explicit staged paths; nothing unverifiable lands.
5. **Headless-first event lane** (Codex CLI) — all build sessions drive
   `unown -p` with the JSON envelope; exit codes and receipts are the
   interface, never parsed TUI text.
6. **Human-gated patch inbox vocabulary** (Gemini CLI) — the round's harness
   fixes and minted tasks are presented with before/after evidence and canary
   gates; adopted for the improvement report format, not bypassed.
7. **Aider's benchmark craft** — pass@1/pass@2 with one retry, edit-format
   well-formedness, per-run cost columns; the SDLC metrics table inherits the
   shape.
8. **The postmortem loop** (Claude Code) — every failure gets root cause →
   fix → regression pin → rerun; the Validation Log is this loop written
   down, and "agent finds its own weaknesses" is the round's thesis.
9. **Naming-collision discipline** (the late-entrants pass) — a fresh-name
   search is part of shipping anything public: the app was renamed
   Cascade → Fugue on the receipt that Windsurf's flagship agent owns the
   name, before a single build session paid for the old one. ZCode's
   background memory curation is noted as the closest shipped competitor
   loop to watch, and the round's local-first engine stands as the answer to
   ZCode's telemetry controversy.

Remaining gaps this round deliberately does *not* adopt: Gemini's enterprise
gating (Unown stays clone-to-install), Codex's docs-behind-login (Unown's docs
stay in-repo), and Cline's product surface sprawl (one terminal, one engine).
