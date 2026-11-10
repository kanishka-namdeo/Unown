# Memory-Engine Combination Round — Session Log (2026-11-10)

Session doc per the repo's checkpoint discipline. Resume from the latest
checkpoint if this session is interrupted.

Objective (user task): *"test all possible combinations of using the memory
engine of unown for tasks. fix whatever is not upto latest standards or not
performing upto expectations"* — then document, bump the version and push
every milestone. The charter follows the 2026-11-09/10 combination rounds
(`docs/plan-mode-tui-combo-round-session.md`,
`docs/plan-mode-tui-combo-2-round-session.md`), applied to the **memory
engine**: drive every combination of write lane × consolidation × read lane
× tier setup × lifecycle (the matrix in
`docs/memory-engine-standards-2026-11.md` §3 — the round's grounding
research), live, as a real user against the real model, and fix whatever is
not up to the late-2026 standards floor (§2 — the 24-point checklist).

Round scope note: unlike the plan-mode rounds, this round's subject has a
large committed test battery already (17 focused files, 271 tests at
baseline). The round's job is not to re-prove what unit tests pin — it is
to drive the **live combinations** (real engine, real AutoDream through the
metered Agnes upstream, real TUI, real clones/worktrees) where the unit
lanes mock the boundaries away, and to grade the results against the 2026
floor. The last round's hand-off note explicitly leaves this round's
precondition better than its own: **BRIDGE_UPSTREAM_KEY is set** this time,
so engine learning jobs (AutoDream extraction) can run live — the live
dream receipts are part of this round's matrix.

## Method (as a real user, against the real model)

- Fresh clone at v0.0.59 (52a262d8); bun 1.4.4 side-installed (the sandbox's
  1.3.14 cannot parse `pi-repo/bun.lock` lockfileVersion 3); install 7/7
  (engine service skipped: `UNOWN_ENGINE_AUTOSTART=0` — the engine is driven
  through `bun run agent:start`).
- `.env` carries `BRIDGE_UPSTREAM_KEY` **and** `AGNES_API_KEY` (the Agnes AI
  metered free tier, ~20 RPM — the bridge's spacing/concurrency guards stay
  on). Stack green: bridge :3031 (`upstreamKeyIsSet: true`) + engine :3030
  (phase ready, v0.0.59); upstream live-verified (`/v1/models` — 6 models;
  one chat completion receipt before any install).
- Baseline before any edit: focused memory suites **266 pass / 5 skip / 0
  fail** (17 files); full self-learning suite **5501 pass / 105 skip / 0
  fail** (5606 tests, 251 files) — matching the 2026-11-10 close.
- Live lanes: the engine's REST+SSE API through the per-boot bearer token;
  the `unown` TUI through a PTY where interactivity matters
  (`scripts/tui-capture/pty_common.py` machinery); real scratch projects
  under a temp root for project-dream rows; real clones/worktrees for the
  identity rows. Long lanes must fit one tool-call window (the sandbox kills
  background trees at boundaries — the 2026-11-10 round's harness law).

## The combination matrix (this round's enumeration)

Write lanes W1 `/note` · W2 `note` tool · W3 exit note · W4 `unown note` ·
W5 subagent note · W6 `## Manual notes` hand-edit · W7 harness patch ×
consolidation C1 pending · C2 project dream · C3 benchmark dream · C4
quarantine · C5 hoist · C6 no-change · C7 gated/rolled-back × read lanes R1
session-start injection · R2 `/learning` · R3 `/new`-`/resume`-`/fork` · R4
`unown memory` · R5 `/memory search` · R6 `/api/memories?q=` · R7
`?across=1` · R8 sandbox injection · R9 dashboard Memory screen × tier
setups T1–T5 × lifecycle L1–L6. Full enumeration and the adversarial rows:
`docs/memory-engine-standards-2026-11.md` §3.

## Findings

(filled as the round drives them — each confirmed against source; live
confirmation noted)

## Fixes

(filled as they ship)

## Tests

(filled at close)

## Checkpoints

- **CP0 (setup + baseline + grounding research)**: clone at 52a262d8
  (v0.0.59); bun 1.4.4 side-installed; install 7/7; stack + Agnes upstream
  live (upstream key SET this round — the live-dream precondition); doctor
  green (agent home on the bundled zai-bridge lane, 6-model catalog; the
  two ⚠ items are the optional model-specs/LSP lanes); focused memory
  suites 266/0/5; full suite 5501/0/105. The late-2026 standards floor
  recorded at `docs/memory-engine-standards-2026-11.md` (24-point floor +
  the W×C×R×T×L matrix). Milestone M1 pushed.

## Hand-off notes

(filled at close)
