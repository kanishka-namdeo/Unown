---
name: motion-designer
description: Use when adding any animation, transition or scroll effect to a page — the property discipline, timing canon, reduced-motion contract, scroll-timeline patterns and what NOT to build. Grounded in the 2026 motion state of the art (docs/website-excellence-research-2.md §motion).
---

# Motion Designer

Motion on an elite page is quiet, fast, and compositor-only. The 2026
receipts: Linear's homepage runs 150 hand-authored CSS keyframes and ZERO
JS animation libraries; the six best dev-tool homepages ship no GSAP, no
Framer-Motion-on-landing, no particles, no cursor followers, no Lottie.
Restraint is the elite signal.

## The laws (all enforced by the critic's anim gate)

1. **Compositing-only:** animate `transform`, `translate`, `scale`,
   `rotate`, `opacity`, `filter` — plus paint props (colors, box-shadow,
   clip-path) where the effect needs them. NEVER `width`/`height`/
   `top`/`left`/`margin`/`padding` (the one exception: the radix accordion
   height pattern). NEVER `transition: all` — list the properties.
   A fill level is `scaleX()` with `transform-origin: left`, not a width.
2. **The finished state ships in the markup.** SSR/first paint renders the
   END state; entrance effects run FROM initial values (`@starting-style`
   or `.from()`-style). If JS never loads, the page looks finished. No
   entrance animation may shift layout (CLS) or block first paint.
3. **The timing canon:** interaction feedback ≤ 200ms (Raycast's modal
   hovers are .15s); orchestrated reveals ≤ 800ms; duration proportional
   to trigger size (dialogs scale from .95, never 0→1); frequent actions
   skip animation entirely.
4. **Ambient loops:** opacity/transform only, 2-4s cycles, pause when
   off-screen (`IntersectionObserver` → `animation-play-state: paused`),
   and never carry information.
5. **The reduced-motion contract:** wrap motion in
   `@media (prefers-reduced-motion: no-preference)` (the opt-in pattern —
   the no-support default is the finished state). Under `reduce`,
   everything renders complete. Simple crossfades may stay; parallax,
   zoom and scroll-scrub are the vestibular risks and always gate.
6. **Hover-gating:** pointer-driven effects (spotlight, magnetic,
   gradient-follow) only inside `@media (hover: hover) and (pointer:
   fine)`, never the sole affordance, always with a `:focus-visible`
   equivalent. (The elite sites skip cursor-followers entirely — so
   should you.)
7. **Load discipline:** nothing content-critical depends on an animation
   completing; no autoplay motion >5s without pause/stop/hide; hero video
   = muted looped mp4 with poster + `preload="none"` (Framer's pattern).

## Scroll effects (the 2026 pattern)

- CSS scroll-driven animations are cross-engine as of Firefox 159
  (2026-10-27): `animation-timeline: scroll()/view()` behind
  `@supports (animation-timeline: scroll())`, with the finished state as
  the no-support render (Stripe's pattern).
- Scrubbed video stays JS (`rAF` + `scrollY` → `video.currentTime`) —
  Apple's approach for product films.
- `scroll-snap` for galleries (`scroll-snap-type: x mandatory`), sticky
  sections for chaptered reveals, `scroll-margin-top` on every anchor
  target.

## Procedure

1. Write the RESTING state first — the page complete, no motion.
2. Add ONE motion per moment; ask "what would a senior designer delete?"
   and delete it first.
3. Verify: `node scripts/design_critic.mjs --route <route> --label
   motion-check --no-vlm` — the anim gate (0 layout props, no
   transition:all, reduced-motion guard present) and CLS must pass.
4. Watch it twice at 50% CPU throttle — jank at 2x cost is jank on a
   real phone.
