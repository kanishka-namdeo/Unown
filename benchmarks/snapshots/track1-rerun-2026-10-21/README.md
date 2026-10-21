# Track 1 rerun receipt — 2026-10-21

Rerun of "Track 1 — pi-repo test suite" (keyless). Same protocol as the
2026-10-17 rerun: pinned-snapshot model-catalog hydration, then per-workspace
test runs (the robust path from `benchmarks/README.md`), sequentially on a
2 CPU / 4 GB box. Receipt: `summary.json` (mirrors the 2026-10-17 shape).
Full per-workspace logs: `/home/z/my-project/logs/track1/`.

**Result: 7,812 pass / 1 fail / 921 skip** (2026-10-17: 5,342 pass / 0 fail /
13 skip). Wall time of the recorded runs: ~436 s.

## Deviations from the 2026-10-17 run

1. **coding-agent: 1 genuine failure (new).**
   `test/interactive-tui.test.ts > createInteractiveTui > replaces the renderer
   and restores the previous screen for resume-hint exits` fails with
   `Error: Theme not initialized. Call initTheme() first.` at
   `applyOverlayScrim` (`interactive-mode.ts:2276`), reached from
   `switchTuiMode` (`interactive-mode.ts:924`). The overlay-scrim call was
   added by the 2026-10-20 "beauty-3 — the composure release (overlay
   choreography)" commit (`f362358`); the test drives `switchTuiMode` on a
   bare prototype context without a prior `initTheme()`. Reproduces in a
   fully sanitized environment — it is a regression in the vendored tree
   after the 2026-10-17 receipt, not an environment artifact. Not fixed here
   (Track 1 policy: report, don't patch). Output captured in
   `/home/z/my-project/logs/track1-failures.log`.
2. **coding-agent: 3 env-induced failures under the harness shell (excluded
   from the receipt numbers).** The agent tool shell exports `NO_COLOR=1`,
   `CLICOLOR=0`, `TERM=dumb`; `theme.ts`'s `getColorMode()` maps `NO_COLOR` to
   `"plain"`, which fails the two new `syntax-highlight.test.ts` assertions
   and `theme-detection.test.ts`'s `uses terminal capabilities` (added by
   `5f55bcc`, beauty-1, 2026-10-20). The canonical pi-repo invocation
   (`./test.sh`) strips these via `env -i`; re-running the full suite with
   `NO_COLOR/CLICOLOR/CLICOLOR_FORCE` unset and `TERM=xterm-256color` gives
   **2126 pass / 1 fail / 50 skip** — the recorded numbers. The ambient-env
   run (2123 pass / 4 fail) is in the logs for reference.
3. **tui: 1041 pass recorded (was "1072 dots").** The 2026-10-17 figure
   counted node's dot-reporter marks, which include suite events: today's
   suite is 1041 tests + 159 suites = 1200 marks (dot run rc=0). The suite
   also grew via the post-10-17 tui commits (beauty-2/3/4, responsive round
   5, U1, cherry-picks). This receipt uses the spec-reporter test count for
   an apples-to-apples number.
4. **self-learning: 2907 pass (was 533).** The engine suite grew from 43 to
   102 test files between the 2026-10-17 rerun and this checkout
   (2026-10-18..21 engine phases / audit waves / memory M-phases / dashboard
   retirement). `bun test test/` = 2945 tests across 116 files, 0 fail.
5. **Skip accounting.** This receipt records the actual skip columns from the
   vitest/bun summaries (921 total — overwhelmingly the key-gated live-API
   `skipIf(!API_KEY)` tests in `ai`, plus 50 coding-agent and 38 self-learning
   skips; all expected keyless). The 2026-10-17 receipt recorded 0 skips for
   the vitest workspaces even though its per-workspace pass counts are
   byte-identical to today's (957/418/15/147/36/50/87/23) — a
   recording-methodology difference, not a behavior change.
6. **Model-catalog re-pinning was necessary.** `agent:install` had hydrated
   `packages/ai/src/providers/data` from **live** models.dev (aggregate
   fingerprint `09d72232…`); it was re-hydrated from the pinned 2026-08-25
   snapshots before the run (`2186abe3…`, rc=0) — exactly the drift scenario
   the Track 1 README warns produces ~52 catalog failures. No such failures
   occurred after re-pinning.

## Unchanged vs 2026-10-17

- `ai` 957, `agent` 418, `telemetry` 15, `protocol` 147, `client` 36,
  `server` 50, `session-backends/sqlite-node` 87, `evals` 23 — identical pass
  counts, 0 failures each.
- Root scripts (`node --test scripts/*.test.mjs`): 5 pass, 0 fail.
- Stack (bridge :3031, engine :3030) left running and healthy throughout.

## Environment

bun 1.4.3, node v24.21.0, npm 11.19.0, vitest 4.1.11, 2 CPU / 4 GB RAM,
Linux. Hydration pin: `modelsdev-api-2026-08-25.json` +
`openrouter-models-2026-08-25.json` via
`node scripts/generate-models.ts --strict --data-only`.
