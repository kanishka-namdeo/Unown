---
name: landing-page-architect
description: Use when building or restructuring a marketing landing page — section sequencing, hero anatomy, conversion flow, CTA placement and trust architecture. Grounded in the 2025-26 elite landing grammar (Linear, Stripe, Apple, Airbnb, Notion, Framer, Raycast, Resend, Anthropic, Mercury, Attio).
---

# Landing Page Architect

The structure of an elite landing page, as a build order. The evidence:
`docs/website-excellence-research.md` (Linear/Geist/Stripe) and
`docs/website-excellence-research-2.md` (the nine-site sweep) in this repo.

## Before laying out a section, answer three questions

1. **Who is this for and what do they do next?** One primary action per page.
   Every section either advances the argument or is cut.
2. **What is the product's honest hero?** Apple ships the product tile;
   Airbnb ships the search bar (H1 hidden); Raycast embeds the real app
   window; Notion ships a live workspace mock. The hero must contain the
   product or its real interface — never adjectives about it.
3. **What are the receipts?** Trust is quantified: Mercury puts "$1B
   annualized revenue, 4+ years profitable" in an H2 slot; Anthropic
   publishes the policy artifacts at nav level. Every claim on the page
   must carry a link or a number a visitor can check. No receipt, no claim.

## The section grammar (top to bottom)

1. **Nav** — wordmark, 4-6 links, exactly ONE filled action (the anti-crowding
   invariant: everything else link-styled). Nav CTA = the page's primary action.
2. **Hero** — one sentence argument (H1 ≤ 10 words), one sentence elaboration,
   the primary CTA + one secondary, and the product itself (screenshot, live
   embed, or real UI mock). No carousel, no particles, no video wall.
3. **Social proof strip** — logos or a count ("trusted by 30,000+") — only if
   checkable. Otherwise skip the section entirely.
4. **The argument, in 3-6 bands** — each band: one claim (H2, ≤ 12 words) +
   its proof (the product demonstrating the claim, a receipted number, or a
   before/after). Band patterns that work: feature trio, bento grid, tabbed
   walkthrough, code-block + explanation (for dev products: language tabs are
   a first-class section — Resend ships AI/Node.js/Serverless/Ruby).
5. **The objection handler** — FAQ or "the skeptic's questions", honest about
   limitations (collapsed answers keep the scroll budget).
6. **The record** — changelog/dates if the product ships ("is this a live
   project or a screenshot of one" — a dated rail answers).
7. **Finale** — the ask restated + the honest cost ("you have lost an
   afternoon"), never a false-urgency countdown.

## Conversion rules

- The primary CTA repeats at: nav, hero, finale. NOWHERE else — a CTA in
  every band is a wall of CTAs (the eight-label bar lesson).
- Secondary CTAs are link-styled, never filled.
- The first CTA is above the fold at 1440x900 AND at 390x844.
- Every CTA states its cost honestly ("Get started" → what actually happens).

## Verification

- Scroll past the page top-to-bottom: can you state the argument after one
  pass? Each band in one breath?
- `bun scripts/landing_audit.mjs` against the built page — the word/vh budget
  catches structure-by-accretion.
- `node scripts/design_critic.mjs --route <route> --label <label> --enforce`
  — the rubric's hierarchy/density axes gate the structure.
