# PLM round session log — the dogfooding mission, checkpointed

> The Process Lifecycle Management (PLM) round (2026-10-30): make every
> significant activity the engine performs a first-class tracked process —
> observable, governed, recoverable, reproducible, measurable — and then
> USE the system on itself: the round's own failures (two were caught
> live) became ledger rows and fixes, the whole run executed against the
> live Agnes-backed engine, and the receipts below were measured, not
> asserted. Session log per the dogfooding-mission contract: each
> checkpoint is resumable — the commit hash, the state of every lane, and
> what remained open are recorded as they were.

- [The setup](#the-setup)
- [Checkpoint 1 — research + the PLM core](#checkpoint-1--research--the-plm-core)
- [Checkpoint 2 — wiring + the first dogfooding catch](#checkpoint-2--wiring--the-first-dogfooding-catch)
- [Checkpoint 3 — terminal lane + Mission Control views](#checkpoint-3--terminal-lane--mission-control-views)
- [Checkpoint 4 — bounded growth + the second catch + the landing](#checkpoint-4--bounded-growth--the-second-catch--the-landing)
- [Checkpoint 5 — live receipts + reports](#checkpoint-5--live-receipts--reports)
- [The validation log](#the-validation-log)
- [What was NOT validated](#what-was-not-validated)

Related: [PLM competitor research](plm-competitor-research.md) ·
[Process lifecycle report](process-lifecycle-report.md) ·
[Tool lifecycle report](tool-lifecycle-report.md) ·
[PLM usage](plm.md) ·
[competitor comparison](competitor-comparison-report.md)

## The setup

- Fresh clone at `ff19e10f` (v0.0.47), bun 1.4.3, the stack started with
  `bun run agent:start` — bridge :3031 proxying
  `https://apihub.agnes-ai.com/v1` (model `agnes-3.0-flash`, the spec
  cascade verified it: 524,288 ctx / 65,536 out, curated catalog).
- `unown doctor` green; two real terminal sessions executed against
  Agnes before any code changed (the "verify as a real user" gate) —
  both delivered notes to the engine.
- The engine DB carried over between restarts (one data root, as in
  production); every metric below is from the LIVE engine, fetched over
  the API with the boot token.

## Checkpoint 1 — research + the PLM core

**Commit `ef1f0581`** — pushed; state: the core modules + store schema +
engine wiring + 102 pinning tests, full suite 5,276 green.

- The research pass ([PLM competitor research](plm-competitor-research.md))
  fixed the design before code: Temporal's closed status set, OpenHands'
  first-class waiting, OTel GenAI's tool-span vocabulary, LangGraph's
  pending-writes discipline, the classify-before-retry rule.
- `src/plm/` landed as seven modules (states, process-registry,
  tool-registry, failure-taxonomy, recovery-engine, checkpoints,
  learning-attribution) + the facade — the pure/store split of the house
  pattern, kill switch `UNOWN_PLM=0`.
- Seven new tables in `store.ts` (idempotent `CREATE TABLE IF NOT EXISTS`
  — no migration needed on existing installs).
- The router, runner and server grew their seams: jobs and runs became
  processes, tool executions became invocations, `wirePlm()` subscribed
  the improvement listeners.

## Checkpoint 2 — wiring + the first dogfooding catch

**State after `ef1f0581`**: engine restarted against the new code and the
scheduler's own jobs ran — and the FIRST live run caught a real defect:

> `[plm] refusing process transition …: CREATED → RUNNING is not a legal edge`

The router called `CREATED → RUNNING` directly; the state machine refused;
successful jobs finalized as ABANDONED-with-success-outcome (the fallback
edge). Exactly the mission's "no process may bypass lifecycle states"
rule biting its own wiring. The fix (commit `c831a9fc`): jobs walk
`CREATED → QUEUED → RUNNING` (the scheduler pick-up is a real state);
runs birth `started: true` (both events in the journal). The wiring pin
was tightened to assert the full four-transition chain — the regression
can never return silently.

## Checkpoint 3 — terminal lane + Mission Control views

**Commit `5a1e32e7`** — pushed; state: terminal reporting + the dashboard
views, full suite 5,287 green.

- The detachment contract held: the terminal agent reports tool
  invocations and its own session process over HTTP (the delegation
  pattern — fire-and-forget, 1.5 s timeout, down-engine-safe), never
  opening the engine DB.
- Mission Control gained the **Processes** screen (census, transition
  analytics, per-process rows, Enter = the full transition history) and
  the **Tools** screen (per-tool reliability, recommendations with fix
  lines); the Recovery screen grew the recovery-engine scorecard; the
  Learning Lab grew the attribution footer. The mock engine grew full PLM
  fixtures; the render tests pin the new vocabulary.
- The first terminal dogfooding session ran against Agnes (read → write →
  bash, `greet.py` verified) and landed as a SUCCEEDED
  `terminal-session` process with `{"calls":3,"errors":0}` and three
  terminal-lane invocations with real durations.

## Checkpoint 4 — bounded growth + the second catch + the landing

**Commit `c831a9fc`** — pushed; state: retention + env docs + landing.

- The six PLM tables joined the retention registry (30-day telemetry,
  90-day history, `learning_attribution` precious — structurally never
  pruned); the registry pin moved from six to twelve tables.
- The SECOND live catch: the boot orphan-heal showed
  `category=infrastructure, action=retry` — the text-derived plan had
  overridden the explicit producer category, mixing two taxonomies in one
  row. Fix: the whole plan derives from the FINAL category
  (`planRecoveryFor`), pinned by a coherence test.
- The landing showcase gained the Processes tile (a real PTY still of the
  live registry, `13-processes.png`) + two index entries, paid for by
  compressing the band's captions and three FAQ answers: the page
  measures **3,817 words ≤ 3,820** at replay-finished — the pre-round
  number exactly, ceiling untouched, the amendment documented in
  `e2e/landing-budget.spec.ts`.
- The dashboard PTY capture lane learned the new screens
  (`scripts/tui-capture/pty_capture_dashboard.py`); the capture run
  passed pane-truth for `processes, tools, recovery, lab`.

## Checkpoint 5 — live receipts + reports

**State at writing**: the engine has been running the round's code for
hours against Agnes, executing its own learning jobs. Measured over the
API (`GET /api/plm`, `GET /api/processes`, `GET /api/tools`,
`GET /api/recovery`):

- **31 processes** tracked: 23 SUCCEEDED · 5 ABANDONED (the pre-fix
  cohort, honestly retained) · 1 FAILED (the drain-closed dream-check,
  healed at boot) · 2 RUNNING. Transition analytics recorded every edge
  class: `(birth)→CREATED ×31`, `CREATED→QUEUED ×19`, `QUEUED→RUNNING
  ×19`, `RUNNING→SUCCEEDED ×23`.
- **35 tool invocations**, 91.4% success, engine+terminal lanes split;
  bash at 83% with two `logic` failures produced a live medium
  recommendation ("mine a recent failing invocation's transcript and mint
  a regression task") — the underperforming-tool detector working on real
  data, not fixtures.
- **1 recovery event, validated** — the boot orphan heal, recorded
  end-to-end (classify → execute → validate) with recovery score 100%.
- The reports: [process lifecycle](process-lifecycle-report.md) ·
  [tool lifecycle](tool-lifecycle-report.md) · this log ·
  [the research pass](plm-competitor-research.md).

## The validation log

Per the mission's rule — every failure named, reproduced, fixed, pinned:

| # | Failure | Reproduction | Root cause | Fix | Pin |
| --- | --- | --- | --- | --- | --- |
| F1 | Jobs landed `ABANDONED` with success outcomes; engine log spammed `refusing … CREATED → RUNNING` | Restart engine, let the scheduler run any job | Router wired an illegal shortcut edge | Jobs walk CREATED→QUEUED→RUNNING; runs birth `started:true` | `test/plm-wiring.test.ts` asserts the 4-transition chain |
| F2 | Recovery row mixed `category=infrastructure` with `action=retry` | Trigger the boot orphan heal | The text-derived plan overrode the explicit producer category | `planRecoveryFor` — the whole plan derives from the final category | `test/plm-recovery-engine.test.ts` coherence pin |
| F3 | `idx_delegations_ts` vanished from fresh DBs (caught by the F34 boot pin mid-round) | Construct a fresh Store | The schema edit dropped the index line while appending the PLM tables | Re-added; the existing F34 pin now guards it forever | `test/delegation-journal.test.ts` (pre-existing) |
| F4 | The sidebar accelerator pin broke (Delegation lost `0`) | Run the dashboard render suite | Two screens inserted after Recovery shift the digit rail | Pin updated to the new product statement (Processes takes `0`) | `test/dashboard-render.test.ts` |
| F5 | `bun run test:unit` failed on files under `data/self-learning/sandboxes/*/workspace/src/` — a mint solvability stub (`debounce.js: not implemented`) | Run the engine (task-mint fires), then `bun test src` | bun's positional test filters are SUBSTRING matches — the sandbox workspaces contain `/src/`, so engine runtime artifacts sweep into the web app's unit run on any source install that has run the engine | Cleaned the runtime artifacts (`sandbox-gc` owns them on its 15-min cycle); the proper fix (scoping `test:unit` against runtime-data roots) is filed as the follow-up — CI is unaffected (fresh checkout, engine never ran before the unit job) | `data/` is gitignored — no repo pin possible; this row is the receipt |
| F6 | The v0.0.48 release's first workflow run (41098657680) died at ci-green poll attempt 17: the API answered HTTP 504 and `set -euo pipefail` errexited the waiter — downstream skipped, no artifacts, no release, while CI itself was still green-in-flight | Re-drive the extracted step script against a mocked `gh` that fails once with the incident's exact 504 line | A WAIT loop ran under errexit: one transient probe failure equals job death | The probe is wrapped errexit-safe (`if json="$(gh api …)"`); a failed probe counts consecutive and waits out the minute; 10 consecutive still fail loudly (never pass blind); the 40-attempt bound unchanged | The four-scenario behavioral harness (`scripts` outside the repo, the receipt is this row + run 41098657680's log): 504-then-green passes · 10-consecutive fails with the refuses-blind error · red CI fails · no-run-yet waits then passes — all four verified locally against the script extracted verbatim from the YAML |

## What was NOT validated

- **Replay reproducibility stays `null`** — no replay run was executed
  against a live checkpoint in this round (the machinery is tested; the
  score stays honestly unmeasured until a real replay happens).
- **Learning attribution is empty (0 rows)** — no improvement shipped
  during the window (the harness found `fix-drop-right` already-passing;
  the honest null the FAQ documents). The ledger will fill on the next
  genuine ship; the listener is pinned by test.
- **Skill generation** — none this round (same as the cold-start report's
  honest null).
- **Long-horizon retention** — the round is one session old; retention
  checks need reruns across days.
