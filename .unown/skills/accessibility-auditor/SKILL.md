---
name: accessibility-auditor
description: Use when auditing any built page for accessibility — WCAG 2.2 AA conformance, semantic quality, keyboard operability, motion safety, and screen-reader experience. The zero-tolerance layer.
---

# Accessibility Auditor

The law layer: these gates are zero-tolerance, not budgetary. WCAG 2.2 AA is
the floor; the craft here is making conformance invisible.

## The audit order

1. **Automated first, both schemes, both motion states:**
   `bunx playwright test <the a11e specs>` where the repo ships them, and
   `node scripts/design_critic.mjs --route <route> --label a11y --no-vlm` —
   the contrast gate measures every visible text node against its composited
   background (alpha is computed through, never assumed). Zero violations.
2. **Keyboard walk:** Tab through the ENTIRE page top to bottom. Every
   interactive element must: be reachable, show a visible `:focus-visible`
   ring with MORE contrast than its rest state, respond (Enter/Space/
   arrows per its ARIA pattern), and never trap focus. Tab order follows
   DOM order; if the visual order diverges, the DOM is wrong.
3. **The heading outline:** `document.querySelectorAll("h1,h2,h3,h4,h5,h6")`
   — exactly one h1, no skipped levels (h1→h3 is a broken outline), and
   headings that describe their section's content, not its styling. The
   critic's heading gate enforces the skips; read the words yourself.
4. **Semantics over divs:** landmarks (nav/main/section/footer with
   aria-labels where ambiguous), real buttons for actions / real links for
   navigation (never div-with-onClick), lists as lists, tables for data.
   Landmark count small; every landmark earn its name.
5. **Images and media:** every `<img>` has an alt (empty if decorative —
   decorative is a decision, not an omission); complex imagery has a
   caption or aria-describedby; video never autoplays with sound; any
   motion >5s has pause/stop/hide.
6. **Motion safety:** every animation needs a
   `prefers-reduced-motion: reduce` variant that lands content in its
   finished state (the opt-in pattern — wrap motion blocks in
   `@media (prefers-reduced-motion: no-preference)`). Parallax, zooming and
   scroll-linked movement are the vestibular risks — they especially must
   gate. The critic's reduced-motion guard checks the media rule exists;
   YOU check the landed state is actually correct.
7. **Live regions and status:** async state changes (copy buttons, form
   saves, search results) announce via `role="status"`/`aria-live="polite"`
   — an icon swap alone is silent (WCAG 4.1.3). Exactly the live regions
   the page needs, no more.
8. **The screen-reader pass (the honest one):** with a real reader (or the
   most faithful available), navigate by landmarks, then headings, then
   Tab. Does the page tell its story without the pixels? The H1's
   textContent must be character-exact meaningful prose — it is the first
   thing announced and the thing search engines index.

## Findings format

`| SC | where | what fails | the fix |` — cite the success criterion. A
finding without its SC is an opinion; an SC without a failing element is
a checklist item, not a finding.

## Verification

- Re-run the automated pass: zero violations, both schemes.
- Re-run the keyboard walk: no traps, no invisible focus, no order surprises.
