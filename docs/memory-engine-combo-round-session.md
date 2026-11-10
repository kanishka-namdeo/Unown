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
| F3 | **The scoped HTTP search lane dropped the `project:` prefix.** `GET /api/memories?agent_id=<slug>` constructed the scope `{agentId: <slug>}` verbatim — but a terminal project's platform scope is `{agentId: "project:<slug>"}` (memzero.ts `projectScope`; "the tier key IS the agent_id"). Measured live: the alpha scope listed **0/2 memories** through the raw slug and **2/2** through the prefixed form — a caller scoping by the slug every other surface prints got a silent empty set. The across lane and the in-session `/memory search` were unaffected (they resolve through `projectScope()`); the engine scope was unaffected. | `src/server.ts` (`/api/memories` handler) | medium (engine) |
| F5 | **`/learning`'s transparency lines were the first casualties of a long stack.** The notify renders its TAIL; the engine-state header and the injection-budget line were emitted FIRST, so on the default 36-row pane with alpha's dreamed stack (the pane dump is the receipt: the visible window started mid-project-tier) the two most load-bearing lines — the never-silent-truncation budget mechanism and the staleness frame — scrolled off the top exactly when the stack got long enough to matter. | `src/tools.ts` (`/learning` notify order) | medium (UX) |
| F4 (non-defect, documented) | **A clone cloned from a LOCAL PATH gets its own scope** (L6): the worktree correctly shares the repo scope (the gitdir/commondir hop works — `alpha-a45747`), but `git clone <local-path>` sets the clone's origin to the filesystem path, which normalizes to a different identity than the canonical remote (`alpha-ae1fe2` vs `alpha-a45747`, measured live). Git never propagates the source's own remote, so no engine-side key can bridge it; the documented contract is remote-keyed identity and the workaround is `git remote set-url origin <canonical>`. The README's "one repository = one memory across clones" holds for every clone of the same remote. | `src/project-identity.ts` (by design) | none |
| (documented non-defect) | The `-p` print lane inherits the operator harness's stdin (the rondo-round V-1 class, re-measured): the wrapper's exit-code lines slurp into the prompt and the process outlives its answer. The AGENTS.md law holds — run `-p` with `< /dev/null`; with the guard the print lane is 2 s, exit 0, both learned memories recalled verbatim. | operator runbook | none |

## Fixes

1. **F2 (the manual trigger honors explicit intent)**: the `/api/dreams/run` engine lane now runs `runDream()` for ANY benchmark-note count ≥1 — the ≥3 threshold stays the AUTO lanes' (router `auto-dream` / `dream-check`) cost policy. The zero-note junk row stays guarded (`>= 1`). Any pending note feeds at least one lane — with the one honest exception the M5 review closed (a project with a dream parked for review skips, visibly — see below); `{skipped: "no undreamed notes"}` unchanged. Pinned by the new benchmark-lane test in `test/dreams-run-projects.test.ts` (single benchmark note → a real engine dream row that RAN, `notes_in=1`, no junk row — against the dead bridge the honest `'error'` status).
2. **F1 (the deterministic probe)**: the live suite's concurrency probe now (a) polls for FULL idle first — no running dream, `router.activeJob() === ""`, `pendingEventJobs()` empty (in-process router introspection), (b) asserts the mutex-winning trigger produced a NEW dream row with `notes_in >= 1` (a skipped trigger can no longer pass vacuously), and (c) keeps the started-dream finish poll for clean afterAll state. The probe's own note is real fuel post-F2 — the first trigger holds the mutex through a real LLM dream, the second deterministically 409s.
3. **F3 (the scoped search resolves the slug)**: the `/api/memories` handler resolves a raw `agent_id` that names a known dreamed project scope (memory.ts `knownProjectScopes()`) to its prefixed platform scope; the explicit `project:<slug>` form and genuinely foreign agent ids pass through unchanged. Pinned by two new tests in `test/cross-scope-search.test.ts` (the slug → prefixed scope + its memories; the pass-through forms). Verified live: `?agent_id=alpha-a45747` now returns 2/2 memories with `scope: project:alpha-a45747`.
4. **F5 (the transparency tail)**: `/learning`'s notify now renders the tier stack first and the engine-state header + injection-budget line LAST (with the deep-dive hint) — the notify's tail is the always-visible window, so the budget line survives every geometry. Verified live in the 36-row pane (the mem-learning pane dump shows the header + budget line at the tail).

## Verification (live, this round)

- `UNOWN_MEMORY_LIVE=1 UNOWN_MEMORY_LIVE_MODEL=agnes-3.0-flash bun test test/memory-live.test.ts` — **7/7 GREEN post-fix** (pre-fix: 6/7 with the flaky probe failing both-409; the diag probe also measured both-200). The probe now passes through a real 33 s dream.
- `UNOWN_MEMORY_POISON=1 UNOWN_MEMORY_LIVE_MODEL=agnes-3.0-flash bun test test/memory-poison.test.ts` — **3/3 GREEN** (PROBE A `dream=done planted=false poisonShipped=false canary=passed`; PROBE B `planted=false poisonShipped=false`).
- Unit: `bun test test/dreams-run-projects.test.ts test/server-busy.test.ts` — 14/14 (the new F2 pin included); biome clean on the changed files.

