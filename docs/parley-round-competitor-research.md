# The Parley round's competitor research

> **Verdict up front:** six agent systems were reverse-engineered to ground
> this round — ZCode (Z.ai's official coding agent), OpenClaude (Twigpine's
> provider-agnostic Claude-Code-workflow CLI), Codewhale (the Rust terminal
> agent formerly "DeepSeek-TUI"), Goose (Block's agent, now a Linux
> Foundation project), Crush (Charmbracelet's LSP-native TUI agent) and Amp
> (the ex-Sourcegraph lab's thread/orb environment) — each read against its
> own repo, docs and changelogs on the seven learning dimensions the SOTA
> round established (learning loop, memory, benchmarks, planning, failure
> recovery, task decomposition, autonomous debugging). The headline finding
> extends the SOTA round's: **still none of the competitors ships a closed,
> self-improving loop** — but the 2026 frontier has moved to (a) adversarial
> verification of one's own work (OpenClaude's anti-rationalization
> verifier, Codewhale's "dispatched ≠ settled ≠ verified" evidence gates),
> (b) isolation-controlled evaluation of agent changes (Goose's Harbor
> cross-harness benchmark, ZCode's external-launcher contract, Codewhale's
> skill-evaluation methodology), and (c) durable resumable execution with
> checkpointed recovery (Codewhale's runtime ledger, ZCode's three-way
> rewind, Amp's orbs). This round adopts the verification and evaluation
> scaffolding — the pieces that make self-improvement *trustworthy* — and
> lists what remains open.

- [Method](#method)
- [What each system is](#what-each-system-is)
- [ZCode — the memory discipline](#zcode--the-memory-discipline)
- [OpenClaude — the adversarial verifier](#openclaude--the-adversarial-verifier)
- [Codewhale — the evidence ledger](#codewhale--the-evidence-ledger)
- [Goose — the cross-harness benchmark](#goose--the-cross-harness-benchmark)
- [Crush — the LSP-native minimalists](#crush--the-lsp-native-minimalists)
- [Amp — the environment-as-verifier](#amp--the-environment-as-verifier)
- [The seven-dimension comparison](#the-seven-dimension-comparison)
- [What this round adopted](#what-this-round-adopted)
- [Remaining gaps](#remaining-gaps)

Related pages: [SOTA round research](sota-round-competitor-research.md) (the
seven-system sweep this extends — OpenHands, Roo/Zoo, Cline, Codex CLI,
Gemini CLI, Aider, Claude Code) · [sentinel round
research](sdlc-testing-competitor-research.md) · [memory competitor
research](memory-competitor-research.md) (the standing memory-stack
comparison) · [Parley session record](parley-demo-session.md) (the round
this research grounds).

## Method

Each system was researched against its own primary sources during the round
(2026-10-28): GitHub repos read at their current `main` (READMEs, changelogs,
design docs, source files — ZCode's `apps/zcode-cli/docs/design/v2/` and
OpenClaude's `src/tools/AgentTool/built-in/verificationAgent.ts` are cited
at file level), official docs sites, and published benchmark readmes. Claims
carry the standing tiering: `[V]` verified at a cited source, `[C]`
upstream-claimed, `[U]` unknown. Star counts and versions are as-read on the
research day.

## What each system is

| System | What it is | What this round took from it |
|---|---|---|
| [ZCode](https://github.com/zai-org/ZCode) | Z.ai's official coding agent — Electron + web + CLI sharing one codebase; the GLM-5 harness (~8.3k stars, v3.16.2) [V] | the memory-benchmark discipline (`--memory-bench` forces extraction to drain before exit) and the benchmark-launcher isolation contract |
| [OpenClaude](https://github.com/Twigpine/openclaude) | Twigpine's open, provider-agnostic CLI mirroring Claude Code's workflow surface on 200+ models (34.2k stars, v0.33.0) [V] | the adversarial verification agent — anti-rationalization prompting, mandatory adversarial probes, exact-command-or-reject evidence |
| [Codewhale](https://github.com/codewhale-hq/CodeWhale) | the Rust terminal agent formerly "DeepSeek-TUI" (41.1k stars, v0.10.2) [V] | "dispatched ≠ settled ≠ verified" as a lifecycle; receipts with approval provenance; the skill-evaluation methodology (frozen baseline, rejection conditions, holdout) |
| [Goose](https://github.com/aaif-goose/goose) | Block's agent, now under the Agentic AI Foundation at the Linux Foundation (55.9k stars, v1.57.0) [V] | Harbor's cross-harness benchmark table — same model across harnesses, cost/turns/compute columns, adapter-vs-vanilla sanity check |
| [Crush](https://github.com/charmbracelet/crush) | Charmbracelet's Go TUI agent with LSP-native context (28.8k stars, v0.98.2) [V] | the interrupted-tool-call settling pattern (a crashed process must not poison the transcript) |
| [Amp](https://ampcode.com/docs) | the ex-Sourcegraph independent lab's agent — threads, orbs (remote per-thread machines), The Dial [V] | model-*bundle* pinning per task (mode = model + reasoning + prompt + tools, fixed for a thread's lifetime); verification through environment ("tell it to prove its changes work") |

## ZCode — the memory discipline

ZCode's memory design (v4) is the most formally specified of the six: a
per-project memory root with `MEMORY.md` plus one-fact-per-file entries, two
mutually exclusive retrieval branches (`default-index` vs `semantic-recall`,
deliberately not user-configurable), background extraction after successful
turns, and a designed-but-not-auto-triggered "Dream" consolidation handler
[V, `apps/zcode-cli/docs/design/v2/memory/README.md`]. Two contracts stand
out for this round:

- **`--memory-bench`** — a CLI mode that forces auto-extraction on, waits
  for the extraction queue to drain (bounded 60 s) before process exit, and
  *errors if memory is disabled* [V]. Memory subsystems get a first-class
  benchmark mode rather than an afterthought — the same stance this round's
  snapshots take (a learning claim without a drained-and-captured receipt is
  not a claim).
- **The external-launcher contract** (`docs/usage/13-automation.md`) —
  per-sample isolation (separate workdir + user dir + data dir; "only
  changing sessionId is insufficient isolation"), pinned conditions (build
  SHA-256, CLI version, model + provider protocol, permission mode), and
  strict adjudication: startup failure / cancelled / timeout → save failure
  evidence, never count as success [V].

Its `/rewind` cleanly separates conversation rewind, workspace rewind and
compact boundaries (`fileHistoryTrackEdit()` before every mutation) [V,
`design/v2/rewind/plan.md`] — a Unown checkpoint/undo parity feature already
shipped in the SDLC rounds, re-validated here.

## OpenClaude — the adversarial verifier

OpenClaude ships a built-in **verification agent** whose prompt is the most
honest piece of verification engineering found in any competitor [V,
`src/tools/AgentTool/built-in/verificationAgent.ts`]:

- it names its own failure modes ("verification avoidance", "being seduced
  by the first 80%") and instructs the agent to recognize its own
  rationalizations;
- every check must show the exact command and copy-pasted output — "a PASS
  report without at least one adversarial probe is rejected", and the caller
  "may spot-check your commands by re-running them";
- it assumes the implementer's tests are mock-heavy ("the implementer is an
  LLM too");
- per-change-type strategies (frontend / backend / CLI / infra / bugfix)
  with universal baselines (build, tests, linters, regressions).

This round adopts the pattern for the Parley build's review phase: the
reviewer brief demands adversarial probes (cross-tenant access attempts,
role-escalation attempts, expired-token replays), not just "check the code".

## Codewhale — the evidence ledger

Codewhale's Operate mode makes verification a **lifecycle state**: every
substantive request becomes a goal with completion checks; each workflow
phase gates on evidence; "dispatched ≠ settled ≠ verified"; a missing
required result stops dependent work and repairs the step [V,
`docs/MODES.md`]. Its `/receipts` surface records every file, command, MCP
call, agent, approval and failure — with *who* decided each approval (user /
session rule / posture / host) and "ran without asking" counts [V,
`docs/RECEIPTS.md`].

Its `SKILL_EVALUATION.md` is the skill-improvement methodology Unown's
harness already echoes, made explicit: hold provider/model/tools/fixtures
fixed, change one skill, define task families with hard rejection conditions
("silently skips verification or reports an unrun check as passed"
auto-rejects), dev/holdout split with repeated paired runs, keep the
previous version for rollback [V].

## Goose — the cross-harness benchmark

Goose's Harbor (`evals/harbor`) is the strongest public benchmark
methodology found this round: terminal-bench-2 (89 tasks) run **across agent
harnesses on the same model** (claude-sonnet-4-6: goose code-mode 57.3%,
Claude Code harness 55.1%, OpenCode 52.8%, stock goose 50.6%), with columns
for rate, compute hours, tokens, turns, cost and a pass/fail/err/tout
breakdown, plus a sanity check that the harness adapter matches a
vanilla-installed binary [V, `evals/harbor/README.md`]. Their published
insight matters for Unown's programme: a harness feature (codemode) moved
the score +6.7 points — more than the gap between several competing agents —
so harness changes are measurable and worth optimizing [V].

## Crush — the LSP-native minimalists

Crush ships no memory, no benchmarks, no self-improvement — and two sharp
mechanics worth keeping in view: **interrupted-tool-call settling** (a dead
process's unanswered tool calls are settled at startup so the transcript is
never poisoned [V, `internal/agent/settle.go`]) and 13 Claude-Code-compatible
hook events that compose deterministically in config order [V,
`docs/hooks/README.md`]. Its builtin self-configuring skills
(`crush-config`, `crush-hook`) are the minimalist answer to agent skill
generation [V].

## Amp — the environment-as-verifier

Amp's Dial (low/medium/high/ultra — each mode a bundle of model + reasoning
effort + system prompt + tools) is **fixed for a thread's lifetime**,
because mid-thread model switches both confuse models and invalidate prompt
caches [V, ampcode.com/docs/the-dial] — a concrete constraint for any
routing change. Its orbs give the agent a whole machine and make it "prove
that its changes work before you look at them" [V, ampcode.com/docs/orbs] —
verification through environment rather than prompt, the same stance as
Unown's fresh-sandbox harness runs.

## The seven-dimension comparison

| Dimension | ZCode | OpenClaude | Codewhale | Goose | Crush | Amp |
|---|---|---|---|---|---|---|
| Learning loop | background extraction; Dream designed, not auto-triggered [V] | auto fact extraction; hook-chain self-healing rules [V] | skill-optimization experiments (frozen baseline, holdout) [V] | recipes as reusable workflows [V] | none [V] | none published [V] |
| Memory | Memory v4: per-project MEMORY.md + one-fact files, two retrieval branches [V] | memdir: capped MEMORY.md, 4-type taxonomy, only non-derivable facts [V] | opt-in Markdown + SQLite FTS5, untrusted-data wrapping [V] | Memory MCP + Top-of-Mind + MOIM [V] | none persistent [V] | durable threads, no cross-thread memory [V] |
| Benchmarks | no leaderboard; launcher isolation contract [V] | startup/local-model latency only [V] | none by policy [V] | Harbor cross-harness TB2 [V] | none [V] | none public [V] |
| Planning | plan mode + `/expert` workflow graph [V] | plan tools + repo map [V] | Plan/Work/Operate modes + `/goal` budgets [V] | permission modes + recipes [V] | coder/plan/task agents [V] | The Dial bundles [V] |
| Failure recovery | event-sourced; 3-way `/rewind` + fork [V] | session fork; outcome taxonomy (exited/failed/stale/killed) [V] | `/undo` + `/restore`; write-after-read guard [V] | resume/fork/edit-as-YAML; auto-compaction [V] | tool-call settling [V] | orb sleep/wake with state [V] |
| Task decomposition | subagents + workflow scheduler [V] | agent tool + per-agent routing/maxSteps [V] | one runtime for everything; fleet roles; writer-claim ledger [V] | subagents + parallel subrecipes [V] | parallel agent tool [V] | Task + Read Thread subagents [V] |
| Autonomous debugging | Gather-Act-Verify loop [V] | adversarial verification agent [V] | evidence-centric Operate loop; receipts [V] | errors-as-prompts philosophy [V] | LSP diagnostics as tools [V] | environment-as-verifier (orbs) [V] |

## What this round adopted

1. **Adversarial review probes** (OpenClaude) — the Parley build's `/review`
   phase is briefed to attempt cross-tenant reads, role escalations and
   expired-token replays, not just read the diff.
2. **Evidence-first cycle receipts** (Codewhale) — every harness cycle in
   this round's snapshots records the run ids behind each status; a status
   without its run receipt is treated as unmeasured.
3. **Memory-drain-before-snapshot** (ZCode) — the round's baseline/midpoint/
   final snapshots are taken after the dream queue drains, so a "5 dreams"
   count is a completed-consolidation count, not an in-flight one.
4. **Holdout discipline for the learning claim** (Codewhale) — the final
   benchmark re-run includes the seed suite (dev) *and* the minted tasks
   (holdout): an improvement that only shows on the tasks the patch was
   mined from is not retained learning.
5. **Cost columns on every run** (Goose Harbor) — the snapshots carry
   tokensIn/tokensOut/toolCalls totals, so a pass-rate lift can be read
   against its token cost.

## Remaining gaps

- No cross-harness lane yet: Harbor's same-model-across-harnesses table has
  no Unown equivalent (the polyglot/selfimprove tracks measure Unown
  against itself over time, not against sibling harnesses) — the honest
  gap this round records but does not close.
- The Dial's bundle-pinning constraint (no mid-thread model switches) is
  documented by Amp but untested in Unown's routing — noted for the
  routing backlog.
- Codewhale's writer-claim coordination ledger (refuse a second live writer
  whose claim overlaps) is a parallel-safety idea Unown's single-writer
  busy-mutex achieves differently; a multi-sandbox future would need it.
