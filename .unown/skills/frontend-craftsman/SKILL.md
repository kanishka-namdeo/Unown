---
name: frontend-craftsman
description: Use when polishing a built page to production grade — responsive behavior, overflow control, detail quality, cross-browser checks and the pre-ship verification battery. The last mile before a page may ship.
---

# Frontend Craftsman

Polish is measurable: no overflow, no off-grid spacing, no off-curve type,
no jank, no broken states. This skill is the pre-ship battery.

## The polish pass

1. **Overflow hunt (mobile first):** at 390px, `document.documentElement
   .scrollWidth - clientWidth` must be 0. Hunt the offenders:
   unshrinkable flex children (`min-w-0` on every flex text child), fixed
   widths, `sr-only` tables re-expanded by scoped CSS (the F17 anatomy —
   the clip belongs on a wrapper DIV, not the table), pre/code without
   `overflow-x: auto`, 100vw + scrollbar math. Then 320px, 768px, 1024px,
   1440px, 1920px.
2. **The grid sweep:** every spacing value on the 4px grid (margin,
   padding, gaps); line-heights on the same scale. The critic's off-grid
   gate is ≤ 15% — optical corrections allowed, laziness is not.
3. **Type detail pass:** the tracking curve holds at every size; tabular
   numerals for any changing number (`font-variant-numeric:
   tabular-nums` — a counter must not jitter its own layout); `text-wrap:
   balance` on heads, `text-wrap: pretty` on paragraphs where supported;
   no orphaned single words on the last line of a hero.
4. **State completeness:** every interactive element has hover, focus,
   active, disabled, loading (where async), and empty (where data-driven).
   Every one of those states keeps AA contrast — the disabled state is
   the classic violator.
5. **Dark/light parity (if the site has both):** flip schemes on every
   state. Unconditionally-colored panels under a flipped scheme are the
   F18 anatomy — tokens, never literal hexes, and never an alpha'd token
   where the background flips.
6. **Images:** `width`/`height` attributes on every `<img>` (the IHDR
   truth, not guesses), `loading="lazy"` below the fold, `decoding="async"`
   on decorative media, alt per its decision.
7. **Cross-browser:** Chromium + Firefox + WebKit, both schemes, one
   desktop + one mobile viewport each. The divergence classes: scrollbar
   styling, `backdrop-filter` (Safari prefix), view-transition support,
   `@supports` gated effects.
8. **The details that read as craft:** focus rings aligned to the radius;
   `::selection` on brand; `scroll-margin-top` on anchors; `aria-current`
   on nav state; the favicon in BOTH schemes; the 404 in the page's voice;
   `prefers-color-scheme` honored on first paint (no flash).

## The pre-ship battery (all green or it does not ship)

```
bun run typecheck && bun run lint && bun run test:unit
bun run build                        # the production build is the artifact
bun run test:e2e                     # where the repo ships them
node scripts/design_critic.mjs --route <route> --label ship --enforce
```

Plus the page's own gates where they exist (the landing's audit/contrast
lanes; an app's component suite). A gate that was never run is a claim,
not a gate — run them to conclusion, read the output, never cancel
mid-flight.

## The craftsman's question

At every step: "would an elite team ship this line?" The honest answers
are yes, no, or "not yet" — and "not yet" means the task list is not
done, not that the standard bends.
