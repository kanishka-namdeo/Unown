# judge-calib — results (agnes-3.0-flash as judge, 2026-10-26)

Suite: calibration of the binary CORRECT/WRONG QA judge (Mem0-J protocol:
question → reference → candidate, temperature 0, 3 runs per item) against 24
gold-labeled items in 8 classes. This is docs/testing-strategy.md §7.6's open
"judge calibration for every graded number" (§10 item L) — the audit
literature (MemStrata arXiv 2610.05343: 1.5-2.3% same-seed label flips;
Auditing LTM Evaluation arXiv 2609.38021) says the judge is the weak link of
every memory benchmark; here it is measured before it is trusted.

## Headline (n = 78 judge calls, sequential through the bridge)

| Metric | Value | Reading |
|---|---|---|
| Agreement (hard-labeled) | **20 / 20 (1.00)** | every correct-gold, correct-paraphrase, wrong-number, wrong-entity item judged exactly right |
| FPR (wrong judged CORRECT) | **0 / 8** | no wrong-number, no wrong-entity passed |
| FNR (correct judged WRONG) | **0 / 8** | no paraphrase punished |
| Leniency (partial → CORRECT) | **0 / 4** | strict: incomplete answers are WRONG under the strict protocol |
| Abstention on answerable | **2 / 2 WRONG** | refusing a known answer fails, per the LoCoMo/Mem0 protocol |
| Abstention on unanswerable | **2 / 2 CORRECT** | the LongMemEval `_abs` contract |
| **flipRate** (run-to-run, temp 0) | **0 / 72** | MemStrata's instability does not reproduce here |
| **orderSensitivity** | **0 / 6** | presenting the candidate before the reference changes nothing |
| Parse failures | 0 / 78 | every reply parsed to CORRECT/WRONG |

## Reading

agnes-3.0-flash, as served through the bridge, is a **well-calibrated binary
QA judge on this corpus**: perfect agreement, no positional bias, no
run-to-run flips at temperature 0, and the correct strictness on partial
answers. The green light this gives: recall-qa's judge-free exact-match
scoring can be complemented by a judged lane (the recall-qa README's stated
limitation — exact-match understates recall) without importing judge noise.
The corpus deliberately includes the adversarial classes the audit papers
flag: wrong-number (unit-preserving numeric swaps), wrong-entity
(type-preserving entity swaps), and both abstention directions.

## Honest limitations

- Single judge model (agnes-3.0-flash — the only served tier); the corpus is
  24 items in the aurora-gateway fact world, not a public dataset. The
  MemStrata flip rate is measured on identical re-runs (temp 0) — it does
  not cover seed variation or judge-prompt paraphrase.
- Leniency 0/4 means the judge enforces the STRICT reading of partial
  answers; a deployment that wants lenient grading must say so explicitly
  (the protocol prompt is echoed in the summary receipt).
- The judge and the agent under test are the same model — self-grading bias
  is not measured here (a cross-model judge is the follow-up when a second
  served tier exists).
- Receipts: `results/per-case/<item-id>.json` (all 3 raw replies + verdicts
  + the order-swap probe where applicable), `results/summary.json`.

## Reproduce

```bash
bun runner.mjs --dry     # corpus validation, no bridge calls
bun runner.mjs           # 24 items × 3 runs + 6 order-swap probes ≈ 78 calls (~4 min)
```
