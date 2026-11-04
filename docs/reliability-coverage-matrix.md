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
- Status: opened 2026-11-04 (Phase 0); refreshed at every teardown

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
| Engineering | code lanes, unit coverage, type/lint parity | R: root tsc 0 / lint 0-142 / unit 2125/0; package tsc parity 77=77 (SM round); Coda Lane A/B 51/51 | P: O-2/O-3 both unit lanes + app tsc per ticket | G: none named |
| Operations | supervision, spend, budgets, autostart | R: `unown engine status` lanes; S2-11 spend meter + graduated ceilings (`GET /api/automations/spend`, skip rows); governor 60 calls/h breaker closed (live 2026-11-04) | P: routine-driven release-monitor first run 2026-11-08 observed from this engagement | G: none named |
| Quality | verifier gates, check:* culture | R: `check:docs|changelog|blog|benchmarks|claims` + claims 62/62 (SM round close) | P: per-ticket gate battery incl. root gates | G: none named |
| Collaboration | subagents, delegation audit | R: 20 built-in subagents + `delegation-auditor`; delegation bench 76/100 baseline → round receipts | P: delegation-auditor spawn after delegation-heavy O-tickets | G: subagent-reuse axis (queued upstream) |
| Learning | memory reuse, harness, skill lifecycle | R: selfimprove cold/warm receipts; 6 integrity gates; 13 `.unown/skills/` observed; AutoDream 10-min cycle | P: the round's tickets deliver notes → dreams; benchmark minting from round failures | G: none named |
| Reliability | known-bug burn-down, regression pins | R: 6 open issues all with lanes filed (#29/#30/#43/#44/#45/#46); regression sweeps in harness ship gate; 31 pins added by the SM round | P: bug register in the round log; every finding → benchmark lane | G: #30 live-hang capture still pending (armed, non-repro on idle) |
| Keyboard Accessibility | keyboard-only operation, focus, a11y | R: v0.0.51 keyboard round (Shift+Tab cycle, SS3 arrows, astral input, approval-gate keys); settings-ux BM-1..BM-7 (12/12 at SM-3); Coda axe wcag2a/2aa lanes | P: **Ostinato zero-mouse e2e + axe both schemes + focus-order pins** — the round's headline lane | G: WebKit/Firefox/mobile `[U]` |
| TUI Consistency | rendering coherence, one-list truths, footer discipline | R: todo-unification + footer-quiet rounds (v0.0.53); tui-observability 22-flag ledger closed; PTY pane-truth lanes (25 specs, ~30 scripts) | P: PTY re-verification of standing lanes on this lineage before O-1 dispatch | G: none named |
| Recovery & Resilience | crash/resume/persistence | R: longrun crash-consistency (SIGKILL torture + torn tails); exit-resume PTY lane (verbatim resume receipt); Coda offline boot 91 ms vs 175 ms median (N=5) | P: **Ostinato crash-resume + atomic-save + offline lanes** | G: none named |

## Lane notes

- Receipts above were re-verified against `main` @ `189fa033` and the live
  stack on 2026-11-04 where the receipt is a live surface (engine status,
  bridge health); historical receipts are linked, not restated.
- The two headline lanes for THIS round are **Keyboard Accessibility** and
  **Recovery & Resilience** applied to the app lane — the directive's
  hardening-first requirement is exactly there (see
  [the PRD's mapping table](ostinato-prd.md#hardening-first-requirement)).
- The gap column is deliberately short because prior rounds closed the
  backlog; the two standing gaps (#30 capture, subagent-reuse) are queued
  in [SESSION.md](SESSION.md), not forgotten.

## Freeze rule

Per the directive: **no new features after the P0 set until every lane
above carries a receipt produced or re-validated within this engagement.**
The freeze is lifted by the matrix, not by opinion.

## Related pages

- [The Ostinato PRD](ostinato-prd.md) — the DRIVE vehicle this matrix gates
- [The augmentation registry](a1-augmentation-registry.md)
- [The round's session log](ostinato-round-session.md)
- [`A2_GROUND_TRUTH.md`](../A2_GROUND_TRUTH.md) — the recon snapshot
- [`SDLC_CAPABILITY_MATRIX.md`](../SDLC_CAPABILITY_MATRIX.md) — the
  sibling lane-by-lane capability inventory
