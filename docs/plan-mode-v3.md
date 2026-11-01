# Plan Mode V3 — the capability orchestrator + self-improvement directive

- **Round**: 2026-11-01 · plan-mode-v3
- **Status**: shipped (default on, `UNOWN_PLAN_MODE_V3=0` restores V2)
- **Session log**: [plan-mode-v3-session.md](plan-mode-v3-session.md) · **V2 lineage**: [benchmarks/plan-mode/GAP-REGISTER.md](../benchmarks/plan-mode/GAP-REGISTER.md)
- **Pinned by**: `test/plan-v3.test.ts` (data model, 24 pins) · `test/plan-mode-v3.test.ts` (extension, 9 pins) · `test/subagent-builtins.test.ts` (the bench, 8 pins) · the updated V2 suites (todo-unification M3 + kill switch, acp setMode, golden `--plan` + kill switch)

## What V3 is

V2 made planning *convergent*: a scored plan file, an approval gate, mechanical budget. V3 makes planning an **orchestration** with a learning objective. The operator directive, compressed to its contract:

> Every task must simultaneously deliver project value and improve the agent that did it. Prefer leverage over generation; prefer learning over repetition; prefer reusable improvements over task-specific fixes. Software delivery is evidence — learning is the objective.

Three mechanisms turn that into product:

1. **The capability audit** — before designing anything, the orchestrator evaluates eleven capabilities *in priority order* (tiered memory → existing skills → workflows → standing orders → routines → repo map → project context → prior learnings → benchmarks → agent patterns → subagent delegation), recording relevance, expected benefit, confidence and a USED/SKIPPED decision with a reason for each. New-solution-creation is the last resort, not the default.
2. **The specialist bench** — eight read-only planning subagents with verdict-first contracts (five reviewers for the draft plan, three analysts for the retrospective). Consulted through the `task` tool when the work is complex, uncertain, multi-domain or risky; small plans record justified skips.
3. **The retrospective close-out** — no executed plan closes without `plan_retrospective`: the outcome, a failure classification (eight-category taxonomy) with root cause and prevention when anything went wrong, and learning candidates each tagged with the lane it should land in (memory / skill / workflow / routine / standing-order / benchmark / agent-pattern). The note feeds AutoDream — the Reflexion loop's memory write.

## Design lineage (what was researched, what was adopted)

