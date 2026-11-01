# PT-5 — the complex-plan lane (live specialist spawns)

Prompt (fixed, verbatim):

```
Plan adding 'Coda' — a local-first markdown notes + task-board PWA (offline-first, installable, cross-platform) — as a new app at apps/coda/ in this monorepo, with production quality: a pure TypeScript domain layer (notes, tasks, boards, search), a UI, unit tests, Playwright e2e + accessibility checks, and the docs/DOX updates a new top-level app requires. Produce the implementation plan.
```

Run contract: `unown --plan --max-turns <cap> --output-format json -p "<prompt>"`
in a scratch checkout of this repo (the runner's fixture semantics: the repo
minus `node_modules/.next/data/.run/.unown/dist`), agnes-3.0-flash via the
bridge (:3031), fresh session, fresh `.unown/plans/`. On hosts that reap
agent processes between operator calls the lane runs as budgeted-chunk resume
chains (the fresh-clone round's documented protocol); the receipt records
total turns across chunks.

What this task measures (the PT-4 control's unmeasured dimension):

- **Live specialist spawns**: a genuinely multi-domain task (app code + tests
  + e2e + a11y + docs/DOX) should CONSULT the bench, not skip — the phase
  rules require ≥2 reviewers at ≥6 steps; the receipt counts the actual
  spawns and their verdicts (product-strategist / solution-architect /
  delivery-manager / qa-architect / devils-advocate).
- **The audit on a real repo**: USED rows with reasons (the AGENTS.md chain,
  the repo's own workflows, the repo map, project context) — the honest
  counterpart to PT-4's all-SKIPPED empty-repo control.
- **Synthesis over real verdicts**: consensus / conflicts + ruling /
  missing / confidence derived from five actual consultations, not skips.

Operator note (2026-11-02): this prompt is the DRIVE track's Coda app — the
plan artifact doubles as the app round's design doc.
