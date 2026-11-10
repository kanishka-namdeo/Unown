# Plan-Mode × TUI Combination Round 2 — Session Log (2026-11-10)

Session doc per the repo's checkpoint discipline. Resume from the latest
checkpoint if this session is interrupted.

Objective (user task): *"test all possible combinations of plan mode
functionality and TUI experience. fix whatever is not upto latest standards"*
— then document, bump the version and push every milestone. The directive is
the same charter as the 2026-11-09 round
(`docs/plan-mode-tui-combo-round-session.md`); this round is the second
pass: re-verify the shipped lane on a fresh environment, then EXPAND the
combination matrix into the cells the first round never drove (approval
options 2/3/4, digit quick-select, Ctrl+C cancel, the V2 kill switch in the
PTY lane, the live `--plan-model` split in the lane, the turn-budget
rendering, narrow terminals, the print lane, `/plan open`), and fix whatever
is not up to the late-2026 standards floor
(`docs/plan-mode-standards-2026-11.md` — this round's grounding research).

**Round note (the recovery):** this round spans two sandbox lifetimes. The
first continuation drove the expanded matrix live, found L3/L4 and verified
the fixes ALL GREEN — but the sandbox was recycled before the push. The
second lifetime re-cloned at 940c26ee, re-applied the two cli.ts changes
byte-exactly (the `apply_cli_fixes.py` re-applicator — anchors verified),
rebuilt the missing receiving seams the recovered diff implied
(`permissions.ts`'s `seedSessionAsk` gate method, `tools.ts`'s options type +
the manual-lane call), re-pinned everything (12 new tests), rebuilt the
expanded matrix lane from the receipts, and re-verified every phase live.
The lesson is now a harness law: **a fix is not done until it is PUSHED** —
the working tree is not a checkpoint.

## Method (as a real user, against the real model)

- Fresh clone at v0.0.58 (9e5786d2); bun 1.4.4 side-installed (the sandbox's
  1.3.14 cannot parse `pi-repo/bun.lock` lockfileVersion 3); install 7/7
  (engine service skipped: `UNOWN_ENGINE_AUTOSTART=0` — the engine is driven
  manually through `bun run agent:start`); stack green (bridge :3031 +
  engine :3030), upstream **Agnes AI** live-verified (`/v1/models` — 6
  models; one chat completion receipt).
- Baseline before any edit: focused plan suites 91/91 (6 files); the
  round-2 pins bring that to 103/103 (7 files); full self-learning suite
  **5497 pass / 0 fail / 105 skip** (5602 tests, 251 files) at close.
- Every interactive claim is driven through the REAL TUI in a PTY (the
  `scripts/tui-capture/pty_common.py` machinery — pexpect + pyte, pane text
  as truth), against the live model, with `MATRIX_GATE_TIMEOUT` headroom for
  the metered upstream.

## Findings (each confirmed against source; live confirmation noted)

| # | Finding | Where | Severity |
|---|---|---|---|
| L1 | **The `--plan` boot lane's ready-anchor is unreachable on a 36-row pane.** `phase1_boot` waits on the startup block's `── Themes ──` line, but the plan entry notice + the first-flights catalog push that line off a 36-row pane on any home that still shows the catalog (the first round's home had it latched never-again, so its receipt never saw this). The TUI itself is ready (footer + PLAN chip + notice all rendered within ~2 s). | `scripts/tui-capture/verify_plan_mode_matrix.py` (phase1_boot) vs `pty_common.py` wait_ready contract | high (lane) |
| L2 | **A cold first boot can outrun the 90 s ready timeout.** The first-ever `bun bin/unown` TUI boot in a fresh environment pays the transpile-cache cost and exceeded 90 s once; every later boot is ~1-2 s. | `pty_common.py` (wait_ready default) | medium (lane) |
| L3 | **The approve-each-edit promise was silent vapor.** "Execute — approve each edit" maps to permission mode `default` — but `default` alone only triggers ask RULES, and a default-config session has none. **Measured live (the first lifetime): a ZERO-dialog ask census while the approved plan executed freely** — 2 file mutations, 0 prompts. The option's label promised per-edit approval and the session never asked once. | `self-learning/src/tools.ts` (approvePlanExecution — no seeding), `self-learning/src/permissions.ts` (no session-ask seam) | critical |
| L4 | **The MAIN TUI boot lane dropped both plan-mode flag values at the call site.** The worktree lane and the print lane delivered `planModel`/`maxTurns` to `cmdTui`/`cmdPrint`, but the ordinary `unown --plan --plan-model <id> --max-turns <n>` boot passed neither — **measured live (the first lifetime): 0/11 planning turns on the sibling model, no not-found warning either** (the value never reached `getFlag`, which answers the registered default `""`). Round 1's F1 fix made the flag LANE work; the main boot lane still dropped it one call later. | `self-learning/src/cli.ts` (runCli's main cmdTui call) | critical |
| L5 | **The options phase cannot fit one tool window.** A specialist-spawning V3 planning pass alone ran past 8 minutes under the metered upstream (3 specialists × ~6 turns each, ttft ~8 s); the first lifetime's single-process options phase was unrunnable in a ~10-minute window. The lane splits into three bounded sub-lanes (options-a/b/c), each re-planning on a fresh scratch project. | `scripts/tui-capture/verify_plan_mode_matrix.py` | lane design |
| L6 | **A 60-col pane keeps none of the old ready anchors.** The hints row is fully dropped at 60 cols (whole-chip degradation) and the startup block scrolls off a 20-row pane — the narrow lane needs an ANY-of anchor set that includes the always-rendered memory footer row. | `pty_common.py` + the narrow lane | low (lane) |
| R1 | **The `/permissions` status render inverted the seeded rules' meaning** (the post-M4 independent review): one total line said "N always-allow rule(s) confirmed this session" — after "approve each edit" seeds two ASK rules, the only surface that mentioned them asserted the opposite ("2 always-allow rules **confirmed**"). | `self-learning/src/permissions.ts` (renderPermissionsStatus) | low (render) |
| R2 | **The per-edit posture did not survive a session resume while the execution state did** (same review): `persistPlanState` carried `executing` but not the approval posture — a crash mid-execution then `unown --resume` restored the approved plan's execution with an empty `sessionRules`: the zero-dialog defect, silently re-opened. | `self-learning/src/tools.ts` (persistPlanState / session_start restore) | medium |
| R3-R6 | **Vacuous/false-pass classes in the new lane** (same review): the budget receipt asserted only `turns >= 1`; p1's `/plan show answers` matched the echoed command itself; `latest_session()` could score a PREVIOUS phase's session after a spawn crash; `--live` ran the options family TWICE (umbrella + sub-lanes — six metered planning passes instead of three). | `scripts/tui-capture/verify_plan_mode_matrix.py` | low (lane) |
| R7/R8 | Documented non-defects (same review): the seeded posture is one-way within a session (acceptEdits' documented ask-rule semantics; no un-seed); the one disk-write path is the user's own "Always allow (this session)" confirmation under `UNOWN_PERMISSIONS_LEARN=1` (pre-existing learn behavior, off by default). | `docs/permissions.md` | none |
| (non-findings worth recording) | The 2026-10-31 keyboard round's PageUp fix holds: the first lifetime saw one `PageUp → 1` FAIL at 05:32 that never reproduced (this lifetime: gate phase 17/17 with PageUp green; the nav set is also pinned by the extension-selector's own matrix). The stay-loop latch, the digit quick-select inertness beyond the option count, the 6-round editor cap notice, the V2 kill switch, both narrow geometries, the print-lane envelope and `/plan open`'s no-plan-file answer all verified green. | — | none |

## Fixes (all shipped this round)

1. **L3 (the approve-each-edit promise)**: the manual approval lane
   (`approvePlanExecution` with mode `default`) now calls the new
   `seedSessionAsk` seam — `cli.ts` wires it to the shared gate, the gate
   pushes pattern-less **session-scoped ask rules** for `edit`/`write`, so
   every file mutation prompts for the rest of the session. The rules die
   with the session (never written to disk); a more specific config allow
   still wins on its own subject (the user's own carve-out stands); a config
   deny still beats everything (the safety floor holds); `acceptEdits`
   auto-approves the seeded asks for in-project paths exactly like
   config-file ask rules. **Verified live (both lifetimes): the ask census
   during option-2 execution = 2 dialogs for 2 mutations, each answered
   "Allow once", execution reaching "Plan complete"** with the todo
   discipline intact (seeds=1, creates=0).
2. **L4 (the main boot lane's dropped flags)**: the main TUI lane's `cmdTui`
   call now carries `planModel: args.planModel` and `maxTurns: args.maxTurns`
   — the same field set as the worktree lane, so the three TUI boots can
   never drift again. **Verified live (both lifetimes): `--plan --plan-model
   agnes-2.5-flash` → the footer rides the sibling, the gate opens on the
   sibling, 5/11 assistant turns on the sibling during planning, execution
   returns to the session model; `--plan-model agnes-no-such-model` warns
   "not found — staying on" in the TUI.**
3. **L1 (ready anchor)**: `wait_ready`'s default is now an ANY-of set — the
   startup block's `── Themes ──` OR the always-rendered footer token
   (`esc-esc tree`; the resume lane's established contract). Verified live:
   the p1/boot/v2/narrow lanes all boot through the fresh-home catalog.
4. **L2 (cold-boot timeout)**: the default `wait_ready` timeout moves 90 →
   240 s (a cold first boot pays bun's transpile cache once).
5. **L5/L6 (the lane)**: the matrix grows from 3 phases to 9 (+ the options
   umbrella split into three bounded sub-lanes) — diag, v2, narrow
   (80x24 + 60x20 through the new `rows`/`cols` constructor params),
   options-a/b/c, plan-model, budget; the narrow lanes wait on the ANY-of
   anchor set that covers every width (block / hints lead / memory row).
   `UnownPty` logs its geometry, and `--phases` selects any subset.
6. **R1 (the status render)**: `status()` splits `sessionAskCount` /
   `sessionAllowCount` and the render names each — "N ask rule(s) seeded
   (per-edit approval active)" vs "N always-allow rule(s) confirmed".
7. **R2 (the resume posture)**: the plan-mode session entry carries
   `approvalMode` ("manual"/"auto"), `session_start` restores it, and a
   resumed mid-execution manual session RE-SEEDS the per-edit ask rules
   (the entry is cleared at plan completion and at a fresh entry into plan
   mode). **Live-verified through the new
   `scripts/tui-capture/verify_approve_each_edit_resume.py` lane**: kill
   mid-execution right after answering one per-edit dialog, resume with
   `-c` → `/permissions` renders "ask rule(s) seeded (per-edit approval
   active)" AND a direct trivial edit in the resumed session prompts
   again (ALL GREEN; the r1/r2 stills).
8. **R3-R6 (the lane honesty)**: the budget receipt now splits
   planning/executing turns at the approval marker and asserts the sanity
   band (1..20 planning turns — a soft pressure cannot be pinned to the
   cap, and the name says so); p1's `/plan show` asserts the concrete
   `No plan yet in this session.` anchor; `latest_session(since=…)` bounds
   every census read to files written after the phase started; the default
   live selection no longer runs the options umbrella AND its sub-lanes
   (an explicit `--phases options` still honors the umbrella).

## Tests

- NEW `test/plan-mode-combo2.test.ts` (12 pins): the gate-level
  `seedSessionAsk` contract (7 — the measured zero-dialog defect as the
  baseline, prompt-on-every-edit/write, dedupe on repeat, the
  specific-allow carve-out, the deny floor, the acceptEdits adjustment,
  nothing written to disk), the approval dialog's routing (3 — manual seeds
  `["edit","write"]`, auto-accept does not, the editor lane never seeds) and
  the source-contract that EVERY `cmdTui` call site delivers both plan-mode
  flags (2 — balanced-brace extraction, because the worktree call's `}),`
  ending breaks a naive `});` scan).
- Gates: focused plan suites 103/103 (7 files); **full self-learning suite
  5497/0/105** (5602 tests, 251 files); typecheck delta vs baseline = 0
  (773 pre-existing, untouched); biome findings on the changed files = 0
  new.
- The expanded matrix lane, run live phase by phase: **p1 9/9 · boot 1/1 ·
  diag 1/1 · v2 7/7 · narrow 6/6 · gate 17/17 · options-a 5/5 · options-b
  3/3 · options-c 5/5 · plan-model 6/6 · budget 6/6 — 66 steps ALL GREEN**
  (stills + pane dumps under `download/unown-addon-captures/stills/`).
- The review-hardening pins (post-M4, `test/plan-mode-combo2.test.ts` now
  16): the manual posture rides the session entry and a resumed execution
  re-seeds (with the auto posture resuming WITHOUT phantom prompts), and
  the `/permissions` render names ask rules as seeded while the classic
  always-allow lane is untouched.

## Checkpoints

- **CP0 (setup + baseline + grounding research)**: clone at 9e5786d2
  (v0.0.58); bun 1.4.3 side-by-side; install 7/7; stack + upstream live;
  doctor green (agent home on the bundled zai-bridge lane, 6-model catalog);
  focused plan suites 93/93; full suite 5482/3-flake/105-skip (F11 class,
  green in isolation); committed phase 1 matrix re-run green on the keyboard
  steps after the L1/L2 lane flukes were understood (see findings). The
  late-2026 standards floor recorded at
  `docs/plan-mode-standards-2026-11.md`. Milestone M1 pushed.
- **CP1 (the first lifetime's matrix + fixes — recovered)**: the expanded
  matrix driven live; L3/L4 found and fixed in cli.ts; the whole matrix
  re-run ALL GREEN (receipts: the stills and the 40 KB verify log that
  survived the recycling under `download/unown-addon-captures/stills/`).
  The sandbox was recycled before the push — the engine fixes were NOT on
  the remote.
- **CP2 (the recovery + M2)**: re-clone at 940c26ee; the two cli.ts changes
  re-applied byte-exactly; the receiving seams rebuilt
  (`permissions.ts` `seedSessionAsk` + `tools.ts`'s options type and the
  manual-lane call); 12 pins added; focused 103/103; typecheck delta 0;
  **M2 pushed (7a65e9d6)**.
- **CP3 (the lane rebuild + M3)**: `pty_common.py` carries the L1/L2 fixes;
  the verify script rebuilt to nine phases from the receipts (L5/L6 folded
  in); every phase re-driven live on the recovered tree — 66 steps ALL
  GREEN, including the two fixes' live lanes (ask census seen=2;
  5/11 planning turns on the sibling). **M3 pushed (3d39d34c)**.
- **CP4 (docs + release)**: this session doc closed; CHANGELOG entries +
  v0.0.59; usage.md's approval paragraph gains the per-edit promise;
  BEHAVIOR.md gains the seeded session-ask contract; pty-README registers
  the expanded lane; the blog post; DOX pass. Full suite 5497/0/105 as the
  final gate. The v0.0.59 TAG is deliberately NOT cut — the pre-existing
  flaky CI lanes (landing e2e/unit, Chaconne, Live production check —
  failing across rounds, untouched by this round) would hold the release
  workflow's ci-green gate; same honest hand-off as the v0.0.58 bump.
- **CP5 (the independent review + hardening)**: a fresh-eyes review of the
  pushed engine diff (8 findings, R1-R8 above) → R1/R2 fixed in the engine
  with 4 new pins, R3-R6 fixed in the lane, R7/R8 documented; the new
  resume lane live-verified ALL GREEN; full suite re-run **5501/0/105**;
  typecheck delta vs baseline = 0 (776 = 776, line-shifted only); biome
  clean on the changed files.

## Hand-off notes

- The upstream stays metered (~20 RPM class): a specialist-spawning planning
  pass can stretch past 8 minutes — `MATRIX_GATE_TIMEOUT=900` covered every
  live phase this round. When a lane must survive the specialist bench,
  raise it; when the model records justified skips, 480 is plenty.
- A fix is not done until it is PUSHED: the first lifetime lost the engine
  fixes to a sandbox recycling between verification and commit. The
  `apply_cli_fixes.py` byte-exact re-applicator pattern (anchor-verified,
  tab-preserving) is what made the recovery cheap — keep one per round that
  touches tab-indented files through non-interactive edits.
- Background processes do not survive a tool-call boundary in this sandbox
  class (setsid does not help — the runner kills the tree): long lanes must
  fit one call window, which is exactly why options-a/b/c exist.
- The bridge carries no `BRIDGE_UPSTREAM_KEY` in this environment, so the
  ENGINE's learning jobs 401 through it (27/27 in the usage log) — fail-open
  by design, the TUI sessions are unaffected (they ride the direct agnes
  provider). A future round that wants live AutoDream receipts should set
  the key in `.env`.
