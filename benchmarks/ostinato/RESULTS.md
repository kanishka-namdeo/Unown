# The Ostinato round — results

Every number below comes from a committed receipt under `receipts/`.
A lane with no receipt reads `null` ("not measured") — never a guess.
Methodology: [README.md](README.md). Suite opened 2026-11-04 (Phase 0).
Baselines recorded BEFORE any augmentation is canaried against them (the
fairness law: pristine-vs-current A/B, strictly-sequential re-trials).

## Calibration canaries (A2-lane baselines)

Model `agnes-3.0-flash` via the bundled bridge (:3031), print mode,
`--max-turns 8`, scratch cwd, 2026-11-04.

| Lane | What it measures | Trials | Last run | Result |
|---|---|---|---|---|
| C1 | trivial print-mode round trip (exact output + exit 0) | 3/3 | 2026-11-04 | **PASS 3/3** · 1 turn each · env duration mean 1039 ms (spread 920–1162) · wall 1.6–1.8 s · [receipt](receipts/run-20261104T074016Z/) |
| C2 | small-code ticket: authoring quality + turns-to-done | 3/3 | 2026-11-04 | **PASS 2/3** · variant A PASS (3 turns, 62.2 s env), variant B **FAIL** — capped at 8 turns, 6/8 authored tests green (2 parseDuration fails at the cap), variant C PASS (7 turns, 20.9 s env) · turns-to-done spread 3–8+ · [receipts](receipts/) |
| C3 | debug ticket: seeded red→green flip + turns-to-done | 3/3 | 2026-11-04 | **PASS 3/3** · red seeded and verified before every dispatch; tests pristine (0 tamper) · variant A 7 turns / 21.3 s, B 4 / 5.9 s, C 4 / 7.2 s env · [receipts](receipts/) |

Reading: the trivial lane is perfectly reliable; the small-code lane
already shows turn-cap overflow under its own verifier (C2-B) — the exact
failure class the round's chunk economics exist to manage; the debug lane
landed every variant well under the cap.

## App lanes (armed as the app lands)

| Lane | What it measures | Last run | Result |
|---|---|---|---|
| K-1 | keyboard-only e2e (zero pointer events) | — | `null` (runner lands with O-3/O-4) |
| A-1 | axe wcag2a/2aa + focus-order pins | — | `null` |
| O-1 | PWA installability + offline/online boot timing | — | `null` (skeleton landed 2026-11-04; capture lane is O-5) |
| R-1 | crash-resume (SIGKILL mid-review → restored invariants) | — | `null` |
| I-1 | import/export round-trip (byte-stable) | — | `null` |
