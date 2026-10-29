# The Website Excellence Round

> The Website Excellence Program's benchmark home: the critique harness
> contracts, the rubric with its cited thresholds, and the committed receipts
> every UI iteration produces — the measured evidence that Unown's website
> output improves because of what this round builds. The program's success
> question is answerable only from these receipts: *"would a restarted project,
> using the improved Unown, create a significantly better website than it could
> have at the beginning?"*

- [The method](#the-method)
- [The rubric](#the-rubric)
- [The receipts](#the-receipts)
- [The baseline (2026-10-29)](#the-baseline-2026-10-29)
- [The critic calibration](#the-critic-calibration)
- [Honest limitations](#honest-limitations)

Related: [`../../docs/website-excellence-session.md`](../../docs/website-excellence-session.md)
(the round's checkpoint log) · [`../../docs/website-excellence-research.md`](../../docs/website-excellence-research.md)
(the design knowledge base) · [`../../docs/website-excellence-gap-analysis.md`](../../docs/website-excellence-gap-analysis.md)
(the capability audit) · [`../nocturne-round/`](../nocturne-round/) (the prior
gallery round, whose F10/F11 entries this round's baseline found).

## The method

Every significant UI iteration runs the critique loop
([`scripts/design_critic.mjs`](../../scripts/design_critic.mjs)):

1. **Build** — the production standalone build; the critic refuses to audit a
   dev server (HMR and on-demand compilation are not what visitors get).
2. **Capture** — per-band + full-page screenshots at desktop 1440×900 and
   mobile 390×844, under `prefers-reduced-motion: reduce` (the settled
   base-state-finished rule: a reveal that never resolves must show up as a
   blank frame, not as an opinion).
3. **Objective audit** — in-page, no LLM: WCAG contrast on every visible text
   node against its composited background, the type-scale census, the 4px-grid
   conformance of block spacing, heading order, image alts, mobile horizontal
   overflow.
4. **Vitals** — cold-load FCP / LCP / CLS / TBT from buffered
   PerformanceObservers installed at document start.
5. **VLM critique** — every screenshot scored 0–10 on seven axes by
   `agnes-3.0-flash` through the local llm-bridge (strict JSON, one retry on
   parse failure — the iterative-refinement recipe at one step), plus concrete
   defects and the three highest-leverage improvements.
6. **Receipt** — one JSON per run in `critiques/`: the audit, the vitals, every
   per-shot critique, the per-axis means, and the rubric verdict. **A run
   without a receipt never counts; a score without a pixel ground-truth is an
   opinion.**

## The rubric

Machine-readable inside the script (`RUBRIC`), documented with citations in
[`rubric.md`](rubric.md). The gates:

| Gate | Threshold | Source |
|---|---|---|
| WCAG contrast violations | 0 | WCAG 2.2 AA SC 1.4.3/1.4.11 — the law |
| Distinct font sizes | ≤ 8 | the elite census (Linear ~7 text steps) |
| Spacing off the 4px grid | ≤ 15% | Carbon 2× grid; the baseline measured 32.7% |
| Heading skips | 0 | document order is a contract |
| Missing image alts | 0 | WCAG 1.1.1 |
| Mobile horizontal overflow | 0 px | the 390px covenant |
| FCP / LCP / CLS / TBT | ≤1.8s / ≤2.5s / ≤0.1 / ≤200ms | Core Web Vitals "good" band |
| VLM axis means (7 axes) | ≥ 7.0 | the elite floor, calibrated below |

## The receipts

`critiques/<timestamp>-<label>-<route>.json`, schema
`website-excellence/critique/1`. Committed. The comparison unit for
before/after evidence is the receipt pair (same route, `label` tells the
story: `baseline` → `iter1` → … → `final`). Screenshots themselves land in
gitignored `download/design-critic/<label>/`; the curated before/after
evidence that ships on the landing page is staged into `public/` through the
media lanes, never by committing the scratch dir.

## The baseline (2026-10-29)

The landing page at commit `89535c6`, label
[`baseline`](critiques/20261029-145746-baseline-root.json):

| Axis | Mean | | Objective | Value |
|---|---|---|---|---|
| hierarchy | 6.50 | | contrast violations | 0 (min 5.95:1) |
| typography | 6.79 | | distinct font sizes | **23 (FAIL)** |
| spacing | 6.08 | | off-grid spacing | **32.7% (FAIL)** |
| color | 7.25 | | heading skips | 0 |
| alignment | 7.19 | | missing alts | 0 |
| density | 6.71 | | mobile overflow | 0px |
| overall | **6.40** | | FCP/LCP/CLS/TBT | 276ms / 276ms / 0 / 61ms |

Rubric: FAIL (type scale + spacing grid + five VLM axes under the floor).
The VLM defect tally's top themes — "massive, empty pastel color blocks",
"establish a strict 8pt or 12pt spacing grid to replace the chaotic"
spacing, alignment drift between headline and subhead — corroborate the
objective audit independently. That corroboration is the pixel-ground-truth
pattern doing its job.

## The critic calibration

A judge that cannot discriminate is worthless, so the VLM lane is calibrated
against a known-bad fixture
([`scripts/design_critic_calibration.html`](../../scripts/design_critic_calibration.html)
— 11 ad-hoc type sizes, arbitrary odd spacing, sub-AA greys, an h1→h4 skip,
an alt-less image). Result
([`critiques/20261029-145834-calib-bad-root.json`](critiques/20261029-145834-calib-bad-root.json)):
overall **1.5** vs the real page's **6.4** — a 4.9-point separation, every
axis 1.0–2.5, 26 contrast violations, 100% off-grid. The honest headline the
calibration surfaced: the fixture's deliberate chaos (10 distinct sizes) is
MORE disciplined than the real landing page's 23. The judge is not
sycophantic; the page has work to do.

## Honest limitations

- **Vitals are localhost-cold-load numbers**, not field CrUX: no network, no
  CDN, no device variance. They gate regressions, not the absolute visitor
  experience; the deploy-verify lane and Vercel analytics own that truth.
- **The VLM scores are one model's opinion**, single pass with one refinement
  retry, not a panel. The calibration pins that the opinion discriminates;
  it does not make it objective — which is why the objective audit rides in
  the same receipt and the rubric needs both.
- **The type census counts computed px** — responsive variants and em-derived
  roundings each count. That is deliberate: a visitor's browser resolves the
  cascade to exact pixels, and 23 distinct resolved sizes is what they get.
- **Band splitting is heuristic** (`main > section` + heading labels); a page
  built differently needs `--full-only` or a band selector of its own.
- **TBT under `--no-vlm` quick passes** still boots the real build; the
  audit is never run against a dev server.
