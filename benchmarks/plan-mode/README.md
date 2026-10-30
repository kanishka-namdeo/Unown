# Plan Mode benchmark (benchmarks/plan-mode/)

The planning round's measurement surface (the 2026-10-31 round; the mission's
"planning benchmarks increase" needs a baseline to increase from — gap P-12).
Measures whether plan mode PRODUCES a plan at all, and how good the produced
plan is by the deterministic rubric.

## What it measures

- **Production** — did the run produce a plan file at all? (The v0.0.48
  baseline produced none: both baseline attempts burned their whole
  `--max-turns` cap on exploration.)
- **Quality** — the 0-100 rubric score, imported from the product's own
  scorer (`pi-repo/packages/self-learning/src/plan.ts` — the SAME function the
  `plan_write` tool returns), so product coaching and benchmark measurement can
  never drift. Dimensions: objective (10), context (10), approach (10),
  steps (30), risks (15), verification (15), clarity (10).
- **Convergence** — turns used / cap, plan_write iterations, continuation
  nudges consumed (the gap P-17/P-17b mechanics).

## Methodology

- Fixed task set: `tasks/pt-*.md` (verbatim prompts, pinned caps).
- Every run: `unown --plan --max-turns <cap> --output-format json -p "<prompt>"`
  in a scratch copy of the Unown checkout, agnes-3.0-flash through the bridge
  (:3031), fresh session, fresh `.unown/plans/`.
- The `--output-format json` envelope carries the structured `plan` report
  (score, steps, files ratio, artifact path) — the runner reads the envelope,
  never parses prose.
- Receipts: one JSONL row per run (`results/run-<ts>/receipt-<task>.json`) +
  `summary.json`; `RESULTS.md` is hand-written from the receipts.
- Deterministic scoring: the same plan always scores the same (no LLM judge);
  the rubric's edge cases are pinned by `test/plan.test.ts` in the package.

## Run it

```bash
bun run agent:start   # bridge :3031 must be up
bun benchmarks/plan-mode/run-plan-bench.mjs --cap 25 --out results/run-<label>
```

Flags: `--cap <N>` (default 25), `--tasks pt-1,pt-2` (default all),
`--out <dir>` (default `results/run-<ts>`), `--unown <path>` (default the
repo's `bin/unown`).

## Receipt shape (per run)

```json
{
  "task": "pt-1",
  "promptFile": "tasks/pt-1.md",
  "model": "agnes-3.0-flash",
  "cap": 25,
  "exitCode": 0,
  "subtype": "success",
  "turns": 14,
  "plan": { "objective": "...", "steps": 7, "stepsWithFiles": 6,
            "risks": 4, "hasVerification": true, "score": 100,
            "passes": true, "file": ".unown/plans/plan.md" }
}
```

`plan: null` means no plan was produced (the baseline failure mode).
