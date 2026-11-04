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

## App lanes (the O-4/O-5 hardening battery; re-run at the O-6 closeout)

| Lane | What it measures | Last run | Result |
|---|---|---|---|
| K-1 | keyboard-only e2e (zero pointer events) | 2026-11-04 | **PASS 4/4** — the create → review → export → import flow (keyboard events only, the download + filechooser riding `waitForEvent`), the review loop, the empty state, the corrupt-session recovery · [receipt](receipts/run-20261104T181704Z/) |
| A-1 | axe wcag2a/2aa + focus-order pins | 2026-11-04 | **PASS 4/4** — axe `wcag2a`+`wcag2aa` zero violations in light AND dark, the tab-order pin, the Esc focus-return pin · [receipt](receipts/run-20261104T181704Z/) |
| O-1 | PWA installability + offline/online boot timing | 2026-11-04 | **PASS 2/2 + the derivation proof 18/0** — SW-controlled first load, offline reload from cache with the loop completing offline, the non-precached-URL fallback page; `verify-precache.ts` resolves every precache URL to disk (18 entries, 0 missing) · [receipt](receipts/run-20261104T181704Z/) |
| R-1 | crash-resume (SIGKILL mid-review → restored invariants) | 2026-11-04 | **PASS 2/2** — the reveal-phase restore, the due-queue recompute with the graded card dropping, the cursor advancing, the loop completing across two crashes; + resize (375/1280, overflow discipline, two-pane) · [receipt](receipts/run-20261104T181704Z/) |
| I-1 | import/export round-trip (byte-stable) | 2026-11-04 | **PASS** (rides inside K-1's flow test) — the export structurally byte-verified incl. the canonical-separators pin, the import round-trip closing the loop · [receipt](receipts/run-20261104T181704Z/) |

The battery whole: **12 pass / 0 fail** (8.5 s first run, 7.2 s re-run,
headless chromium-1248, tree `8103d739`, external Playwright verifier —
no self-grading). Unit lanes the same hour: Lane A 93/0, Lane B 93/0 —
[the same receipt run](receipts/run-20261104T181704Z/). The O-4/O-5
receipts in `.unown/receipts/` (working-tree-only) recorded the same
battery at 7.2 s / 7.4 s on the authoring lineage; this row is the
committed re-run on a fresh clone.
