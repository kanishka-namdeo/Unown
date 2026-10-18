# recall-qa — live run results (2026-10-18, kimi-k2.5 via llm-bridge → Dashscope)

Corpus: seed 20261019 — 40 questions from the real LongMemEval `oracle`
split (500 questions, MIT, sha256 provenance in corpus.json), stratified
over `question_type`, oversampling the memory-hard types. Receipts:
`results/per-case/<id>.json` (notes, dream candidate, guard verdict, both
answers, both match scores, evidence-retention score) +
`results/summary.json`.

## Headline

| Metric | Warm (post-dream memory injected) | Cold (no-dream control) |
|---|---|---|
| Pass rate (40 questions, judge-free exact-match ≥ 0.6) | **0.650** | **0.025** |

**Lift = +0.625** — the dream-consolidated memory's added recall over the
no-dream control. 120 live LLM calls (40 dreams + 40 warm QA + 40 cold QA),
368 s wall clock, 0 dream errors, 0 gated candidates, 2 flagged notes
(quarantine banners only — no effect on outcome).

The cold arm's 0.025 is the benchmark's own validity check: the questions
are NOT answerable without memory (a high cold rate would mean a broken
benchmark, not a good memory).

## Per-question-type table

| question_type | n | warm pass | cold pass | lift | evidence retained in memory |
|---|---|---|---|---|---|
| multi-session | 10 | 0.70 | 0.00 | +0.70 | 0.20 |
| temporal-reasoning | 10 | 0.60 | 0.00 | +0.60 | 0.70 |
| knowledge-update | 10 | 0.60 | 0.10 | +0.50 | 0.70 |
| single-session-user | 4 | 1.00 | 0.00 | +1.00 | 1.00 |
| single-session-assistant | 3 | 0.67 | 0.00 | +0.67 | 0.33 |
| single-session-preference | 3 | 0.33 | 0.00 | +0.33 | 0.33 |

## What the decomposition shows

**Evidence retention ≠ recall.** Mean evidence retention is 0.55 — the
dream keeps ≥60% of the answer's content words in only ~half the cases —
yet warm pass is 0.65. The dream writes *compressed, contextual* memory
(the fact plus its setting, not the answer's exact words), and the QA
model resolves the question from that compression. The multi-session row
is the clearest: 0.20 retention, 0.70 pass. The recall payload of memory
is the compressed fact, not the transcript.

**Weakest axis: preferences.** single-session-preference is the lowest
warm pass (0.33) AND lowest retention (0.33): stated user preferences
("I prefer evening calls") are the dream's weakest consolidation target —
consistent with the office-domain benign-recall finding from the MPBench
run (the project-memory dream is not a user-preference store). A user-tier
dream path would be the fix direction; recorded as a finding, not patched.

**Knowledge-update works.** The 0.10 cold / 0.60 warm on knowledge-update
(the field's "does memory track changes" axis) matches the quality-axes
staleness result: the dream prefers the newest statement of a fact.

## Honest limitations

- Judge-free exact-match is strict for open-ended QA; the 0.6 overlap
  threshold passes synonyms but fails paraphrases. A judge arm (with
  audit anchors, per strategy §10 item L) would likely raise warm pass;
  this run deliberately measures the conservative bound.
- n=40, one model (kimi-k2.5), one dream per case, oracle haystack
  (no retrieval layer in front of memory — by design: this measures the
  consolidation+injection loop, not retrieval ranking).
- The dream here runs on trimmed transcripts (answer evidence kept full,
  filler trimmed — receipts record the exact notes); real terminal
  session notes are shorter and denser.

## Re-running

`bun runner.mjs [--fresh] [--limit N]` (resume-safe per case). The corpus
sampler (`sample_corpus.mjs`) re-derives the same 40 questions from the
upstream split given the same seed; upstream sha256 is pinned in the
corpus header.
