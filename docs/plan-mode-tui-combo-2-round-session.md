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

## Method (as a real user, against the real model)

- Fresh clone at v0.0.58 (9e5786d2); bun 1.4.3 side-installed (the sandbox's
  1.3.14 cannot parse `pi-repo/bun.lock` lockfileVersion 3); install 7/7
  (engine service skipped: `UNOWN_ENGINE_AUTOSTART=0` — the engine is driven
  manually through `bun run agent:start`); stack green (bridge :3031 +
  engine :3030), upstream **Agnes AI** live-verified (`/v1/models` — 6
  models; one chat completion receipt).
- Baseline before any edit: focused plan suites 93/93 (7 files); full
  self-learning suite 5482 pass / 3 fail / 105 skip — the 3 fails are the
  known load-dependent F11 class (all pass in isolation; the prior round
  filed the class for its owning lane).
- Every interactive claim is driven through the REAL TUI in a PTY (the
  `scripts/tui-capture/pty_common.py` machinery — pexpect + pyte, pane text
  as truth), against the live model, with `MATRIX_GATE_TIMEOUT` headroom for
  the metered upstream.

## Findings (each confirmed against source; live confirmation noted)

| # | Finding | Where | Severity |
|---|---|---|---|
| L1 | **The `--plan` boot lane's ready-anchor is unreachable on a 36-row pane.** `phase1_boot` waits on the startup block's `── Themes ──` line, but the plan entry notice + the first-flights catalog push that line off a 36-row pane on any home that still shows the catalog (the first round's home had it latched never-again, so its receipt never saw this). The TUI itself is ready (footer + PLAN chip + notice all rendered within ~2 s). | `scripts/tui-capture/verify_plan_mode_matrix.py` (phase1_boot) vs `pty_common.py` wait_ready contract | high (lane) |
| L2 | **A cold first boot can outrun the 90 s ready timeout.** The first-ever `bun bin/unown` TUI boot in a fresh environment pays the transpile-cache cost and exceeded 90 s once; every later boot is ~1-2 s. | `pty_common.py` (wait_ready default) | medium (lane) |
| (further findings accrue below as the round drives the expanded matrix) | | | |

## Fixes

(accrue as the round lands them)

## Tests

(accrue)

## Checkpoints

- **CP0 (setup + baseline + grounding research)**: clone at 9e5786d2 (v0.0.58);
  bun 1.4.3 side-by-side; install 7/7; stack + upstream live; doctor green
  (agent home on the bundled zai-bridge lane, 6-model catalog); focused plan
  suites 93/93; full suite 5482/3-flake/105-skip (F11 class, green in
  isolation); committed phase 1 matrix re-run green on the keyboard steps
  after the L1/L2 lane flukes were understood (see findings). The
  late-2026 standards floor recorded at
  `docs/plan-mode-standards-2026-11.md`. Milestone M1 pushed.

## Hand-off notes

(accrue)
