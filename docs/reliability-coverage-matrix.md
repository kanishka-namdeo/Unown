# The A1 reliability coverage matrix

> **Verdict up front:** the 2026-11-04 A1 directive ("STABILISE A2 × HARDEN
> A2 × PROVE IT") requires eleven reliability lanes to carry receipted
> coverage before the hardening freeze (its Phase 3). This matrix is that
> ledger: per lane — what covers it TODAY on `main` @ `189fa033` (with
> receipts), what the Ostinato round ADDS, and the honest gap. No lane is
> marked covered without a receipt; a missing receipt is `null`, never a
> guess.

One-line purpose: the eleven-lane reliability coverage ledger for the A1
engagement — current coverage, planned coverage, gaps.

- Owner: the A1 operator (operator-authored, refreshed alongside
  [`A2_GROUND_TRUTH.md`](../A2_GROUND_TRUTH.md))
- Status: opened 2026-11-04; refreshed at the Ostinato round's teardown
  (2026-11-04); **re-opened for the Etude round 2026-11-05** (the fresh
  A1 directive's Phase 0) — the Ostinato receipts stand as history; this
  round re-validates every lane it touches and adds the fresh-install
  truth law (wiped-home lane runs) to the Keyboard Accessibility and TUI
  Consistency lanes, where the round's opening harvest (B-13/B-14) lives

**Mini-TOC**

- [The matrix](#the-matrix)
- [Lane notes](#lane-notes)
- [Freeze rule](#freeze-rule)
- [Related pages](#related-pages)

## The matrix

Coverage codes: **R** = receipted on `main` today (receipt linked) ·
**P** = planned this round (ticket named) · **G** = open gap (named lane
or `[U]`).

| Lane | Covers | Today (receipted) | This round adds | Gap |
|---|---|---|---|---|
| Planning | plan quality, specialist review, scored plans | R: plan-mode suite 3/3 @ 100/100 ([receipts](../benchmarks/plan-mode/RESULTS.md)); PT-5 complex-plan 87/100 with 7 live specialist spawns | P: O-0 round plan = this PRD + specialist-bench consultation ticket if the round opens a second plan | G: none named |
| Architecture | engine/agent/bridge contracts, DOX | R: [`docs/detached-engine-architecture.md`](detached-engine-architecture.md) + 12 failure modes; engine suite 5454/0/105-skip (SM round close) | P: O-2 storage-choice design gate (the PRD's `[U]`) | G: none named |
| Engineering | code lanes, unit coverage, type/lint parity | R: root tsc 0 / lint 0-142 / unit 2125/0; package tsc parity 77=77 (SM round); Coda Lane A/B 51/51 | **R (this round)**: Ostinato Lane A/B 93/93 (both forms), unit family 2223/0/158, tsc 0, lint 0-143 — [receipt](../benchmarks/ostinato/receipts/run-20261104T181704Z/) | G: none named |
| Operations | supervision, spend, budgets, autostart | R: `unown engine status` lanes; S2-11 spend meter + graduated ceilings (`GET /api/automations/spend`, skip rows); governor 60 calls/h breaker closed (live 2026-11-04) | P: routine-driven release-monitor first run 2026-11-08 observed from this engagement | G: none named |
| Quality | verifier gates, check:* culture | R: `check:docs|changelog|blog|benchmarks|claims` + claims 62/62 (SM round close) | P: per-ticket gate battery incl. root gates | G: none named |
| Collaboration | subagents, delegation audit | R: 20 built-in subagents + `delegation-auditor`; delegation bench 76/100 baseline → round receipts | P: delegation-auditor spawn after delegation-heavy O-tickets | G: subagent-reuse axis (queued upstream) |
| Learning | memory reuse, harness, skill lifecycle | R: selfimprove cold/warm receipts; 6 integrity gates; 13 `.unown/skills/` observed; AutoDream 10-min cycle | P: the round's tickets deliver notes → dreams; benchmark minting from round failures | G: none named |
| Reliability | known-bug burn-down, regression pins | R: 6 open issues all with lanes filed (#29/#30/#43/#44/#45/#46); regression sweeps in harness ship gate; 31 pins added by the SM round | **R (this round)**: the round's bug register B-1..B-11 ALL FIXED and pinned (nine app defects harvested by live execution rounds + two harness/product fixes as A2H-1/A2H-2 tickets, both registry promotions) — the round log's bug register is the receipt | G: #30 live-hang capture still pending (armed, non-repro on idle) |
| Keyboard Accessibility | keyboard-only operation, focus, a11y | R: v0.0.51 keyboard round (Shift+Tab cycle, SS3 arrows, astral input, approval-gate keys); settings-ux BM-1..BM-7 (12/12 at SM-3); Coda axe wcag2a/2aa lanes | **R (this round)**: Ostinato A-1 + K-1 — axe `wcag2a`/`wcag2aa` zero violations light AND dark, the tab-order pin, the Esc focus-return pin, the zero-mouse create→review→export→import flow — 4/4 + 4/4 battery tests, [receipt](../benchmarks/ostinato/receipts/run-20261104T181704Z/) | G: WebKit/Firefox/mobile `[U]` |
| TUI Consistency | rendering coherence, one-list truths, footer discipline | R: todo-unification + footer-quiet rounds (v0.0.53); tui-observability 22-flag ledger closed; PTY pane-truth lanes (25 specs, ~30 scripts) | P: PTY re-verification of standing lanes on this lineage before O-1 dispatch | G: none named |
| Recovery & Resilience | crash/resume/persistence | R: longrun crash-consistency (SIGKILL torture + torn tails); exit-resume PTY lane (verbatim resume receipt); Coda offline boot 91 ms vs 175 ms median (N=5) | **R (this round)**: Ostinato R-1 + O-1 — crash-resume (reveal-phase restore, due-queue recompute, cursor advance, loop completing across crashes), atomic writes (temp-key + commit-swap), offline boot-from-cache + the loop completing offline, the 18/0 precache derivation proof — [receipt](../benchmarks/ostinato/receipts/run-20261104T181704Z/) | G: none named |

## Lane notes

- Receipts above were re-verified against `main` @ `189fa033` and the live
  stack on 2026-11-04 where the receipt is a live surface (engine status,
  bridge health); historical receipts are linked, not restated. The Etude
  round (2026-11-05) re-verified the live surfaces on `f3f0176e`: bridge
  200/6 models, engine ready/9 jobs, doctor 19✓/2⚠, unit 2235/0/160,
  gates green, e2e 14/14 — [the baseline](../benchmarks/etude-round/README.md).
- **The Etude round's headline lanes** (per its directive's
  hardening-first bar): Keyboard Accessibility and TUI Consistency
  applied to the PTY harness itself first (the fresh-install truth law —
  every lane claim must hold on a wiped home's FIRST boot). The opening
  audit harvested B-13/B-14 there; the fix tickets A2H-5/A2H-6 and the
  H-9 helper restore the lanes' fresh-home coverage — the receipts land
  in [the round's validation log](../benchmarks/etude-round/validation-log.md).
- The two headline lanes for the Ostinato round were **Keyboard
  Accessibility** and **Recovery & Resilience** applied to the app lane —
  both carried their receipts at that round's teardown (the committed
  closeout re-run, `benchmarks/ostinato/receipts/run-20261104T181704Z/`);
  the honest `[U]`s (WebKit/Firefox/mobile) stand recorded, not claimed.
- The gap column is deliberately short because prior rounds closed the
  backlog; the standing gaps (#30 capture, subagent-reuse) are queued
  in [SESSION.md](SESSION.md), not forgotten.

## Freeze rule

Per the directive: **no new features after the P0 set until every lane
above carries a receipt produced or re-validated within this engagement.**
The freeze is lifted by the matrix, not by opinion.

## Related pages

- [The Ostinato PRD](ostinato-prd.md) — the Ostinato round's DRIVE vehicle
- [The Etude PRD](etude-prd.md) — the Etude round's proposed DRIVE vehicle
- [The augmentation registry](a1-augmentation-registry.md)
- [The Ostinato round log](ostinato-round-session.md) · [the Etude round log](etude-round-session.md)
- [`A2_GROUND_TRUTH.md`](../A2_GROUND_TRUTH.md) — the recon snapshot
- [`SDLC_CAPABILITY_MATRIX.md`](../SDLC_CAPABILITY_MATRIX.md) — the
  sibling lane-by-lane capability inventory
