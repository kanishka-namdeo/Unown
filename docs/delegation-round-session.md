# The Delegation Round — the session record

> The resumable checkpoint log for the subagent-orchestration mission (2026-10-30 →): make Unown measurably better at **delegation** — every spawn carries its reason, every delegation is audited (cost, outcome, duplicates), Mission Control shows the fleet's decisions, the missing specialist roles ship, and the gains are proven by a before/after benchmark on the live agent. Each checkpoint states what is done, what is verified, and what is next, so an interrupted session resumes from the last green state.

- [Checkpoint 0 — setup, the research, the mission opened](#checkpoint-0--setup-the-research-the-mission-opened)
- [Checkpoint 1 — phase 1, the baseline: ten scores on v0.0.45](#checkpoint-1--phase-1-the-baseline-ten-scores-on-v0045)
- [Checkpoint 2 — the delegation ledger core](#checkpoint-2--the-delegation-ledger-core)
- [Checkpoint 3 — the surfaces: card, chip, widget, dashboard, CLI](#checkpoint-3--the-surfaces-card-chip-widget-dashboard-cli)
- [Checkpoint 4 — the specialist agents](#checkpoint-4--the-specialist-agents)
- [Checkpoint 5 — the after-benchmark + learning validation](#checkpoint-5--the-after-benchmark--learning-validation)
- [Checkpoint 6 — the release: 0.0.46](#checkpoint-6--the-release-0046)

## The contract

The mission succeeds only if, measured on the SAME workload before (v0.0.45) and after (v0.0.46):

- every delegation is **explainable** (a recorded `why`, visible before the result lands),
- the **audit ledger** answers for each spawn: why it was created, what it did, what it cost, how it ended, and whether the same work was already in flight (duplicates),
- **delegation quality** (handoff completeness, right-role choice, outcome rate) improves or holds while context cost per completed task does not regress,
- the specialist coverage the mission names (debug, test, security review, documentation + the curators) ships as first-class agents,
- Mission Control (in-session + dashboard) shows the delegation picture, composing existing facts without forking data,
- every failure found during the round becomes a benchmark entry and a pinned test before it is called fixed,
- and a human observer can read, in one place, exactly how Unown decided to delegate.

Dogfood rule (inherited): every discovered weakness becomes a benchmark, an evaluation, or a regression test — failure → root cause → benchmark → fix → rerun → evidence. No failure is resolved until the benchmark it minted passes.

## Checkpoint 0 — setup, the research, the mission opened

**DONE.** The stack is up and the mission is grounded:

- Clone at `70e9b88c` (v0.0.45, the observability round's tip), bun 1.4.4, `bun scripts/install.ts` green, engine :3030 + bridge :3031 live against the Agnes upstream, `unown doctor` green, a headless probe answered (`BASELINE-RUN-OK`).
- Five research passes: the subagent system architecture (fleet/journal/catalog/routing, file:line map), the benchmark + round conventions (receipt formats, session-doc skeleton, changelog/blog grammar, gate matrix), the Mission Control surfaces (dashboard screen registry, mission panel, recovery pattern, UX principles), the release runbook (16 CI jobs, tag-triggered release, xplat lanes), and the external state of the art (60+ sources).
- The competitor research is committed: [docs/delegation-competitor-research.md](delegation-competitor-research.md) — the verdict, the field map (Claude Code, Copilot CLI's measured delegation fix, Cursor/Devin/Amp, the frameworks), the measurement landscape (resolution vs cost, pass^k, duplicate-work rate, sequential-delegation ratio, intervention rate, MAST), Unown's gap table, and the adopt/reject list that scopes this round.

**VERIFIED (2026-10-30, this machine):**

| Gate | Result |
|---|---|
| `bun run agent:start` | bridge :3031 `ok:true` (upstream 200), engine :3030 `phase:ready`, v0.0.45 |
| `unown doctor` | green (⚠ LSP/MCP optional lanes only) |
| `unown -p` end-to-end | answered through bridge → Agnes |
| `unown --version` === package.json | 0.0.45 === 0.0.45 |
| Research receipts | 60+ cited sources, tiered V/C/U, in the research doc |

**NEXT.** Checkpoint 1: the baseline benchmark — a delegation-inviting workload run on unmodified 0.0.45, scored on the mission's ten axes with committed receipts (`benchmarks/delegation-round/`).

## Checkpoint 1 — phase 1, the baseline: ten scores on v0.0.45

*(opens when the baseline workload has run and the receipts are committed)*

## Checkpoint 2 — the delegation ledger core

*(opens when the ledger — `why`, journal enrichment, the engine endpoint — is implemented and pinned)*

## Checkpoint 3 — the surfaces: card, chip, widget, dashboard, CLI

*(opens when every user-facing delegation surface ships with its kill switch and tests)*

## Checkpoint 4 — the specialist agents

*(opens when the new builtin and project agents ship with role contracts and pins)*

## Checkpoint 5 — the after-benchmark + learning validation

*(opens when the 0.0.46 re-run is scored against the baseline and the failure ledger closes)*

## Checkpoint 6 — the release: 0.0.46

*(opens when the tag is pushed and the release is verified)*
