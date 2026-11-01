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

## Plan Mode V3 (2026-11-01, the capability-orchestrator round)

Task set: `tasks/pt-4.md` — the capability-audit plan on a deliberately
capability-EMPTY scratch repo (one `add()` function, bun test runner, no
AGENTS.md, no memory, no skills), which is the control that makes the audit's
honesty measurable: an empty repo's correct audit is all-SKIPPED-with-reasons.
Model: agnes-3.0-flash through the bundled bridge, live Agnes upstream.

| Lane | What it proves | Result |
|---|---|---|
| PT-4 headless (`--plan -p`, cap 30) | The V3 prompt produces the full V3 doc unprompted-by-hand: 11 audit rows with reasons, five justified specialist skips (a trivial task consulting nobody is the CORRECT outcome), synthesis (confidence 95), learning plan, verification | **98/100, passes** — the only deduction is the ≥1-USED-row sub-check, the honest verdict for a repo with nothing to reuse |
| PT-4i interactive (PTY-driven full loop) | The complete orchestrator cycle against a real TTY: `/plan` → approval dialog → **real execution** (multiply written to `src/calc.ts`, `test/calc.test.ts` created, `bun test` 5/5) → `plan_retrospective` merged into the plan file → the `plan retrospective` engine note delivered for AutoDream | **PASS, all four stages** — the plan scored 100/100; the retrospective carried outcome `delivered`, a verified memory candidate (the calc-lab test conventions) and an improvement line |

Receipts: `results/run-2026-11-01-v3/` — `receipt-pt-4.json` (scored by the
product's own `scorePlanDocV3`), `receipt-pt-4i.json` (the four-stage verdicts),
the verbatim plan files, the executed source + tests, and the 116,953-byte PTY
transcript.

### V3 limitations (same honesty as the V2 table)

- n=1 run per lane, one model: a demonstration that the V3 mechanisms work
  end-to-end through the live stack, not a population claim about planning
  quality. The V3 dimensions are additionally pinned deterministically by
  `test/plan-v3.test.ts` (24 pins) and `test/plan-mode-v3.test.ts` (9 pins),
  which is where the scorer's behavior is actually contract-tested.
- PT-4's empty-repo control means the specialist bench was exercised as
  *justified skips*, not live consultations — a complex-plan lane with live
  specialist spawns remained unmeasured until PT-5 below (the bench's own
  contracts are pinned by `test/subagent-builtins.test.ts`, and the
  read-only delegation guard by `test/plan-mode-v3.test.ts`).
- The interactive lane was driven by a scripted PTY driver (Enter on the first
  approval option), not a human's considered choice — the approval gate's
  semantics themselves are the V2 round's, already pinned by its own suites.

## PT-5 — the complex-plan lane with LIVE specialist spawns (2026-11-02)

The fresh-clone round's M3 lane, closing the limitation above. Task:
`tasks/pt-5.md` — plan **Coda**, a local-first markdown notes + task-board PWA
at `apps/coda/` (app code + tests + e2e + a11y + docs/DOX: a genuinely
multi-domain change). Run contract as documented in the task file: scratch
checkout fixture, agnes-3.0-flash through the live bridge, budgeted-chunk
resume protocol on the reaping host (chunk 1 capped at 10 turns with the plan
drafted; chunk 2 resumed by session id and completed uncapped — 17 turns,
396 s).

| Metric | Result |
|---|---|
| Plan produced / passing | **yes — 87/100** (threshold 70) |
| Steps (with files) | 9 (8) — re-sequenced by the delivery-manager verdict |
| Risks / verification | 5 / yes |
| **Live specialist spawns** | **7 spawns, all five bench agents** (product-strategist, solution-architect, qa-architect, delivery-manager ×2, devils-advocate ×2 — the second round re-reviewing the revised plan) |
| Verdicts applied back | yes — product-strategist **DRIFT → cuts applied**; qa-architect **GAPS → mitigated**; delivery-manager **DELIVERABLE → re-sequenced**; devils-advocate **P0s found → fixed in Approach/Steps**; solution-architect **ALIGNED** |
| Capability audit | USED rows with reasons on the real repo (the honest counterpart to PT-4's all-SKIPPED control) |
| Session shape | 17 turns, `plan_write` iterations, `exit_plan_mode` invoked, read-only tools only |

The full V3 document structure is present in the committed plan artifact:
Context, Capability audit, Approach, Specialist review (5 verdicts),
Synthesis, Steps, Risks, Learning plan, Verification. The plan doubles as the
DRIVE track's Coda app design doc (operator decision 2026-11-02).

Receipts: `results/run-2026-11-02-pt5/` — `receipt-pt-5.json` (the envelope's
`plan` block + the spawn ledger), `summary.json`, the verbatim
`pt-5-plan.md`, and both chunk envelopes.

### PT-5 limitations (same honesty)

- n=1 run, one model (the metered free tier): a demonstration that the bench
  consults and that its verdicts change the plan, not a population claim.
- The chunked-resume protocol means the "turns 17" figure counts across two
  process lifetimes (10 + 7); the plan converged inside the first chunk and
  the specialists + synthesis + learning plan completed in the second.
- The specialist consultations ran at their default low effort through the
  metered upstream; their verdict quality is evidenced by the applied
  changes (cuts, re-sequencing, P0 fixes), not independently scored.
