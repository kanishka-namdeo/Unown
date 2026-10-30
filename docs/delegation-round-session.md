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

**DONE.** The baseline benchmark is built, run, and scored —
[`benchmarks/delegation-round/`](../benchmarks/delegation-round/):

- The methodology contract (`README.md`): ten axes with formulas (delegation
  quality, subagent reuse, context efficiency, user explainability, progress
  visibility, memory utilisation, learning retention, failure recovery,
  autonomous decision quality, human intervention rate), a byte-pinned
  nine-lane workload + PTY pane-truth lane, the receipt contract, the honest
  limitations.
- The runner (`run-delegation-bench.mjs`): live agent, ground truths computed
  at run time, per-lane receipts (prompt, envelope, markers, journal delta,
  engine overview before/after), resumable, dream-trigger with retry.
- The scorer (`score-delegation.mjs`): read-only over receipts, zero model
  spend at score time, raw measurements + evidence quotes per axis,
  `--compare` for the after-run.
- **The baseline: v0.0.45 scores 76/100.** The gaps are the mission's
  targets: `why` recorded on 0/8 spawns, reuse 0, headless progress
  visibility 0/45. The strengths are real too: handoffs 84%, failure
  recovery 2/2, notes and dreams on the production path, the TUI fleet
  widget pane-proven.
- **Seven failures caught live** (`validation-log.md`, F26–F33): the runaway
  scout (104 turns / 596k tokens / 111 tool calls, clock-killed — the
  flagship product defect), the unpersisted async delivery, the push-channel
  polling loop, and four harness defects (all fixed in the runner/lane with
  evidence).

**VERIFIED (receipts from this machine, 2026-10-30,
`benchmarks/delegation-round/receipts/baseline-2026-10-30T07-43-53/`):**

| Gate | Result |
|---|---|
| 9/9 headless lanes green | ✓ (t8 after the F29 marker fix; run1 kept as audit trail) |
| PTY pane truth | widget live (`fleet-widget.pane.txt`, still rendered) + delivery with vitals (`fleet-result.pane.txt`) |
| Baseline scores | 76/100 overall; per-axis table in `RESULTS.md` with every raw number |
| Dream on the production path | 3× 409 then 200 on attempt 4 (F28): dreams Δ3, memory v3→4 (`dream-retry.receipt.json`) |
| Docs gates | `check_docs` green on the suite's four docs + registrations |

**NEXT.** Checkpoint 2 — the delegation ledger core: the `why` field on
every task call (journaled, displayed, surfaced), journal entries enriched
with task/usage/duration/outcome, lean-agent turn caps (F26's fix), the
persisted async delivery (F27's fix), and the engine's `/api/delegations`
aggregate — each with pinning tests.

## Checkpoint 2 — the delegation ledger core

**DONE.** The audit spine is implemented, live-verified, and pinned —
`pi-repo/packages/self-learning/`:

- **The `why` field** (premises before delegating): accepted on every `task`
  call (single + batch items), journaled with the spawn, displayed in the
  result section, the async ack, the fleet delivery, `task_control status`
  and `/tasks`. Live-verified: a real delegation session stated its reason
  ("Focused read-only search (context hygiene): … delegating keeps this
  session clean") and the reason rode the journal AND the engine aggregate.
- **The journal enrichment**: `spawned` entries carry `why` + `taskPreview`
  (the ORIGINAL ask, pre-repo-map composition — a live defect caught the
  first cut journaling the composed preamble); `finished` entries carry the
  audit payload (turns/tokens/tools/elapsed/blocked). Both lanes, additive,
  pre-0.0.46 entries stay readable.
- **The engine aggregate**: the `delegations` table + `POST/GET
  /api/delegations` (records, by-agent×status tallies, totals incl.
  `with_why` coverage) + the `delegation:recorded` SSE invalidation.
  Live-verified POST `{"ok":true,"inserted":1}` → GET with tallies.
- **The F26 fix (the runaway)**: read-only builtins ship turn caps —
  scout/background-explore 24, explore 40 (≈3× their healthy envelopes); the
  runaway shape now ends in a typed max-turns partial instead of a 596k-token
  clock kill.
- **The F27 fix (the vanishing delivery)**: fleet deliveries persist
  (`unown-subagent-delivery` session entries) — a replayed transcript keeps
  the child's report.
- **The F32 fix (push-channel polling)**: the async ack and a running
  child's `task_control status` both state the push contract ("the result
  arrives as its own message and WAKES YOU — do not poll").
- **Surfaces**: `/delegation` (the audit card, receipts-only worth lines) +
  the `delegation` footer chip (unseen not-ok first) + `unown delegations`
  (`--limit/--json/--engine`, pairs the journal by id) + the dashboard's
  **Delegation** screen (records, tallies, why-coverage line).
- **Docs + DOX**: `docs/subagents.md` (the why field section, the caps
  note), `docs/usage.md` (both command rows), the package AGENTS.md's
  delegation-round contract block.

**VERIFIED (this machine, 2026-10-30):**

| Gate | Result |
|---|---|
| Engine unit suite | **4970 pass · 0 fail** (220 files) — includes the 25 new delegation pins |
| New pins | `delegation.test.ts` (20) · `delegation-journal.test.ts` (5, incl. the F34 fresh-DB schema boot pin) · dashboard render anchors |
| Typecheck | zero NEW errors (101 pre-existing vendored ones unchanged — diff-verified against clean HEAD) |
| Live boot | engine `phase: ready`; POST/GET `/api/delegations` green |
| Live E2E delegation | the model stated its `why`; journal delta + engine row both carry it |
| CLI smoke | `unown delegations` renders the real journal (11 records, honest "why on 0/11" for pre-round entries); `--json` parses |
| Biome | clean on all changed files |
| Docs gates | `check_docs` green on every touched doc |

**F34 caught in-round**: the delegations index ran before its table in the
schema string — the engine crash-looped at boot until the order was fixed;
now pinned by a fresh-DB construction test (the honest ledger entry records
that the LIVE boot caught it, not the suite).

**NEXT.** Checkpoint 3: the remaining surfaces — the auto-brief's
delegation line, the fleet widget's why column, print-mode delegation
events — then the specialist agents (checkpoint 4).

## Checkpoint 3 — the surfaces: card, chip, widget, dashboard, CLI

*(opens when every user-facing delegation surface ships with its kill switch and tests)*

## Checkpoint 4 — the specialist agents

*(opens when the new builtin and project agents ship with role contracts and pins)*

## Checkpoint 5 — the after-benchmark + learning validation

*(opens when the 0.0.46 re-run is scored against the baseline and the failure ledger closes)*

## Checkpoint 6 — the release: 0.0.46

*(opens when the tag is pushed and the release is verified)*
