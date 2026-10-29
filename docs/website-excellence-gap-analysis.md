# The Website Excellence gap analysis — what Unown could not do, and what this round built

> The Phase 2 capability audit, conducted 2026-10-29 at commit `89535c6`:
> for every capability a world-class website-creation platform needs, what
> existed before this round, what was missing, what got built, and what
> honestly remains open. This is the Tool Gap Analysis deliverable — the
> roadmap section at the end is the commitment ledger.

- [The audit method](#the-audit-method)
- [Design intelligence — evaluating visual quality](#design-intelligence--evaluating-visual-quality)
- [Visual understanding — inspecting and comparing screens](#visual-understanding--inspecting-and-comparing-screens)
- [Frontend excellence — the execution baseline](#frontend-excellence--the-execution-baseline)
- [Design systems — reusable foundations](#design-systems--reusable-foundations)
- [The tool inventory — before and after](#the-tool-inventory--before-and-after)
- [The specialised agents](#the-specialised-agents)
- [The roadmap — what stays open](#the-roadmap--what-stays-open)

Related: [`website-excellence-session.md`](website-excellence-session.md) (the
round log) · [`website-excellence-research.md`](website-excellence-research.md)
(the design knowledge base) ·
[`../benchmarks/website-excellence-round/README.md`](../benchmarks/website-excellence-round/README.md)
(the benchmark contracts) · [`landing-research.md`](landing-research.md) (the
landing page's own rationale doc).

## The audit method

Walked the capability questions against the actual checkout at `89535c6`:
every claim below is `[V]`-tier (verified against a file, a script, a test or
a live run in this round), or explicitly marked open. The unit of analysis is
the platform a website-building session has access to: its tools, its gates,
its memory, its benchmark lanes — not the quality of any single page, which
the baseline receipt already measures.

## Design intelligence — evaluating visual quality

**Before.** Unown could *measure* two things: WCAG contrast per text node
(`scripts/contrast_audit.mjs`, both schemes, exit-on-fail) and scroll/text
density (`scripts/landing_audit.mjs`). It could *opine* in free text
(`scripts/agnes_review.mjs` — "a reviewer's aid, not a gate": VERDICT/DEFECTS/
IMPROVE prose, no scores, no receipts, no aggregation, no comparability
between runs). It could NOT: score a page on axes, detect type-scale
sprawl, measure grid conformance, compare iterations objectively, or gate a
session's output on visual quality. The proof it could not: the landing page
— six rounds of agent-built polish in — resolved to **23 distinct font sizes
and 32.7% off-grid spacing**, and no lane in the repo could see either
number.

**This round.** `scripts/design_critic.mjs` (the critique driver):
objective audit + vitals + scored VLM critique in one receipted run against
any route of the production build; per-axis means comparable across labels;
`--enforce` for gating. Calibration fixture + receipt prove the judge
discriminates (1.5 vs 6.4 on the same axes).

**Still open.** Aesthetic *preference* learning (the critic judges against a
fixed rubric; it does not yet learn the brand's own taste from past accepted
pages). Motion-quality critique (durations/easings judged from video frames —
the TUI lane has `audit_video.py` doing exactly this for terminal captures;
the web lane has no twin yet).

## Visual understanding — inspecting and comparing screens

**Before.** The agent stack itself has real vision: the `browser` session
tool drives Chromium over CDP and takes vision screenshots (docs/browser.md),
and the bridge passes `image_url` parts through to the VLM (the very lane
`agnes_review.mjs` uses). The landing lanes screenshot sections both schemes
+ reduced-motion (`landing_shots.mjs`). But nothing compared two screenshots
(no pixel-diff engine), nothing detected visual regressions between builds,
and every screenshot lane was landing-page-only — a gallery app route could
not be captured without writing a new script.

**This round.** The critic generalizes capture to ANY route (or any local
HTML file) at two viewports with per-band splitting; receipts make runs
comparable (axis means + objective gates), which is comparison at the
measurement layer — the layer that matters for iteration. Before/after
evidence is now a receipt pair, not an album.

**Still open.** True pixel-diff regression testing (playwright's
`toHaveScreenshot` or a pixelmatch lane pinned against committed baselines —
deliberately not built this round: the repo's media philosophy is
append-only curation, and a pixel-diff gate needs a flakiness budget + a
baseline-refresh protocol that deserve their own round). Screenshot
comparison *inside* a live agent session (the browser tool can screenshot;
wiring a critique call per screenshot is a prompt-layer feature, not a
platform gap).

## Frontend excellence — the execution baseline

**Before.** Strong, with receipts: Next.js 16 + React 19 + Tailwind 4 +
shadcn-style primitives + framer-motion in the landing stack; 1909 unit
tests; 15 e2e specs (axe a11y two motion passes, SEO surface, scroll budget,
dex video); CI lint/typecheck/build/coverage on three OSes. The gaps the
baseline exposed were not stack gaps but *discipline* gaps the gates could
not see (type scale, spacing grid) — plus two process gaps F10/F11 exposed:
the round closeouts that shipped a red build and lint errors to main because
no local pre-push checklist enforced them.

**This round.** The discipline gaps now have gates (the rubric); the process
gap has the pre-push checklist (typecheck + lint + unit + build before every
push, adopted as the round's CP0 contract); the vitals lane adds the perf
dimension Lighthouse owns in CI-pending state (ci.yml line ~660 records
Lighthouse as "not in CI yet" — the critic's vitals receipts are the
lab-proxy stopgap, and the receipted numbers make the future Lighthouse job
a drop-in).

**Still open.** Real Lighthouse in CI (needs a runner strategy + a score
budget policy — the receipts here make that decision data-driven instead of
vibes). Bundle-size budget gate. Component-level visual tests for the
gallery apps.

## Design systems — reusable foundations

**Before.** The landing page has a real token system (the GBA 5-bit palette
gate `gba_palette_check.mjs`, dual-declared schemes, `--color-canvas`
assertions) — but it is a *page* system, not a *platform* system: a new
gallery app (nocturne, aria…) starts from Tailwind defaults + per-app
globals.css with no shared type ramp, no shared spacing tokens, no shared
motion duration/easing contract. Each app re-derives craft; the baseline's
23-size sprawl is partly this — no shared scale to inherit.

**This round.** The research doc's synthesis tables (canvas ramp, type ramp,
spacing tokens, motion durations, section grammar, perf gates, QA gates) are
the platform-level design foundation, expressed as the rubric the critic
enforces — a system any future app session inherits by being measured
against it.

**Still open.** A `design-tokens.ts` shared module the apps import (the
rubric measures conformance; it does not yet provide the tokens as code —
deliberate: measure first, then codify what the passing pages converge on).
Icon system beyond lucide. Dashboard/SaaS/enterprise layout presets.

## The tool inventory — before and after

| Capability | Before `89535c6` | After this round |
|---|---|---|
| WCAG contrast audit | per-text-node, both schemes, exit-on-fail (`contrast_audit.mjs`) | unchanged (still the law's owner) — the critic consumes the same standard |
| Scroll/density budget | `landing_audit.mjs` + e2e twin | unchanged |
| Section screenshots | landing-only, both schemes, reduced-motion | any route/file, two viewports, per-band (`design_critic.mjs`) |
| Type-scale census | — | computed-size census + ≤8 gate |
| Spacing-grid audit | — | 4px-grid conformance + ≤15% gate |
| Heading order / alts | axe e2e (landing) | any-route in-audit gates |
| Core web vitals | — (Lighthouse explicitly not in CI) | cold-load FCP/LCP/CLS/TBT receipts |
| VLM critique | free-text aid, no receipts | strict-JSON 7-axis scored critique, per-shot, aggregated, receipted |
| Before/after evidence | album curation | receipt pairs (same schema, comparable) |
| Critic calibration | — | known-bad fixture + separation receipt |
| Visual regression pixel-diff | — | open (see roadmap) |
| Motion critique | TUI lane only (`audit_video.py`) | open (see roadmap) |

## The specialised agents

The round evaluated the specialised-agent question the way the program
demands — quantitatively, on the one agent that ships this round:

- **The Design Critic** (the VLM persona in the critic): calibrated —
  known-bad 1.5 vs real 6.4 (4.9-point separation, every axis 1.0–2.5 on the
  fixture); retained as the rubric's scoring lane. Its contribution is
  measured, not asserted: the baseline defect tally's corroboration by the
  objective audit is in the receipt.
- **The Creative Director / Senior Designer / Motion Designer / Brand
  Strategist personas**: not shipped as separate agents — the evidence does
  not yet justify them. The critic persona subsumes the designer-review
  function; the others need a workload that a single well-prompted lane
  cannot cover before they earn their own processes (the repo's own
  subagent-cost precedent: retain only agents that provide measurable
  value).
- **The Accessibility Auditor**: already exists as infrastructure (axe-core
  e2e + contrast audit) — an agent persona would duplicate a solved gate.

## The roadmap — what stays open

1. **Pixel-diff visual regression** — baselines, flakiness budget, refresh
   protocol; owner: a future round with CI-runner time to burn.
2. **Motion critique lane** — port `audit_video.py`'s frame-sampling pattern
   to web routes (critique 5 evenly-sampled frames of a scroll capture).
3. **Lighthouse in CI** — the vitals receipts are the decision data; a score
   budget policy follows from them.
4. **`design-tokens.ts`** — codify the converged token set as the shared
   module apps import.
5. **Aesthetic-preference learning** — the critic learns the brand's
   accepted-page history (a Mem0 memory lane seeded from passing receipts).
6. **In-session critique wiring** — the browser tool's screenshots flowing
   through the critique prompt so a live session self-critiques without the
   operator driving the loop.
