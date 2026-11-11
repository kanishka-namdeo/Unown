# memory-recital — live run results (2026-11-11, agnes-3.0-flash via llm-bridge → Agnes AI)

Run: the full scenario battery (S1 debug → S2 knowledge update → S3
reversal+preference+temporal, real `unown -p` sessions, real dreams) + the
5-probe QA battery (warm vs cold) + the three edge probes (`--edge`).
Receipts: `results/agnes-3.0-flash/per-probe/*.json` (session transcripts,
dream rows, both arms' raw responses + scores) +
`results/agnes-3.0-flash/summary.json`.

## Headline

| Metric | Warm (memory injected) | Cold (fresh clone, no `.unown/`) |
|---|---|---|
| Pass rate (5 probes, judge-free) | **5/5** | **0/5** |

**Lift = +5** — the dream-consolidated memory's added recall over the
no-memory control. All 10 QA arms + 3 sessions + 5 dreams ran live against
the real Agnes upstream (agnes-3.0-flash); 0 session errors, 0 timed-out
sessions, 0 gated dreams.

## Per-probe table

| Probe | Ability | Warm | Cold | Warm score |
|---|---|---|---|---|
| T1 temporal | when the render lane switched to auto-sizing | ✅ (2026-11-05) | ❌ honest abstention | 1.00 |
| T2 multi-hop history | why the parser was rewritten + the original defect | ✅ | ❌ (invented a plausible defect) | 0.83 |
| T3 knowledge-update | the CURRENT date contract + what it was before | ✅ ("empty dates accepted, any parseable date; strict ISO removed") | ❌ (hallucinated a confident "effectiveDate <= today" contract) | 0.67 |
| T4 preference | the comment style the user required | ✅ ("sentence case, no trailing periods") | ❌ (hallucinated a bizarre "Chinese-only comments" rule) | 1.00 |
| T5 abstention | the library keel was benchmarked against | ✅ honest abstention | ✅ honest abstention (unscored as a memory win — both arms know nothing) | 1.00 (honesty) |

The cold arm's T3/T4 hallucinations are the exact lane the memory closes:
without it the model invents confident "contracts" and rules; with it, the
answers come from the learned state. The cold arm must NOT pass the
knowledge probes (a high cold rate would mean a broken benchmark) — 0/5 on
knowledge, honest on abstention: the control is valid.

## Edge probes (`--edge`)

| Probe | Assertion | Result |
|---|---|---|
| E1 concurrency | two parallel answer-only sessions in one project — both exit notes land | **PASS** (3 notes observed post-arc; the session-salt lane holds) |
| E2 contamination | dreaming the QA sessions' own notes adds nothing false | **PASS** (no abstention text became a memory line — the Recital BUG-3 contract) |
| E3 outbox | engine killed alone → the session still answers (memory is files, injection needs no engine) and its note queues in the outbox → engine restart drains it | **PASS** (queued-while-down ✅, drained ✅; the down session answered the preference question correctly from the injected tier) |

## The round's baseline (the same battery, pre-fix, 2026-11-11)

| Probe | Warm (pre-fix) | The bug it exposed |
|---|---|---|
| T1 temporal | ✅ | — |
| T2 history | ✅ | — |
| T3 knowledge-update | ❌ "no information" | **BUG 1** — the reconcile pass deleted BOTH sides of the contradiction, leaving no current rule |
| T4 preference | ❌ "not in memory" | **BUG 2** — extraction had no conventions lane |
| T5 abstention | ✅ | — (and the follow-up exposed **BUG 3** — the abstention answer itself consolidated into permanent memory) |

Post-fix warm 5/5 with the same battery on a fresh project; the four fixes
landed in the same round with 11 new unit pins + this suite. Session log:
`docs/memory-recital-round-session.md`; the teardown that grounded the
design: `docs/TEARDOWN_2026-11-11_five-memory-systems.md`.
