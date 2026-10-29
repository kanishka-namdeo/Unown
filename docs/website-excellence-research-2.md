# The Website Excellence Round 2 — the design-research knowledge base

> The second research base (researched 2026-10-30): the first round read
> Linear, Vercel/Geist and Stripe from their live production files. This
> round extends the coverage to the rest of the mission's elite list —
> Apple, Airbnb, Notion, Framer, Raycast, Resend, Anthropic, Mercury,
> Attio — plus the 2025–26 motion-design state of the art, all read from
> live HTML/CSS rather than from posts about them, and distilled into the
> rules an AI website builder can enforce. Two targets on the mission
> list (arc.net, openai.com) sat behind Cloudflare challenges this round
> and are recorded as not-verified rather than guessed.

- [The method](#the-method)
- [Apple — the optical-tuning benchmark](#apple--the-optical-tuning-benchmark-v)
- [Airbnb — the token-naming benchmark](#airbnb--the-token-naming-benchmark-v)
- [Notion — the fluid-typography benchmark](#notion--the-fluid-typography-benchmark-v)
- [Framer — the dark-surface benchmark](#framer--the-dark-surface-benchmark-v)
- [Raycast — the one-accent benchmark](#raycast--the-one-accent-benchmark-v)
- [Resend — the editorial-contrast benchmark](#resend--the-editorial-contrast-benchmark-v)
- [Anthropic — the warm-paper benchmark](#anthropic--the-warm-paper-benchmark-v)
- [Mercury — the numbers-as-headlines benchmark](#mercury--the-numbers-as-headlines-benchmark-v)
- [Attio — the product-motion benchmark](#attio--the-product-motion-benchmark-v)
- [Motion — the 2026 state of the art](#motion--the-2026-state-of-the-art-cv)
- [The synthesis — rules this round consumes](#the-synthesis--rules-this-round-consumes)

Related pages: [Website Excellence round 2 session](website-excellence-2-session.md) (the round this research grounds) · [Website Excellence research](website-excellence-research.md) (the first round's base — Linear, Geist, Stripe) · [landing research](landing-research.md) (the landing page's rationale) · [landing effects research](landing-effects-research.md) (the presence round's effect sourcing).

## The method

On 2026-10-30 this round fetched the live production HTML of the nine
sites below and followed their stylesheet links (Apple's homepage CSS
bundle and `wss/fonts` face sheet; Airbnb's client CSS with the full
`--typography-*` and `--palette-*` token sets; Notion's fifteen Next.js
CSS chunks carrying the "Tatami" token layer; Framer's nine inline
style blocks plus its published brand page; Raycast's six CSS chunks;
Resend's five; Anthropic's three; Mercury's two; Attio's two), then
measured the rendered DOM with a headless browser where the CSS alone
could not settle a computed value. Every number in the site sections is
[V] — extracted from those artifacts this round. The motion section
mixes [V] (production CSS of Linear/Stripe/Vercel/Raycast/Framer/Apple)
with [C] (browser release notes, MDN compatibility data, the standards,
and the engineering blogs the patterns descend from).

Two mission-list sites could not be read: **arc.net** (Cloudflare
hard-block on every fetch path — direct, headless, reader proxy,
archive) and **openai.com** (Cloudflare managed challenge; the challenge
shell's styles must not be attributed to the brand). Both are recorded
as not-verified and stay out of the synthesis rather than entering as
folklore.

| Source | What was read | Tier |
|---|---|---|
| [apple.com](https://www.apple.com) + `/iphone/` | homepage + iPhone CSS bundles, the 45-`@font-face` fonts sheet, HIG typography (incl. the Dec 2025 data endpoint) | [V] / [C] |
| [airbnb.com](https://www.airbnb.com) | live homepage + the client CSS: full typography ramp, 872 palette definitions (346 `-dark`), spacing/radius tokens, breakpoints | [V] |
| [notion.com](https://www.notion.com) | live homepage + 15 CSS chunks: the Tatami token layer (type, spacing, radius, color), fluid hero clamps, rendered-DOM measurements | [V] |
| [framer.com](https://www.framer.com) + `/brand` | live homepage (9 inline style blocks, 40 style presets, `data-framer-*` motion attributes) + the published brand palette | [V] |
| [raycast.com](https://raycast.com) | live homepage + 6 CSS chunks: tokens, the embedded app-window hero, gradient-border pill, keycap glow | [V] |
| [resend.com](https://resend.com) | live homepage + 5 CSS chunks (1MB): font stack, gray-1…12 dual scale, section skeleton, button anatomy | [V] |
| [anthropic.com](https://www.anthropic.com) | live homepage + 3 CSS chunks: the ivory ramp, clay accent, grid/reading-width tokens, theme inversion | [V] |
| [mercury.com](https://mercury.com) | live homepage (830KB single-column narrative) + 2 CSS chunks: Arcadia/Tiempos/Plex stack, ink illustration color | [V] |
| [attio.com](https://attio.com) | live homepage (1.08MB) + 2 CSS chunks: weight census, radius census, the radar keyframes with reduced-motion guard | [V] |
| Linear / Stripe / Vercel / Raycast / Framer / Apple production CSS (motion lane) | 150-keyframe homepage (Linear), scroll-timeline `@supports` blocks (Stripe), `view()` timelines (Vercel), `.15s` hovers (Raycast), `preload="none"` video (Framer), the rAF/scrollY engine (Apple) | [V] |
| MDN BCD 8.1.7 + caniuse JSON + browser release notes | the scroll-driven-animation matrix (Firefox 159, Oct 27 2026), View Transitions levels, `@starting-style`, `interpolate-size` | [C] |
| [rauno.me/interfaces](https://rauno.me/interfaces) · [vercel.com/design/guidelines](https://vercel.com/design/guidelines) · web.dev animation/reduced-motion guides | the timing canon, the compositing law, the opt-in reduced-motion pattern | [C] |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | SC 2.3.3 (animation from interactions) | [C] |
| [Codrops kinetic-type + restraint case studies (2026)](https://tympanus.net/codrops/2026/10/26/animating-agents-gsap-animaxxing/) | the per-word-reveal discipline, the "knowing when to do less" round | [C] |

## Apple — the optical-tuning benchmark [V]

Apple's marketing homepage is the benchmark for type tuned at every
size rather than scaled from one setting — and for spending an entire
superfamily's weight range on just three weights.

**Typography.** SF Pro ships as Display (≥19px) and Text (≤17px)
optical cuts — 45 `@font-face` blocks serve 9 weights × 4 styles, and
the homepage uses exactly **400 / 500 / 600** (no 700). The homepage
ramp is **11 sizes** (12, 14, 17, 19, 21, 24, 28, 32, 40, 48, 56px) —
the biggest headline class is 56/48/32px by breakpoint at weight 600,
line-heights are precise to four decimals (1.0714 at 56px), and
letter-spacing is per-size optical tuning: −.005em at 56px, 0 at 40px,
+.007–.012em at 19–28px, −.01–.022em at caption sizes. The HIG
publishes the full tracking table this descends from (17pt = −26/1000em,
48pt = +8, 80pt+ = 0) and states the system fonts are variable fonts
with "dynamic optical sizes."

**Color.** ~12 hexes total on the homepage: text `#1d1d1f`, secondary
`#6e6e73`, tertiary `#86868b`; surfaces `#fff`, `#f5f5f7` (the signature
light gray), `#ededf2`, dark tiles `#18181a`/`#272729`/`#000`; **one
accent — `#0071e3`** — for every link and CTA on the site. Dark sections
are designed black tiles alternating with light, not a token flip.

**Grid.** **3 breakpoints** (734 / 1068 / 1441), a 12-column
percentage grid, content max 1260px (hero 1680px on iPhone pages),
section padding 112–144px by breakpoint, pill CTAs at `border-radius:
980px`.

**Rules for the builder:** cap the ramp at ~11 sizes and 3 weights;
headline weight is 600, never 700; tune letter-spacing per size
(negative above 40px, ~0 at 40px, slightly positive at 19–28px,
negative again at captions); two neutrals + one accent; dark sections
are composed, not inverted.

## Airbnb — the token-naming benchmark [V]

Airbnb is the benchmark for tokens that make drift structurally
impossible — and for the search-first hero.

**Typography.** One variable font — **Airbnb Cereal VF** (weight axis,
self-hosted, with italic and script subsets) — and tokens named
`role_size_lineHeight` (`titles-semibold_22_26`): body 11–18px,
subtitles 14–18, titles 14–32, special-display 40/44 → 72/74, captions
10–12. **13 token sizes**, weights 400/500/600 only, letter-spacing
`normal` on almost everything (one `tracking-wide: 0.04em`).

**Color.** The largest token system of the nine: **872 `--palette-*`
definitions over 116 names, including 346 `-dark` overrides** — the
Rausch brand ramp (`#FF385C`, with a 100–900 scale), a grey ramp
0–1100, and the warm beige neutral ramp (`beige100 #F7F6F2` → `beige900
#413F3D`) that replaced pure white. Dark mode is the systematic
`-dark` override layer, not a second palette.

**Spacing.** Micro/macro split: `--spacing-micro-` 2–32px (base 4),
`--spacing-macro-` 16–80px. Radius is a semantic ramp: 4/8/12/16/20/24/
28/32 + pill. **5 breakpoints** (375/744/950/1128/1440).

**The hero.** There is no marketing headline — the H1 is visually
hidden and **the search bar is the hero**; below it, category chips and
dense listing carousels. When the product is the search, the search is
the hero.

**Rules for the builder:** name type tokens `role_size_lineHeight` so
size and leading can never drift apart; ship a semantic radius ramp;
warm the neutrals; make the primary surface do the talking.

## Notion — the fluid-typography benchmark [V]

Notion is the benchmark for fluid type done with engineering precision,
and for one dimension scale ruling both spacing and leading.

**Typography.** NotionInter (400/500/600/700) + Lyon Text serif (loaded
but unused on the homepage) + iA Writer Mono. The ramp is **14 token
steps, 12→96px**. The H1 is the exhibit: `clamp(2.625rem, 11.25vw −
25.5px, 6rem)` for size, a matching clamp for line-height (48→100px),
**and a fluid negative letter-spacing** (`clamp(−4.6px … −1.5px)` —
tracking tightens as it grows) with `text-wrap: balance`. Line-heights
are tokenized to the same scale as spacing (size-700 = 42px font / 48px
leading).

**Color.** 294 `--tatami-color-*` tokens — 10 hue families × 100–900
plus alpha-black/alpha-white scales — yet the marketing page is ~95%
black text on warm paper (`gray-100 #f9f9f8`). Color is earned, not
spent.

**Spacing.** One base-4 scale from 4px to 160px serves spacing AND
line-heights; containers 1252px / 960px; **6 breakpoints** (375→1440);
small radii (4px nav, 8px CTA, 12–16px cards) that read tool-like, not
decorative.

**Rules for the builder:** fluid display type clamps size, leading AND
tracking together; one scale for spacing and leading; a huge token
system with monastic restraint in use; small radii for credibility.

## Framer — the dark-surface benchmark [V]

Framer is the benchmark for dark themes with depth — pure black,
stepped surfaces, alpha-white hairlines — and for two-font,
two-weight confidence.

**Typography.** **GT Walsheim Medium** (display, weight 500 only) +
**Inter** (body) + Azeret Mono (code). 40 style presets across **9
sizes** (12–54px); rendered H1 = 54px / weight 500 / −.04em tracking /
line-height 1em. **Weights in use: 400 and 500 — nothing else.**

**Color.** Published brand palette: `#000000` black, `#FFFFFF` white,
**`#0099FF` Framer Blue**, `#0055FF` deep blue. The dark theme is pure
`rgb(0,0,0)` with stepped surfaces (`#050505` → `#404040`, 14 steps)
and **alpha-white borders (`#ffffff0f`–`#ffffff1a`, 6–10%)** — never
solid gray hairlines.

**Grid.** **2 breakpoints** (810 / 1200 — the editor's own defaults,
shown in the hero mockup), 1200px container, 120px section padding, 8px
button radius.

**Rules for the builder:** two families, two weights, −.04em display
tracking, 1em display leading; dark = `#000` + stepped surfaces +
alpha hairlines; one accent for every interactive element; publish the
palette and the don'ts.

## Raycast — the one-accent benchmark [V]

Raycast is the benchmark for a single accent carrying a whole brand —
and for the embedded live product window.

**Typography.** Inter (UI, 14px dominant — 134 uses) + Geist Mono /
JetBrains Mono (code) + Instrument Serif (accent display) + VT323
(decorative). Hero H1 44px/700; the weight census skews 500 (209×) >
600 > 400; UI text carries positive micro-tracking (+.1–.3px).

**Color.** Near-black grey ramp (`--grey-900 #07080a`, surfaces
`#111214`/`#0c0d0f`) with **one accent: `#ff6363`** (25 uses — inline
code, checkboxes, the command-icon gradient, the keycap glow). Every
other hue lives inside product screenshots, never in UI chrome. The
hero glow is a radial gradient anchored top-center at ~30% opacity
fading into grey-900; the announcement pill's gradient border is a
2px-padding wrapper trick.

**The hero.** Not a screenshot — **the real app window embedded**
(`.window` — 26px radius, 750×475 min, platform-aware: a Windows
variant at 8px radius with Segoe UI Variable). 99 images, zero videos
on the homepage.

**Rules for the builder:** one accent on near-black; delegate all
colorfulness to product media; embed the product itself (not a picture
of it) when you can; mono is a brand signal.

## Resend — the editorial-contrast benchmark [V]

Resend is the benchmark for serif/sans contrast and texture in a
dev-tool page.

**Typography.** A licensed stack: **ABC Favorit** (display sans),
**Domaine** (serif display), Inter (body), **Commit Mono** (incl.
italic). Hero H1: Domaine at 64px → **96px**, tracking −.01em, leading
**100%**, with a white→transparent gradient clip.

**Color.** Light-first (`--background:#fdfdfd`) with a true dark opt-in
(`#000`); a Radix-style **gray-1…12 dual scale** (each step defined for
both themes); borders as `border-t` top-edge separators on rounded-3xl
card sections — structure without boxes.

**Buttons.** The signature: 2px `white/5` border + 25px backdrop blur +
**a PNG grain texture overlay** (`::after`), white-alpha 104° gradient
fill, hover = hard invert (`bg-white/90` + black text), focus ring 4px
`ring-white/30`.

**Rules for the builder:** a serif display at 96px/leading-100% with a
gradient clip buys editorial contrast no sans can; grain + blur =
tactile glass without translucency crimes; section-as-card with border-t
rhythm; code-language tabs (AI / Node.js / Serverless / Ruby) are a
first-class landing section for a dev product.

## Anthropic — the warm-paper benchmark [V]

Anthropic is the benchmark for tinted neutrals — the "printed page"
reading of a serious AI company — and for trust as published paperwork.

**Typography.** In-house `Anthropic Sans` + `Anthropic Serif` (the
mid-migration successors to Styrene B / Tiempos Text, whose tokens
still exist) + Anthropic Mono + JetBrains Mono. Weights 400–700 with
body at 400/500 and 600+ reserved for headings; line-height tokens in
fine steps (100–154%); optical-size tokens (`--font-opsz-display:48` /
`text:16`); the ramp is `clamp()`-based against `--size-base` between
390px and 1920px viewports. Serif is the display/voice face; sans is
the UI face.

**Color.** The ivory ramp: `#fff, #faf9f5` (page), `#f0eee6`,
`#e8e6dc` … down to warm near-black `#141413` / `#1a1918` — **every
gray shares the paper's hue**. One signature accent: **clay `#d97757`**
(interactive variant `#c6613f`); muted named accents (oat, olive,
cactus, sky, heather, fig) appear only in illustration-scale moments.
Dark mode is a true token inversion (`[data-theme=dark]`), never a
restyle.

**Grid.** 12 columns / 16px gutter / 48–80px margins / max 1920px, and
**reading width as a first-class token: 640–720px** for long-form trust
content.

**Trust.** The H1 puts safety in the frontier claim ("AI research and
products that put safety at the frontier"); the page gives prime real
estate to the Responsible Scaling Policy and a Public Benefit Report
module. Governance vocabulary at the same visual level as product.

**Rules for the builder:** tint every neutral toward the paper hue;
one accent with one interactive variant; encode reading width; trust =
quantified artifacts published, not adjectives.

## Mercury — the numbers-as-headlines benchmark [V]

Mercury is the benchmark for a fintech that puts business metrics in
headline slots and designs its own footnotes.

**Typography.** **Arcadia** (proprietary text + display variable pair)
with **Tiempos Headline** still layered as the editorial serif voice,
and **IBM Plex Mono** for figures. Serif headlines, sans product,
mono numbers — the same three-voice discipline as Anthropic.

**Color.** Near-monochrome ink — `#272735` (a blue-black, 426 uses)
for all illustration fills, like banknote engraving: one ink, no loud
CTA accent verified on the homepage.

**Content.** The verified H2 stack: "Loved by 450K+ of the most
ambitious entrepreneurs"; **"$1B in annualized revenue and 4+ years
profitable"**; "Banking for the agentic era." **FDIC appears 44×** —
the disclaimers-and-footnotes section is designed, not hidden.
Seriousness = profitability + regulator language; modernity = editorial
serif + agentic-era framing.

**Rules for the builder:** numbers as headlines beat adjectives; own
the footnotes (compliance as texture); one-ink illustration reads as
financial print.

## Attio — the product-motion benchmark [V]

Attio is the benchmark for animating the product itself — and for the
weight ceiling.

**Typography.** Inter + **Inter Display** (the display cut) with a
single Tiempos Text garnish; the class census: **font-medium ×313,
font-normal ×117, font-semibold ×38, bold ×1** — the ramp lives at
400–600, and modernity comes from medium weights, never bold.

**Color.** Near-black text `#101112`; dark surfaces `#242629`/`#1c1d1f`/
`#2e3238`; light grays `#E6E7EA`/`#EEEFF1`/`#F4F5F6`; the recurring
blue `#266df0` lives in product-UI illustration (status dots, avatars)
— semantic tokens (`text-primary/secondary/tertiary`,
`--color-surface`) do the structural work.

**Motion.** The homepage's signature is a **pipeline radar**: pulsing
rings (opacity 0.067–0.135, 3.6s cycles) and a bob (±5px, 4s) —
animated product diagram, not decoration — **behind a
`prefers-reduced-motion` kill-switch**. Hover underlines at 150ms.

**Rules for the builder:** weight ceiling 600 (medium-dominant);
animate the product, not ornaments; slow ambient cycles (3–4s) with a
reduced-motion guard; tiny radii (2.1/4px) on 10–20px UI details signal
real engineering at illustration scale.

## Motion — the 2026 state of the art [C/V]

**The scroll-driven-animation matrix completed this month.**
`animation-timeline: scroll()/view()`: Chrome/Edge 115 (Jul 2023),
Safari/iOS 26.0 (Sep 2025), and **Firefox 159 on October 27, 2026** —
an Interop 2026 focus area that converged every engine [C]. Production
adopters this round verified: **Stripe** ships `scroll-timeline-name` +
`timeline-scope` dialog snapping and a pure-CSS "detect-scroll" trick
(`animation-timeline: scroll(inline self)` animating a registered
`--can-scroll` property) wrapped in `@supports (animation-timeline:
scroll())`; **Vercel** ships `@md:[animation-timeline:view()]`
utilities [V]. **Apple ships none of it** — its product pages still run
bespoke rAF + `scrollY` + `position: sticky` + `video.currentTime`
scrubbing, which remains the production workhorse for scrubbed video
[V]. Scroll-**triggered** animations (`animation-trigger`) land in
Chrome 145, Chromium-only as of May 2026 [C].

**Reduced motion.** Stripe wraps motion in the **opt-in pattern**
(`@media (prefers-reduced-motion: no-preference)`, ~26 blocks) and
zeroes duration tokens under `reduce`; Vercel uses Tailwind's
`motion-safe:`/`motion-reduce:`; Apple applies per-component
`transition: none !important` [V]. WebKit's own guidance: simple
crossfades are fine for motion-sensitive users — the nuance is *which*
motion, not any motion [C].

**Microinteractions.** The property discipline holds: transform +
opacity (+ color on Stripe's buttons, deliberately, with one signature
easing everywhere). Raycast hovers: `translateY(-6px)`/`scale(1.04)` at
**`.15s`** (its most common duration); dialogs scale from `.95`, never
0→1. The 2026 "glint/sheen" family is gradient choreography — Vercel's
`border-trail` animates `offset-distance` (CSS Motion Path) rather than
sweeping sprites [V]. Stripe animates `<details>` via
`::details-content` with `allow-discrete` and a sliding tab indicator
by **transitioning a registered custom property** [V]. The timing canon
(Rauno, which Vercel's guidelines descend from): interaction feedback
≤200ms, duration proportional to trigger size, loops pause off-screen,
`will-change` only for the animation's duration [C].

**What died vs what replaced it [V/C].** Particles: `particles.js` last
published 2015, zero elite adopters. Lottie: gone from every scanned
marketing homepage (alive inside product UI). Cursor followers /
magnetic cursors: **absent from all six elite homepages** — a mid-market
signature now. JS animation libraries on landing pages: zero — Linear
runs 150 hand-authored CSS keyframes (the agent-grid hero is 25 dots at
opacity-only `steps(1,end)` loops, no canvas, no WebGL, no GSAP);
Framer's motion is six looped muted `<video preload="none">` with
posters. GSAP itself became 100% free (Webflow, May 2025 —
ScrambleText/SplitText now ship in the public package) and is the
agency/Scrollytelling stack, not the elite-marketing stack [C].
**Decode/scramble text went mainstream**: Vercel's own homepage ships a
`ScrambleText` component [V]. **Per-word reveal, 2026 discipline**
(Codrops): fonts load before any split; words that change width hold
their space; reduced motion = the hero simply appears [C].

**View Transitions.** Same-document (SPA): universal — Chrome 111 →
Safari 18.0 → Firefox 144 (Oct 2025), 92.9% [C]. Cross-document (MPA):
Chromium + Safari ~85%, Firefox Level-1 only [C]. Who ships them:
frameworks (React 19.3's `<ViewTransition>` went stable Sep 2026;
Astro's zero-JS Client Router; SvelteKit; Fresh) — none of the six
elite marketing homepages yet [V].

## The synthesis — rules this round consumes

Nine sites, one grammar. The first round's synthesis (restraint,
even-step ramps, alpha borders) holds; this round adds the enforcement
layer — what an AI website builder can be *made* to obey:

1. **The type ramp is closed and small: 9–14 sizes, 2–3 weights, one
   weight ceiling at 600.** Apple 11 sizes/3 weights; Framer 9/2;
   Airbnb 13/3; Notion 14/4 (bold almost unused); Attio's rendered
   census: 313 medium vs 1 bold. Headline weight is 600/500 — never
   700. **Enforceable: a type-scale census with a hard size-count
   ceiling and a weight whitelist, both already measured by
   `scripts/design_critic.mjs`.**
2. **Display type tightens as it grows — mechanically.** Apple's
   per-size tracking table; Notion's fluid negative letter-spacing
   clamp; Framer's fixed −.04em; Resend's 96px at leading-100%. Below
   ~28px tracking goes slightly positive; at captions, negative again.
   **Enforceable: a tracking-vs-size curve check on every text node.**
3. **Neutrals are tinted, never pure — except when dark, when they go
   all the way to #000.** Anthropic's ivory ramp (every gray sharing the
   paper's hue), Airbnb's beige, Mercury's ink `#272735`; dark themes:
   Framer's pure black + stepped surfaces + alpha-white hairlines
   (6–10%), Raycast's grey-900. **Enforceable: a neutral-hue-spread
   check (the grays must cluster around one hue) + a dark-surface
   stepped-luminance check.**
4. **Exactly one accent, with at most one interactive variant.** Apple
   `#0071e3`; Airbnb Rausch; Framer `#0099FF`; Raycast `#ff6363`;
   Anthropic clay `#d97757`/`#c6613f`. Color lives in product media and
   illustration, never in chrome. **Enforceable: an accent-census —
   interactive elements must resolve to ≤2 hue families.**
5. **The hero is the product.** Apple's tiles/scroll films; Airbnb's
   search-bar hero (H1 hidden); Notion's live workspace mock; Framer's
   design canvas; Raycast's embedded real app window. **Enforceable (as
   a rubric axis): the hero must contain the product or its real
   interface, not adjectives about it.**
6. **Trust is quantified and institutional.** Mercury's "$1B
   annualized revenue, 4+ years profitable" in an H2 slot and FDIC ×44
   as a designed footnote section; Anthropic's policy artifacts at nav
   level; Attio's "30,000+ customers" + SDK/API/MCP section. Nobody
   says "trust us." **Enforceable: every trust claim on a generated
   page must carry a receipt link — the landing's own check:claims
   pattern, generalized.**
7. **Motion: compositing-only, opt-in reduced-motion, ≤200ms
   interactions, ambient loops that are opacity-only and pause
   off-screen, zero JS animation libraries on marketing pages.** The
   load state is quiet (Linear's ambient dots; Framer's poster-first
   video); spectacle is user-initiated. **Enforceable: the CSS
   property whitelist for keyframes/transitions + duration ceilings +
   a `prefers-reduced-motion` presence check — all mechanically
   auditable from the emitted CSS.**
8. **Scroll-driven animation is now cross-engine — ship it behind
   `@supports` with the finished state as the no-support default**
   (Stripe's pattern). Scrubbed video stays rAF. **Enforceable: any
   `animation-timeline` usage must be `@supports`-wrapped; the
   no-support render must be the finished state.**
9. **Fewer breakpoints than you think: 2–6, containers 1200–1260px,
   section padding 112–144px.** Framer 2, Apple 3, Airbnb 5, Notion 6.
   **Enforceable: a breakpoint census with a soft ceiling of 6.**
10. **One scale rules spacing AND line-height** (Notion's Tatami);
    micro/macro split when the system is big (Airbnb). Radius is a
    semantic ramp with a purpose per step (Airbnb 4–32 + pill; Attio's
    2.1px micro-radii). **Enforceable: spacing-token conformance (the
    existing 4px-grid audit) extended to line-height values.**

What this round does with them: the ten rules above become the inputs
to the round's capability builds — the design-critic's new objective
axes (tracking curve, neutral-hue spread, accent census, breakpoint
census, keyframe property whitelist) and the website-skills' guard
rails. See the [session record](website-excellence-2-session.md) for
the build log.
