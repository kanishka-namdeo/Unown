---
name: design-system-generator
description: Use when starting any website or app UI from scratch — generate the type ramp, color tokens, spacing scale and radius ramp BEFORE writing components. The ten enforceable rules from the two research bases (docs/website-excellence-research*.md).
---

# Design System Generator

Generate the system first; components inherit it. The evidence base is the
nine-site sweep (`docs/website-excellence-research-2.md`) + Linear/Geist/Stripe
(`docs/website-excellence-research.md`). Every rule below is enforced by the
craft axes of `scripts/design_critic.mjs` — generate a system that passes
them and the critique loop starts green.

## The procedure (in order, all values as CSS custom properties)

1. **Pick the voices (≤ 3 families):** one workhorse sans (Inter and its
   display cut, or a characterful grotesk), OPTIONAL one serif/character
   display (the editorial contrast voice), one mono (the numbers-don't-lie
   voice). Self-host woff2. Weights: **400, 500, 600 ONLY** — the weight
   ceiling is 600 and ≤ 4 distinct weights, enforced.
2. **The type ramp — closed and small:** 6-8 body sizes (12→17px), 2-3
   display sizes (32-64px), ONE max headline size. Apple ships 11 sizes
   total; Framer 9; the critic gate is ≤ 8 distinct sizes on a rendered
   page. Name tokens `role_size_lineHeight` (Airbnb) so size and leading
   cannot drift. Fluid display type: `clamp()` the size, the leading AND the
   tracking together (Notion's H1 pattern), `text-wrap: balance` on heads.
3. **The tracking curve:** ≥40px → negative (−0.005 to −0.04em); 17-40px →
   −0.03 to +0.02em; <17px labels → ≤ +0.2em allowed (tracked small caps
   are a voice). Display type TIGHTENS as it GROWS — never the reverse.
4. **The neutrals — tinted, never pure:** pick ONE hue (warm paper, blue-black
   ink, whatever fits the brand) and generate the gray ramp INSIDE it:
   8-12 steps from surface to text. Dark theme: pure `#000` or near-black
   base + stepped surfaces + **alpha-white borders (6-10%)**, never solid
   gray hairlines. The tinted grays must cluster within 30° hue spread
   (circular stddev) — enforced.
5. **The accent: exactly ONE** + at most one interactive variant (hover
   state). Accent lives on interactive elements and key moments only —
   color is clickable. ≤ 2 accent hue clusters on interactive elements —
   enforced. Secondary hues belong to product media and illustration,
   never chrome.
6. **Contrast from day one:** text tokens must clear WCAG AA 4.5:1 (3:1
   large) against every surface they can sit on, BOTH schemes if the site
   has two. Compute — never eyeball. Zero violations is the law.
7. **The spacing scale:** base-4 (4/8/12/16/24/32/48/64/96/128/160) — ONE
   scale ruling spacing AND line-heights (Notion's Tatami discipline).
   Section padding 96-144px desktop. Container 1200-1260px. Reading width
   for long-form: 640-720px as a token.
8. **The radius ramp — semantic:** 4/8/12/16/24 + pill, one purpose per
   step (chips 8, cards 12-16, modals 24+, buttons per voice). Small radii
   read tool-like; big radii read consumer.
9. **The breakpoint set: ≤ 6** (2-3 ideal). Each breakpoint is a layout you
   test — decide them once, up front.
10. **Emit `--tokens` and a `tokens.css`** every component imports. No
    hand-picked hexes or px values in components — a value not in the system
    is a bug.

## Verification

- `node scripts/design_critic.mjs --route <route> --label sys-check --no-vlm`
  — the craft axes (weights, tracking, neutral hue, accents, breakpoints)
  must ALL pass before the first component is written.
- `bun scripts/contrast_audit.mjs` (if the repo ships one for the surface) —
  zero violations, both schemes.
