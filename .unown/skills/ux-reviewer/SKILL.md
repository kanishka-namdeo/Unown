---
name: ux-reviewer
description: Use when evaluating a built page or flow for friction — hierarchy, readability, wayfinding, flow assessment, and conversion blockers. The review-layer procedure that runs before and after the visual critique.
---

# UX Reviewer

The flow review — what the visual critique cannot see. Run it on the built
page, as a user would meet it: cold load, top to bottom, then the primary
task.

## The review pass (record findings as you go, each with its evidence)

1. **The five-second test:** load the page, wait five seconds, look away.
   Can you state: what this is, who it's for, what to do next? If any of
   the three is gone, the hero failed — fix hierarchy before anything else.
2. **The one-pass argument:** scroll top to bottom once. Every section must
   advance ONE argument in order (claim → proof → next). Two sections making
   the same point = cut one. A section that only decorates = cut it.
3. **Scan patterns:** at 1440px, each band should read in Z or F without
   horizontal hunting. Check: does the eye land on the claim before the
   chrome? Is anything important only visible on hover? (Hover-gated
   content is invisible on touch — Stripe gates effects with
   `@media (hover: hover)` for exactly this reason.)
4. **Wayfinding:** where am I / what's here / where can I go — the nav's
   current-section state, the footer's completeness, deep links that land
   mid-page with scroll-mt so headings aren't beheaded.
5. **The task walk:** perform the page's primary task as a first-time user
   (sign up, run the install command, start the demo). Count the clicks,
   the context switches, the moments of doubt. Each doubt is a finding with
   the moment it occurred.
6. **Reading comfort:** body text 15-17px, line-height 1.5-1.6, measure
   45-75ch, paragraphs ≤ 4 sentences in marketing copy. Wall-of-text bands
   get subheads or bullets.
7. **The trust ladder:** claims → receipts → next step, in that order per
   band. An unreceipted superlative ("blazing fast", "battle-tested") is a
   finding: either attach the number/link or cut the adjective.
8. **Error and empty states:** if the flow has any (forms, demos, fetches),
   each one must say what happened + what to do next, in plain language.

## Output format

Findings as a table: `| # | where | finding | severity (P0 blocks the task /
P1 adds friction / P2 polish) | the fix |`. P0s first. Then the three
highest-leverage fixes in order — the same discipline the VLM critique's
"improvements" field uses.

## Verification

- Re-run the task walk after fixes; the doubt count must drop.
- `node scripts/design_critic.mjs --route <route> --label ux-pass` — the
  density/hierarchy axes corroborate the structural findings.
