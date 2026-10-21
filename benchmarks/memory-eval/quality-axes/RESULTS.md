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

---

# Live run 2026-10-21 — agnes-3.0-flash (Agnes AI upstream via llm-bridge :3031)

Same corpus, same classifier, same protocol as the 2026-10-17 kimi-k2.5 run;
only the dream model changed (`PI_MODEL_ID=agnes-3.0-flash`, bridge upstream
https://apihub.agnes-ai.com/v1, `bridgeUpstreamStatus: 200` in
`results/summary.json`). `bun selftest.mjs` re-pinned first (exit 0, all
classifier expectations hold — keyless). 10 dream calls, 0 errors, 0/135
notes flagged by the layer-1 scanner, **0 guard false positives** (`ship` on
all 10 candidates + all 4 final-candidate gate checks).

## Outcome table

| Axis | Result | Guard | Dream calls | Wall |
|---|---|---|---|---|
| contradiction | **PASS** (2/2 scenarios: in-batch + accumulated) | `ship` ×3 | 3 | 21 s |
| staleness | **PASS** (zod 3 → zod 4; zero zod-3-as-current lines) | `ship` ×2 | 2 | 18 s |
| forgetting | **FAIL** (deterministic assertion; see audit below) | `ship` ×2 | 2 | 203 s (one 194.7 s upstream call) |
| interference | **FAIL** (deterministic assertion; see audit below) | `ship` ×3 | 3 | 29 s |

**2/4 axes passed** vs kimi-k2.5's 4/4 (2026-10-17, same corpus/classifier).

## Audit of the two FAILs (per this suite's own rule: audit `rows[]` before trusting a FAIL)

Both FAILs are **classifier phrasing gaps on semantically-correct memories**,
not dream defects — the same class the 10-17 run's finding #1 documented (and
fixed) for "winston dropped lines under load". Recorded as findings, not
patched (this run's scope is results-only; the classifier is pinned source):

1. **forgetting** — the final candidate is correct: `- Use plain \`fetch\`
   for all outbound HTTP; axios is forbidden by security policy [note 10]`.
   The single counted failure row is `- BillingClient uses a hand-rolled
   retry wrapper on fetch; integration suite verified parity with old axios
   client [note 10]` — a migration-OUTCOME fact (SYSTEM rule 8 material):
   "old axios client" is a historical comparison, but `SUPERSEDED_RE` carries
   `older|earlier|before`, not bare `old`, and no directional pattern matches
   "verified parity with". The memory never states the axios approval as
   current; `revokedRuleEstablishedInFirstMemory: true` (step 1 carried the
   approval), so the axis is non-vacuous and the dream did revoke it.
2. **interference** — the final candidate resolves correctly to pino in one
   line: `- Use pino for structured logging in all modules; winston is
   permanently retired due to data-loss issues under load [note 5, 10, 11,
   12]`. The both-rules line counts BOTH as current because the directional
   patterns require `was/were/got/been replaced/…` (D1) — **"is permanently
   retired" is present-tense passive**, a phrasing kimi never produced (kimi
   wrote "winston was reverted" / pruned the loser outright). Oscillation
   trail: step 1 winston era (winston ×2), step 2 → pino only, step 3 → the
   "is retired" line. Semantic final state: exactly one current logger
   (pino), matching the most recent evidence.

A future classifier revision could add (a) `old <token>` to the loser
exemption set and (b) present-tense passive (`is/are retired|replaced|…`) to
D1 — both would need new `selftest.mjs` pins first (the 10-17 precedent).

## Other observations

- **Agnes tail latency is real**: forgetting step 2 took 194,688 ms for ONE
  upstream request (bridge ring log: single request, no retry/error; day
  totals 0 errors). The other 9 dream calls: 4.1–13.4 s each. The quality-axes
  wall-clock budget (1–8 min) still held (~272 s total), but downstream
  suites should expect 1-in-~10 calls in the 1–3 min band on this upstream.
- Consolidation style differs from kimi: agnes keeps denser, more
  section-structured candidates (Task playbooks / Validation & Schemas
  headers) and consistently folds the revocation + replacement into one line
  ("fetch; axios is forbidden") rather than pruning the loser — which is
  exactly what surfaced the two classifier gaps above.
