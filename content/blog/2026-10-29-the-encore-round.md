---
title: "The encore round: an agent that critiqued its own design work, then beat its own gates"
description: "The gallery's eighth app, built inside a measured design loop — every screenshot scored, every failure ledgered, every number traced to a receipt."
date: 2026-10-29
lastmod: 2026-10-29
tags: [landing, demo]
type: feature
media: [/blog/2026-10-29-the-encore-round/hero.png, /blog/2026-10-29-the-encore-round/iterations.png, /landing/encore/poster.png]
---

The first seven gallery apps asked whether the agent could carry a whole
SDLC. This round asked the question that decides whether any of it
scales: **can the agent tell that its own work is not good enough yet —
with numbers, not vibes — and then fix what the numbers say?**

Short answer: the loop shipped. It found **23 font sizes** and **32.7%
off-grid spacing** on a page six rounds of polish had produced, caught a
**42px mobile overflow** its own writing sessions had introduced, caught
a **contrast fix that broke the light theme** one iteration after the
fix landed, and drove its own flagship to **every objective design gate
green**. The gallery now frames **eight** agent-built apps.

## The instrument came first

The round began by building the thing the platform lacked: a critique
lane that produces **receipts**, not opinions.
[`scripts/design_critic.mjs`](https://github.com/kanishka-namdeo/Unown/blob/main/scripts/design_critic.mjs)
runs against any route of the production build — per-band and full-page
screenshots at desktop and mobile, an objective in-page audit (WCAG
contrast on every visible text node against its composited background, a
type-scale census, 4px-grid conformance, heading order, alts, overflow),
cold-load FCP/LCP/CLS/TBT, and a strict-JSON seven-axis VLM critique
through the Agnes lane — aggregated into one committed receipt per run.

A judge that cannot discriminate is worthless, so the lane ships with a
known-bad calibration fixture — eleven ad-hoc type sizes, arbitrary odd
spacing, sub-AA greys, an h1→h4 skip. The fixture scores **1.5**; the
real landing page scores **6.4**. The judge discriminates.

Then the first receipt landed, and it was uncomfortable: the landing
page — six rounds of agent-built polish — resolves to **23 distinct font
sizes** (the elite baseline is about seven) and **32.7% off-grid
spacing**. The deliberately-chaotic calibration fixture uses ten sizes.
Our real page was less disciplined than a page designed to be bad.

## The flagship

**Encore** — the earned performance — is the gallery's eighth app, live
at [`/encore`](https://unown-nine.vercel.app/encore): a showcase, not a
SaaS domain, whose content is this round's own measured story. The
baseline receipt card (the honest 6.40/10 with its failing gates). The
critique loop as an interactive stepper. The tool cards. The failure
ledger. And the centerpiece: a **before/after drag comparison** between
the landing page's baseline hero and the flagship's final hero — the
program's success question rendered as a slider.

It was built by the agent across **17 ledgered sessions** (459 turns,
513 tool calls, zero human edits to app code), phase by phase from its
own 192-line build contract — the design system pinned before a line of
UI existed: an eight-size type ramp, the 4/8px spacing grid, both
schemes WCAG-AA, the 390px covenant, motion 150/250/400ms behind
`prefers-reduced-motion`.

![The encore hero — the axis-score strip animating the baseline means](/blog/2026-10-29-the-encore-round/hero.png)

## The loop, in receipts

Every iteration of the flagship was critiqued by the same instrument,
and the receipts are committed:

| Run | VLM overall | Font sizes | Off-grid | Contrast (dark / light) | Overflow |
|---|---|---|---|---|---|
| the landing baseline | 6.40 | 23 | 32.7% | 0 / unaudited | 0px |
| iter0 — first build | 6.27 | 6 | 0% | 0 / 0 | 42px |
| iter1 | 6.00 | 6 | 0% | 0 / 0 | 42px |
| iter2 | 6.00 | 6 | 0% | 0 / 27 | 0px |
| iter3 — final | 6.22 | **6** | **0%** | **0 / 0** | **0px** |

The trajectory of the OBJECTIVE gates is the story: the discipline the
baseline lacked (type scale, spacing grid) held from the very first
build — because the plan enforced it — while the loop caught and fixed
what the writing sessions could not see: the 42px mobile overflow (an
`sr-only` data table whose layout box the scoped table CSS re-expanded
past the viewport), and the round's favorite failure — a contrast fix
that pinned its colors "under any scheme" and broke the light theme for
**27 text pairings**, caught by the both-scheme audit one iteration
later, fixed by inheriting the landing's own dual-declared tokens.

![The iterations band — the before/after comparison and the delta table](/blog/2026-10-29-the-encore-round/iterations.png)

And the honest part, on the record: the VLM overall (6.22) did **not**
clear the 7.0 floor, and sits within a single judge's variance band.
The objective gates are laws and they pass; the aesthetic floor is a
goal and it stays open. The showcase says exactly that — no number
without its receipt, no spin on the ones that hurt.

## What the platform keeps

The round's failures are ledgered (F14–F18 in the
[validation log](https://github.com/kanishka-namdeo/Unown/blob/main/benchmarks/website-excellence-round/validation-log.md)),
and each one left a permanent artifact behind:

- the **critique lane** with its both-scheme audit (the judge's own
  light-scheme blind spot was the fourteenth failure it caught — its
  first run photographed only the light theme and nobody noticed until
  the receipts described "off-white backgrounds" on a dark-first page);
- the **calibration fixture** — the judge's discrimination pinned by a
  receipt, not asserted;
- the **seed drift gate** — the showcase's every number tied to its
  committed receipt by a test that reads the JSON and compares
  field-by-field;
- the project memory AutoDream consolidated from the build's own session
  notes — the sibling-inspection rule, the happy-dom origin quirk —
  already rendered into `.unown/memory/project.md` for the next round's
  sessions to inherit.

The primary success question — *would a restarted project, using the
improved platform, create a significantly better website than it could
have at the beginning?* — now has a measured answer. At the beginning:
23 font sizes, 32.7% off-grid, no instrument to see either. After: a
first build that lands at 6 sizes and 0% off-grid **because the contract
and the critique loop exist**, with every failure it introduces caught
by a receipt, not a reviewer.

That is the encore: the performance after the performance. The next one
starts from these receipts.
