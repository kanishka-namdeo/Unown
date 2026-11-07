# F-5 receipt — the PARALLEL 29th-lane implementation (SUPERSEDED 2026-11-07 by the ledger-arbiter reconciliation)

> **STATUS: SUPERSEDED.** This lane's F-5 closed GREEN on its own tree (Lane A/B
> 160/0/20, contract 7/0/41, e2e 9/9 ×2) but the 28th lineage's F-5 landed on
> origin/main FIRST and governs (the V-42 class, twelfth concurrent-lineage
> event; see the reconciliation commit + V-19..V-22). This file preserves the
> parallel lane's record — its UNIQUE findings (V-21's design-level root cause:
> the F-1 "runs resolve against jobs" invariant vs engine runs merged into the
> local document, cured by the engineRuns ruling; the probe-first law H-23) are
> receipted in the round's validation log and live on as laws/registry rows.
> The governing implementation's receipt is [f5.md](f5.md).


> Ticket: F-5 · verifier: Lane A + Lane B + contract lane + e2e flow ×2 +
> typecheck + claims (V-8) + the root-battery reconciliation · sessions:
> `01a1b503…` (chunks 1-6 + the three dead dispatches), `01a1b53e…` (dead),
> `01a1b54a…` (final2 ×4), `01a1b55f…` (surgical ×3), `01a1b578…` (oneline),
> `01a1b57e…` (race ×3), `01a1b58e…` (design ×2) — **27 dispatches /
> ~520 turns** (24 enveloped: 499 turns, 2.13M in / 142K out tokens; 3
> process deaths unreceipted), ~1.7 h wall. The round's hardest ticket by
> an order of magnitude — and its richest: the operator gate caught TWO
> real defects per cycle across five corrective cycles, and the final root
> cause was a DESIGN-level conflict, not a coding slip.

## What landed (18 files)

- `src/ui/run-history.ts` + test — groupRuns (by taskId, newest-first;
  status/tokens/turns/duration rows; budget-throttled marker retained,
  E-04) + renderRunHistory (the `data-route="runs"` section).
- `src/ui/run-detail.ts` + test — the E-05 pin: the run's error field
  renders VERBATIM (entity-escaped only) into a data-error block, gated on
  status !== ok; a failed run is never success-styled.
- `src/ui/spend.ts` + test — spendMeterViewModel + renderSpendMeter:
  tokens in/out, calls vs windowLimit ("unlimited" at 0), window start,
  the visible throttle banner when throttled (E-04, canned-JSON pin).
- `src/ui/app.ts` (+381/-57 across the session) — the F-5 wiring: the
  four-route tab bar (aria-selected, `data-route-tab`); job-row and
  run-row selection (`selectedJobId`/`selectedRunId`); the palette
  job-scoped commands (run-now/pause/resume/skip/snooze) through
  `dispatchJobCommand` with the full EngineError taxonomy (E-02: honest
  error panel + lane downgrade, never silent success); the spend fetch
  on the live lane; **the composeDraft lift** (draft-in-state so a
  background rerender can never stomp the open form) + stale-error
  clearing; **the engineRuns ruling** (chunk 10 below); doBoot preserves
  route + dialog + draft across refreshes.
- `src/adapter/rest-adapter.ts` — mapRuns normalizes the engine wire form
  (ISO-8601 startedAt/endedAt → epoch-ms; string ids → numbers) at the
  adapter boundary; **the `delete rec.error` line removed** (a deleted
  null reads as undefined and violates the E-05 invariant — see V-14).
- `runner/fixture-serve.mjs` (new) — the e2e lane's standalone stub boot:
  port-0 internal serve + the shim's own socket on 4130 with CORS
  preflight + `/__fixture-health`; SIGTERM-clean shutdown.
- `runner/fixture-server.ts` (+16) — the POST /run sub-route unshifts the
  synthetic run into the GLOBAL /api/runs list (engine-mirroring; the
  contract fixtures untouched).
- `playwright.fugue.config.ts` — the second webServer entry (the stub on
  4130) so the flow lane rides a GUARANTEED live lane.
- `e2e/fugue-flow.spec.ts` (new, 6 tests, hard assertions): (a) live-lane
  boot + tab bar; (b) the grouped history renders the fixture runs with
  status markers; (c) E-05 verbatim error on run selection; (d) the spend
  meter (unlimited + no banner); (e) the run-now flow lands the synthetic
  run (id ≥ 13) through the real palette path; (f) E-02: /api abort → the
  honest engine-down panel, no silent success.
- `e2e/fugue-smoke.spec.ts` — live-lane amendments: the settled-boot wait
  (`[data-route-tabs]` visible before the never-blank read); the compose
  test unchanged in substance (it was correct — the app was broken).
