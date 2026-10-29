---
title: "The craft axes: teaching the agent to see what elite pages never do"
description: "The second Website Excellence round: nine elite sites from production CSS, six new enforceable critique gates, and the app that passed on iteration three."
date: 2026-10-30
lastmod: 2026-10-30
tags: [website-excellence, design, critique]
type: feature
media: []
---

The first Website Excellence round taught unown to *critique* its own
design output: screenshot, audit, score, fix, re-score, receipt. The
second round — shipped today — taught it to see the things elite pages
never do, and to refuse them at gate time.

## What the nine-site sweep found

The round's research base reads Apple, Airbnb, Notion, Framer,
Raycast, Resend, Anthropic, Mercury and Attio from their **live
production CSS** — the actual token values, not blog posts about them.
The pattern that falls out is stricter than any style guide:

- **Type ramps are closed and small.** Apple ships 11 sizes on its
  homepage across 3 weights; Framer 9 sizes across 2. Attio's rendered
  census: 313 medium-weight elements, **one** bold. The elite weight
  ceiling is 600 — bold is the amateur's emphasis.
- **Display type tightens as it grows** — mechanically. Apple tunes
  letter-spacing per size; Notion ships a fluid clamp that tightens
  tracking to −0.048em at 96px. Below 28px, tracking goes slightly
  positive; at captions, negative again.
- **Neutrals are tinted, never pure.** Anthropic's ivory ramp shares
  one warm hue across all ten grays; Mercury's ink is a blue-black
  `#272735`. Two-hue grays read as two designs stitched together.
- **Exactly one accent.** Apple `#0071e3`, Raycast `#ff6363`,
  Framer `#0099FF`, Anthropic clay `#d97757` — one accent plus at most
  one interactive variant, everywhere.
- **Motion is compositing-only and quiet.** Linear's homepage runs 150
  hand-authored CSS keyframes and zero JS animation libraries. What
  died: particles, Lottie-on-marketing, cursor followers. What
  replaced them: restraint.

## The craft axes — research made mechanical

Each of those findings is now an objective gate in the design critic
(`scripts/design_critic.mjs`, receipt schema 2): a weight census with
a 600 ceiling, a tracking-vs-size curve over three bands, a
tinted-neutral hue-spread check (circular standard deviation ≤ 30°),
an accent-cluster census on interactive elements, an
animated-property whitelist (layout properties and `transition: all`
are violations), a breakpoint census, and a reduced-motion guard that
must exist wherever keyframes do.

Every threshold is cited in the
[research doc](https://github.com/kanishka-namdeo/Unown/blob/main/docs/website-excellence-research-2.md).
And the axes discriminate both ways: the landing page passes every
craft gate, while the known-bad calibration fixture still fails (it
ships weight 700 — the census catches it).

The axes' first run against the real landing found two genuine
defects minutes after landing: the benchmark HP bars animated `width`
(a layout property), and the first gallery app shipped four
`transition[-]all`s. Both fixed — the fill now rides `scaleX()` on a
full-width element, identical stepped drain, compositor-only.

## Ledger — the validation app

Every capability needs a benchmark. The round's is
[Ledger](https://unown-nine.vercel.app/ledger): a warm-paper fintech
treasury dashboard, deliberately opposite to the landing's dark
Game-Boy aesthetic — the proof the gates hold across design languages.

Its critique loop, receipted iteration by iteration:

| Iteration | Verdict | What the tooling caught |
|---|---|---|
| v0 | FAIL | 132 contrast violations; 252px mobile overflow; a weight census tripped by sr-only table defaults; a chart spike flattening its series |
| iter1 | FAIL | A render-order crash (the audit measured an error shell) — and a **persona bug**: the VLM judge, pinned to the landing's brand, dinged a warm-paper app for not being dark-first |
| iter2 | FAIL | 2 gates left — and the round's own F24 receipt had re-emitted a banned utility through Tailwind's repo-wide scanner (the F20 trap, again) |
| iter3 | **PASS** | `--enforce`, exit 0: contrast 0, 8 type sizes, 0% off-grid, VLM 7.0–8.23, every craft axis green |

The persona bug became the critic's `--brand` flag — the judge follows
the design language, never the reverse. The receipt trap became
ledger entry F25 with a write-time rule: the defusal happens when the
prose is written, not as a gate-time follow-up.

## The rest of the round

The release that shipped while its own CI was red (v0.0.42 — the
e2e lane had failed, the release notes said "all gates green") closed
as F21: every release job now depends on a `ci-green` gate that
resolves CI's conclusion for the tagged SHA and refuses to mint
artifacts otherwise. Six website skills (landing-page-architect,
design-system-generator, ux-reviewer, accessibility-auditor,
motion-designer, frontend-craftsman) and four specialist agents
(design-reviewer, ux-critic, a11y-auditor, performance-engineer) are
committed where every future session picks them up.

The full paper trail — the session log, the gap analysis, the
validation log with every failure ledgered — is linked from the
[docs](https://github.com/kanishka-namdeo/Unown/tree/main/docs).
Every number in this post is checkable against a committed receipt;
that remains the only kind of number this project ships.
