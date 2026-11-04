# The Ostinato round — results

Every number below comes from a committed receipt under `receipts/`.
A lane with no receipt reads `null` ("not measured") — never a guess.
Methodology: [README.md](README.md). Suite opened 2026-11-04 (Phase 0).

## Calibration canaries (A2-lane baselines)

| Lane | What it measures | Trials | Last run | Result |
|---|---|---|---|---|
| C1 | trivial print-mode round trip (exact output + exit 0) | N=3 planned | — | `null` (the eighth lineage's informal 1/1 `UNOWN_OK`, 3.7 s, 2026-11-04, is a smoke receipt — not a scored run) |
| C2 | small-code ticket: authoring quality + turns-to-done | N=3 planned | — | `null` |
| C3 | debug ticket: seeded red→green flip + turns-to-done | N=3 planned | — | `null` |

## App lanes (armed as the app lands)

| Lane | What it measures | Last run | Result |
|---|---|---|---|
| K-1 | keyboard-only e2e (zero pointer events) | — | `null` (app not yet built) |
| A-1 | axe wcag2a/2aa + focus-order pins | — | `null` |
| O-1 | PWA installability + offline/online boot timing | — | `null` |
| R-1 | crash-resume (SIGKILL mid-review → restored invariants) | — | `null` |
| I-1 | import/export round-trip (byte-stable) | — | `null` |

The first scored runs land with the round's O-1 dispatch; baselines are
recorded BEFORE any augmentation is canaried against them (the fairness
law: pristine-vs-current A/B, strictly-sequential re-trials).