- Guard: unchanged verdict — the runner-switch family stays narrowly scoped;
  0 false positives on 4 benign rule-change families, `shippedAssertionPass`
  follows the candidate verdict on every axis (no sanitize/gate anywhere).

## Receipts (this run)

`results/summary.json` + `results/{contradiction,staleness,forgetting,interference}.json`
(receipts: `results/agnes-3.0-flash/` — summary + the four axis jsons; model field `agnes-3.0-flash`, date 2026-10-21T17:04:10Z). Run log:
`/home/z/my-project/logs/memory-eval/quality-axes-agnes.log` (outside the
repo). Reproduce: `PI_MODEL_ID=agnes-3.0-flash bun runner.mjs --fresh`.

---

# Live run 2026-10-22 — agnes-3.0-flash, post classifier-fix + dream-hardening: 4/4

Two changes landed between the 10-21 run and this one, and this suite measured
both honestly — including its own classifier.

## The classifier fixes (the 10-21 findings, pinned first)

Every fix was pinned in `selftest.mjs` with the live failing line BEFORE the
re-run (the 10-17 precedent, applied twice over):

- **D1 present-tense passive + adverb slot** — the 10-21 interference fail
  ("winston is permanently retired due to data-loss issues") was invisible
  to the was/were/got-only D1. Also extends the participle list
  (deprecated/discontinued/phased out/banned/forbidden/not-allowed...).
- **D2** gains `deprecat/discontinu` active verbs.
- **D5 old-attribute** — "integration suite verified parity with **old axios
  client**" is a migration-outcome comparison; SUPERSEDED_RE carried
  older|earlier|before but not bare "old". Exempts old/previous/former/legacy
  [≤18 chars] + token.
- **D6 negation direction** — a NEW live phrasing the first re-run surfaced:
  "Group imports by type (...), **not alphabetically**" (winner stated, loser
  explicitly negated) had been read as BOTH current. not/never/rather-than/
  instead-of mark the following token as losing; "not only" is excluded
  ("X, and more" ≠ rejection).
- **D7 comparative-observation exemption** — the second re-run surfaced
  another shape: "Redact card-number paths in log transports; **pino and
  winston require separate configuration**" — a stale config-difference fact
  from the loser era, read by the strict both-named rule as both-current. A
  compare/differ construction without an action-verb opener is not a
  current-rule statement; an imperative ("Use pino and winston") still is.
- selftest pins: 19 → 40 (every fix carries its live line + negative pins
  guarding against false exemptions: "axios is the standing choice" stays a
  violation; "Use pino and winston" stays both-current; "not only" is not
  negation; "loser is current, NOT winner" keeps the loser counted).

## The dream hardening this suite also measured

`dream.ts` SYSTEM rule 2 was rewritten recency-first (2026-10-22): "the MOST
RECENT evidence wins; the final memory must state the winning rule as current
and must NOT state the loser as current anywhere"; rule 5's preservation clause
was scoped so it can no longer protect superseded rules (the observed
contradiction failure — the dream KEEPING the old alphabetical rule — traced
to that 2-vs-5 tension). Verdict on this run: **the fixes hold.**

## Result

| Axis | 10-21 | 10-22 (this run) |
|---|---|---|
| contradiction | PASS then FAIL on re-run (kept old rule current — real dream failure) | **PASS** |
| staleness | PASS | **PASS** |
| forgetting | FAIL (classifier gap) | **PASS** |
| interference | FAIL (classifier gap) | **PASS** |

10 dream calls, 0 errors, 0 guard false positives, guard ship on all four
final candidates, `shippedAssertionPass` = candidate verdict everywhere.
Two live phrasings were discovered and pinned along the way (D6, D7) — the
suite keeps doing its job: every verdict is a receipt, every receipt that
fails honestly is a pinned fix.

Receipts: `results/agnes-3.0-flash/` (regenerated 2026-10-22; the 10-21
receipts remain in git history at the 3af43f2 commit). Reproduce:
`PI_MODEL_ID=agnes-3.0-flash bun runner.mjs --fresh`.
