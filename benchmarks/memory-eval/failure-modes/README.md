# failure-modes — the twelve documented memory failure modes, pinned as measured regressions

The twelve cross-industry failure modes from the 2026-10-25 competitor-research
sweep ([docs/memory-competitor-research.md](../../docs/memory-competitor-research.md)
§"Common failure modes to benchmark") — the doc's explicit debt: *each should
have a pinned case in `benchmarks/memory-eval/`*. This suite pays it: every
case is a pinned regression — a pass today AND a per-check receipt that makes
a future regression visible the moment a refactor reintroduces the industry's
shipped bug.

## What it measures

Twelve cases (hand-authored `cases.json`), three execution modes:

| Mode | Cases | What runs |
|---|---|---|
| deterministic | fm-01, fm-05, fm-07, fm-09, fm-10, fm-12 | direct production-module calls (memory.ts overlay resolution, budget.ts, term.ts caps, guard.ts scanners, memzero platform ops) — no bridge, no LLM |
| live | fm-03, fm-04, fm-06, fm-11 | the production consolidate path via `../_lib/dream-pipeline.mjs` (structural quarantine → ONE extraction add → guard sweep → reconcile → render) on isolated mem0 scopes, ~2 bridge calls per case |
| engine | fm-02, fm-08 | a scratch engine booted through the REAL `startServer()` in a child process (own scratch data dir + per-boot token; `test/memory-live.test.ts` pattern), real REST + busy-mutex + dream rows |

| # | Case | The industry bug it pins | Checks |
|---|---|---|---|
| 1 | fm-01-silent-truncation | Codex #13386 / #48679 | oversized tiers resolve ≤ `PI_MEMORY_TOTAL_CHARS` with `<!-- budget: pruned -->` markers; a 25k note caps at 20 000 codepoints + `(truncated)`; a capped render records `rendered N/M` in its footer |
| 2 | fm-02-dedup-toctou | Mem0 #6515 / #6531 | two concurrent dream triggers serialize (busy-mutex: one 200, one 409); the shared fact exists exactly once; no stuck `running` dream rows |
| 3 | fm-03-dedup-scale | Mem0 #7123 | twelve seeded near-duplicates + one dreamed variant collapse to ≤ 4 matching memories, enforcement detail survives |
| 4 | fm-04-contradiction-coexistence | Codex #56767 | the invalidated max-age=3600 rule never appears CURRENT in render, search, or cross-scope recall |
| 5 | fm-05-cross-scope-leakage | Mem0 #5439 / Graphiti #2065 | same-named projects get distinct composite scopes; scoped searches never leak; cross-scope results carry scope tags; writes stay scoped |
| 6 | fm-06-poisoning-direct-write | Letta #3388 / Codex #53490 | the direct-write note is structurally quarantined; nothing it planted survives into render/platform/search |
| 7 | fm-07-injection-via-memory-file | Graphiti non-defense / Claude Code 2.1.284 | committed memory-file content with impostor markup is flagged/neutralized at load — never injected verbatim as instructions |
| 8 | fm-08-ingestion-loss | Graphiti #1707 | a dream that fails (dead bridge) is VISIBLE (error status), the note is NOT consumed (still pending), and the recovered engine later consumes it |
| 9 | fm-09-stale-index | Letta #4337 | after `platform.delete` the fact is absent from search, getAll and render |
| 10 | fm-10-merged-conflicts | Letta #4832 / #5091 | a teammate's committed project.md vs existing platform state: no duplicates under the production import guard, `## Manual notes` preserved, re-import idempotent |
| 11 | fm-11-bitemporal-recency | Letta #4097 / Zep bi-temporal | Thursday's note delivered after Friday's resolves to FRIDAY's fact as current (event time, not delivery order) |
| 12 | fm-12-context-bloat | Claude Code 2.1.309 | a pathological at-cap tier stack degrades in the documented order (oldest dated blocks first, markers announced, guide never pruned) |

## Findings surfaced by the deterministic lane (already recorded)

- **fm-07**: the `### System` impostor block (variant 4) is NOT caught by the
  memory-file load scan (`scanMemoryCandidate` / `scanUntrustedText`) — only
  the guard's layer-4 tool-output scanner (role-tag-forgery) flags it. The
  case still passes (the guard neutralizes at the dream boundary), but the
  load-time coverage gap is measured and recorded per receipt.
- **fm-10**: `importLegacyMarkdown` itself has NO content-level dedup — on an
  unguarded scope an overlapping fact lands in 3 memories. Production never
  hits this (the dream-time swap-boundary guard only imports into an EMPTY
  scope, and reconcile dedupes), so the case passes on the guarded path; the
  raw-surface duplication is recorded as the receipt's finding.

## Run

```bash
bun runner.mjs --dry        # deterministic cases run for real (lexical embedder, no bridge), live/engine cases validated not run, no receipts
bun runner.mjs              # all twelve (resume-safe; deterministic cases ~instant, live ~2 bridge calls each, engine cases boot a scratch engine)
bun runner.mjs --case fm-04-contradiction-coexistence
bun runner.mjs --fresh      # ignore existing receipts
```

Live/engine modes require the llm-bridge on `:3031` (checked before any
call). Scratch env (set before the package import — never the live engine
DB): `PI_SELFLEARNING_DATA` / `PI_SELFLEARNING_DB` / `PI_MEM0_DIR` under
`/home/z/my-project/scratch-mem/failure-modes/…`; each live case owns an
isolated mem0 scope (`projectScope("fm<n>-…")`), wiped before seeding.

## Receipts

`results/per-case/fm-<id>.json` — every check's pass/fail + the evidence that
decided it (matched lines, scopes, statuses, counts), plus any `finding`
fields. `results/summary.json` — per-case pass booleans, modes, durations.
Model-scoped results dirs when `PI_MODEL_ID` differs from the recorded one
(the quality-axes pattern). `RESULTS.md` is hand-written from summary.json
(the repo's convention for graded numbers).

## Honest limitations

- The engine cases boot the real `startServer()` but on a scratch data dir —
  they pin the serialization/consumption contracts, not the OS-service
  supervision layer.
- fm-02's duplicate-count assertion is scoped to the project scope the
  scratch engine's dream writes; a second process could in principle race the
  mem0 vector store — the case measures what production actually runs (the
  busy-mutex path), not a stress harness.
- fm-11 (bi-temporal) and ops-accuracy's `bi-temporal-delayed` pin the same
  contract with different fact families — one dream each, both receipts
  committed; a failure in either is the same regression.
- The deterministic lane runs the lexical embedder only (no LLM) — the
  semantic-embedder variant of fm-05/fm-09 is covered by retrieval-rank's arms.
