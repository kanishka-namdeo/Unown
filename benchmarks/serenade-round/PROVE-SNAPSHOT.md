# The Serenade round — the mid-round PROVE snapshot (2026-11-07, after L-6)

> The A1 directive's third track, receipted at the halfway mark
> (L-0..L-6 closed of L-0..L-13). The round-close improvement report
> extends this page; every number cites its receipt. Baseline: the
> [frozen battery](snapshots/serenade-baseline-2026-11-07.json) at
> `6e3579bb` (unit 2654/0/208 · canaries C1/C2 PASS + C3 the known
> V-3 class).

## Turns-to-done — the series (session-file ground truth)

| Ticket | Turns | Dispatches | Class | Receipt |
|---|---|---|---|---|
| L-0 | 49 | 3 | plan (read-only + materialize) | [l0](receipts/l0.md) |
| L-1 | 54 | 2 | scaffold | [l1](receipts/l1.md) |
| L-2 | 57 | 2 | domain (storage) | [l2](receipts/l2.md) |
| L-3 | 135 | 3 | pipeline (the keystone) | [l3](receipts/l3.md) |
| L-4 | 102 | 3 | domain (search) | [l4](receipts/l4.md) |
| L-5 | 145 | 3 | UI shell | [l5](receipts/l5.md) |
| L-6 | 126 | 3 | domain+UI (queue) | [l6](receipts/l6.md) |

- **Total engine turns to L-6: 668** across 19 dispatches (the
  113-turn parallel-lane duplicate EXCLUDED from this table — it is
  the round's measured waste, receipted in
  [l3-parallel-lane-34th](receipts/l3-parallel-lane-34th.md); with it
  the round's gross spend is 781).
- The class split holds (review #1's finding): domain/scaffold
  54–57/2, pipeline/UI 102–145/3. The plan's "each ≤ the Ostinato
  C-ticket size" estimate was optimistic by ~2× on the heavy class —
  the honest datum for the next round's pre-split.
- **Zero rework loops**: every ticket closed on its first dispatch
  chain; the only re-dispatches were cap-boundary continuations and
  L-3's ruling-refinement chunk (+24, the cheapest high-value
  dispatch of the round).

## Paired augmentation deltas (the round's, so far)

| Augment | Stage | The measured delta |
|---|---|---|
| H-24 live-traffic fixture refresh | **PROMOTED** | 3 fiction pins caught live (overview.version, notes shape, spend panel revived after silently dead); the A/B gate's stale-lane-green vs refreshed-lane-RED receipted ([h24](receipts/h24.md)) |
| H-26 pre-dispatch claim gate | CANARY | 1 live refusal (zero-spend) against a real active claim; the BEFORE arm is the dual-L-3's 113 duplicate turns; promotion accrues on L-7..L-13 at zero duplicates ([h26](receipts/h26.md)) |
| H-21 truncation-aware continuation | CANARY | armed; no output-cap signature has fired on a real chunk yet (the turn-cap boundary is the different signature) — the measure accrues ([h21](receipts/h21.md)) |
| H-22 memory-guard | GATE (landed) | the #46 prune class: occurrences 8–14 all caught+restored; the guard's first live catch 20 min after landing; the paired A/B across the round's renders accrues |

## Retained improvements (structural, by construction)

- The **boundary pin** (L-1) caught real drift mid-round (L-5's
  comment-text DOM_GLOBS) — the enforcement lane's first live catch
  on this vehicle.
- The **B-16 holdout freeze** (L-3): the extraction-quality
  regression gate for L-11 — frozen bytes, the re-run contract
  written into the fixture dir.
- The **taxonomy pins** (L-3): all 7 error rows pinned on fakes, the
  T-3/T-6 document-structure ruling encoded in tests — any future
  classifier drift reddens.
- The **queue transition table + ConflictError** (L-6): the Q-1
  concurrent-flip contract is typed and pinned, not documented folklore.

## The round's own costs (honest ledger)

- 113 duplicate turns (the dual L-3; the concurrent-lineage class,
  now gated by H-26)
- 3 claim races (L-1 claim, dual L-3, H-26 claim) — all arbitrated at
  or before dispatch except the L-3 one; V-2/V-3 laws filed
- 16 accidental turns (H-26's own gate tests before --dry-run — the
  sibling's honest cost note)
- The receipts-late debt (L-5) — remediated [l5](receipts/l5.md);
  cured by construction from L-6

## What the close still owes (the report's second half)

- L-7..L-13's rows (the tags/highlights/io/PWA/e2e/docs/root-wiring
  tickets) + the B-16 holdout re-run result (L-11)
- The H-26/H-21 promotion verdicts on their accrued metrics
- The retained-improvement re-verification on a FRESH lineage (the
  recycle test: the pins, the holdout, the guard all fire without the
  authoring lineage's context)
  — **DELIVERED 2026-11-07 by the 35th lineage**
  ([the receipt](receipts/recycle-test-35th.md)): 5 of 6 improvements
  fired/held green with zero authoring context; the H-26 gate's
  closed-ticket false refusal caught + fixed + paired A/B (V-6)
- The evidence packet assembly (§8) and the competition cycle #2 if
  the round runs past it
