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

**DONE.** `scripts/design_critic.mjs` (npm: `critic:design`) — the
self-critique driver: any route of the production standalone build (or any
local HTML file) at desktop 1440 + mobile 390, per-band + full-page shots
under reduced-motion, the objective in-page audit (WCAG contrast per text
node vs composited background, type-scale census, 4px-grid conformance,
heading order, alts, overflow), cold-load FCP/LCP/CLS/TBT via buffered
PerformanceObservers, and the strict-JSON 7-axis VLM critique through the
bridge — one committed receipt per run
(`benchmarks/website-excellence-round/critiques/`, schema
`website-excellence/critique/1`). `--enforce` turns a rubric fail into
exit 1. The calibration fixture
(`scripts/design_critic_calibration.html`) is the known-bad anchor. The
contracts: the round's [`README.md`](../benchmarks/website-excellence-round/README.md)
+ [`rubric.md`](../benchmarks/website-excellence-round/rubric.md); the gap
audit it answers: [`website-excellence-gap-analysis.md`](website-excellence-gap-analysis.md).

**VERIFIED.** The baseline receipt
([`20261029-145746-baseline-root.json`](../benchmarks/website-excellence-round/critiques/20261029-145746-baseline-root.json)):
the landing page at `89535c6` — overall **6.40**/10 (hierarchy 6.50 ·
typography 6.79 · spacing 6.08 · color 7.25 · alignment 7.19 · density
6.71), **23 distinct font sizes** (gate ≤ 8), **32.7% off-grid spacing**
(gate ≤ 15%), 0 contrast violations (min 5.95:1), 0 heading skips, 0
missing alts, 0 mobile overflow, FCP/LCP/CLS/TBT 276ms/276ms/0/61ms —
rubric FAIL on type scale + spacing + five VLM axes. The calibration
receipt
([`20261029-145834-calib-bad-root.json`](../benchmarks/website-excellence-round/critiques/20261029-145834-calib-bad-root.json)):
the known-bad fixture scores **1.5** overall (every axis 1.0–2.5, 26
contrast violations, 100% off-grid) — a 4.9-point separation from the real
page: the judge discriminates. Honest headline: the fixture's deliberate
type chaos (10 sizes) is MORE disciplined than the real page's 23. Docs
gates green (`check:docs` 84 files, instruction-chars 46 files 0 findings);
pushed as `0eb9e76`.

**NEXT.** The flagship app (CP3) — the plan session E1 wrote
[`plan.md`](../benchmarks/website-excellence-round/plan.md) (192 lines, all
8 sections, 29 turns / 207k-in tokens); the lib session E2 landed 4 modules
+ the drift gate, 64/64 green (one resume: the gate-count off-by-one and
the self-scanning determinism invariant, both fixed in 15 turns).

## Checkpoint 3 — the flagship app

**DONE.** `/encore` — "the earned performance" (the naming receipt: the
eighth app, built by everything seven apps of practice taught the
platform; collision-checked — Adobe Encore discontinued 2014, encore.org
nonprofit, no dev-tool/AI-space collision, lexically distinct from all
seven siblings). The showcase of the program's own measured story, built
by **17 agent sessions** (e1 plan → e10 landing, 459 turns, **513 tool
calls**, zero human edits to app code), with the critique loop as the QA
gate between phases.

The loop's receipts (all committed under
[`critiques/`](../benchmarks/website-excellence-round/critiques/)):

| Run | Overall | Font sizes | Off-grid | Contrast (dark/light) | Overflow | Verdict |
|---|---|---|---|---|---|---|
| the landing baseline | 6.40 | **23** | **32.7%** | 0 / (light-only, F14) | 0px | the "before" |
| encore iter0 | 6.27 | 6 | 0% | 0 / 0 | **42px** | first build, overflow caught |
| iter1 | 6.0 | 6 | 0% | 0 / 0 | **42px** | short-ref fixes, overflow persists |
| iter2 | 6.0 | 6 | 0% | 0 / **27** | 0px | overflow fixed; E6's pins broke light |
| **iter3 (final)** | 6.22 | **6** | **0%** | **0 / 0** | **0px** | **ALL objective gates pass** |

The flagship's final state: every objective rubric gate green — against
a landing baseline that fails type-scale (23 vs ≤8) and spacing
(32.7% vs ≤15%) — with the VLM overall honestly below the 7.0 floor
(the single-judge variance band; the floor stays the program's open
goal, recorded in the round's README limitations). The failure ledger:
**F14–F18** in
[`validation-log.md`](../benchmarks/website-excellence-round/validation-log.md)
— including the loop catching its own fix's light-scheme regression one
iteration after introducing it.

**VERIFIED.** 2041/2041 repo tests green, typecheck + lint clean, the
production build serving `/encore`, the seed's drift gate pinning all
five receipts field-by-field.

## Checkpoint 4 — the learning pipeline

**DONE.** The failure→learning ledger: **F14–F19** in
[`validation-log.md`](../benchmarks/website-excellence-round/validation-log.md)
— the critic's own light-scheme blind spot (F14, found by its first real
run), the lib session's first-cut defects (F15), the OOM build protocol
(F16), the 42px overflow (F17, found by the loop not any human), the
contrast fix that broke the light theme (F18 — the loop catching its own
fix one iteration later), the zombie-server environment trap (F19). The
specialised-agent evaluation: the Design Critic persona is the one that
shipped, and its contribution is measured (the calibration receipt: 1.5
known-bad vs 6.4 real, every axis discriminating); the other persona
candidates are recorded in the gap analysis as not-yet-justified by
evidence. Retained learning: AutoDream consolidated this round's session
notes into the tracked project memory (the sibling-inspection rule for
new app dirs, the happy-dom origin quirk — rendered into
`.unown/memory/project.md` while the round ran; the full diff rides the
release commit).

**VERIFIED.** Every F-entry names its reproduction, root cause, fix,
benchmark and rerun evidence; the memory re-renders are committed with
the release.

## Checkpoint 5 — landing, docs, release

**DONE.** The gallery's eighth entry (17 sessions, 513 tool calls, 24
files, 125 tests, zero human edits), the CSP block, the poster via the
media lane, the demo-session receipt doc, the blog post with real media,
the CHANGELOG entry, the version bump to **0.0.42**, the regenerated
changelog rail + blog data + feed + OG shots, the DOX pass (README table,
docs/AGENTS.md, scripts/AGENTS.md, benchmarks/AGENTS.md), the F19
zombie-server protocol. All gates green at release time: 2041/2041 unit,
15/15 e2e, typecheck, lint, check:docs (86 files), check:changelog (40
stops), check:blog (24 posts), check:benchmarks, check:claims (63
literals), instruction-chars (46 files, 0 findings), the OG palette gate.
Released as **v0.0.42** — the six per-OS binaries through the release
workflow.
