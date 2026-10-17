# quality-axes — memory-quality axes benchmark (deterministic, no LLM judge)

Live benchmark for the memory-quality axes named in
`docs/testing-strategy.md` §7.6 / §10 item M / roadmap item 12 —
**contradiction, staleness, forgetting, interference under accumulation** —
the axes the memory field acknowledges as its weakest (add-only stores keep
superseded facts; multi-hop conflict resolution sits at or below 7% for
GPT-4o-class agents) and the axes a tiered, versioned memory should win.

## What it measures

One synthetic 12-session evolving project (`corpus.json`, the "Atlantis"
invoice service) carries four rule families through a real dream pipeline —
the production `SYSTEM` prompt from `src/dream.ts`, `chatJson` from
`src/llm.ts`, and the real guard (`src/guard.ts`), imported from
`pi-repo/packages/self-learning` (no re-implementation drift):

| Axis | Storyline event | Deterministic assertion on the dream's projectMd candidate |
|---|---|---|
| **contradiction** | lint convention changes: "imports sorted alphabetically" (S01–S06) → "imports grouped by type" (S07+) | the old rule must not be stated as current (its lines absent, or explicitly historical/superseded) while the new rule is; two scenarios — in-batch (all notes in one dream) and accumulated (old rule already in current memory, change arrives via notes — the add-only trap) |
| **staleness** | dependency bump: zod 3 (S01–S05) → zod 4 (S06+) | candidate references the new version; no line states the old version as current |
| **forgetting** | revocation: axios approved (S02) → forbidden, fetch only (S10) | no line states the axios approval/usage as current after the revocation (lines that explicitly revoke/mark it historical are exempt) |
| **interference** | conflicting dominance: logging rule pino vs winston asserted, contradicted, re-asserted across 5 sessions (settled on pino) | exactly ONE logger stated as current in the final candidate — which one is recorded, plus the per-step oscillation trail |

Every axis also runs the real `decideGuardAction` on its final candidate.
These are **benign** rule changes: the expected verdict is `ship`; any
`sanitize`/`gate` is a false-positive signal, and the axis assertion is
re-evaluated on the sanitized text that would actually ship
(`shippedAssertionPass` in the receipts).

## Why deterministic matching (no judge)

The scoring is regex/substring **line classification** on the returned
candidate: every line that mentions a rule family is classified as
"stated as current" / "superseded/historical" / "in a losing transition
position", and each classification (raw line + reason) is recorded in the
receipt — any verdict is human-auditable after the fact. No second LLM
grades the first LLM's output, so no judge identity, rubric, or FPR probe
is needed and nothing about the score depends on judge-prompt tuning
(the failure mode §3.2 of the testing-strategy documents for the field).
LLM usage is the dream calls themselves (~10 `chatJson` calls, kimi-k2.5
via the llm-bridge) — nothing else.

The classifier semantics are pinned by `selftest.mjs` (no LLM, no bridge):
`bun selftest.mjs` — exit 0 means the scoring regexes behave as documented.

## How to run

```bash
# bridge on :3031 must be healthy (checked before any dream call):
curl -s localhost:3031/health

cd benchmarks/memory-eval/quality-axes
bun selftest.mjs      # pin the classifier first (no LLM)
bun runner.mjs        # all 4 axes, ~10 dream calls
bun runner.mjs --axis staleness   # one axis
bun runner.mjs --fresh            # wipe results/ and re-run everything
```

Model: `kimi-k2.5` (override with `PI_MODEL_ID`). The runner redirects
`PI_SELFLEARNING_DATA`/`PI_SELFLEARNING_DB` to
`scratch-mem/quality-axes/` **before** importing the package (`store.ts`
opens SQLite at module scope — same convention as `mpbench/runner.mjs`),
never touches `.env`, and never talks to the engine on :3030.

Current live-run outcome (kimi-k2.5, 2026-10-17): 4/4 axes passed, 0 guard
false positives — receipts and the honest findings record (including one
classifier fix between runs) live in `RESULTS.md` and `results/`.

**Expected runtime:** ~10 dream calls ≈ 1–8 min wall clock (each call
5–60 s on the Dashscope bridge; `chatJson` retries malformed JSON once).

Resume-safe: an axis with an existing error-free receipt
(`results/<axis>.json`) is skipped; errored axes re-run. Receipts:
`results/<axis>.json` (full dream candidates, per-line classification
audit trail, guard verdict, durations) + `results/summary.json`.

## Honest limitations

- **This tests the DREAM (consolidation) quality, not the whole memory
  system.** The full path also involves tier injection, precedence and
  rollback; here only the AutoDream consolidation step is exercised. The
  terminal project-memory path (`runProjectDream`) shares `dream.ts` —
  same SYSTEM prompt, same `chatJson`, same guard — so results transfer
  to it directionally, but the terminal path's own versioning/rollback is
  not under test.
- **The dream is an LLM call; the assertions are not.** Single-run
  receipts, kimi-k2.5, one seed corpus. Re-run for variance; a pass/fail
  flip across runs is itself a finding (record it, don't average it away).
  n=1 per axis is the honest sample size — these receipts are signals,
  not published statistics (§10 item L applies before any external claim).
- **Deterministic ≠ semantic.** The classifier recognizes phrasings, not
  meaning. It is direction-aware (passive "X was replaced", active
  "replaced X", "from X to Y") and records every line it classified, but
  a dream that phrases a rule unusually can be mis-scored — audit the
  `rows[]` in the receipt before trusting a FAIL.
- **Notes are fed newest-first**, mirroring `undreamedNotes()`
  (`ORDER BY created_at DESC`) — the real pipeline's actual order. This
  makes contradiction resolution harder (recent evidence arrives first);
  chronology is only visible through the note-header timestamps.
- The corpus deliberately avoids the guard's runner-switch poison family
  (no runner names in directive positions, no authority spoofs, no
  propagation phrasing) so that guard verdicts measure false positives on
  BENIGN changes, not true positives on poison.
