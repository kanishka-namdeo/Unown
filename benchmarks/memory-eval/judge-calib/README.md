# judge-calib — LLM-judge calibration for memory-QA verdicts

Measurement suite for the judge itself (docs/testing-strategy.md §7.6 open
item "judge calibration for every graded number" / §10 item L). Every
published memory benchmark leans on an LLM judge — LoCoMo's J, LongMemEval
(arXiv 2410.10813, whose paper meta-evaluates its own judge), Letta's memory
leaderboard grader template — and the 2026 audit literature shows the
uncalibrated judge is the weak link: **MemStrata** (arXiv 2610.05343)
measured **1.5-2.3% same-seed label flips** on public memory benchmarks, and
**"Auditing Long-Term Memory Evaluation"** (arXiv 2609.38021) makes judge
calibration a first-class requirement. Before a graded memory number is
published off an LLM judge, the judge protocol itself needs a receipt. This
suite measures OUR protocol — the **Mem0-style binary J-judge**
(arXiv 2504.19413): system prompt + question → reference → candidate,
temperature 0, one word — against 24 gold-labeled items.

## What it measures

| Step | What happens |
|---|---|
| 1. gate | `GET /health` on the bundled llm-bridge `:3031` must return ok before any call (upstream status recorded in the summary). NO mem0 platform, NO engine — the judge talks to the bridge directly (`POST /v1/chat/completions`, model `PI_MODEL_ID ?? agnes-3.0-flash`, `temperature 0`, `max_tokens 16`, non-stream, sequential awaits — Agnes is a ~20 RPM metered tier and the bridge spaces requests). |
| 2. judge | The system prompt and both user-message templates come verbatim from `corpus.judgeProtocol`: `standardOrder` = question → reference answer → candidate answer; `swappedOrder` = question → candidate → reference (the order-swap probe). |
| 3. repetition | `runs: 3` identical calls per item; the run verdict = the first `\bCORRECT\b`/`\bWRONG\b` word-boundary match in the raw reply, case-insensitive ("INCORRECT" cannot parse as CORRECT — the boundary forbids it; unparsable replies are recorded, never guessed). The item verdict is the majority of parsed runs. |
| 4. probe | For the 6 `orderSwapProbe` items, ONE extra call with `swappedOrder` — candidate judged BEFORE the reference is shown (a Letta-grader-style order). |
| 5. metrics | agreement vs gold, FPR, FNR, leniency, abstention both directions, flipRate, orderSensitivity, parseFailures — see below. |

Metrics (majority-level unless stated):

- **agreement** — majority == gold expect over the 20 hard-labeled items.
- **FPR** — share of `wrong-*` items (wrong-number + wrong-entity, n=8)
  judged CORRECT.
- **FNR** — share of `correct-*` items (correct-gold + correct-paraphrase,
  n=8) judged WRONG.
- **leniency** — the 4 `partial` items are NOT scored: their pass rate
  (judged CORRECT) IS the measurement — how lenient the judge is on
  incomplete answers (the corpus's strict gold says WRONG; which strictness a
  QA protocol needs is a product decision, so the number is recorded, not
  folded into agreement).
- **abstention** — `ab-*` must be judged WRONG (refusing an answerable
  question fails — the LoCoMo/Mem0 contract); `au-*` must be judged CORRECT
  (abstaining on an unanswerable question passes — the LongMemEval `_abs`
  contract).
- **flipRate** — share of item×run verdicts that differ from their item's
  majority (MemStrata's same-seed label-flip measure, here at temperature 0;
  anything above 0 at temperature 0 is position-dependence, not sampling).
- **orderSensitivity** — share of probed items whose swapped-order verdict
  differs from the standard-order majority.

The judge and the corpus's candidate answers share the same served model
(`agnes-3.0-flash`) — the honest constraint of a metered single-model
deployment, recorded in every receipt.

## Corpus

`corpus.json` — hand-authored around the same fictional project as the
sibling suites (aurora-gateway: its ports, staging Postgres, deploy windows,
Slack channels, rate limits). 24 items in 6 classes (7 `cls` labels —
abstention has two directions):