- `apps/fugue/NOTES-F5.md` — the research digest + ten chunk receipts
  (every deviation, ruling, and gate number receipted session-side too).

## The five-cycle QA story (the honest ledger)

The PLAN's F-5 row was one line; the ticket took five operator-gate
cycles, each catching REAL defects (no gate-catch was cosmetic):

1. **Cycle 1 (chunk 4→5):** the flow spec shipped with if-count guards +
   a tautology (toBeGreaterThanOrEqual(0)) because the shell exposed no
   route navigation — the runs flow was unreachable in a browser. The
   completion chunk added the tab bar + selection hooks.
2. **Cycle 2 (chunk 6):** the config never booted the fixture — the flow
   tests silently rode the degraded lane. The corrective added the
   fixture webServer + hard assertions; three process deaths intervened
   (V-13); the shim double-bound 4130.
3. **Cycle 3 (surgical):** probe-confirmed defects — the compose
   rerender-stomp (background doBoot replacing the open form with
   DEFAULT_DRAFT), the fixture /run not landing in the global runs view,
   mapRuns not coercing ISO strings (the NaN durations), the shim
   shutdown crash. All four rulings implemented.
4. **Cycle 4 (race):** the one-line root cause — mapRuns' `delete
   rec.error` turned null into undefined → the E-05 invariant threw
   inside the boot pipeline → split-brain UI (a rendered dialog bound to
   a half-replaced state). Removed; flow (e)/(f) went green.
5. **Cycle 5 (design):** the flaky smoke failures traced (via the
   operator probe harness) to the LAST layer: the F-1 invariant "runs
   resolve against jobs" vs boot() merging ENGINE runs (taskId → engine
   automations) into the LOCAL document — domain-invalid by construction
   on the live lane. The V-18 ruling: engineRuns lives in its own state
   field, never in state.data.runs; the runs route renders
   `engineRuns ?? data.runs` (engine-authoritative, E-09 intact). Plus
   the doBoot dialog/draft preservation + the settled-boot wait. All
   gates green TWICE after.

**The lesson (V-14):** the failure presented as flaky e2e for four
cycles because everyone (A2 and operator) debugged the SYMPTOM layer.
The V-14 law (operator rules the mechanism after 2 cycles) fired late —
the probe-first rule is now standing law (H-23): when a gate failure
survives two A2 cycles, the operator instruments the live page BEFORE
the next dispatch. The probe harness (`scripts/probe-compose.mjs`, the
operator QA instrument) caught cycles 3-5's root causes in minutes each.

## The operator gate (independently re-run, all green)

- Lane A: **160/0/20** (501 expects) · Lane B: **160/0/20** — the
  134/17 F-4 baseline grew by 26 tests/3 files (the three module suites
  + the wiring pins).
- Contract lane: **7/0/41** (unchanged by design).
- e2e: **9/9, run TWICE** (11.3 s / 11.1 s — flow a-f + smoke 1-3; the
  compose race is dead, verified across repeats).
- Root typecheck: **0** · root fugue+ostinato chunk: **281/29** (was
  255/26 at F-4 — grew by exactly the 26 Lane-A tests).
- Claims (the V-8 law): **62/62** after the FIFTH hand restoration of
  the issue-#46 prune class (this render took the entire restored
  durable lane; V-15 below).
- Serve boot + /health: green (the webServer lane proves it every run).

## Turns-to-done (the honest reckoning)

F-1 188 → F-2 61 → F-3 ~64 → F-4 28 → **F-5 ~520**. The trend INVERTED
on this ticket. The decomposition (receipt-side, from the envelopes):
~112 turns of planned work (chunks 1-4: digest, modules, wiring, spec —
comparable to F-4's shape), ~40 turns to the V-12 truncated-tool-call
burn + its continuations, ~90 turns to the three V-13 process deaths and
their fresh-session re-briefings, ~250 turns to the five QA cycles
(operator gate-catches × real defects × the V-14-late diagnosis loop),
~28 turns to design-cycle continuations. Contributing causes: the
operator's raised chunk budgets (16-48 vs F-4's 8 — more rope, more
burn), continuation context re-reads (up to 371K input tokens per
dispatch), and a PLAN row that hid a design conflict. None of it is
model regression: every ruling landed first-try once stated byte-exact.
The F-6+ briefs return to 8-turn chunks, V-40 rides every brief
verbatim, and the probe-first rule front-loads diagnosis.

**State: F-5 CLOSED. Next: F-6 (the LIVE loop — the real-engine e2e
lane, ≥3 consecutive runs + a cold boot, operator witness receipt).**
