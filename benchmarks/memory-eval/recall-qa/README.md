# recall-qa — LongMemEval-adapted multi-session QA-recall benchmark

Live recall benchmark adapted from the public **LongMemEval** dataset
([xiaowu0162/longmemeval](https://huggingface.co/datasets/xiaowu0162/longmemeval),
arXiv 2410.10813, MIT). The question it answers: **after sessions are
dream-consolidated, does the injected memory actually let a fresh session
ANSWER QUESTIONS about what happened?** — the memory loop's core value
proposition. Until this suite, the memory benchmarks tested mechanics
(injection, poison defenses, consolidation quality axes) but never recall.

## What it measures

Per case, against the **production post-swap dream + guard path** (the
Mem0 learning core, commit 25c6601 — imported from `packages/self-learning`
via `../_lib/dream-pipeline.mjs`, no re-implementation drift; helpers
copied, never imported from sibling benchmarks):

| Step | What happens |
|---|---|
| 1. notes | The case's oracle haystack sessions (1-3) each become ONE Unown session note: a trimmed transcript (~4000 chars/note). Evidence turns (`has_answer=true`, the LongMemEval oracle labels) are kept full FIRST; filler turns are trimmed (400 chars) and dropped only when the budget is exceeded — answer evidence is never cut before filler. |
| 2. dream | ONE `consolidate()` pass over an isolated mem0 scope (`projectScope("rq-<id>")`), wiped + seeded with the established `CURRENT_MEMORY` stand-in exactly like production seeding (`importLegacyMarkdown` kind "seed", verbatim `infer:false`, no LLM), then the notes fed **newest-first** (`undreamedNotes()` order) as plain user messages — flagged notes are structurally quarantined (never reach the extraction LLM) and their texts feed the guard's layer-2.5 echo backstop. |
| 3. guard | `decideGuardAction(candidate, current, {firstMint:false})` — the shipped memory is what the engine would actually inject: `gate` → the pre-dream memory ships (nothing new), `sanitize` → the quarantined-out remainder, `ship` → candidate verbatim. Dream error → engine keeps the old memory (warm arm equals cold). |
| 4. QA (two arms) | A fresh `chatText` call (`maxTokens 300`), identical question message in both arms: **warm** = system message contains the SHIPPED post-dream memory; **cold** = control WITHOUT the dream memory (the pre-dream seed memory only — what a fresh session would see if AutoDream had never run). |
| 5. scoring | Judge-free normalized exact-match: content-word overlap ≥ 0.6 of the ground-truth answer in the response, or a 4-word phrase hit (mpbench-style matcher, copied). Two documented deviations from mpbench semantics, both because numeric/unit answers are the recall payload: numerals count as content words with digit-letter splitting (`"7pm"` → `"7 pm"`), and 1-2-content-word ground truths require a FULL hit (a unit-only match on a wrong number must not pass). Both arms recorded per case. |

**Headline = lift**: warm pass rate − cold pass rate. The memory must beat
no-memory; a high warm rate with a high cold rate would mean the questions
are answerable without memory (broken benchmark), and the per-case receipts
make every verdict auditable (raw score, hit words, phrase).

Also recorded per case: **evidenceRetention** — the same matcher run against
the shipped memory (did the dream keep the answer's content words at all).
This decomposes failures into *consolidation loss* (dream dropped the
evidence) vs *retrieval loss* (evidence kept, QA failed anyway) — the
dream-consolidation observation trail.

## Corpus

`corpus.json` (seed 20261019): 40 questions from the `longmemeval_oracle`
split (500 questions, each with oracle-selected haystack sessions containing
the answer evidence — no retrieval layer of our own in front of the memory).
Stratified over the real `question_type` field, oversampling the memory-hard
types: temporal-reasoning 10, knowledge-update 10, multi-session 10,
single-session-user 4, single-session-assistant 3, single-session-preference 3.
Excluded: `*_abs` questions ("answer: information not enough" negative cases
— a different task) and questions with >3 haystack sessions (1 session → 1
note, pipeline budget 1-3 notes). Turn content capped at sampling time
(3200 chars evidence / 600 filler). Upstream file NOT vendored; sha256 +
counts recorded in the corpus header. Regenerate with:

```bash
curl -sL -o /tmp/longmemeval_oracle \
  "https://huggingface.co/datasets/xiaowu0162/longmemeval/resolve/main/longmemeval_oracle"
bun sample_corpus.mjs /tmp/longmemeval_oracle --seed 20261019
```

## Run

```bash
bun runner.mjs --dry        # no-LLM dream-side plumbing smoke (<1 s, no bridge, no receipts)
bun runner.mjs            # full corpus (resume-safe; ~10-60 min live)
bun runner.mjs --limit 3  # smoke
bun runner.mjs --fresh    # ignore existing receipts
```

Requires the llm-bridge on `:3031` in live mode (checked before any call;
the mem0 extraction + reconcile + QA calls go through it). Scratch env:
`PI_SELFLEARNING_DATA=/home/z/my-project/scratch-mem/recall-qa/data`,
`PI_SELFLEARNING_DB=.../db/recall-qa.db`, `PI_MEM0_DIR=.../mem0` (set BEFORE
the package import); each case runs in an isolated mem0 scope
(`projectScope("rq-<id>")`), wiped and re-seeded per run. 40 cases ×
(1 dream + 2 QA) ≈ 120 LLM calls on `kimi-k2.5`. Receipts:
`results/per-case/<id>.json` (notes fed to the dream, the dream candidate
verbatim, guard verdict, both answers, both match scores) +
`results/summary.json`. RESULTS.md is hand-written from summary.json (the
repo's convention for graded numbers).

## Honest limitations

- **Exact-match is strict for open-ended QA.** A semantically-correct
  paraphrase that shares < 60% of the ground-truth's content words FAILS.
  This is a deliberate judge-free choice: no LLM judge in the loop means no
  judge model to trust, calibrate, or pay for — at the cost of understating
  true recall. Both arms suffer the same strictness, so the lift remains
  meaningful. Every receipt records the raw score + hit words for audit.
- The **oracle split** hands the pipeline the sessions containing the
  evidence; a full system also needs retrieval to select them. Measured
  here: consolidation + injection + QA only.
- Sessions are rendered as **transcript notes** (deterministic trim), a
  coarser compression than real terminal-session notes (which are
  LLM-written summaries). The benchmark measures the loop as fed, not the
  note-writing quality of the terminal agent.
- n=40, one model (kimi-k2.5), one dream per case, seed-memory stand-in —
  statistical direction, not a leaderboard row. LongMemEval's own protocol
  feeds full haystacks to long-context models; this adaptation compresses
  through Unown's ~4k-char note / 120-line memory budgets instead — the
  point is the memory loop, not raw long-context ability.
- Upstream marks the dataset **deprecated** in favor of
  `longmemeval-cleaned` (which removed noisy sessions); the original (as
  named for this task) still downloads without a token and is what
  `sha256 821a2034…` pins.