| cls | n | gold |
|---|---|---|
| correct-gold | 4 | CORRECT — verbatim restatement of the reference |
| correct-paraphrase | 4 | CORRECT — semantically equal, different wording ("250 milliseconds" vs "a quarter of a second") |
| wrong-number | 4 | WRONG — numeric detail off (8788 vs 8787) |
| wrong-entity | 4 | WRONG — wrong channel/path/CI system |
| partial | 4 | leniency profile — incomplete answer; strict gold WRONG, recorded as pass rate |
| abstention-answerable | 2 | WRONG — refusing an answerable question |
| abstention-unanswerable | 2 | CORRECT — abstaining on an unanswerable question |

`orderSwapProbe`: 6 ids (cg-1, cg-2, wn-1, we-1, pt-1, pt-3) — one class
each of the verdict-relevant kinds plus both partial shapes. sha256
`d1c475b4b8c5bffcdfc8e48d75611afeb800038b07edc0877ab3a3176d9f677f`.
Hand-authored — there is no sampling step; regenerate by deliberately
editing `corpus.json` (any edit is a corpus change, pinned by the sha; the
runner validates it in `--dry`: every item parses, both templates substitute,
ids are unique, probe ids exist).

## Run

```bash
bun runner.mjs --dry          # corpus validation + receipt plumbing with a deterministic fake judge (<1 s, no bridge, no receipts)
bun runner.mjs              # full corpus: 24 x 3 judge runs + 6 order-swap probes = 78 calls (sequential; ≈ 4 min at the metered rate)
bun runner.mjs --limit 2   # smoke (first 2 items — 8 calls incl. their order-swap probes)
bun runner.mjs --fresh    # ignore existing per-item receipts
bun runner.mjs --case wn-1  # a single item
```

Requires the llm-bridge on `:3031` in live mode (checked before any call).
Scratch env vars (`PI_SELFLEARNING_DATA`, `PI_SELFLEARNING_DB`, `PI_MEM0_DIR`
under `/home/z/my-project/scratch-mem/judge-calib/`) are set defensively
BEFORE anything else per the memory-eval convention, although this suite
never imports the self-learning package — the judge calls the bridge
directly. Model-scoped results: a run whose model differs from the one
recorded in `results/summary.json` writes to `results/<model>/` instead of
clobbering. Resume-safe: items with an existing error-free receipt are
skipped (errored items re-run); a partial run's summary is marked
`complete: false` with its `selection` recorded, never passed off as full.

## Receipts

- `results/per-case/<id>.json` — every run's raw reply + parsed verdict +
  the matched text and its index, `finish_reason`, completion tokens,
  duration, the order-swap probe (raw reply, verdict, delta), the filled
  prompts, and the judge-protocol echo (system prompt, both templates,
  temperature, runs, max_tokens, parser rule) — each verdict is auditable
  standalone.
- `results/summary.json` — every metric (agreement with the disagreement
  list, FPR/FNR with the offending item ids, leniency per item, both
  abstention directions, flipRate, orderSensitivity per item, parseFailures,
  a per-class census) + the judge-protocol echo + `bridgeUpstreamStatus`.

RESULTS.md is hand-written from summary.json (the repo's convention for
graded numbers).

## Honest limitations

- **Self-judging.** The judge and the corpus's candidate answers are the
  same served model (agnes-3.0-flash) — the honest constraint of a metered
  single-model deployment. A judge grading its own phrasing style can be
  systematically lenient (the paraphrase and partial classes are exactly
  where that bias would show); recorded in every receipt as `selfJudging`.
- **n=24, one protocol.** A calibration profile, not a leaderboard. One
  disagreement moves agreement by 4.2 pp; MemStrata's 1.5-2.3% label flips
  were measured over full public benchmarks — at this n the suite detects
  gross miscalibration (a judge that passes wrong numbers), not fine drift.
- **Binary verdicts only.** The Mem0 J-judge answers CORRECT/WRONG — no
  partial credit, no confidence. Hedged replies ("mostly correct…") parse by
  the first word-boundary hit; unparsable replies land in `parseFailures`,
  never silently coerced.
- **max_tokens 16.** A verbose judge could truncate before the verdict word;
  every run records `finishReason`, so a `length` cutoff shows up as a parse
  failure with its raw reply — visible, not silent.
- **Leniency is recorded, not scored.** The partial items carry a strict gold
  (incomplete ⇒ WRONG) but the suite deliberately keeps them out of the
  agreement number — which strictness the product needs is a decision the
  receipt informs, not one the benchmark makes.
- **Order sensitivity is a 6-item probe.** It detects the direction
  (reference-position bias), not its magnitude; the probe ids were chosen to
  cover all verdict kinds, but n=6 bounds the resolution.
