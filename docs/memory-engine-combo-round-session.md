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

| # | Finding | Where | Severity |
|---|---------|-------|----------|
| F1 | **The live suite's busy-mutex probe was non-deterministic — its verdict was decided by unrelated router activity, not the mutex under test.** Two measured live failure modes: (a) both 409 — a dream-check queued while the previous test's API dream ran drains on the next router tick and holds the mutex when the pair fires; (b) both 200 — the triggered dream was a ~1ms NO-OP (see F2) that acquired and released the mutex faster than the second request arrived. The probe had no idle precondition and no real fuel. | `test/memory-live.test.ts` (concurrency probe) | high (lane) |
| F2 | **The manual dream trigger's engine lane was a silent no-op below the AUTO lanes' ≥3 threshold.** `POST /api/dreams/run` answered `{started:true}` and the fire-and-forget body consolidated NOTHING whenever 1–2 benchmark notes + 0 terminal notes were pending (the mirror of `auto-dream`'s `>= 3` guard skipped `runDream()`; `runProjectDream()` had no terminal notes). Measured live twice: the dashboard's "dream now" reports a start, the Dreams screen shows nothing — the same defect class the 26641dec fix closed for terminal notes, still open on the benchmark lane. The ≥3 threshold is a cost policy for AUTONOMOUS operation, not a correctness requirement: `runDream()` consolidates any count ≥1 (its junk `no-notes` row only exists at exactly zero) and `canaryCheck` skips itself gracefully with no last-passing task. | `src/server.ts` (`/api/dreams/run` handler) | high (engine) |
| (verified green) | The engine-side live loop on a fresh environment: injection marker VERBATIM in the upstream request, tier blocks + `<project_instructions` wrapper present, real dream + canary + SSE events, write/history/rollback, crash-consistency self-heal, size hygiene — all green before AND after the round's fixes (receipts under `benchmarks/memory-eval/results/memory-live-receipt-*.json`). The poison gates live: PROBE A (poisoned benchmark note through the canary-gated dream) and PROBE B (poisoned terminal note through the project dream) — poison never ships (`memory-poison-receipt-*.json`). The busy mutex itself is SOUND (synchronous check-acquire, no TOCTOU — the probe's flake was lane-side). | — | none |

## Fixes

1. **F2 (the manual trigger honors explicit intent)**: the `/api/dreams/run` engine lane now runs `runDream()` for ANY benchmark-note count ≥1 — the ≥3 threshold stays the AUTO lanes' (router `auto-dream` / `dream-check`) cost policy. The zero-note junk row stays guarded (`>= 1`). `{started:true}` is now always true when notes exist (any pending note feeds at least one lane); `{skipped: "no undreamed notes"}` unchanged. Pinned by the new benchmark-lane test in `test/dreams-run-projects.test.ts` (single benchmark note → a real engine dream row that RAN, `notes_in=1`, no junk row — against the dead bridge the honest `'error'` status).
2. **F1 (the deterministic probe)**: the live suite's concurrency probe now (a) polls for FULL idle first — no running dream, `router.activeJob() === ""`, `pendingEventJobs()` empty (in-process router introspection), (b) asserts the mutex-winning trigger produced a NEW dream row with `notes_in >= 1` (a skipped trigger can no longer pass vacuously), and (c) keeps the started-dream finish poll for clean afterAll state. The probe's own note is real fuel post-F2 — the first trigger holds the mutex through a real LLM dream, the second deterministically 409s.

## Verification (live, this round)

- `UNOWN_MEMORY_LIVE=1 UNOWN_MEMORY_LIVE_MODEL=agnes-3.0-flash bun test test/memory-live.test.ts` — **7/7 GREEN post-fix** (pre-fix: 6/7 with the flaky probe failing both-409; the diag probe also measured both-200). The probe now passes through a real 33 s dream.
- `UNOWN_MEMORY_POISON=1 UNOWN_MEMORY_LIVE_MODEL=agnes-3.0-flash bun test test/memory-poison.test.ts` — **3/3 GREEN** (PROBE A `dream=done planted=false poisonShipped=false canary=passed`; PROBE B `planted=false poisonShipped=false`).
- Unit: `bun test test/dreams-run-projects.test.ts test/server-busy.test.ts` — 14/14 (the new F2 pin included); biome clean on the changed files.

## Checkpoints

- **CP0 (setup + baseline + grounding research)**: clone at 52a262d8
  (v0.0.59); bun 1.4.4 side-installed; install 7/7; stack + Agnes upstream
  live (upstream key SET this round — the live-dream precondition); doctor
  green (agent home on the bundled zai-bridge lane, 6-model catalog; the
  two ⚠ items are the optional model-specs/LSP lanes); focused memory
  suites 266/0/5; full suite 5501/0/105. The late-2026 standards floor
  recorded at `docs/memory-engine-standards-2026-11.md` (24-point floor +
  the W×C×R×T×L matrix). Milestone M1 pushed.
- **CP1 (the engine-side live matrix + F1/F2 fixed)**: the engine-side live
  gates driven on the fresh environment (memory-live 6/7 with the flake,
  memory-poison 3/3); the mutex race ground-truthed through the in-process
  diagnostic probe (`.run/matrix-diag` — activeJob/pendingEvents snapshots
  at every step; both-200 and both-409 modes both measured); F2 fixed in
  `src/server.ts`, F1 fixed in `test/memory-live.test.ts`, the F2 pin added
  to `test/dreams-run-projects.test.ts`; re-verified live **7/7 + 3/3
  GREEN**. Milestone M2 pushed.

## Hand-off notes

(filled at close)
