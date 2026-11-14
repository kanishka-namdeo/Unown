# memory-recital — live run results (2026-11-15 re-run, agnes-3.0-flash via llm-bridge → Agnes AI)

The Memory Divertimento round's post-close verification re-run: the full
scenario battery (S1 debug → S2 knowledge update → S3
reversal+preference+temporal, real `unown -p` sessions, real dreams) + the
5-probe QA battery (warm vs cold) + the three edge probes (`--edge`), driven
on the v0.0.66 code — the review queue, the recall seal, the per-type
budget, the SRO supersede and the dormancy lane all in the loop. Receipts:
`results/agnes-3.0-flash/per-probe/*.json` (session transcripts, dream
rows, both arms' raw responses + scores) +
`results/agnes-3.0-flash/summary.json`.

## Headline

| Metric | Warm (memory injected) | Cold (fresh clone, no `.unown/`) |
|---|---|---|
| Pass rate (5 probes, judge-free) | **3/5** | **1/5** |

**Lift = +2** — memory still beats no-memory on every knowledge probe (T1,
T2, T4 warm-pass with cold-fail; the cold arm's one pass is T5 abstention,
where a pass means honest ignorance — the control stays valid). Two warm
probes missed this run, both read in full below: T3 lost to the strict
matcher on a semantically-correct answer, and T5's warm arm fabricated —
the one genuine behavioral finding of the run.

## Per-probe table

| Probe | Ability | Warm | Cold | Warm score |
|---|---|---|---|---|
| T1 temporal | when the render lane switched to auto-sizing | ✅ | ❌ | 1.00 |
| T2 multi-hop history | why the parser was rewritten + the original defect | ✅ | ❌ | 0.67 |
| T3 knowledge-update | the CURRENT date contract + what it was before | ❌ (semantically correct, matcher-strict: 0.44) | ❌ | 0.44 |
| T4 preference | the comment style the user required | ✅ | ❌ | 0.80 |
| T5 abstention | the library keel was benchmarked against | ❌ (**fabricated "libc"**) | ✅ honest abstention | 0.00 |

The honest read of the two warm misses:

- **T3 (matcher-strict, not a memory miss).** The warm answer was
  substantively right — "Now `validateRows` enforces only 3-column count and
  numeric amount (empty dates are valid; non-empty dates pass without
  format check); before, it enforced ISO date validation via an `ISO_DATE`
  regex" — but the judge-free matcher needs 0.6 content-word overlap with
  "empty dates accepted / any parseable date / strict ISO removed", and
  "valid" vs "accepted" + the missing "removed" cost the pass at 0.44. The
  documented limitation ("the expected-answer matcher is strict for
  open-ended QA — both arms suffer the same strictness") doing exactly what
  it says; the receipt records the raw response for the human read.
- **T5 (the run's one genuine finding).** The warm arm — memory injected,
  three real sessions dreamt — FABRICATED ("we benchmarked keel against
  `libc`") where the cold arm correctly abstained. Nothing in the dreamt
  memory names keel or a benchmark; the injected context primed a confident
  invention. This is the exact hallucination class the abstention probe
  exists to catch, and it is model-luck (the 2026-11-11 and 2026-11-12 runs
  passed the same probe warm with honest abstentions on the same lane) —
  but it is recorded here as measured: injected memory can PRIME
  fabrication as well as prevent it, and the abstention lane is the guard.

## Edge probes (`--edge`)

| Probe | Assertion | Result (2026-11-15) |
|---|---|---|
| E1 concurrency | two parallel answer-only sessions in one project — both exit notes land | **PASS** (3 notes observed post-arc; the session-salt lane holds) |
| E2 contamination | dreaming the QA sessions' own notes adds nothing false | **PASS** (`contaminationAdded: false` — the Recital BUG-3 contract) |
| E3 outbox | engine killed alone → the session still answers (memory is files, injection needs no engine) and its note lands through the recovery path → engine up, outbox empty | **PASS** (the down session answered from the injected tier; the note landed — the delivery again AUTO-STARTED the down engine, the M6 lane, so the outbox intermediate never appeared; `outboxDrained: true`) |

## The 2026-11-12 re-run's own catches (the runner hardened — kept for the record)

The 2026-11-12 live re-run starved `dreamAndWait`'s 600 s budget twice, and
both shapes are fixed in `runner.mjs`:

1. **The pre-trigger consumer** — the auto dream-check (`run:finished`)
   consumed E1's notes before the manual trigger fired, so the "ended after
   this call" anchor never matched. The wait's row anchor is now re-based on
   the newest note of ours (re-read every poll): a pre-trigger consumer's
   row counts, and a note still in flight re-raises the bar until the row
   consuming it lands.
2. **The throttled settle** — with every note of ours already dreamt, the
   follow-on E2 wait starved while a governor-throttled engine (the QA
   battery + canary dreams had burned the rolling hour: 69 calls/60, 226k
   tokens) parked the queue behind the throttle. The settle now accepts the
   no-change dream row the throttle DOES mint (the row's own `notes`
   coverage names our notes) — waiting for a row that can never come is the
   bug, not the throttle.

## History

- **2026-11-11 (the Recital round's baseline, pre-fix)**: warm 3/5 — T3
  "no information" (**BUG 1**: reconcile deleted both sides of the
  contradiction), T4 "not in memory" (**BUG 2**: extraction had no
  conventions lane), and the follow-up exposed **BUG 3** (the abstention
  answer itself consolidating into permanent memory) + **BUG 4** (a merged
  temporal marker inventing history). Post-fix: warm 5/5 / cold 0/5, all
  three edge probes green (the E3 outbox intermediate observed).
- **2026-11-12 (the Encore verification)**: warm 5/5 / cold 0/5 reproduced
  on the freshness-stamped code; T3 0.89; the freshness lane visible in
  every receipt; the two `dreamAndWait` starvation shapes above caught and
  fixed live.
- **2026-11-15 (this run, the Divertimento post-close verification)**:
  warm 3/5 / cold 1/5, lift +2 — every knowledge probe still
  memory-gated (T1/T2/T4 warm-pass cold-fail); T3 matcher-strict on a
  correct answer; T5's warm arm fabricated (the run's one genuine finding,
  model-luck recorded as measured); E1-E3 green on the v0.0.66 loop.

Session logs: `docs/memory-recital-round-session.md` (the suite's origin),
`docs/memory-encore-round-session.md` (the Encore round),
`docs/memory-divertimento-round-session.md` (this round's post-close
verification); the teardowns that grounded the designs:
`docs/TEARDOWN_2026-11-11_five-memory-systems.md`,
`docs/memory-encore-round-research.md`.
