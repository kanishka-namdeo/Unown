# The A1 augmentation registry

> **Verdict up front:** opened EMPTY on 2026-11-04 per the A1 directive's
> Phase 0 ("Empty Augmentation Registry") — no augmentation earns a row
> until it survives the lifecycle below with receipts. Inherited standing
> practices from prior rounds are listed separately: already receipted in
> their own round logs, not promotions of this engagement.

One-line purpose: the lifecycle ledger for every A2-side or operator-side
augmentation this engagement proposes, canaries, gates and promotes — or
retires.

- Owner: the A1 operator (authored outside A2 sessions)
- Status: OPENED 2026-11-04 (Phase 0) — promoted rows: 0

**Mini-TOC**

- [Lifecycle](#lifecycle)
- [Gate requirements](#gate-requirements)
- [Registry](#registry)
- [Queued hypotheses](#queued-hypotheses)
- [Inherited standing practice](#inherited-standing-practice)
- [Related pages](#related-pages)

## Lifecycle

`PROPOSE → CANARY → GATE → PROMOTE → RETIRE`. No stage skipping.

- **PROPOSE** — a named hypothesis plus the evidence that spawned it (a
  failure class, a friction observation, a debugging session) and the
  metric it claims to move.
- **CANARY** — exercised on live work with before/after instrumentation;
  canaries never ship as defaults.
- **GATE** — the promotion review, against the requirements below.
- **PROMOTE** — lands in its durable lane: skill, subagent, command,
  recipe, routine, hook, review check, memory rule — or an operator-side
  practice when the fix belongs to the operator lane.
- **RETIRE** — a promoted augmentation whose receipts went stale or whose
  cost outweighs its lift is retired explicitly, with the receipt.

## Gate requirements

Promotion requires all five: a measurable reliability improvement on the
metric named at PROPOSE (before/after receipts); regression-detection
improvement or neutral; **no keyboard regressions and no TUI-consistency
regressions** (the directive's hard bars); acceptable latency and cost
(the Agnes metering budget respected); and retention evidence — the
improvement survives a session boundary (memory or skill lane receipt).

## Registry

| ID | Stage | Lane | Hypothesis | Metric | Evidence | Status |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | **empty** — opened 2026-11-04; first rows enter at PROPOSE with the round's first receipted findings |

## Queued hypotheses

PROPOSE-stage candidates (none canaried, none promoted):

- **H-1 — pre-dispatch smoke canary (operator lane).** One `UNOWN_OK`
  print-mode round trip before every A2 dispatch catches
  provider/bridge/engine staleness for ~4 s of spend, converting silent
  chunk-loss into a fast, cheap, classified failure. Spawning evidence:
  the seventh lineage's smoke-1 receipt pattern; this lineage's 3.7 s
  smoke (2026-11-04). Canary: armed for every O-ticket dispatch this
  round. Metric: catch rate vs overhead.
- **H-2 — tree-verify FILE claims at the operator gate (operator lane).**
  Standing practice from the spend round's receipt-overclaim lesson,
  formalized into this round's gate: the receipt's FILES list is
  re-verified against the tree, never trusted. Metric: overclaims
  surviving gate = 0.
- **H-3 — PTY keyboard/TUI audit as a pre-ticket ritual (operator lane).**
  The standing PTY lanes (25 scenario specs, ~30 scripts under
  `scripts/tui-capture/`) re-run on each fresh lineage before the first
  dispatch — the directive's first keyboard/TUI audit brief. Metric: lanes
  green on a fresh lineage with zero fixes, or findings filed to the bug
  register.

A2-side candidates (skills, subagents, hooks, review checks) enter at
PROPOSE only from receipted failures observed during O-ticket driving —
none exist at Phase 0, by design.

## Inherited standing practice

Carried into this engagement unchanged, receipted in prior round logs
(not this registry's promotions): fresh sessions per ticket (the 570 KB
context-degradation lesson); the double-fork dispatch daemonizer
(`scripts/dispatch-bg.py` off-repo); push the round-opening claim before
dispatch; incremental receipts from chunk 1 with the first-poll EXISTENCE
check; the fairness laws (pristine-vs-current A/B, strictly-sequential
re-trials).

## Related pages

- [The Ostinato PRD](ostinato-prd.md) — the DRIVE vehicle
- [The reliability coverage matrix](reliability-coverage-matrix.md)
- [The round's session log](ostinato-round-session.md)
- [`A2_GROUND_TRUTH.md`](../A2_GROUND_TRUTH.md) — §9 learning-mechanism
  inventory; the augmentation surface's recon base
