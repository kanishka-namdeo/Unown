# memory-recital — live run results (2026-11-12 re-run, agnes-3.0-flash via llm-bridge → Agnes AI)

The Memory Encore round's verification re-run: the same full scenario battery
(S1 debug → S2 knowledge update → S3 reversal+preference+temporal, real
`unown -p` sessions, real dreams) + the 5-probe QA battery (warm vs cold) +
the three edge probes (`--edge`), driven on the Encore code — the freshness
stamps, the recall line, `/memory show` and the health card all in the loop.
Receipts: `results/agnes-3.0-flash/per-probe/*.json` (session transcripts,
dream rows, both arms' raw responses + scores) +
`results/agnes-3.0-flash/summary.json`.

## Headline

| Metric | Warm (memory injected) | Cold (fresh clone, no `.unown/`) |
|---|---|---|
| Pass rate (5 probes, judge-free) | **5/5** | **0/5** |

**Lift = +5** — reproduced from the 2026-11-11 post-fix run on the Encore
code: the visibility surfaces changed nothing about what the loop learns, and
T3 (knowledge-update) improved 0.67 → 0.89. All QA arms ran live against the
real Agnes upstream; the freshness lane is visible end to end in the receipts
(**8/8 rendered memory bullets carry their `· 2026-11-12` last-confirmed
date** in the S3 dream row, 0 stale markers — every rule fresh by
construction).

## Per-probe table

| Probe | Ability | Warm | Cold | Warm score |
|---|---|---|---|---|
| T1 temporal | when the render lane switched to auto-sizing | ✅ (2026-11-05) | ❌ honest abstention | 1.00 |
| T2 multi-hop history | why the parser was rewritten + the original defect | ✅ | ❌ (invented a plausible defect) | 0.67 |
| T3 knowledge-update | the CURRENT date contract + what it was before | ✅ ("empty dates accepted, any parseable date; strict ISO removed") | ❌ (hallucinated a confident contract) | **0.89** (up from 0.67) |
| T4 preference | the comment style the user required | ✅ ("sentence case, no trailing periods") | ❌ (hallucinated a rule) | 1.00 |
| T5 abstention | the library keel was benchmarked against | ✅ honest abstention | ✅ honest abstention (unscored as a memory win — both arms know nothing) | 1.00 (honesty) |

The cold arm must NOT pass the knowledge probes (a high cold rate would mean
a broken benchmark) — 0/5 on knowledge, honest on abstention: the control
stays valid.

## Edge probes (`--edge`)

| Probe | Assertion | Result (2026-11-12) |
|---|---|---|
| E1 concurrency | two parallel answer-only sessions in one project — both exit notes land | **PASS** (2 notes observed post-arc; the session-salt lane holds) |
| E2 contamination | dreaming the QA sessions' own notes adds nothing false | **PASS** (no abstention text became a memory line — the Recital BUG-3 contract) |
| E3 outbox | engine killed alone → the session still answers (memory is files, injection needs no engine) and its note lands through the recovery path → engine up, outbox empty | **PASS** (the down session answered the preference question correctly from the injected tier; the note landed in the engine; outbox drained ✅) |

E3's honest shape this run: the note delivery **auto-started the down
engine** (the M6 lane — the README's "a down engine is auto-started on note
delivery") and delivered directly, so the outbox intermediate never appeared
(`outboxQueuedWhileDown: false` in the receipt; the 2026-11-11 run observed
the transient file when the delivery retry lost that race). The arc's
assertions — answers-from-files while down, the note eventually landed, the
outbox empty at rest — all hold; the runner now polls for the transient file
(bounded) so it is recorded whenever the outbox path IS taken.

## The re-run's own catches (the runner hardened again)

The live re-run starved `dreamAndWait`'s 600 s budget twice, and both shapes
are now fixed in `runner.mjs`:

1. **The pre-trigger consumer** — the auto dream-check (`run:finished`)
   consumed E1's notes before the manual trigger fired, so the "ended after
   this call" anchor never matched. The wait's row anchor is now re-based on
   the newest note of ours (re-read every poll): a pre-trigger consumer's
   row counts, and a note still in flight re-raises the bar until the row
   consuming it lands.
2. **The throttled settle** — with every note of ours already dreamt, the
   follow-on E2 wait starved while a governor-throttled engine (the QA
   battery + canary dreams had burned the rolling hour: 69 calls/60, 226k
   tokens/200k) landed no new row at all. The SETTLE exit now returns when
   every note of ours was consumed by a project dream that ended after our
   newest note — dream rows are written after the render they receipt, so
   the consolidation is provably on disk.

## History

- **2026-11-11 (the Recital round's baseline, pre-fix)**: warm 3/5 — T3
  "no information" (**BUG 1**: reconcile deleted both sides of the
  contradiction), T4 "not in memory" (**BUG 2**: extraction had no
  conventions lane), and the follow-up exposed **BUG 3** (the abstention
  answer itself consolidating into permanent memory) + **BUG 4** (a merged
  temporal marker inventing history). Post-fix: warm 5/5 / cold 0/5, all
  three edge probes green (the E3 outbox intermediate observed).
- **2026-11-12 (this run, the Encore verification)**: warm 5/5 / cold 0/5
  reproduced on the freshness-stamped code; T3 0.89; the freshness lane
  visible in every receipt; the two `dreamAndWait` starvation shapes above
  caught and fixed live.

Session logs: `docs/memory-recital-round-session.md` (the suite's origin),
`docs/memory-encore-round-session.md` (this round); the teardowns that
grounded the designs: `docs/TEARDOWN_2026-11-11_five-memory-systems.md`,
`docs/memory-encore-round-research.md`.
