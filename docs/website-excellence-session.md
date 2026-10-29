# The Website Excellence Round — the session record

> The resumable checkpoint log for the Website Excellence Program (2026-10-29):
> the mission to evolve Unown into a design-aware, visually intelligent,
> self-improving website creation platform — using a flagship website as the
> vehicle, the critique infrastructure as the instrument, and the
> failure-to-learning pipeline as the retention mechanism. Each checkpoint
> states what is done, what is verified, and what is next, so an interrupted
> session can resume from the last green state. Sources and receipts live in
> [`../benchmarks/website-excellence-round/`](../benchmarks/website-excellence-round/);
> the research knowledge base is
> [`website-excellence-research.md`](website-excellence-research.md); the gap
> analysis is [`website-excellence-gap-analysis.md`](website-excellence-gap-analysis.md).

- [Checkpoint 0 — setup, the baseline, and two P0s](#checkpoint-0--setup-the-baseline-and-two-p0s)
- [Checkpoint 1 — the research knowledge base](#checkpoint-1--the-research-knowledge-base)
- [Checkpoint 2 — the critique infrastructure](#checkpoint-2--the-critique-infrastructure)
- [Checkpoint 3 — the flagship app](#checkpoint-3--the-flagship-app)
- [Checkpoint 4 — the learning pipeline](#checkpoint-4--the-learning-pipeline)
- [Checkpoint 5 — landing, docs, release](#checkpoint-5--landing-docs-release)

## The contract

The program's success question: *"If we restarted this project from scratch
using the improved version of Unown, would it create a significantly better
website than it could have at the beginning?"* — answerable only with
measured evidence: baseline scores before, iteration scores after, the tools
that made the difference, and the learning artifacts that persist. The
operating principle throughout: when a weakness is identified, decide where
the defect lives (Unown, the caller environment, or the artifact), fix it
where it lives, and create the benchmark that would catch it next time.

## Checkpoint 0 — setup, the baseline, and two P0s

**DONE.** Clone at `6d043c5` (the nocturne landing round's HEAD); `bun
install` (400 packages); `.env` from `.env.example` with the Agnes upstream
(`BRIDGE_UPSTREAM_URL=https://apihub.agnes-ai.com/v1`,
`BRIDGE_UPSTREAM_KEY` set, `AGNES_API_KEY` set — the metered free-tier
guards stay); bun upgraded 1.3.14 → 1.4.4 (`agent:install` enforces the
lockfileVersion-3 floor); `bun run agent:install` built the vendored pi
workspace; `bun run agent:start` brought up the stack.

**VERIFIED (the baseline, at `6d043c5` then at the fix):**

| Gate | At `6d043c5` | After CP0's fixes |
|---|---|---|
| `bun run typecheck` | green | green |
| `bun run lint` | **4 errors** (F11) | green (0 errors) |
| `bun run test:unit` | 1909/1909 | 1909/1909 |
| `bun run build` | **BROKEN** — route/page conflict (F10) | green, both status routes listed |
| `bun run test:e2e` | 11 failed (stale browser revision) | 15/15 (after `playwright install chromium`) |
| Bridge `:3031/health` | — | ok, upstream Agnes 200, `agnes-3.0-flash` default |
| Engine `:3030/api/health` | — | `phase: ready`, v0.0.40, SHA `89535c6` |
| Agent end-to-end | — | `bun bin/unown -p` → `UNOWN-AGENT-OK` through the bridge |

The two P0s found at baseline are ledgered in the nocturne round's
validation log as **F10** (the landing phase shipped `page.tsx` + `route.ts`
at the same segment — main was un-buildable, CI red, the Vercel deploy
failed, production stale) and **F11** (four lint errors shipped — the
closeout skipped the lint gate). Both fixed, pushed (`3c4cf87`, `89535c6`),
CI green on the fix. The bridge's `/health` also revealed the Agnes upstream
serves `agnes-image-*` and `agnes-video-*` models beside the two chat
models — noted as an asset lane for the round.

**The pre-push checklist adopted for this round** (the F10/F11 process
fix): `typecheck` + `lint` + `test:unit` + `build` all green locally before
every push — the landing auto-deploys in parallel with CI, so a red build
reaches the deploy lane and only deploy-verify catches it after the fact.

**NEXT.** The research knowledge base (Phase 1) and the capability gap
analysis (Phase 2), then the critique infrastructure.

## Checkpoint 1 — the research knowledge base

**DONE.**
[`website-excellence-research.md`](website-excellence-research.md) — the
competitor knowledge base extracted from live production CSS/markup of
Linear, Vercel/Geist, Stripe and the 2025–26 meta-studies (the Evil
Martians 100-devtool-page study, NN/g motion research, the WCAG 2.2 AA
contrast law, Carbon's 2× spacing grid, type-scale ratios, the Lighthouse
scoring weights), plus the VLM-design-critique literature (UICrit,
iterative-refinement prompting, Design2Code's screenshot-diff judging) and
Unown's own in-repo precedent (`tui-beautification-plan.md`'s four-pass
loop). Every token table cites its source URL; the doc ends in the
design-token synthesis the flagship and the rubric both consume.

**VERIFIED.** `bun run check:docs` green (all anchors + links resolve).

**NEXT.** The gap analysis, then the critique harness.

## Checkpoint 2 — the critique infrastructure

**PLANNED.** The self-critique loop every UI iteration runs: build →
screenshot (full-page + per-band, desktop + mobile) → objective audit
(WCAG contrast, type-scale fit, spacing-grid conformance, heading order,
core web vitals) → VLM critique through Agnes (structured JSON verdict,
scored axes, defects, improvements) → fix → re-score. All receipts under
`benchmarks/website-excellence-round/`. The rubric and its thresholds are
the benchmark contract; a run without a receipt never counts.

## Checkpoint 3 — the flagship app

**PLANNED.** `/cadenza` — the virtuoso showcase: the Website Excellence
Program's own story (iterations, before/after comparisons, scores with
receipts, the failure ledger, the tools and learning artifacts) as an
elite-grade interactive experience — built by Unown sessions phase by
phase (plan → lib → UI → embed/landing), zero human edits, the critique
loop between phases as the QA gate.

## Checkpoint 4 — the learning pipeline

**PLANNED.** The failure→learning ledger for this round; the critic
calibration (does the rubric discriminate a known-good from a known-bad
page?); the specialised-agent evaluation (the Design Critic persona's
contribution measured, not asserted); the memory/skill artifacts the round
mints and their reuse evidence.

## Checkpoint 5 — landing, docs, release

**PLANNED.** The landing gallery entry #8, the "Built And Improved With
Unown" surface refresh, the blog post with media, the DOX pass, the
scroll-budget reconciliation, the CHANGELOG entry, the version bump and
the release with six per-OS builds.