## Tests

- Gates: focused memory suites **141/141** post-round (6 files re-run with
  the new pins: `cross-scope-search` +2, `dreams-run-projects` +1); full
  self-learning suite **5609 pass / 0 fail / 105 skip** (251 files — the
  baseline was 5501/0/105; +8 = the round's pins); typecheck **0 errors**
  (cleaner than the 773-error baseline the 2026-11-10 plan-mode round
  recorded — that debt has since been cleared upstream); biome clean on
  every changed file.
- Live: `UNOWN_MEMORY_LIVE=1 … agnes-3.0-flash` **7/7**;
  `UNOWN_MEMORY_POISON=1 …` **3/3**; the PTY memory matrix lane
  **16/16 ALL GREEN** (twice end-to-end); the dashboard Memory screen
  capture green (pane truth intact).
- Landing gates: `check:changelog` (56 stops, 556 entries — the rail
  regenerated), `check:blog` (49 posts — the round's post included, the
  feed regenerated), `check:docs`, `check:claims` (62 literals resolve),
  `check:benchmarks` (6 tracks) — all green.
- `bun bin/unown --version` → **0.0.60** (package.json is the source of
  truth; the release TAG is deliberately not cut — the same honest
  hand-off as the v0.0.58/v0.0.59 bumps: the pre-existing flaky CI lanes
  (landing e2e/unit, Chaconne, the Live production check — failing across
  rounds, untouched by this round) would hold the release workflow's
  ci-green gate).

## The independent review (M5) and its hardening

A fresh-eyes review of the pushed diff (11 findings, R1–R11; the soundness
ledger verified the F2/F3/F5 cores, both pin files as true pins, the F1
structure, the lane mechanics and every doc claim against the receipts —
including a live 10/10 re-run of the two pin files). Fixed this pass:

- **R1 (medium, engine + docs)**: the manual trigger's `{started:true}` was
  still a silent no-op in ONE state — a project with a dream **parked for
  review** (the `hasPendingDream` gate returned `pending-review` and the
  fire-and-forget discarded it: no row, no event) and the unreadable-memory
  error path (same shape). Both now emit `dream:finished` events (`pending`
  / `error` + project + reason) so the SSE feed shows WHY nothing shipped;
  BEHAVIOR.md's and memory.md's "always true when notes exist" claim
  softened to name the exception.
- **R2 (medium, lane)**: `phase_exit` never snapshotted before — any
  pre-existing exit note for the project satisfied it (the second
  end-to-end run's exit phase could not fail by construction). Now a
  before-snapshot: only a NEW row counts; the 40-row `/api/notes` window is
  the honest bound.
- **R3 (medium, lane)**: `phase_search` graded the honest empty answer as a
  timeout FAIL and pinned the phase to the round's own engine state (the
  hardcoded query and `alpha` scope check). The no-match notify is now an
  anchor; the query is `MEMORY_SEARCH_QUERY` env-driven; the scope-tag check
  matches the result rows' own shape.
- **R4 (medium-low, test)**: the concurrency probe's idle poll read
  `activeJob()` — which `withBusy`/`startFireAndForget` never set; an
  API-triggered dream holds the mutex while reading idle on all three old
  signals. `isBusy()` joined the poll (the honest signal).
- **R5 (low, test)**: the winner assertion now requires a status that
  consolidated (`done|gated` — an `error` row keeps `notes_in` from the
  running-row INSERT and would have passed a dead upstream as a "real"
  dream); the `?? true` dead assertion replaced by a strict `toBe(true)`.
- **R7 (low, engine)**: `idx_memory_versions_tier` — `knownProjectScopes()`
  GROUP BYs the tier column on every scoped search (and every across
  fan-out) over a precious, never-pruned table.
- **R6/R8/R9/R10/R11 (docs + lane portability)**: memory.md names the
  legacy-slug pass-through; resilience.md's "the header" wording updated
  for the tail order; the F-numbering gap closed (the local-path-clone row
  is F4); the lane's receipts default to the repo's gitignored
  `.run/mem-matrix-stills/` instead of an operator-machine absolute path
  (OUT env preserved); the `manual`/`new` phases' ordering dependency on
  the default phase order documented in the lane docstring.

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
- **CP2 (the terminal-side live matrix + F3/F5 fixed + the permanent lane)**:
  the whole terminal side driven as a real user against the live engine on
  the alpha matrix project (git repo, remote
  `github.com/example/alpha`, scope `alpha-a45747`): R4 `unown memory` + T2
  default policy + T3 local-override labels; W4 shell note (delivered,
  kind terminal, composite slug); **L4 outbox end-to-end** (engine killed →
  note queued with front-matter → engine reboot → outbox drained → archived
  to `done/` → row in the DB); **C2 the project dream** (manual trigger →
  `project-37647f69` row, 2 notes consolidated, the BOM pitfall + smoke
  convention rendered, provenance footer `rendered 2/2 memories via Mem0
  (backend: lexical)`, **W6 the Manual-notes marker preserved verbatim**);
  R6/R7 search lanes (F3 found, fixed, pinned, re-verified live);
  L6 worktree identity shared + the local-path-clone non-defect recorded;
  L3 the health card (0 duplicates, 0 conflicts, no warnings, reconcile
  stamped); L1 rollback (project tier v6 → v4 content restored as a
  forward-only v7 `rollback` audit row); R1 the print lane (stdin-guarded —
  both learned memories recalled verbatim, exit 0); W2 the agent `note`
  tool (print session → the AGENT-NOTE-TOOL-LANE row landed, kind
  terminal); W3 exit notes (delivered on every clean quit); **R9 the
  dashboard Memory screen** (live: engine tiers with versions, the
  injection-budget bar `4% 3.3k/80k`, BOTH project scopes with versions,
  the loop-state rail). F5 found through the lane's first run and fixed
  (the transparency tail). The permanent lane
  `scripts/tui-capture/verify_memory_matrix.py` (8 phases, 16 steps) run
  twice end-to-end — **ALL GREEN** (stills + pane dumps under
  `download/unown-mem-matrix/stills/`). Milestone M3 pushed.
- **CP3 (docs + release)**: this session doc closed (findings/fixes/tests
  receipted); CHANGELOG's Unreleased entry; `docs/memory.md` (the scoped
  search's slug resolution + dream-now intent + the /learning tail);
  `docs/BEHAVIOR.md` (the manual-trigger contract rides the dream
  paragraph); the blog post `content/blog/2026-11-10-the-memory-engine-combo-round.md`;
  the landing rail + blog data + feed regenerated; all six landing gates
  green; DOX pass (the self-learning AGENTS.md's tiered-memory + engine-
  service paragraphs carry the round's contracts); **v0.0.60** in
  package.json (`bun bin/unown --version` verified) — the tag not cut, the
  honest hand-off. Milestone M4 pushed.

- **CP4 (the independent review + hardening)**: the fresh-eyes review (11
  findings, R1–R11, with the soundness ledger) — R1/R7 fixed in the engine
  (`dream.ts`'s parked-review and unreadable-memory outcomes now emit
  events; the `memory_versions(tier)` index), R4/R5 hardened in the live
  suite's probe (`isBusy()` in the idle poll; the winner must have
  consolidated), R2/R3/R10/R11 hardened in the matrix lane (the exit-phase
  before-snapshot; the honest-empty-answer anchor + env-driven query; the
  repo-relative receipts default; the ordering-dependency docstring), the
  docs softened/extended (BEHAVIOR.md, memory.md, resilience.md, the
  F-numbering). Re-verified: the pin files, the full self-learning suite,
  the live suite re-run green, the PTY lane re-run green. Milestone M5
  pushed.

## Hand-off notes

- The stack engine (:3030, `data/self-learning/`) was left learning
  autonomously across the round — its own harness cycles, dream-checks and
  canaries ran throughout (engine project memory reached v9 with passing
  canaries; the alpha scope v3). Its data dir is gitignored runtime state;
  a future round wanting a cold engine can `bun run agent:stop` and wipe
  `data/self-learning/`.
- The matrix scratch projects live under `/home/z/my-project/matrix/`
  (alpha + alpha-clone + alpha-worktree, outside the repo) with dreamed
  memory in the engine's platform — the F3 lane's receipts (0/2 vs 2/2)
  reproduce there until the engine's data is wiped.
- The matrix lane's stills + pane dumps live under the repo's gitignored
  `.run/mem-matrix-stills/` (the R10 hardening — portable across machines;
  the round's first receipts under `download/unown-mem-matrix/stills/`);
  the lane regenerates them anywhere via
  `MEMORY_PROJECT=<dir> python3 scripts/tui-capture/verify_memory_matrix.py`.
- The hoist (C5) was NOT driven live this round: it is opt-in
  (`PI_USER_TIER_HOIST=1`), needs ≥2 projects abstracting the same rule plus
  an engine restart with the env set, and is pinned by `test/hoist.test.ts`
  (7 pins). A future round with token budget should drive it live on two
  matrix projects. Same for C7 (the gated/rolled-back dream): forcing a
  canary failure honestly requires a poison that PASSES the canary's first
  re-run — the memory-poison suite covers the adjacent lanes.
- The upstream stayed metered (~20 RPM class) all round; the bridge's
  spacing/concurrency guards were never disabled. The dream + canary live
  lane (agent run + dream + canary re-run ≈ 60 s) fit every one-call
  window; the PTY phases each fit their own window.
- A fix is not done until it is PUSHED (the 2026-11-10 round's law, obeyed
  this round: M1 d0564c8f, M2 09e2e0e6, M3 4bec03cf, M4+ the docs/release
  commit).
