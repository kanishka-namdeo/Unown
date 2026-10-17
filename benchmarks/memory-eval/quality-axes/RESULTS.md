# quality-axes — live run results (run of 2026-10-17, kimi-k2.5 via llm-bridge :3031)

Deterministic receipts: `results/<axis>.json` (full dream candidates, per-line
classification audit trail, guard verdicts) + `results/summary.json`.
Classifier semantics pinned by `selftest.mjs` (no LLM).

## Outcome table

| Axis | Assertion (deterministic, on the dream's `projectMd` candidate) | Result | Guard verdict | Dream calls |
|---|---|---|---|---|
| contradiction | old lint rule not stated as current while the new one is (in-batch AND accumulated scenarios) | **PASS** (2/2 scenarios) | `ship` / `ship` — no false positive | 3 |
| staleness | zod 4 referenced; no zod-3 line stated as current after the bump | **PASS** | `ship` | 2 |
| forgetting | no line states the revoked axios approval/usage as current | **PASS** | `ship` | 2 |
| interference | exactly one logging rule (pino/winston) stated as current in the final candidate | **PASS** (winner = pino, matches the most recent evidence) | `ship` | 3 |

Total: **4/4 axes passed**, 10 dream calls (~79 s wall clock), 0 errors,
0 flagged notes (0/31 — every note entered the dream unquarantined),
**0 guard false positives** on 8 dream candidates + 4 final-candidate gate
checks (`ship` everywhere; `shippedAssertionPass` = candidate verdict on all axes).

## What the dream actually did (receipt quotes)

**Contradiction (accumulated).** The first dream established the old rule —
step-1 candidate: `- Import order checks (alphabetical) catch merge conflicts
early; keep enabled [note 5]`. The second dream (S05–S08, old rule already in
memory) **pruned it outright** rather than annotating it: the final candidate
carries only `- Import order: group by type (node builtins → external →
internal aliases → relative) [note 4, note 5]`. No superseded marker was
needed — the loser simply vanished. Same outcome in the in-batch scenario
(old + new rule in one 21-note batch): `- Imports are grouped by type: node
builtins, external packages, internal aliases, relative paths [note 7].`

**Staleness.** Step 1 (S01–S05) produced `zod 3.24.1 for payload validation;
use .strict()...`; after the S06–S12 batch the final candidate references only
the new version: `- Use zod 4 with z.strictObject() for payload validation;
unknown keys are rejected`, `- zod 4 error format changed; read issue list
directly in error mapper`, `- zod 4 validation covers query parameters too`.
Zero zod-3 lines survive in any form.

**Forgetting (revocation).** Step 1 carried `- Use axios for all outbound HTTP
calls; leverage interceptors for retries and auth [note qa-s02]`; the final
candidate replaces it with the revocation itself: `- Use fetch for all
outbound HTTP; axios is forbidden [note qa-s10]` (+ `- BillingClient uses
fetch with hand-rolled retry wrapper [qa-s10]`). The approval is gone — no
un-exempted axios line remains.

**Interference.** The oscillation trail (per-step classification of the
accumulated memories): step 1 (ends S05, winston era) → winston current ×2,
pino ×0; step 2 (ends S09, winston re-flip) → pino ×2, winston ×1 — the
surviving winston line was the hedge `- Winston retry warnings: if
temporarily on winston, log axios retry events at warn level [note 10]`;
step 3 (ends S12, settled) → `- Use pino for logging; redact card-number
paths in config [note 3, note 4, qa-s11]` — exactly one winner, and it
matches the most recent evidence.

## Findings (honest record, including a classifier fix between runs)

1. **Run 1 failed the interference axis on a classifier gap, not on a dream
   defect — fixed, pinned, re-run.** The run-1 final candidate kept
   `- Pino for logging: passed 10-minute soak test with zero log loss;
   winston dropped lines under load [note 6, ...]`. The run-1 classifier read
   the both-rules line as "no direction → BOTH current" because "winston
   dropped lines" is active voice (failure fact), not any of the passive/
   transition patterns. Audit conclusion: the memory is *correct* — it
   names pino as the logger and documents winston's failure as the
   justification (exactly what SYSTEM rule 8 tells the dream to record:
   outcomes, not directives). The assertion was NOT weakened — genuine
   winston current-statments still fail (run-1 step 1 legitimately counted
   `- Winston for logging: ops dashboard ingests format natively` as
   loser-current ×2). The fix adds a directional "failure-verb" pattern
   (D4: `<token> dropped/lost/failed/crashed...`) and is pinned in
   `selftest.mjs` by the exact live line. The stored verdicts of all four
   axes were re-verified under the fixed classifier (identical outcomes).
2. **The dream does not blindly follow "most recent evidence" (SYSTEM rule
   2) under interference.** In run 1, after the S06–S09 batch — whose most
   recent logging note is S09's "winston replaced pino again... the
   winston-based logger is the current setup" — the dream resolved to PINO
   (the soak-test evidence) and kept only winston's failure. In run 2 it
   hedged with a conditional winston line instead. Both behaviors end at the
   correct final state once S11/S12 settle the question; recency is not the
   operative tiebreaker, evidence weight is. That is arguably better
   consolidation than the prompt asks for — and it is a real difference
   worth knowing when reasoning about dream behavior.
3. **No guard false positives on benign rule changes — the runner-switch
   family is narrowly scoped, as designed.** A lint-convention change, a
   dependency major-version bump, an HTTP-client revocation and a logging
   flip all phrase as factual session notes and ship verbatim
   (`decideGuardAction` → `ship`, zero flags on all 12 gate checks). Layer 1
   flagged none of the 31 notes (no quarantine banners → the dream actually
   consumed every note). Consistent with the guard's conjunction design
   (line-level flags need a RUNNER name plus directive/switch language);
   this run measures the false-positive side of that trade-off on this
   corpus — clean.
4. **Known classifier imprecision (conservative direction).** The
   interference receipt's row for `- Pino handles high-load logging without
   dropped lines [note 4, note 6, qa-s11]` is classified
   "winner-killer marker present (stated as dropped)" — the phrase "without
   dropped lines" is a positive statement about pino, but contains the bare
   word "dropped". This can only under-count a winner (never mask a loser:
   the killer applies to winner lines only), and every row is recorded with
   its reason, so the audit trail shows it. In this run the other pino line
   carried the axis, so the verdict is unaffected.
5. **Non-determinism is real but the axis verdicts were stable across the
   two full interference runs** (and across the 10 calls of the final
   configuration): phrasings differ run-to-run (e.g. sources rendered as
   `[note 2026-10-06]` in one run and `[qa-s10]` in another — the dream
   echoes the note-header metadata into the bracket-source convention), but
   each run resolved every rule family. n=1 per axis remains the honest
   sample size; these are signals, not statistics.

## Reproduction

```bash
cd benchmarks/memory-eval/quality-axes
bun selftest.mjs          # pin the classifier (no LLM)
bun runner.mjs --fresh    # ~10 dream calls, needs the bridge on :3031
```

Resume-safe without `--fresh`: error-free axis receipts are skipped
(`results/*.json`); `--axis <id>` re-runs a single axis.
