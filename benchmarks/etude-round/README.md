# The Etude round — the Etude engagement's benchmark suite

One-line purpose: the baseline benchmark suite + calibration canaries for
the Etude round (the 2026-11-05 A1 engagement) — what is measured, how the
baseline was captured, and where the receipts live.

- Opened: 2026-11-05 (the seventeenth lineage's Phase 0)
- Round log: [docs/etude-round-session.md](../../docs/etude-round-session.md)
- Methodology parent: [../README.md](../README.md) (pin everything ·
  anti-tamper · pair accuracy with cost · receipts committed, never
  regenerated)

## What this round measures

The engagement's cargo is operational quality, so the baseline is the
**gate surface itself**, receipted on a fresh lineage before any ticket:

| Baseline lane | Receipt (2026-11-05, tree `f3f0176e`, bun 1.4.3) |
|---|---|
| Install | 7/7 steps green (`UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1`) |
| Bridge health | `:3031` ok, upstream 200, 6 agnes models, default `agnes-3.0-flash`, lanes 3/2/45 s |
| Engine health | `:3030` ready, v0.0.56 @ `f3f0176e`, 9 router jobs scheduled, breaker closed, budget 0/60 calls · 0/200000 tok |
| Doctor | "ready to chat", 19 ✓ / 2 ⚠ (model-spec self-heal + LSP — the honest pair) |
| Headless smoke (C1) | `UNOWN_OK`, exit 0, 1 turn, 2.5 s, 19.5k/4 tokens, cost 0 |
| Typecheck | 0 errors |
| Lint | 0 errors / 143 warnings |
| Unit | 2235 pass / 0 fail / 160 files (160.7 s) |
| check:docs | ok (149 pages) |
| check:changelog | 55 stops / 539 entries / 54 dated |
| check:blog | 46 posts / 116 tags |
| check:benchmarks | 6 tracks / 6 resolved |
| check:claims | 9 jobs / 62/62 literals |
| ostinato e2e battery | 14/14 (7.6 s) |
| PTY footer-quiet lane | 9/9 checks held |
| PTY resume-hint lane | ALL HELD (warm home) — cold-home defect B-13, see the [validation log](validation-log.md) |
| PTY resume-picker lane | PASS (warm home) — cold-home defect B-14, see the [validation log](validation-log.md) |

The Phase-1 holdout forms against this snapshot: any ticket that moves a
baseline number must show the before/after pair, and the standing lanes
re-run at every teardown (the H-3 ritual).

## Calibration canaries

The three canaries arm before every A2 dispatch (the H-1 pattern; ~4-7 s
total spend, catch rate recorded per lane — a zero-catch round is a clean
data point, not a promotion receipt):

- **C1 — the provider-chain smoke**: `bun bin/unown -p "Reply with
  exactly: UNOWN_OK" --output-format json < /dev/null` → exit 0, result
  `UNOWN_OK`, ≤30 s. Catches: bridge down, upstream staleness, key
  rot, engine spawn failures.
- **C2 — the doctor gate**: `bun bin/unown doctor` → "ready to chat",
  exit 0, the two known-honest ⚠ allowed (model-spec pre-first-session,
  LSP absent in-container). Catches: state-schema drift, sandbox
  breakage, instruction-set audit failures.
- **C3 — the engine lane**: `bun bin/unown engine status` → UP, version
  SHA = the checkout HEAD, 9 jobs scheduled, breaker closed. Catches:
  build drift (the `memory: up · old build` chip class), stale parallel
  checkouts, router regressions.

## The harness-defect receipts (the round's opening harvest)

The first keyboard/TUI audit (fresh-home truth) harvested two
deterministic harness defects — full evidence, repro commands and the
cold/warm matrix in [validation-log.md](validation-log.md); the fix lanes
are tickets A2H-5/A2H-6 in the round log. Both defects become standing
regression material: after the fixes land, the wiped-home ×3 lane run is
the pinned verifier.

## Learning-layer baseline (Phase-1 opening, before app tickets)

Per the fairness laws (separate tuning from holdout): before the first
E-ticket, capture the standing learning tracks' current receipts as this
round's learning baseline — `benchmarks/memory-eval/ops-accuracy`
(summary.json), `benchmarks/memory-eval/quality-axes` (summary.json),
`benchmarks/selfimprove` (latest summary), and an engine learning-state
snapshot via the nocturne-round pattern (`bun validation-round/snapshot.mjs
--label etude-baseline --out etude-round/snapshots/`, drain-before-
snapshot). These pin the "did A2 actually learn" axis the engagement is
accountable for.

## RESULTS.md

Honest nulls until the round's tickets land receipts; the file carries the
baseline table above plus the before/after pairs as they accrue.
