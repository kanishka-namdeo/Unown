# H-10's paired runs — the WITH/WITHOUT gate, EXECUTED (null result, honestly)

**The twenty-fourth lineage, 2026-11-06 13:00–13:20 UTC** — the
teardown-window first act, executed on the frozen post-C-7 tree
`b436b843` (the C-7 landing `1129eb4b` + the memory sync — the app
surface identical to `f3f73104`), per the pre-registered protocol
(the registry's H-10 row): ≥3 runs/arm, the skill the ONLY variable,
the pins enforced by the `a1-paired-runs.py` harness (frozen-SHA
refusal, clean-tree refusal, staged-only check, temporary promote +
demote revert, incremental receipts, resume).

## The data (n=3 per arm, the frozen ticket v2)

| Arm | Run | Envelope | Turns | Result | e2e battery |
|---|---|---|---|---|---|
| WITHOUT | 1 | success, not capped | 14 | 1,390 chars — **CLEAN PASS** (the full report) | GREEN |
| WITHOUT | 2 | cap-abort (V-12 class) | 16 | 0 chars | GREEN |
| WITHOUT | 3 | capped mid-work | 16 | 79 chars | GREEN |
| WITH | 1 | success, not capped | **9** | **2,371 chars — CLEAN PASS** (the richest report of the pairing: the #43 race mechanics explained, the read-back verification cited) | GREEN |
| WITH | 2 | capped mid-work (the re-run; the first attempt's dispatcher was SIGTERMed externally, −15, no log — the incident receipted) | 16 | 80 chars | GREEN |
| WITH | 3 | capped mid-work | 16 | 74 chars | GREEN |

Tallies: completions **1/3 vs 1/3** (no delta) · complete-run turns
**14 vs 9** (favors WITH, n=1/arm — inside noise) · mean turns 15.3 vs
13.7 (capped-run noise) · e2e flake-rate **0.0 both arms** (the surface
is deterministic at n=3).

## The verdict — NULL, and why

**The skill's firing surface never occurred.** The skill's SHOULD
conditions (an iframe fill failure, a partial application, an empty
read-back) did not happen in ANY of the six runs: both arms' complete
runs beat the fixture's race **by construction** — the fixture's 50 ms
re-tap script only resets `#token` when it is still EMPTY
(`if (i && i.value === "") i.value = ""`), and Playwright's fill lands
the value synchronously before the adapter's post-fill read-back, so
the race loses every time (the WITH-1 report itself derives this
mechanism). The recover pattern had nothing to recover.

Per the registry's own precedent (H-1's closeout: "a zero-catch round
is not a promotion receipt; it is one clean data point"), **no
WITH/WITHOUT delta is claimable on the skill's mechanism at n=3/arm**.
H-10 stays at CANARY; the skill stays STAGED (never promoted on a
null).

## What the instrument proved (the run's real cargo)

- The harness works end-to-end: the frozen-SHA and clean-tree refusals
  fired live; the promote/demote revert restored the staged-only state
  (verified post-run); the incremental receipt survived a killed
  invocation; the resume logic skipped completed runs.
- The fixture's race is **benign by construction** — a genuine finding
  for the gate's future: measuring the #43-class recover pattern needs
  a HOSTILE variant (a re-tap that overwrites non-empty values, or a
  slower frame) — a fixture change that belongs to a proper ticket
  (the C-2-landed surface), not to the gate harness.
- The v1 brief flaw (invented `#city`/`#gift` fields) was caught by
  the runs themselves (run 2's report named the real field set), both
  arms were re-measured on the corrected v2 brief, and the v1 data is
  archived at `.a1/logs/h10-pair-v1-flawed-instrument/` (kept as the
  flaw's receipt, not gate evidence) — the instrument-fix precedent:
  a broken instrument is replaced, both arms re-measured, the incident
  receipted.

## The teardown's open choices

Extend to 6/arm (the noise-band law's escalation) · strengthen the
instrument (the hostile race variant, via a ticket) · or hold the null
and let H-10 ride the round's remaining browser tickets for organic
firing evidence. The full machine receipt:
`.a1/logs/h10-paired-b436b843.json` (operator lane, every envelope
cited).