| Source | Mechanism studied | What V3 took |
|---|---|---|
| **MetaGPT** (role-specialized SOP — "Code = SOP(Team)"; product manager → architect → PM → engineer, each role emitting a structured artifact) | Role-specialized planning pipelines | The specialist bench: fixed contracts per role so verdicts merge mechanically — but as read-only *reviewers* of one plan, not a pipeline that hands artifacts between roles (the anti-pattern MetaGPT's own users report: slow, drift-prone chains) |
| **Reflexion** (arXiv 2303.11366 — Actor / Evaluator / Self-Reflection / Memory) | Post-trial linguistic feedback stored for the next run | The retrospective → note → AutoDream lane: the failure taxonomy + prevention is the "self-reflection", the engine's dream consolidation is the memory write |
| **Builder/reviewer patterns** (2026 review-agent practice; OpenAI multi-model review fan-outs) | Independent review beats self-review | Dual review is mandatory-by-class at execution time (high-risk steps spawn the `reviewer`); the devil's advocate is chartered so *finding flaws is success* |
| **Claude Code plan mode** failure modes (its own tracker: writes during plan mode #39713, ~340-line community hook guards; stale state after toggle-off #7782) | Read-only-ness as a prompt promise vs a toolset property | V3 keeps V2's enforced-toolset approach and extends it to delegation: planning-time spawns are restricted to strictly read-only agents **by the task tool's guard**, never by asking the model nicely |
| **Capability governance** (NVIDIA verified agent skills; Claude Code skills' progressive disclosure) | Agents consulting a capability inventory before executing | The capability audit: eleven concrete, checkable surfaces (not a vibe), each with a decision and a reason |

## The ten design decisions

1. **V3 is the default; V2 is the kill switch** (`UNOWN_PLAN_MODE_V3=0`) — the repo's convention for behavior rounds (cf. `UNOWN_FOOTER_CLASSIC=1`). Both lanes are pinned by tests so neither can drift.
2. **The plan doc grows, it does not break.** Four new optional sections (`## Capability audit`, `## Specialist review`, `## Synthesis`, `## Learning plan`) + the post-execution `## Retrospective`. A V2 doc parses and renders byte-identically; every V2 constructor stays type-valid (pinned).
3. **Scoring stays deterministic and single-sourced.** `scorePlanDocV3` re-weights the V2 seven to 80 points and adds capability-audit 8 + specialist-review 8 + learning-plan 4 = 100. Same `PlanScore` shape, same threshold gate, same `planCritiqueAdvice` — the approval dialog and benchmark lane needed no branching.
4. **Planning-time delegation is read-only, enforced.** `task` stays in the V3 plan toolset; the guard admits exactly agents whose declared tools ⊆ {read, grep, find, ls}. Agents with no `tools` field (the full-toolset ones) are refused. The refusal names the bench and the remediation. Sync and fleet lanes share the guard, applied before any spawn.
5. **The bench is unadvertised** (`advertise: false`, the `planner` precedent): reached by name from the phase prompt, never by catalog browsing — the advertised catalog stays lean and the specialists are never picked for ordinary work.
6. **Review depth scales with plan size.** ≥1 specialist verdict for any plan; ≥2 once the plan carries six or more steps. Justified skips count (`### <name> — SKIPPED: <why>`) — a trivial plan that consults nobody is honest, not penalized.
7. **The retrospective is a tool with a contract, not a hope.** `plan_retrospective` (execution-mode-guarded) validates: outcome ∈ {delivered, partial, failed}; a non-delivered outcome requires failure class + root cause + prevention; at least one learning candidate or improvement overall — "nothing to extract" is rejected as a missed retrospective.
8. **The merge is surgical.** The retrospective section is appended to the plan file by stripping any prior `## Retrospective` and appending the rendered one — the model's original plan bytes are never reflowed by the close-out.
9. **The learning lanes are real surfaces.** Every learning kind names a mechanism that exists: memory tiers, `.unown/skills/`, workflows, `unown routines`, standing orders (`## Program:` sections), `benchmarks/`, agent patterns. No "learnings" that land nowhere.
10. **The kill switch covers the whole stack**: toolset (task on/off), prompt (the V3 orchestrator vs the V2 workflow) and scorer (10 vs 7 dimensions) — one env var, one mode, no half-states.

## The grammar (the plan file's V3 sections)

```markdown
## Capability audit
- tiered-memory — USED: <reason> (relevance: high; benefit: <what>; confidence: 80)
- existing-skills — SKIPPED: <reason>
<… one row per capability, all eleven>

## Specialist review
### product-strategist — ALIGNED
- <finding>
### delivery-manager — SKIPPED: <reason>

## Synthesis
- consensus: <where the reviews agree>
- conflicts: <disagreements + the orchestrator's ruling>
- missing: <what the reviews surfaced>
- confidence: <0-100>

## Learning plan
- memory: <what this run should remember or validate>
- benchmark: <scenario worth measuring, when real>

## Retrospective            <!-- appended by plan_retrospective, post-execution -->
- outcome: delivered | partial | failed
- failure class: plan | memory | skill | delegation | context | execution | review | external | none
- root cause: <text>       <!-- required when the outcome is not 'delivered' -->
- resolution: <text>
- prevention: <text>
- learnings:
  - <lane>: <concrete candidate>
- improvements:
  - <free text>
```

The parsers are tolerant (em-dash family or bare hyphen; optional meta block; sections in any order) and the round-trip is pinned.

## Failure modes considered and their guards

| Failure mode | Guard |
|---|---|
| A writing subagent smuggled into planning (the #39713 class) | The task-tool guard: tools ⊆ {read, grep, find, ls}, enforced pre-spawn on both lanes; `bash`-carrying "read-only-ish" agents (`reviewer`, `debug`) are refused too — bash can mutate |
| The audit becomes ritual (eleven copy-pasted SKIPPED rows) | The scorer requires a reason per row, ≥ 8 rows for full credit, and ≥ 1 USED row (or a Context justification) — an all-skipped audit on a real repo loses points |
| The specialists rubber-stamp | Every specialist's contract demands findings with evidence (the architect must cite file:line; the devil's advocate is told a no-findings review is approval theater) |
| The retrospective degenerates into "went well, nothing learned" | `validateRetrospective` rejects nothing-extracted close-outs and unclassified failures |
| The V3 prompt bloats the model's context every turn | The injection is one context message per turn like V2's (sentinel-prefixed, stripped when stale); the prompt is the same size class (~90 lines of guidance) |
| V2 users get a silent behavior change | The kill switch is documented, tested in both lanes, and the changelog entry names every observable difference (task in the plan toolset, the new sections, the new tool) |

## Live receipts (first runs, the full stack: bridge → Agnes `agnes-3.0-flash`)

- **Headless print lane** (`unown --plan -p …` in a scratch repo): the full V3 plan — 11-row audit (all SKIPPED with honest reasons: the scratch repo has no memory/skills/AGENTS.md), five justified specialist skips (trivial task), synthesis (confidence 95), learning plan, verification — deterministic re-score **98/100, passes** (the only deduction: no USED row, correctly flagged).
- **Interactive full loop** (PTY-driven, `/plan` → approval → execution → close-out): plan scored 100/100, approved, **executed for real** (`multiply` added to `src/calc.ts`, `test/calc.test.ts` created, `bun test` 5/5), then `plan_retrospective` merged the section (outcome delivered, a real memory candidate: the calc-lab test conventions, verified against the files) and the engine's note feed shows the `plan retrospective: … outcome delivered, plan score 100/100` note for AutoDream.

Transcript and artifacts: `docs/plan-mode-v3-session.md` (M6) and `benchmarks/plan-mode/RESULTS.md`.

## Non-goals (recorded, not silently dropped)

- No fourth permission-mode `plan` (the extension-level state machine stays the single source of truth — V2's recorded non-goal, unchanged).
- No headless `--plan-execute` auto-approval: print mode stays read-only, so the retrospective needs an interactive approval by design.
- No plan DAG, no `/plans` archive browser (V2 non-goals, still open).
- The specialist bench does not auto-consult: the orchestrator decides, and a trivial plan that consults nobody with reasons is the *correct* outcome, not a failure.
