# Landing Effects Research — the presence round

Why the landing page (`/`) gained the effects it gained in the 2026-10-28
"presence round", what was considered and rejected, and the sourcing rules that
keep the additions inside the page's existing motion, a11y and honesty
contracts. Companion to [`docs/landing-research.md`](landing-research.md) (the
page's binding design rationale lives one level up in
[`src/components/landing/AGENTS.md`](../src/components/landing/AGENTS.md)).

**The question this round answers:** *what effects, animations and elements can
make the landing page stunning and intuitive for the end user?* — asked as a
build brief, not a mood board: every addition had to survive the page's four
standing invariants (motion is additive, never load-bearing; the base state of
every animated rule is the finished state; the palette stays on the GBA grid;
nothing loops for decoration unless a visitor asked for it).

**Contents**

- [Part 1 — What the best dev-tool pages actually ship](#part-1--what-the-best-dev-tool-pages-actually-ship)
- [Part 2 — What the research says works (and what hurts)](#part-2--what-the-research-says-works-and-what-hurts)
- [Part 3 — The shortlist: what fits THIS page](#part-3--the-shortlist-what-fits-this-page)
- [Part 4 — What was rejected, and why](#part-4--what-was-rejected-and-why)
- [Part 5 — The shipped set, mapped to contracts](#part-5--the-shipped-set-mapped-to-contracts)

---

## Part 1 — What the best dev-tool pages actually ship

A verification pass over the pages this repo already studies
(`docs/landing-research.md` Part 1) plus the 2025–2026 pattern catalogs
(Magic UI, Aceternity, motion.dev), reading the shipped markup rather than the
marketing screenshots:

| Site | The effect in the markup | The lesson |
|---|---|---|
| Linear | H1 split into per-line spans shipped `opacity:0; filter:blur(10px); transform:translateY(20%)` inline, with a `visuallyHidden` duplicate for screen readers; customer marquee as pure CSS (`--Marquee-duration:30s`); badges carry `data-shimmer` | The blur-up headline is the most-copied hero device of 2025; the accessible-duplicate pattern is the way to ship it |
| Vercel | Motion's `ScrambleText` in the deploy CTA module | Text scramble reads as "decoding" — preattentive, one-shot, brandable |
| Cursor | Live status pill with `shimmer shimmer-synced` (`--shimmer-duration:1.6s`) | A shimmering pill says "working right now" without a word of copy |
| Supabase | Marquee gated `motion-safe:group-hover:run` — paused until hover, wrapped in the reduced-motion guard; Shiki for zero-JS syntax color | Hover-gated motion + `motion-safe:` is the gold-standard a11y wiring |
| Clerk | `data-spotlight` SVG gradient overlays tracking the cursor with `mix-blend-overlay`; ticker items carry `aria-posinset`/`aria-setsize` | Pointer-tracking spotlight is ubiquitous, cheap and decorative-safe |
| Resend | `perspective-[2000px]` header (3D tilt) | Tactile depth — the one pattern that clashes with a pixel grid |
| Warp | Terminal-first hero imagery | For a terminal product the terminal IS the hero (this page already agrees) |
| motion.dev | `ScrambleText`, `Typewriter`, `animateView` components; the performance tier list | Animating **global** CSS variables is the F-tier "inheritance bomb" — scope vars to the smallest subtree |

## Part 2 — What the research says works (and what hurts)

- **100–400ms is the animation sweet spot; 500ms starts to feel like a drag**
  (NN/g, *Animation Duration*). One-shot reveals ≤ 300ms; the letter rain
  stays the deliberate exception because it is user-triggered spectacle.
- **Motion that conveys system status is the #1 purpose of animation**
  (NN/g, *Microinteractions*). A live chip, a decode wave, a scrubbed progress
  bar all say something true about state; a looping gradient says nothing.
- **Scroll-scrubbed motion is acceptable where autonomous motion is not.**
  NN/g's scroll-fading study distinguishes user-scrubbed motion (fine) from
  autonomous fades (annoying: "sometimes I just want to see information
  there"). CSS `animation-timeline: scroll()` is also the *only* scroll
  animation that runs on the compositor at fling speed — which this page
  already relies on for `.rise` and the seal.
- **Spotlight/glow implementations must scope their CSS vars.** The
  performance tier list's worst entry is animating inherited variables; the
  correct pattern (Clerk) writes `--mx/--my` on the *hovered element only*.
- **Auto-forwarding content users must read is the classic carousel sin**
  (NN/g, Siemens case). Nothing task-critical may auto-advance; the session
  replay autoplays once and stops, and its transcript is a static list.
- **The hero text must never be gated behind an animation.** Linear ships
  `opacity:0` inline and eats the risk; this page's contract is stricter —
  SSR renders the finished headline, and the decode wave runs *after*
  hydration, on top of the finished text.

## Part 3 — The shortlist: what fits THIS page

Ranked by impact-per-contract-cost for a dark-canvas, gold-accent, GBA-pixel,
glyph-motif page that already has letter rain, a Konami flourish, scroll-timeline
reveals and an autoplaying session replay:

1. **A glyph-decode wave across the hero H1** — the brand story ("unknown →
   known") in one ~1.2s one-shot animation. Vercel ships the same class of
   effect; here the scramble alphabet is the word UNOWN itself.
2. **A scroll-progress route bar** — zero-JS, compositor-scrubbed
   (`animation-timeline: scroll(root)`), reading as the Gen-3 route/EXP bar.
   Orientation on a 13.5-viewport page is an intuitiveness win, not a bauble.
3. **Nav scrollspy** — the bar marks the band you are actually reading
   (`aria-current="true"`), the same affordance every long docs page ships.
4. **Cursor spotlight on cards** — the pointer lights a gold radial through
   scoped `--mx/--my` vars on the hovered card only (Clerk pattern; scoped
   per the tier list).
5. **A stepped glint on the primary CTA** — a four-frame sweep, gated on
   hover, in `steps()` like every other furniture transition on the page.
6. **A Live chip on the demo chrome** — the gallery iframes really are live
   apps; a blinking square + "Live" is an honest status indicator in the
   cursor-blink idiom, not decoration.
7. **A count-up on the benchmarks headline figure** — one number, one-shot,
   in view; the figure is receipt-backed and the DOM ships the final value.
8. **A pane-swap fade for the proof tabs and dex screens** — `display:none →
   block` restarts a CSS animation for free, so the hard tab swaps gain a
   160ms stepped fade with zero JS and no View-Transition API risk.

## Part 4 — What was rejected, and why

- **WebGL/shader hero, canvas glyph-matrix field** — the GTA-VI-site class of
  main-thread work; 5% of the vibe at 500% of the cost, and the hero already
  carries a grid + dither halo + seal + decode. Restraint is the brand
  (landing-research Part 1, Linear row).
- **Marquee/logo ticker** — loops for decoration; the changelog rail already
  tells the liveness story with native scroll, and Motion's ticker teardown
  documents the a11y failure modes of clone-based marquees.
- **View Transitions API on the tab swaps** — same-document transitions
  snapshot the whole page; the hidden-pane contract plus a 160ms CSS fade
  gets the same perceived smoothness with none of the risk.
- **3D tilt cards, magnetic buttons** — smooth-physics interactions read
  against a page whose furniture advances in `steps(2)` frames; a magnetic
  pixel button is a contradiction.
- **Scrollytelling / sticky pinned chapters** — the loop band already tells
  the three-beat story in tabs; a pinned section would blow the scroll budget
  for a page whose whole redesign history is about cutting scroll.
- **Sticky "back to top"** — the bar is sticky, the route bar shows position,
  the scrollspy names the band; a fourth orientation device would be the
  wall-of-CTAs mistake in miniature.

## Part 5 — The shipped set, mapped to contracts

| Effect | Contract wiring |
|---|---|
| H1 decode wave | SSR = finished text; the wave runs post-hydration, once, ~1.2s, skipped under reduced motion; animated spans are `aria-hidden`, the `sr-only` duplicate carries the accessible text and the SEO string |
| Route bar | `@supports (animation-timeline: scroll())`-gated, `prefers-reduced-motion` → not rendered; fixed and `aria-hidden`; costs zero JS and zero layout height |
| Nav scrollspy | `IntersectionObserver`, one `aria-current="true"`; a state marker, not motion — ships under reduced motion too |
| Card spotlight | pointer-scoped `--mx`/`--my` on the hovered element only; `@media (hover:hover)` gated; default vars sit off-card so the contrast audit and the un-hovered page are unaffected |
| CTA glint | `::after` sweep in `steps(4)`, hover-gated, `color-mix` with palette tokens (no hand-picked hex) |
| Live chip | text + border on tokens; the blinking square is `aria-hidden` (the blink is the existing cursor idiom); states a true fact |
| Count-up | DOM ships the final figure; the animation is one-shot in-view, rAF, ~560ms, skipped under reduced motion |
| Pane fade | CSS-only, `steps()`, killed by the global reduced-motion block; no DOM change |

Every addition animates `transform`/`opacity` or mutates text only; none adds a
live region (the page keeps exactly two); none touches layout height; none adds
a word of prose except the Live chip's one.
