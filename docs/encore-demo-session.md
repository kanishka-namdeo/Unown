# The encore demo session — the Website Excellence showcase

> The receipt behind the gallery's eighth app: the Website Excellence
> Round's own story as an elite-grade showcase — built by the agent across
> 17 ledgered sessions with the critique loop as the QA gate, every number
> on the page traced to a committed receipt. Status: closed at v0.0.42.

- [What the app is](#what-the-app-is)
- [The naming receipt](#the-naming-receipt)
- [How it is built](#how-it-is-built)
- [The critique loop — the receipts](#the-critique-loop--the-receipts)
- [The checkpoints](#the-checkpoints)
- [Where things live](#where-things-live)

Related: [the round's session log](website-excellence-session.md) ·
[the plan](../benchmarks/website-excellence-round/plan.md) ·
[the validation log (F14–F18)](../benchmarks/website-excellence-round/validation-log.md) ·
[the rubric](../benchmarks/website-excellence-round/rubric.md) ·
[the research](website-excellence-research.md)

## What the app is

Encore is a **showcase, not a SaaS domain** — the one gallery app whose
content is the platform's own measured evolution. Seven bands: the hero
(the axis-score strip animating the baseline), the baseline receipt card
(the landing page's honest 6.40/10 with 23 font sizes and 32.7% off-grid
spacing), the critique loop as an interactive stepper, the **before/after
drag comparison** (the landing baseline hero vs the encore final hero —
the program's primary success question as a slider), the tool cards (the
design critic + the calibration fixture), the F-ledger (every failure a
benchmark), and the finale (the success question and its answer).

The design bar was the round's research synthesis — the Linear/Geist/
Stripe craft baseline applied through the Unown brand's existing token
system, never a new palette: an 8-size type ramp (the built page resolves
to 6), the 4/8px spacing grid (0% off-grid at 58 sampled values), both
schemes WCAG-AA clean, the 390px covenant, motion 150/250/400ms behind
`prefers-reduced-motion`.

## The naming receipt

The gallery's musical-term convention continues: **encore** — the
performance after the performance, the one you have to EARN. The eighth
app is built by everything seven apps of practice taught the platform,
and its content is the proof that the practice paid. Collision check:
Adobe Encore (DVD authoring, discontinued 2014 — different domain,
different decade), encore.org (a nonprofit), no dev-tool/AI-space
collision, and lexically distinct from all seven siblings (focus,
bazaar, cadence, parley, fugue, aria, nocturne — "encore" shares no stem
with "cadence").

## How it is built

| Phase | Session(s) | Turns | Result |
|---|---|---|---|
| Plan | e1-plan | 29 | the 192-line 8-section build contract ([plan.md](../benchmarks/website-excellence-round/plan.md)) |
| Lib | e2-lib + e2-fix | 55 | 4 modules + the drift gate, 70 tests green |
| UI bands 1–3 | e3-ui + e3-fix | 70 | the frame, hero, baseline, loop + 24 tests |
| UI bands 4–7 | e4-ui + e4-fix | 70 | iterations (the slider), tools, failures, finale + tests |
| Critique loop | operator + e5–e8 | 132 | iter0 → iter3 receipts; overflow, light-scheme, contrast fixed |
| Seed wiring | e9-seed ×3 | 74 | the five-receipt trajectory in the seed, drift gate grown |
| Landing | e10-landing | — | the gallery entry, CSP block, poster lane |

Operating procedure: headless `unown -p` through the detached launcher
(the gallery F0/F2 contract), `--max-turns` caps, resume chains on caps,
one commit per phase, the critique loop (`node scripts/design_critic.mjs`)
between phases as the QA gate, zero human edits to app code. Every resume
was fed a precise diagnosis (the nocturne round's F9 lesson, applied).

## The critique loop — the receipts

The receipts live in
[`critiques/`](../benchmarks/website-excellence-round/critiques/) and the
drift gate (`src/lib/encore/seed.test.ts`) pins all five field-by-field:

| Run | Overall | Font sizes | Off-grid | Contrast dark/light | Overflow |
|---|---|---|---|---|---|
| the landing baseline | 6.40 | 23 | 32.7% | 0 / unaudited | 0px |
| iter0 | 6.27 | 6 | 0% | 0 / 0 | 42px |
| iter1 | 6.00 | 6 | 0% | 0 / 0 | 42px |
| iter2 | 6.00 | 6 | 0% | 0 / 27 | 0px |
| iter3 | 6.22 | 6 | 0% | 0 / 0 | 0px |

The headline the receipts tell: every OBJECTIVE gate passes on the final
build — the discipline the landing baseline lacks — while the VLM overall
(6.22 vs the landing's 6.40) sits inside the single-judge variance band
(the floor of 7.0 stays the program's open goal; the honest framing is on
the page itself). The loop's own failures are ledgered as F14–F18,
including the judge's light-scheme blind spot (F14) and the loop catching
its own fix's regression (F18).

## The checkpoints

- **CP0** — the baseline: the landing page receipted at 6.40/23/32.7%;
  the critic calibrated (known-bad 1.5 vs real 6.4).
- **CP1** — the plan: 8 sections, the design system pinned BEFORE a line
  of UI existed (the discipline gates held from the first build).
- **CP2** — the lib: the drift gate reading the real receipts; two
  first-cut defects (F15) fixed in one fed-diagnosis resume.
- **CP3** — the UI: 7 bands, 55 component tests, the F3 hydration pin,
  the native-range slider.
- **CP4** — the loop: four iterations, 42px overflow → 0, the light
  scheme broken by a fix then repaired (F18), all objective gates green.
- **CP5** — the landing: the gallery's eighth entry, the poster, the
  scroll budget reconciled.

## Where things live

- `src/lib/encore/` — the domain (types, seed, stats, format) + the drift
  gate that reads the committed receipts
- `src/components/encore/` — the shell, the primitives, the seven views,
  the component suite
- `src/app/encore/` — the route (the `?embed=1` server-side read, the
  scoped tokens, no API routes by design)
- `public/landing/encore/` — the favicon, the before/after iteration
  shots, the poster
- `benchmarks/website-excellence-round/` — the plan, the receipts, the
  session envelopes, the validation log, the rubric
- `scripts/design_critic.mjs` + `scripts/design_critic_calibration.html` —
  the critique lane and its known-bad anchor
