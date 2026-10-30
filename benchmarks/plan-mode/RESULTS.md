# Plan Mode benchmark — results (benchmarks/plan-mode/)

The 2026-10-31 planning round's before/after evidence. Task set: `tasks/pt-{1,2,3}.md`
(fixed verbatim prompts). Model: agnes-3.0-flash (the metered free tier) through the
bundled llm-bridge (:3031). Cap: `--max-turns 25`. Scored by the product's own
deterministic rubric (`pi-repo/packages/self-learning/src/plan.ts` — the same function
`plan_write` returns), captured from the `--output-format json` envelope's `plan` block.

## Before / after (the round's headline)

| Metric | v0.0.48 baseline (2026-10-31) | Plan Mode V2 (2026-10-31) |
|---|---|---|
| Plans produced | **0 / 2 runs** (both burned the whole cap on exploration; the 45-turn retry's "answer" was a mid-thought sentence) | **3 / 3 runs** |
| Mean rubric score | **0 / 100** (no plan to score) | **100 / 100** |
| Steps with file references | — | 18 / 18 across the three plans |
| Risks with mitigations | — | 4 / 4 / 4 per plan |
| Verification sections | — | 3 / 3 (commands + manual steps) |

Receipts: baseline `results/baseline/pt-1-attempt-{1,2}.txt` (verbatim captures);
after `results/run-2026-10-31-v2/` (`summary.json` + per-task receipts).

## Per-task (run-2026-10-31-v2)

| Task | Exit | Subtype | Turns | Score | Steps (with files) | Risks | Verification |
|---|---|---|---|---|---|---|---|
| pt-1 (`/theme` command) | 0 | success (capped, answer recovered) | 25 | 100 | 6 (6) | 4 | yes |
| pt-2 (`--quiet` flag) | 0 | success (capped, answer recovered) | 25 | 100 | 6 (6) | 4 | yes |
| pt-3 (slow-resume fix) | 0 | success (capped, answer recovered) | 25 | 100 | 6 (6) | 4 | yes |

All three runs hit the 25-turn cap mid-verification and recovered the completed plan
(the LR-1b cap-with-answer contract) — the plans themselves converged well inside the
budget, with the continuation nudges (`unown-plan-continue`, gap P-17b) absorbing the
model's narration-stops and the rubric coaching (`plan_write`, gap P-05) driving the
file/risks/verification dimensions to full marks.

## Honest limitations

- n=3 tasks, n=1 run per task, one model (the free tier's agnes-3.0-flash): this is a
  before/after demonstration on the round's own failure modes, not a population claim.
  The baseline's zero-plan failure was reproduced twice (25- and 45-turn caps) before
  any code changed; the after-runs are pinned receipts, not a selection.
- The rubric is structural (sections present, steps concrete, files named, commands
  runnable) — it does not judge whether the plan is *correct*. The pt-1 plan's
  correctness was spot-checked by hand (it found the real pi theme APIs —
  `getAvailableThemesWithPaths`, `InteractiveThemeController`, `ThemeSelectorComponent`
  — and cited line-accurate reuse points); pt-2/pt-3 were scored, not hand-audited.
- "Turns 25" means the cap landed during post-plan verification chatter; the plan
  artifact was complete before the cap (the envelope's `plan` block proves it).
- Baseline receipts capture stdout verbatim; the baseline predates the envelope
  `plan` block (it had no plan to report), so the before/after production metric is
  the honest comparable — the score column is "not produced" vs measured.
