# The aria round — competitor research

> The 2026-10-29 sweep that grounds the aria round (gallery app #6, an
> Enterprise CRM built by Unown as the Evolution Programme's proving
> ground). This is the **delta layer**: everything the prior passes
> established is treated as read — the seven incumbents' standing rows live
> in
> [the validation round's research](validation-round-competitor-research.md);
> here we cover what moved since, the new entrants worth tracking, and what
> the round should adopt. Evidence tiers per `docs/AGENTS.md`: **[V]**
> verified at a fetched primary source, **[C]** credible secondary, **[U]**
> unverified.

- [Method](#method)
- [Headline deltas](#headline-deltas)
- [Comparison table](#comparison-table--the-named-set-current-state-delta-flagged)
- [Per-system sections](#per-system-sections)
- [The benchmark landscape moved](#the-benchmark-landscape-moved)
- [What the aria round should adopt](#what-the-aria-round-should-adopt--the-top-8-transfer-list)
- [Where Unown's mechanisms are still ahead](#where-unowns-mechanisms-are-still-ahead)
- [Remaining capability gaps](#remaining-capability-gaps--the-updated-honest-ledger)
- [What this means for the aria round](#what-this-means-for-the-aria-round)
- [Naming diligence — Aria](#naming-diligence--aria)

Related pages: [the validation round research](validation-round-competitor-research.md) ·
[the SOTA round research](sota-round-competitor-research.md) ·
[the parley round research](parley-round-competitor-research.md) ·
[the memory research](memory-competitor-research.md) ·
[the 2026-10-25 sweep](../benchmarks/research/2026-10-25/README.md) ·
[the memory-validation evidence file](../benchmarks/research/2026-10-29/memory-validation-round.md) ·
[the aria session record](aria-demo-session.md)

## Method

Primary sources fetched directly on 2026-10-28: official changelogs and
release feeds (GitHub `releases.atom`, raw `CHANGELOG.md`), docs sites that
serve content (`code.claude.com/docs` `.md`, `docs.openhands.dev/llms.txt`,
`ampcode.com/docs`, `conductor.build/changelog`, `cursor.com/changelog`,
`kiro.dev/blog`, `github.blog`, `commandline.microsoft.com`, `omp.sh` +
`can1357/oh-my-pi` README/npm, `aider.chat`, `swebench.com` embedded
leaderboard JSON, `harborframework.com`, `jules.google`, `tbench.ai`), plus
HN Algolia for community signal. Honesty ledger: the GitHub REST API was
rate-limited during the sweep (star counts quoted from the July survey are
not re-verified); Conductor's doc page *bodies* are client-rendered and
unreadable from the sandbox — Conductor facts are tiered from its
server-rendered changelog and docs nav; Reddit was not reachable, so
community signal is HN-only; `developers.openai.com` remained blocked (Codex
claims come from repo source and release feeds). [V]

## Headline deltas

1. **Copilot Memory** — cross-agent, citation-verified, on by default for
   Pro/Pro+ since 2026-03-04. [V]
2. **Claude Code's orchestration surface** — Projects (public beta), agent
   teams (experimental), dynamic workflows (scripted subagent fleets),
   ultrareview, artifacts, channels, computer use, Remote Control. [V]
3. **Cursor Agent SDK GA with evals + PR-replay fixtures** (2026-10-20);
   Rollouts bot with regression verdicts and optional auto-revert PRs
   (2026-09-23). [V]
4. **Kiro's run-all-tasks gauntlet** — property-based tests + dev servers +
   LSP diagnostics before batch execution (2026-01-16). [V]
5. **Harbor spun out as an independent benchmark framework** — Terminal-Bench
   4.0, hub, cross-harness runs, RL rollouts. [V]
6. **Conductor at 0.92.0** — the worktree-orchestration product, now with
   cloud microVMs, multiplayer and iOS remote control. [V]
7. **OMP (oh-my-pi) 18.13.3** — pi-fork with curated memory, advisor model,
   ranked top-3 with Claude Code/Codex in the mid-2026 field survey. [V/C]
8. **Aider in maintenance mode** — last stable 2026-02-12; the benchmark
   craft is now heritage, not velocity. [V]
9. **SWE-bench Verified submissions ended Feb 2026** (top 79.2); the
   field's yardstick is Terminal-Bench 2.x/4.0. [V]
10. **Memory interchange became a product category** — Codex imports
    external-agent memories (prior round) and community tools now sync
    memory across Claude Code/Cursor/Copilot. [V/C]

## Comparison table — the named set, current state, delta-flagged

Δ marks what changed since the prior passes. Systems not yet in the corpus
(Conductor, OMP, Cursor, Kiro, Copilot CLI, Jules, Squad) are new rows; the
seven core systems keep their standing rows (see the validation round's
seven-dimension table) and are summarized here only where they moved.

| System | Learning loop / self-improvement | Memory | Benchmarks / evals | Failure recovery | Skills reuse | Δ |
|---|---|---|---|---|---|---|
| Claude Code 2.1.312 | postmortems; auto memory; **Projects spawn parallel cloud sessions sharing instructions+memory** | CLAUDE.md chain + typed auto-memory (unchanged) | `plugin eval`, skill-creator A/B, `/skill-doctor`; **ultrareview = fleet-verified review** | `/rewind`, checkpoints (unchanged) | Skills + plugins; **12 LSP plugins, ralph-loop, receipts plugins in official marketplace**; `paths:`-scoped skills | ΔΔ |
| Codex CLI 0.165.0 | memory v2 consolidation (prior round); nothing new shipped | memories_v2 + citations (prior round) | none public | Esc-Esc backtrack (unchanged) | `/skills`; no minting | α-only since 10-23 |
| Gemini CLI 0.66/0.67-p | Auto Memory → human inbox (unchanged) | GEMINI.md + patch inbox (unchanged) | none | checkpoint + re-propose (unchanged) | Agent Skills std | minor: `gemini models`, container-sandbox IDE bridge |
| OpenHands (Canvas v1.34.0 / SDK v1.59.0) | Critic + human-gated skill meta-loop (unchanged) | 2-tier MEMORY.md (unchanged) | matched-model gates (unchanged); **per-conversation cost budget (new in SDK)** | stuck detector (unchanged) | skills + plugins; **account-level disabled-skills deny-list, `/launch` plugin route** | Δ |
| Cline 4.1.26 | `/newrule` only (unchanged) | `.clinerules` + Memory Bank (unchanged) | none | shadow-git checkpoints; **auto-compaction loop bugs fixed** | skills w/ token budgets | Δ cloud tasks |
| Roo Code / Zoo Code v3.92.0 | none (docs frozen 2026-05) | rules dirs (unchanged) | none | shadow-git (unchanged) | Agent Skills format | maintenance only |
| Aider v0.86.2 (Feb 2026) | none; benchmark-driven releases **stalled 8.5 months** | CONVENTIONS.md + repo map (unchanged) | the craft stands; no new runs | `/undo`, lint/test loop (unchanged) | conventions files | Δ stalled |
| Amp | none | AGENTS.md; **Projects**; skills repos + `amp clone` | none published; **fresh-orb "agent friendliness" eval pattern** | orbs; interrupted-tool settling | Git-hosted skills; mobile apps; Remote control | ΔΔ |
| Goose v1.57.0 (AAIF) | recipes | Memory MCP (unchanged) | **Harbor now an independent framework; TB-4.0** | resume/fork | recipes/MCP | Δ benchmark infra |
| OpenCode v2.2.0 (Oct 27) | none shipped | AGENTS.md; **plugin keyed session-instructions that survive compaction + reverts, no extra model turn** | **experimental decision APIs**; no evals shipped | snapshots/undo (unchanged) | skills, custom tools, **desktop plugins** | ΔΔ |
| **Conductor 0.92.0** (new) | **none of its own** — runs first-party agents | delegates to harness memory in repo | none | **turn-by-turn checkpoints; cloud microVMs (Firecracker)** | harness-native; MCP per harness | new row |
| **OMP 18.13.3** (new) | **agent-curated memory: retain/learn/recall/reflect/memory_edit; session → "mental model" next session**; **advisor: second model reads every turn, injects notes** | backends: local, **Hindsight**, **Mnemopi (SQLite)**; project-scoped | hash-anchored patches ~61% fewer output tokens (project-reported) [C] | checkpoint/rewind; filesystem-clone isolation | reads `.claude/.cursor/.codex/.gemini/.cline` configs natively | new row |
| **Cursor** (Agent SDK GA Oct 20) | bots (Rollouts: **regression verdicts → optional auto-revert PR**; Security Review) | rules/AGENTS.md; cloud envs to 300 repos | **`agent-sdk eval` in CI + `github replay` turns real PRs into signed fixtures** | Rollouts monitors deploys; revert PRs (never auto-merge) | Origin app marketplace; skills dir in agents | new row |
| **Kiro** (AWS) | **"Run all tasks" gauntlet: PBTs + dev servers + LSP diagnostics gate batch execution** | spec-driven (spec → tasks) | **property-based tests as task gates** | steering + validation-first ship policy | spec/task structure | new row |
| **GitHub Copilot** (CLI GA Feb 2026 [C]) | **Copilot Memory: cross-agent, memory-as-tool-call (subject/fact/citations/reason), JIT citation verification at recall, self-correct on contradiction**; on by default Pro/Pro+ 2026-03-04 | repository-scoped memory bank; most-recent-memories prompt injection | none public | review bots | plugins from repos; **Squad: "agents disposable, memory in Git"** | new row |
| **Jules** (Google) | none | none | none | diff-approve gate | none | new row |

## Per-system sections

### Claude Code — orchestration is the October story; memory unchanged

Version head still **2.1.312** (fetched 2026-10-28,
<https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md>)
— the validation round's coverage stands, including 2.1.311/312's
stale-memory-after-compaction and over-cap rewrite fixes. What the prior
passes did not record is the orchestration surface now in the official docs
(fetched via `code.claude.com/docs/llms.txt`, 2026-10-28):

- **Projects** (public beta): one ongoing conversation spawns a **thread per
  task**, usually cloud sessions, that "share repositories, instructions,
  and memory"; set context once, steer from phone. [V —
  code.claude.com/docs/en/claude-projects.md]
- **Agent teams** (experimental): lead + peers with own context windows,
  shared task list, inter-agent messaging; docs are frank about coordination
  overhead and token cost. [V — code.claude.com/docs/en/agent-teams.md]
- **Dynamic workflows**: a JavaScript script Claude writes, a runtime
  executes in the background, **dozens-to-hundreds of subagents per run,
  resumable** — "the script decides what runs next." [V —
  code.claude.com/docs/en/workflows.md]
- **ultrareview** (`/code-review ultra`): cloud fleet of reviewer agents,
  "every reported finding is independently reproduced and verified." [V —
  code.claude.com/docs/en/ultrareview.md]
- **Artifacts**: live interactive pages published from a session to
  claude.ai — the docs' own example is a CRM-shaped funnel-fix page with a
  funnel chart and metric cards. [V — code.claude.com/docs/en/artifacts.md]
- **Channels**, **computer use from the CLI**, **Chrome integration**
  (test web apps, form filling), **Remote Control**, **scheduled tasks**,
  **`/insights`**. [V — llms.txt index, fetched 2026-10-28]
- 2.1.312 also fixed per-directory and `paths:` skills resolution — skills
  now scope by directory and path glob. [V — CHANGELOG]
- Marketplace: the official plugin repo now ships **`ralph-loop`**,
  **`receipts`**, and **12 LSP plugins** — Unown's always-on persona,
  receipts lane and LSP strategy are now validated as mainstream patterns
  *and* commoditized. [V —
  github.com/anthropics/claude-plugins-official/tree/main/plugins]
- Doctrine: "Building agents: When to fold subagents into your main agent
  loop" (2026-10-22) — fewer subagents, progressively disclosed context;
  a migration kit that "identifies your patterns, evaluates alternatives,
  and verifies the best approach." [V — claude.com blog index]

**Aria-relevant:** artifacts + Chrome testing + the funnel-chart example;
"Claude for Financial Advisors" (2026-10-27) connects Claude to custodians,
portfolio platforms, **CRMs** and planning tools — the only CRM-shaped
go-to-market in the field. [V — claude.com blog index]

### Codex CLI — quiet week; memory v2 remains the story

Stable is still **0.165.0** (2026-10-23, memory-v2 default + external-agent
import — prior round). Since then: five **0.166 alphas with empty release
bodies** (latest 0.166.0-alpha.5.1, 2026-10-28) and a root CHANGELOG whose
"Unreleased" section holds one exec-lifecycle fix. [V —
github.com/openai/codex/releases.atom (fetched 2026-10-28);
raw.githubusercontent.com/openai/codex/main/CHANGELOG.md]. The memory-v2
citation contract and import pipeline stand as the validation round
documented them. **Aria-relevant:** nothing new; the recall-citation
discipline is the piece to answer.

### Gemini CLI — fixes, model discovery, container-sandbox IDE bridge

0.66.0 stable (prior round); **0.67.0-preview.0 (2026-10-27)** adds a
`gemini models` command and `--list-models`, bridges the IDE companion into
**container sandboxes over exec stdio**, hardens non-interactive
cancellation, and fixes a Claude-hook-timeout migration bug (the
Claude→Gemini migration path is now a maintained surface). [V — release
notes, github.com/google-gemini/gemini-cli/releases.atom]. No Auto Memory
changes; the human-gated inbox stance stands. Consumer access was retired to
Antigravity CLI in June 2026 per the field survey [C —
blog.arcbjorn.com/state-of-cli-coding-agents-2026]. **Aria-relevant:**
none.

### OpenHands — budgets, ACP skills, a growing skills governance layer

Agent Canvas **v1.34.0 (2026-10-27)**: per-conversation Docker runtime,
Settings→Runtime page, automations tags. [V — releases.atom] The
software-agent-sdk shipped **v1.59.0 (2026-10-28)**: **"set and update a
per-conversation cost budget"** and "let clients read and track the
conversation budget," plus **"expose skills to every ACP agent as files plus
a path catalog."** [V — github.com/OpenHands/software-agent-sdk/releases.atom]
The docs index adds a **disabled-skills account-level deny-list**, an
upload-skills cookbook, a `/launch` plugin route, and automations via an
"Automation Skill." [V — docs.openhands.dev/llms.txt]. The Critic,
persistent memory, and human-gated skill-improvement meta-loop are unchanged
from the validation round. **Aria-relevant:** per-conversation budgets — the
exact guardrail a long CRM build wants.

### Cline — cloud lane + compaction fixes

Changelog head **4.1.26** (fetched 2026-10-28): **cloud tasks** with a
Local|Cloud toggle, sandbox progress cards; catalog refresh; retries cut
5→3; **auto-compaction hardened** — no compaction for models with unknown
context limits, no re-compaction every few tool calls after the first (a
compaction-loop bug class fixed in public). [V —
raw.githubusercontent.com/cline/cline/main/CHANGELOG.md]. Learning loop:
still `/newrule` only [V-absence]. **Aria-relevant:** cloud sandboxes
confirm unattended-build infrastructure is table stakes.

### Roo Code / Zoo Code — frozen upstream, maintenance-mode fork

Roo's docs remain frozen at the 2026-05 handoff. Zoo Code **v3.92.0
(2026-10-24)**: inline model selector, MCP marketplace additions,
reliability fixes — no learning or memory movement. [V —
github.com/Zoo-Code-Org/Zoo-Code/releases.atom]. **Aria-relevant:** none.

### Aider — the benchmark craft is now heritage

Last stable **v0.86.2, 2026-02-12** — no release in 8.5 months [V —
github.com/Aider-AI/aider/releases.atom]; the homepage still carries
"Singularity 88%" and 2025-era model recommendations [V — aider.chat]. No
runtime learning exists (prior rounds); the polyglot harness and repo map
remain field-standard designs, but Aider is no longer a velocity threat.
**Aria-relevant:** its pass@1/@2-with-retry shape remains the benchmark-
craft bar Unown's minted-task suite already follows.

### Amp — agent-to-agent, projects, and an agent-friendliness eval pattern

New docs since the Parley pass (fetched 2026-10-28): **Agent to Agent** —
"Amp agents can start other agents, send them instructions, exchange
files, and bring their results back"; fan-out patterns; and the doctrine
worth stealing whole: "Fan-out also tests how ready your repository is for
agents: start several fresh orbs with no hints and see how far each one
gets." [V — ampcode.com/docs/orbs/agent-to-agent]. **Projects**
(per-codebase settings shared by every orb), `amp clone`, mobile apps,
Remote Control, Cross-Client Access [V — ampcode.com/docs]. Learning loop:
still none published. **Aria-relevant:** the fresh-orb, no-hints fan-out is
a cold-start acceptance test for gallery apps.

### Goose / Crush / OpenCode — Harbor leaves the nest; OpenCode ships plugin-era context APIs

Goose **v1.57.0 (2026-10-28)**: allowlist HTTPS/redirect validation,
caller-supplied session IDs, scheduled recipes. [V — releases.atom] The
structural news is **Harbor**: the Parley round's cross-harness benchmark is
now an independent framework — "from the creators of Terminal-Bench,"
installed standalone (`uv tool install harbor`), evaluating "arbitrary
agents like Claude Code, OpenHands, Codex CLI," running thousands of
parallel environments across providers, generating rollouts for RL;
Terminal-Bench is at **4.0**, hosted by Stanford/Harbor/Laude Institute.
[V — github.com/harbor-framework/harbor README; harborframework.com;
tbench.ai]. Crush: **v0.98.2 unchanged** [V — releases.atom]. OpenCode
**v2.2.0 (2026-10-27)**: desktop plugins, experimental image/decision APIs,
**per-provider prompt-cache TTLs**, session history starting from the
latest completed compaction, and the standout: **plugins attach keyed
session instructions that "survive compaction and reverts, and don't start
an extra model turn"** [V — github.com/anomalyco/opencode/releases.atom].

### Conductor — the orchestration product (new row)

Conductor (Melty Labs, conductor.build) is real, fast-moving and well-funded
($22M Series A, 2026-03-31 [C — HN]). It is **not a learning agent** — it
is the *control plane over* them: "Run Claude Code, Codex, Cursor, and
OpenCode in parallel. Each task gets its own workspace, branch, files,
terminal, diff, and review path." [V — docs.conductor.build, fetched
2026-10-28]. Verified from the 2026-10-23 changelog: **0.92.0** — Remote
control (iOS app drives local Mac workspaces), per-workspace preview URLs
with a Wake button, bundled harnesses (Claude Code 2.1.308, Codex 0.164.0,
Cursor Agent 1.0.40, OpenCode 2.1.3); **0.91.0** (2026-10-15) — voice mode,
teammate token-usage heatmaps; **0.90.0** (2026-10-02) — iOS app; cloud
workspaces on **isolated Firecracker microVMs** with multiplayer workspace
links [V — conductor.build homepage + changelog]. Docs nav confirms:
git-worktree isolation, parallel agents, **"View turn by turn changes in a
workspace and revert to previous turns"** (turn-level checkpointing) [V —
docs.conductor.build nav; page bodies are client-rendered and were not
readable from the sandbox — tier accordingly]. **No learning loop, no memory
of its own** [V-absence]. **Aria-relevant:** worktree-per-task with live
preview and PR-per-workspace is the shipped answer to "how would a team
parallelize an app build" — distribution, not learning.

### OMP (oh-my-pi) — the pi-lineage cousin, now ranked with the majors (new row)

**18.13.3 published 2026-10-28** [V — npm registry]; the mid-2026 field
survey ranks it with Claude Code and Codex as the close-quality trio, and an
Oct-27 community post calls it "the best [harness] I have found by far"
[C — blog.arcbjorn.com/state-of-cli-coding-agents-2026;
probsteide.com/notes/oh-my-pi.html]. Current README confirms the
learning-relevant surface: **"Memory the agent curates"** — `retain`
(queue durable facts mid-run), `learn` (reusable lessons), `recall`,
`reflect`, `memory_edit`; backends `local`, **Hindsight**, **Mnemopi**
(local SQLite); project-scoped; "compresses each session into a mental
model that loads on the first turn of the next one." **Advisor**: "Pair a
reviewer model to the 'advisor' role and it reads every turn the main agent
takes, injecting notes inline — a quiet aside, a concern, or a hard
blocker… on its own context and its own model." Nine roles route by
intent. It also reads `.claude`, `.cursor`, `.codex`, `.gemini`, `.cline`
configs directly — cross-harness compatibility as strategy. [V —
raw.githubusercontent.com/can1357/oh-my-pi/main/README.md; omp.sh]. No
benchmark/eval loop ships [V-absence]. **Aria-relevant:** OMP is the
existence proof that a pi-based agent can be publicly ranked top-tier —
and its ungated, in-harness consolidation is exactly the design Unown's
swap assessment rejected; the competitive question is whether Unown's
gated loop produces *measurably* better memory, which is what the aria
round's learning validation should show.

### Cursor — evals GA, canvases, and a regression bot (new row)

From the changelog (fetched 2026-10-28) [V — cursor.com/changelog]:
**Agent SDK GA (2026-10-20)** — "define an agent as a folder of code, test
it with evals, and deploy it": `instructions.md`, `tools/`, `skills/`,
`mcp-connections/`, `channels/`; **`agent-sdk eval`** asserts on which
tools ran with what input and reply shape, runs locally or in CI;
**`agent-sdk github replay <pr-url>`** "turns a real pull request into
signed webhook payloads and sends them to the bot" — real-PR-replay-as-
fixtures. **Cloud Agent Canvases (2026-10-16)**: cloud agents build
interactive canvases; Environments API beta; 300-repo environments.
**Rollouts + Security Review (2026-09-23)**: Rollouts writes a *monitoring
plan* as a PR comment (risks, intended effect, signals, instrumentation
gaps — "edit the plan and Rollouts uses your version"), tracks each
environment on deploy events, returns verdicts "verified healthy /
regression detected / inconclusive," and **can open a revert PR — "does
not merge or roll back on its own today."** [V] **Aria-relevant:** the
monitoring-plan pattern is a per-change verification contract the CRM
build's phases could adopt; canvases are the closest competitor artifact to
a live gallery app.

### Kiro — the run-all gauntlet (new row)

Kiro (AWS) published "Run all tasks: the feature we refused to ship (until
now)" on 2026-01-16 [V — kiro.dev/blog/run-all-tasks/]: they deliberately
refused batch execution until validation made it safe — **property-based
tests** ("invariant checks that ensure your code behaves correctly across a
range of inputs"), **dev servers** and **LSP diagnostics** as validation
environments, and **subagents** to fight context rot. Spec-driven
development (spec → tasks → code) remains the core. **Aria-relevant:** the
closest shipped cousin of Unown's harness cycle — batch task execution
gated by verification — except Kiro's gates are generic and Unown's are
mined from real failures and memory-gated; the PBT gate is the piece to
adopt.

### GitHub Copilot + Squad — cross-agent memory with citation verification (new row)

The single biggest memory-design event since the validation round:
**"Building an agentic memory system for GitHub Copilot"** (github.blog,
2026-01-16) [V —
github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/]:

- **Cross-agent memory**: coding agent, Copilot CLI and code review share one
  cumulative bank — "if Copilot coding agent learns how your repository
  handles database connections… Copilot code review can then use that
  knowledge to spot inconsistent patterns in future pull requests."
- **Just-in-time verification instead of offline curation**: "Information
  retrieval is an asymmetrical problem: it's hard to solve, but easy to
  verify." Memories are stored **with citations to specific code
  locations**; the agent verifies citations in real time before use; on
  contradiction it stores a corrected memory; on validity it re-stores to
  refresh the timestamp.
- **Memory creation as a tool call** with structured fields
  (`subject/fact/citations/reason`); retrieval injects the most recent
  repository memories at session start; opt-in, repository-scoped.
- Rollout: **on by default for Pro/Pro+ since 2026-03-04** [V —
  github.blog/changelog/2026-03-04-copilot-memory-now-on-by-default-for-pro-and-pro-users-in-public-preview/].

Alongside it, Microsoft's **Squad** post ("Disposable agents, durable
memory: the architecture behind Squad", 2026-05-28) states the doctrine:
"Make the agents disposable. Keep the memory in Git… governance belongs in
code whenever the prompt isn't strong enough to be trusted." Their **Squad
Places** demo — agent squads building, abusing and reviewing a social app,
with feedback threads turning into commits and **26 Playwright e2e tests**
stabilizing the surface — is the closest thing found to an agent-built-app
stress test. [V —
commandline.microsoft.com/squad-github-copilot-agent-teams-architecture-durable-memory/].
Copilot CLI itself: GA Feb 2026, specialist agents (explore/plan/review/
build), `&` cloud delegation, plugins from repos [C — survey].
**Aria-relevant:** Copilot's memory example is literally "API version must
stay synchronized across client SDK, server routes and docs" — the CRM
analogue (schema ↔ API ↔ UI contracts) is obvious, and nobody has shipped
an agent-built CRM.

### Jules — the async cloud agent, unchanged shape (new row)

Jules (Google) remains the plan-first async agent: label an issue, it
clones to a Cloud VM, drafts a plan on Gemini 3 Pro, shows a diff, opens a
PR; tiers scale to 300 tasks/day at 60 concurrent. [V — jules.google,
fetched 2026-10-28] No memory, no learning loop, no evals surfaced
[V-absence].

### The rest of the 2026 field (one-liners, mostly [C] via the July survey)

Antigravity CLI (Google, May 2026) [V site + C survey] · Grok Build (xAI,
May 2026; up to 8 parallel subagents in isolated git worktrees) [C] ·
Mistral Vibe (Dec 2025; remote async agents, ACP, Devstral 2) [C] · Kimi
Code CLI (Jun 2026, MIT) [C] · Qwen Code (Gemini CLI fork) [C] ·
**DeepSeek-Reasonix** (Apr 2026; cache-first design, checkpoints + rewind)
[C] · Junie CLI (JetBrains; GA Jun 2026) [C] · Kilo CLI 1.0 (Feb 2026;
**Memory Bank**) [C] · Codebuff (open-sourced late 2025) [C] · Droid
(Factory AI) [C] · Auggie (Augment) [C] · gptme ("git-backed memory for
agents meant to run for months") [C] · Continue (pace slowed) [C] ·
Windsurf 2.0 "Agent Command Center" (Apr 2026) [C — HN] · Waku (Rust
control plane) [C — abhishek.it blog] · **apc-cli** (sync AI memory across
Claude Code, Cursor, Copilot — memory interchange as a community product,
Mar 2026) [C — HN]. The survey counts **35 actively maintained CLI coding
agents** as of 2026-07-03, under AAIF stewardship of MCP, AGENTS.md and
ACP [C].

## The benchmark landscape moved

- **SWE-bench Verified is done as a harness race**: the newest submissions
  are **2026-02-26**; the top score is **79.2** (Sonar Foundation Agent
  with Claude 4.5 Opus; live-SWE-agent ties at 79.2), and the same model
  through mini-SWE-agent scores 76.8 — a measured +2.4 harness delta at
  the frontier. Warp, TRAE, Rovo Dev, Harness AI and EPAM's agent sit
  74.8–78.8 in the 2025 wave. [V — swebench.com embedded leaderboard,
  fetched 2026-10-28]
- **Terminal-Bench is the yardstick now**: TB 2.x closed frontier models in
  the mid-to-high 80s early July (GLM-5.2 open weights at 81.0 on TB 2.1
  vs Claude Opus 4.8's 85.0) [C — survey], and **TB 4.0** is live with
  confidence-interval whiskers [V — tbench.ai]. **Harbor** is now the
  standalone runner (`harbor run --dataset terminal-bench@2.0 --agent
  claude-code`) — the Parley round's "no cross-harness lane" gap now has a
  concrete, public remedy. [V — harbor README]
- **Economics became part of the benchmark**: Anthropic split Agent SDK
  credits from interactive usage on 2026-06-15 [C]; Amp went
  ad-funded-waitlist [C]; Reasonix competes purely on cache economics
  [C]. Cost columns are no longer optional in any eval table.
- **Maintenance risk is now a selection criterion**: "Aider, Open
  Interpreter, and Continue all show slowed cadence. Google retired a
  106k-star tool's consumer access with a month's notice." [C — survey]

## What the aria round should adopt — the top-8 transfer list

1. **Recall-time citation verification, shipped** (Copilot Memory + Codex
   v2): Unown's rendered memory should carry per-bullet citations to
   verifiable sources (receipts, failing-run records, code paths) and the
   recall contract should require verification before consequential use,
   with self-correction on contradiction. The validation round made this a
   *measurement*; two majors now make it a *shipped mechanic* to copy.
2. **Eval-first minting with replay fixtures** (Cursor Agent SDK): every
   minted SKILL.md ships with eval fixtures captured from the session that
   produced it, runnable in CI. Extends the existing task-mint lane and
   answers the per-skill-eval gap at the same time.
3. **Per-conversation cost budgets** (OpenHands SDK v1.59.0): the job
   router should enforce a hard ceiling per CRM build session, visible in
   the envelope — the guardrail for a long app build.
4. **Keyed session-instruction updates that survive compaction** (OpenCode
   v2.2.0): a mid-session memory addendum channel — updated without extra
   model turns, never lost to compaction. Claude Code's
   stale-memory-after-compaction bug class shows the failure this prevents.
5. **Cold-start agent-friendliness eval** (Amp fresh-orb fan-out): accept
   the CRM app only if a fresh sandbox agent with zero memory can stand it
   up from the repo alone. Turns AGENTS.md/skills sufficiency into a
   measured artifact — and doubles as the app's acceptance test.
6. **PBT/invariant gates before batch execution** (Kiro): the CRM's
   phase-gates gain property-based invariants (deal-stage transitions are
   monotonic; contacts unique by email; totals recomputable from events)
   that must hold before a phase can ship — complementary to verify-twice,
   and cheap.
7. **Fold-not-fanout as the decomposition default** (Anthropic, Oct 22):
   the CRM build plan should prefer progressively-disclosed single-loop
   work and reserve fleets for genuinely independent tasks — with the
   cost/latency receipts recorded, per the field's new cost-column
   discipline.
8. **Memory interchange export** (Codex import + apc-cli category): ship
   Unown's export with event history and test against Codex
   `memories_v2`/Claude Code formats — the gap is now a product category,
   and the export side is cheaper than the import side.

## Where Unown's mechanisms are still ahead

- **The closed loop remains unclaimed.** Checked against every system
  above: Copilot stops at self-correcting memory (no benchmark, no harness
  patch); OMP consolidates ungated inside the harness; Gemini still
  terminates in a human inbox; Kiro validates user-authored specs, not
  mined failures; Cursor's bots gate and flag but a human merges; Claude
  Code productized skill eval but not failure-mining. Nobody converts a
  live failure into a benchmark, patches memory, verifies twice, ships,
  and unships on regression. [V across cited sources]
- **Verify-gated memory shipping.** Copilot verifies *at recall, after the
  fact*; Codex grounds in rollouts but consolidation applies without a
  behavioral gate; OMP's dream runs ungated. No competitor gates a memory
  write on a twice-verified behavioral delta. [V]
- **Auto-unship.** The closest shipped artifact is Cursor Rollouts —
  regression verdicts with optional **revert PRs that it explicitly does
  not merge itself** [V]. Unown's regression sweep + auto-unship remains
  the most aggressive shipped rollback discipline found.
- **Minted capability evals from live failures.** Task-minting from real
  failures with solvability gates is still unique; the field mints skills
  from transcripts (Gemini), prompts (skill-creator) or specs (Kiro), not
  from verified failure evidence.
- **Local-first receipts** are now mainstream-but-shallow (Claude
  marketplace's `receipts` and `ralph-loop` plugins) where Unown's receipts
  + canaries + provenance sidecar run deep. [V]

## Remaining capability gaps — the updated honest ledger

1. **Per-skill evaluation harness** — worse than last round: Cursor's eval
   GA + Claude `plugin eval` make suite-level gating look dated. Still the
   #1 gap; adopt-list items 2 and 5 shrink it.
2. **Recall-time citations** — now shipped by two majors; escalate from
   "measurement" to "mechanic" (adopt-list item 1).
3. **Skill usage/cost audit** (`/skill-doctor` analog) — still unmeasured
   how much each listed skill taxes every turn.
4. **Cross-harness memory interchange** — Codex imports, apc-cli syncs, OMP
   reads foreign configs; Unown's import/export remains the thinnest.
5. **Condenser economics** — OpenCode backgrounds compaction and anchors
   history at it; Cline keeps fixing compaction loops; Unown still has no
   benchmarked compaction dimension.
6. **Cross-harness benchmark lane** — Harbor now exists as a standalone
   product; Unown has no adapter. Cheap to fix and the honest external
   validation channel.
7. **Second-model per-turn oversight** (OMP advisor) — Unown's advisor is
   an addon channel, not a per-turn reviewer model on its own context.
8. **Team distribution of live memory** — Squad's answer is "memory in
   Git," the same committed-markdown family Unown already tracks; the real
   gap (live multi-agent memory sync) is unsolved field-wide and recorded
   as deliberate non-adoption.

## What this means for the aria round

The Enterprise CRM build lands in a field where **nobody has an
agent-built CRM reference** — the only CRM-shaped artifacts found were
Claude's financial-advisor CRM connectors [V], an artifacts example with
funnel charts [V], and Squad's social-app stress test [V]. Gallery app #6
would be first-of-kind among the surveyed systems; the comparative report
can say so with receipts.

Concretely, the round runs the CRM build under **per-session budgets** with
cost columns in every snapshot (item 3); gates phase-ships on **PBT
invariants** for domain integrity (item 6); accepts the app via
**cold-start fresh-sandbox agents** (item 5) on top of the existing
QA-changes run-it-yourself lane; mints the CRM's skills with **replay
fixtures** so the per-skill eval gap closes on the round's own artifacts
(item 2); makes the CRM's learned memory **citation-bearing and
recall-verified** so the learning-validation has the anti-drift receipts
the mission's metrics ask for (item 1); and decomposes **fold-first**,
reserving the fleet for genuinely parallel surfaces (item 7). The
competitive claims to preserve: the closed loop, verify-gated shipping,
auto-unship, and minted capability evals — all re-verified this sweep as
still unclaimed by the field, and now testable against the strongest new
entrants (Copilot Memory, Cursor evals, Kiro's gauntlet, OMP's curated
memory) rather than only against the seven incumbents.

## Naming diligence — Aria

The gallery's naming rule (the Fugue precedent: renamed from Cascade
because Windsurf's flagship agent owned the name in-category) requires a
fresh-name search before shipping anything public. Run 2026-10-28; the
full receipt with queries and results lives in the session record
([aria-demo-session.md](aria-demo-session.md#the-naming-receipt)).

- **CRM named Aria?** No. "Aria CRM" searches surface Aria Systems (a
  billing/monetization platform that *integrates with* CRMs — not a CRM)
  [V — Wikipedia via MediaWiki API]; GitHub's "aria crm" repo search
  returns 28 toy projects, largest 3 stars [V — api.github.com]; the
  Wikipedia Aria disambiguation page lists no CRM or sales software among
  its 66 entries [V]. [V-absence in category]
- **Coding agent named Aria?** No — HN and GitHub searches return no agent
  product [V-absence].
- **Adjacent-space collisions (documented, none in-category):** the Rhymes
  AI "Aria" open multimodal model (1,088 stars, arXiv 2410.05993) [V];
  Adobe React Aria (the accessibility components library) [V]; WAI-ARIA
  (the W3C spec — every accessible web app emits `aria-*` attributes
  daily) [V]; aria2 (43,304 stars) [V]; Ariakit [V]; Opera's browser AI
  (now branded purely "Opera AI"; the standalone Aria name no longer
  appears on the page) [V]; VMware Aria Operations (infra ops) [C]; Meta
  Project Aria (research glasses) [C].
- **Verdict: keep "Aria"** — a musical term (the solo voice of the opera —
  apt for the sixth gallery app), with the honest risks recorded: web-dev
  discoverability is noisy (WAI-ARIA, React Aria, aria2), and the Rhymes
  AI model shares the name in the broader AI ecosystem. Neither is the
  Windsurf-Cascade situation. Ranked collision-clean alternatives if more
  separation is wanted: **Arietta** (short aria; clean in software — an
  11-star C++ template library is the top claimant) [V], **Arioso** [V],
  **Toccata** [V]; rejected with receipts: Cadenza (collides with the
  gallery's own **Cadence**), Serenade (serenadeai voice-coding tool + MVC
  framework) [V], Vibrato (the Rust tokenizer) [V], Madrigal [V].
