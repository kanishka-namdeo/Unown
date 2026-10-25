# ops-accuracy — memory-operations accuracy benchmark (gold-op ledger vs the dream)

Live operations benchmark asking the Mem0 paper's core question: **when a note
sequence implies ADD / UPDATE / DELETE / NOOP memory operations, does the
production dream apply the right one?** (arXiv 2504.19413 §3.1/Alg. 1 — the
extraction+update taxonomy; hard-case shapes from MEME, arXiv 2605.12477 —
Cascade and Deletion; conflict-resolution competency from MemoryAgentBench,
arXiv 2507.05257; the bi-temporal case pins competitor-research failure mode
11, Letta #4097 / Zep's bi-temporal lesson.) Until this suite the memory
benchmarks measured axes (contradiction/staleness/forgetting/interference)
and recall, but never scored the per-fact operation against a gold ledger —
the confusion matrix the memory-ops papers report.

## What it measures

Per case, against the **production post-swap dream path** (the Mem0 learning
core, commit 25c6601 — imported from `packages/self-learning` via
`../_lib/dream-pipeline.mjs`, no re-implementation drift):

| Step | What happens |
|---|---|
| 1. scope | An isolated mem0 scope `projectScope("oa-<caseid>")` is wiped and seeded with the corpus `seedMemory` exactly like production seeding (`importLegacyMarkdown` kind "seed", bullet-split, verbatim `infer:false`, no LLM). |
| 2. dream | The case's notes go through ONE `consolidate()` pass (structural quarantine → mem0 extraction add → guard sweep → reconcile → deterministic render), fed **newest-first by `created_at ?? ts` DESC** — `undreamedNotes()` order. The bi-temporal case's notes carry BOTH `ts` (event time) and `created_at` (delivery time): delivery order decides the feed, the event chronology rides in the note text. |
| 3. probes | DETERMINISTIC probes (no LLM judge) over three surfaces — `platform.getAll(scope)` memory texts, the rendered markdown lines, `platform.search(q, scope, 10)` results, all normalized (lowercase, whitespace collapsed, bullet markers stripped): `present` (regex hits ≥1 memory or render line), `absentCurrent` (facts with `current:false` — no UNMARKED render-line or search-hit hit; lines/texts carrying an explicit historical marker — superseded, revoked, removed, no longer, decommissioned, migrated, old, deprecated, "was ", "used to", before — are exempt and recorded verbatim), `once` (exactly one distinct memory matches), `maxMatchCount` (count ≤ a corpus-pinned limit), `search` (the expected fact's regex hits a top-5 result). Which surface satisfied each probe, match counts and matched lines verbatim go into the receipt. |
| 4. ops scoring | Per fact, `observed` ∈ **applied / missed / over-applied** (duplicate — `once` failed or matchCount>1 for ADD/NOOP) **/ wrong-winner** (absentCurrent failed). ADD applied = present (and once when probed). NOOP applied = the dedupOf target present AND exactly once. UPDATE applied = new text present AND old value absent-current. DELETE applied = old value absent-current AND (for supersede/revocation pairs) the replacement present. |
| 5. summary | A gold-op × observed **confusion matrix** (rows ADD/UPDATE/DELETE/NOOP), **opsF1** = applied/(applied + 0.5·(missed + over-applied + wrong-winner)) macro-averaged over the ops present, per-case pass booleans (case pass = every probe passes), dream call counts and durations. Suite passes when every case passes. |

The eleventh documented shape — dedup at corpus scale — is deliberately NOT a
case here: it needs two dreams over one scope, which is
`failure-modes/fm-03`'s pinned scenario.

## Corpus

`corpus.json` (version 1): 11 hand-authored cases over one fictional
TypeScript API-gateway project ("aurora-gateway") — `add-basic`, `noop-restate`
(ADD then NOOP restatement), `update-in-place` (augmented fact),
`supersede` (Postgres 14 → 16), `revocation` (axios approved → forbidden),
`temporal-order` (Friday → Tuesday deploy window), `bi-temporal-delayed`
(delayed outbox delivery, event-time winner), `cascade` (MEME: auth →
identity rename → config relocation), `deletion-state` (MEME: feature removed
in v2.3), `multi-session-compose` (MemoryAgentBench: composed current state),
`granularity` (six atomic facts in one note). Every fact carries a gold `op`,
a `match` regex, and optional `current`/`dedupOf` fields; the probe sets are
the per-case assertions. Hand-authored (no upstream dataset to regenerate
from); sha256
`0a070df6299a1aae05a1b0f18b61ac8e05278122257578f4bcc1cdec588f46c8`.
No note collides with the guard's poison families (runner names in directive
positions, authority spoofs, propagation/secrecy phrasing) — the cases test
operations, not quarantine.

## Run

```bash
bun runner.mjs --dry                 # no-LLM plumbing smoke (fast, no bridge, no receipts)
bun runner.mjs                       # full corpus, live (resume-safe; ~22 LLM calls)
bun runner.mjs --limit 2             # first two cases only
bun runner.mjs --case supersede     # a single case
bun runner.mjs --fresh               # ignore existing receipts
```

`--dry` runs the full plumbing (wipe → seed → verbatim `infer:false` adds →
reconcile seam → render → probes → ops classification) with ZERO bridge
calls, the lexical embedder forced, and no receipt writes; it asserts
plumbing health only (in `--dry` the verbatim notes simply accumulate, so
absentCurrent/once/ops verdicts are meaningless by construction — every
present probe must still hit its verbatim note, and scopes must not leak).
Live mode requires the llm-bridge on `:3031` (checked before any dream call;
`bridgeUpstreamStatus` recorded). One consolidation per case (extraction +
reconcile ≈ 2 LLM calls, sequential — the bridge is a metered ~20 RPM lane).
Scratch env (set before the package import):
`PI_SELFLEARNING_DATA=/home/z/my-project/scratch-mem/ops-accuracy/data`,
`PI_SELFLEARNING_DB=.../db/ops-accuracy.db`, `PI_MEM0_DIR=.../mem0`.

## Receipts

- `results/per-case/<id>.json` — the notes in fed order (with `ts`,
	`created_at`, which field decided the order), the seed render, the dream
	outcome fields (added/merged/pruned/quarantined/guardDeleted, the
	reconcile ops), the post-dream render, the platform memory list, every
	probe's pass/fail with matched lines verbatim / match counts /
	satisfying surface / search top-10 with scores, and per-fact `observed` +
	the classification reason.
- `results/summary.json` — the gold-op × observed confusion matrix, opsF1
	(per-op + macro), per-case pass booleans, dream-call counts, durations,
	platform/bridge provenance.
- Model-scoped: a run whose model differs from the one recorded in an
	existing `results/summary.json` writes to `results/<model>/` instead of
	clobbering (the agnes/kimi receipt-overwrite lesson).
- Resume-safe: a case with an existing error-free receipt is skipped;
	errored cases re-run (their scope is wiped first). Exit code: 0 iff every
	selected case passes.

RESULTS.md is written by hand from `summary.json` after live runs (the
repo's convention for graded numbers).

## Honest limitations

- **Regex probes are literal, not semantic.** A fact captured in different
	words than its `match` regex FAILS `present` (e.g. the cascade `rename`
	regex pins the note's exact phrase "renamed the auth module to identity" —
	an extraction that says "the auth module was renamed to identity" scores
	missed). This is the judge-free trade: no LLM judge to trust, calibrate
	or pay for — at the cost of understating true ops accuracy when the
	extraction paraphrases. Every receipt records the matched/unmatched text so
	a human can reclassify.
- **The absentCurrent exemption list is generous.** Any line containing
	"old", "was ", "before", … (substring, case-insensitive) exempts a
	superseded-fact hit — a deliberate bias against false failures on
	historical mentions, at the cost of masking a wrong-winner that happens to
	share a marker word. Exempt lines are recorded verbatim with the marker
	word that exempted them.
- **The search surface inherits the embedder.** With the lexical backend
	(the current local default), hyphenated tokens stay whole ("feature-flags"
	never matches the split query tokens "feature"/"flags") and mem0's search
	drops results under its 0.1 similarity threshold — the bi-temporal search
	probe deterministically returns zero hits in `--dry` and may fail live
	even when the memory is correct. That is the real production path being
	measured, not a scoring bug; the ONNX lane would behave differently.
- **n=11, one dream per case, one model per run.** The confusion matrix is a
	direction, not a leaderboard row; per-fact cells are mostly 1-2 facts deep.
	The `once`/`over-applied` distinction depends on extraction granularity —
	one case's ADD fact legitimately appears in two notes (multi-session
	composition), so a correct extraction can still score over-applied if both
	phrasings survive the reconcile.
- **Seeding is a stand-in.** Every case starts from the same 3-bullet seed
	memory; real projects carry accumulated state that makes UPDATE/DELETE
	harder (the accumulated scenario shape is covered in quality-axes, and
	dedup-at-scale lives in failure-modes/fm-03).
- The suite measures consolidation through the dream path only — note
	writing quality, note selection (what gets dreamt) and injection-time
	retrieval are other suites' lanes (recall-qa, retrieval-rank).
