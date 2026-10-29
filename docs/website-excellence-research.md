# The Website Excellence Round — the design-research knowledge base

> The Website Excellence Round's research base (researched 2026-10-29): what the best production websites actually ship — Linear, Vercel and Stripe read from their live HTML and CSS rather than from blog posts about them, plus the 2025–26 meta-studies, motion research, accessibility law, performance law and the VLM-critique literature — distilled into the token, gate and protocol tables the flagship app and the benchmark rubric consume.

- [The method](#the-method)
- [Linear — the restraint benchmark](#linear--the-restraint-benchmark-v)
- [Vercel — Geist](#vercel--geist-cv)
- [Stripe — the craft benchmark](#stripe--the-craft-benchmark-v)
- [The 2025–26 dev-tool landing grammar](#the-202526-dev-tool-landing-grammar-c)
- [Motion — the research baseline](#motion--the-research-baseline-cv)
- [Performance — what earns Lighthouse 100](#performance--what-earns-lighthouse-100-c)
- [Objective scoring inputs](#objective-scoring-inputs-c)
- [VLM design critique — the literature](#vlm-design-critique--the-literature-c)
- [The synthesis — tokens this round consumes](#the-synthesis--tokens-this-round-consumes)

Related pages: [Website Excellence session record](website-excellence-session.md) (the round this research grounds) · [landing research](landing-research.md) (the landing page's design rationale — the prior art for several findings here) · [landing effects research](landing-effects-research.md) (the presence round's effect-by-effect sourcing) · [TUI beautification plan](tui-beautification-plan.md) (the in-repo critique precedent the round's harness copies).

## The method

On 2026-10-29 this round fetched the live production HTML of
[linear.app](https://linear.app), [vercel.com](https://vercel.com) and
[stripe.com](https://stripe.com) and followed every stylesheet link — Linear's
homepage alone serves 45 production CSS files, and all 45 were fetched and
read. The token values in the three benchmark sections below were extracted
from those files and that markup, then spot re-verified at write-up time: the
hero copy, the blur-up device and the `InterVariable.woff2?v=4.1` preload on
Linear; the blob palette, `color-mix()`, `68svh`, Söhne and Source Code Pro in
Stripe's served CSS; the full even-step type ramp and the `--guide-color`
ruled-grid gradients in Vercel's. Nothing in those sections comes from a blog
post about the sites.

What a live fetch cannot establish — intent, principles, a foundry's spec
sheet, a study's findings — is cited to the publisher's own page and tiered
accordingly. Claims carry the standing tiering used across this repo's
research docs: **[V]** verified at the cited live source during this round,
**[C]** upstream-claimed (the company's own docs or blog, a published paper or
standard), **[U]** unknown. Nothing below is tiered [U]: a claim that could
not be sourced was cut, not kept.

| Source | What was read | Tier |
|---|---|---|
| [linear.app](https://linear.app) | live homepage markup + all 45 production CSS files — type ramp, color ramp, alpha borders, accent, hero device | [V] |
| [linear.app/now](https://linear.app/now) · [rauno.me/craft](https://rauno.me/craft) | Linear's design principles post + Freiberg's "Invisible Details of Interaction Design" | [C] |
| [vercel.com](https://vercel.com) | live homepage markup + production CSS chunks — the even-step type scale, the `--guide-color` ruled-grid backdrops | [V] |
| [vercel.com/font](https://vercel.com/font) · [vercel.com/geist/colors](https://vercel.com/geist/colors) · [vercel.com/geist/introduction](https://vercel.com/geist/introduction) | Geist's own docs — typeface facts, the 10-step color law, border and shadow rules | [C] |
| [stripe.com](https://stripe.com) · [stripe.com/sessions](https://stripe.com/sessions) | live markup + production CSS — brand palette, blob gradients, svh sizing, Söhne + Source Code Pro, section flow; the archived 2021 scrollyteller as heritage | [V] / [C] |
| [Evil Martians — we studied 100+ devtool landing pages](https://evilmartians.com/chronicles/we-studied-100-devtool-landing-pages-here-is-what-actually-works-in-2025) | the meta-study this round treats as section-grammar law | [C] |
| [NN/g animation duration](https://www.nngroup.com/articles/animation-duration/) · [NN/g microinteractions](https://www.nngroup.com/articles/microinteractions/) | the motion-duration and status-motion research | [C] |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | the AA contrast law (SC 1.4.3, SC 1.4.11) | [C] |
| [Carbon — spacing](https://carbondesignsystem.com/guidelines/spacing/overview/) · [type-scale.com](https://type-scale.com/) | the 2× spacing grid tokens and the modular ratio reference | [C] |
| [Lighthouse performance scoring](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring) | the v10 metric weights | [C] |
| [arXiv:2407.08850](https://arxiv.org/abs/2407.08850) · [arXiv:2412.16829](https://arxiv.org/abs/2412.16829) · [arXiv:2403.03163](https://arxiv.org/abs/2403.03163) · [arXiv:2510.15306](https://arxiv.org/abs/2510.15306) | the VLM design-critique literature | [C] |
| [tui-beautification-plan.md](tui-beautification-plan.md) · [landing-effects-research.md](landing-effects-research.md) | Unown's own in-repo receipts — the critique precedent and the effect catalog | [V] |

## Linear — the restraint benchmark [V]

Linear is the round's restraint benchmark: the proof that a near-monochrome
canvas, one accent and a strict type ramp read as more premium than any
gradient stack — everything below extracted from the live production files
at [linear.app](https://linear.app).

### The type system

One self-hosted variable font — `InterVariable.woff2?v=4.1`, preloaded with
`crossorigin` — plus Berkeley Mono for code [V]: one file covers every
weight, no external font request, no layout-shifting fallback swap. The
ramps [V]:

| Ramp | Values |
|---|---|
| Headings `--title-1…9` | 17 / 20 / 24 / 32 / 40 / 48 / 56 / 64 / 72 px — every step from 32 up sits on the 8px grid |
| Text `tiny…large` | tiny 10 / micro 12 / mini 13 / small 14 / regular 15 / large 17 px — body default is 15, not 16 |
| H1, desktop | 40px, letter-spacing -0.015em, line-height 44px |
| H1, mobile | collapses to 32px / 36px |

Two structural facts worth copying: the ramps share 17px (`--title-1` equals
text large — the seam where a small heading and an emphasized lead meet at
one optical weight), and display sizes carry negative tracking — the elite
signature of this whole study.

### The color system

| Role | Token value [V] |
|---|---|
| canvas level-0 | #08090a |
| canvas level-1 | #0f1011 |
| canvas level-2 | #141516 |
| canvas level-3 | #191a1b |
| marketing canvas | #010102 — darker than the product's darkest level; marketing goes blacker than the app |
| text primary | #f7f8f8 |
| text secondary | #b4bcd0 |
| text tertiary (body) | #8a8f98 |
| text quaternary | #62666d |
| border, faint → strongest | #ffffff0d / #ffffff14 / #ffffff1f / #ffffff26 — white alpha at 5 / 8 / 12 / 15% |
| accent | #7170ff, hover #8989f0, tint #18182f |

The light counterparts [V]: canvases #ffffff / #f8f8f8 / #f4f4f4 / #f0f0f0,
text #282a30 / #3c4149 / #6f6e77, borders in the #e9e8ea family.

Three disciplines hide in that table: canvas steps of five-to-seven per
channel — imperceptible between adjacent levels, cumulative as depth;
borders as white alpha rather than gray hex, so one token adapts to every
level and reads as light, not paint; one accent hue with three states — not
a palette.

Contrast receipts, computed per WCAG relative luminance against the live
values: body tertiary #8a8f98 on level-0 #08090a measures **6.1:1** — AA
(4.5:1) passes with headroom; secondary #b4bcd0 measures 10.5:1; primary
#f7f8f8 measures 18.7:1; quaternary #62666d measures 3.45:1 — under the body
bar, over the 3:1 non-text bar of SC 1.4.11: the ramp's dimmest text step is
label tier, never body copy.

### The page grammar

The live homepage flow [V]: hero — "The product development system for teams
and agents", verbatim — then four feature bands, a Changelog section ON the
homepage, the final CTA, and a six-column footer. The changelog on the
homepage is the structural tell: shipping cadence as a marketing asset
(Stripe reaches the same conclusion from the opposite direction).

The 2025 hero device [V, re-verified in live markup]: the headline ships as
per-line spans with `opacity: 0; filter: blur(10px); transform:
translateY(20%)` inline, revealed on load, plus a `visuallyHidden` duplicate
for screen readers — the accessible-duplicate way to ship the most-copied
hero device of 2025, a11y wiring intact.

### The culture behind the numbers

The restraint is documented, not accidental. Linear's own principles post —
["A calmer interface for a product in motion"](https://linear.app/now) [C] —
states the two laws this round adopts as its restraint ceiling: "Don't
compete for attention you haven't earned" and "Structure should be felt not
seen". Rauno Freiberg's ["Invisible Details of Interaction
Design"](https://rauno.me/craft) [C] is the longer form: the design spend
moved into invisible details — focus states, easing, optical alignment —
not into louder surfaces.

## Vercel — Geist [C/V]

Vercel is the systems benchmark: the design system whose docs read like an
engineering spec.

The typefaces [C, [vercel.com/font](https://vercel.com/font)]: Geist Sans and
Geist Mono (plus Geist Pixel for display moments), open-sourced,
Swiss-design-inspired, 652 glyphs, 9 weights, 32 stylistic sets.

The color law [C, [vercel.com/geist/colors](https://vercel.com/geist/colors)]:
ten color scales of ten steps each, with a documented role for every step —
1–2 page backgrounds, 3–6 borders, 7–8 high-contrast backgrounds, 9–10 text —
and P3 variants served where the display supports them. Two rules carry the
force of law (both re-verified live on the page during this round): "Draw
each border once" and "Keep material shadows translucent".

The dark values [C]: background-100 #0a0a0a (hsl 0 0% 4%), background-200
#000000, gray-100 #1a1a1a through gray-500 #454545 to gray-1000 #171717;
light: #ffffff / #fafafa. Every gray is achromatic — hue 0, saturation 0 —
where Linear's carry a blue cast (#8a8f98, #b4bcd0): Vercel's neutral
machine versus Linear's tinted warmth — two philosophies, to be chosen
deliberately.

The type scale [V, read from the live stylesheet]: headings run
72 / 64 / 56 / 48 / 40 / 32 / 24 / 20 / 16 / 14 px — even steps, the 8px
cadence again; buttons 16 / 14 / 12 and labels 20 / 18 / 16 / 14 / 12 [C,
Geist docs].

The Grid [V]: the live homepage ships ruled-grid / graph-paper backdrops
built from `--guide-color` 1px linear-gradients (verified in the production
CSS chunks fetched this round), and Geist documents the grid as "a huge part
of the new Vercel aesthetic" [C,
[vercel.com/geist/introduction](https://vercel.com/geist/introduction)] —
the cheapest depth there is: emptiness that reads as intentional.

## Stripe — the craft benchmark [V]

Stripe is the craft benchmark: a 2026 enterprise homepage, visually rich,
that still loads like a landing page — everything below extracted from the
live production markup and CSS at [stripe.com](https://stripe.com).

Typography [V]: Söhne (Klim Type Foundry) as a variable font with
`crossorigin` preloads, plus Source Code Pro Medium for code — both
re-verified in the served files during this round.

The hero [V]: animated radial-gradient bento blobs built with `color-mix()`,
cycling #ea2261 / #f363f3 / #ffcf5e / #ff6118 (all four re-verified live)
over the brand "blurple" #635bff; three stacked canvases;
`--hero-layout-min-height: min(68svh, 826px)` — the `svh` unit, so mobile
browser chrome never clips the hero; hero copy 34–48px responsive.

The signature light system [V]: #f6f9fc cool paper-white backgrounds,
#e5edf5 borders, #061b31 dark navy for depth bands — a warm-cool paper that
is unmistakably Stripe's, not a default gray.

The homepage flow [V, all copy verbatim, re-verified]: hero → bento solutions
grid (six cards) → stats band "The backbone of global commerce" → customer
stories (Hertz, URBN $5B, Instacart, Le Monde) → infrastructure depth →
"What's happening" news band → footer. The grammar: claim → proof-by-logo →
depth → liveliness — a visibly alive company is a trustworthy company, the
same conclusion Linear's homepage changelog reaches.

Heritage [C]: the Sessions 3D-city scrollytelling (2021, still archived at
[stripe.com/sessions](https://stripe.com/sessions)) is the ancestor of
today's scroll-driven WebGL heroes — a decade of craft spend, and a reminder
that scroll-scrubbed spectacle ages better than autonomous spectacle.

## The 2025–26 dev-tool landing grammar [C]

Evil Martians read more than 100 dev-tool landing pages and published what
actually works — [the meta-study](https://evilmartians.com/chronicles/we-studied-100-devtool-landing-pages-here-is-what-actually-works-in-2025)
this round treats as section-grammar law (the landing round already adopted
its trust-block finding — [landing research](landing-research.md) Part 1;
this round re-reads it for the flagship's grammar).

Two near-universal rules across the cohort: **"No salesy BS. Clever and
simple wins."** and a **centered layout with a max-width container**. The
winning section order:

> Hero → Trust block → Feature block → Social proof → Supporting blocks →
> Final CTA

The trust block sits directly after the hero — logo belts for B2B products,
big numbers (stars, usage, awards) for dev tools. The hero visual taxonomy:

| Hero visual | Notes |
|---|---|
| Animated product UI | the default for products with a beautiful UI |
| Static product UI | honest and cheap; works when the UI itself is the argument |
| Switchable multi-UI | tabs across use cases |
| Live product embed | "a power move" — the product running in the page |
| Code snippet as hero | the command is the conversion |
| Abstract | for products with no visible UI; the hardest to get right |

The feature-storytelling ladder, weakest to strongest fit for an early-stage
product: function list → action-oriented → **problem-oriented** → bold
statements → mission. Social proof means curated testimonials — never
auto-pulled tweets — woven next to the features they prove. A changelog or
blog preview is the "we're alive, we're shipping" signal, and the cohort's
terminal and infra tools have converged on dark-mode-by-default (Warp and
Cursor among them — the cohort table with receipts is
[landing research](landing-research.md) Part 1).

## Motion — the research baseline [C/V]

The research numbers [C]: 100–400ms is the animation sweet spot, and 500ms
starts to feel like drag ([NN/g, Animation
Duration](https://www.nngroup.com/articles/animation-duration/)); one-shot
reveals belong at ≤300ms; motion's first job is conveying system status
([NN/g, Microinteractions](https://www.nngroup.com/articles/microinteractions/));
and user-scrubbed — scroll-driven — motion is acceptable where autonomous
motion is not ("sometimes I just want to see information there"; catalogued
with receipts in [landing effects research](landing-effects-research.md)
Part 2).

The shipped 2025–26 devices — each read from live markup, with per-site
receipts in [landing effects research](landing-effects-research.md) Part 1:

| Device | Shipper | The markup signature [V] | The lesson |
|---|---|---|---|
| Blur-up headline | Linear | per-line spans `opacity:0; filter:blur(10px); transform:translateY(20%)` + a `visuallyHidden` duplicate — [linear.app](https://linear.app) | the most-copied hero device of 2025; ship it with the accessible duplicate |
| Text scramble | Vercel, motion.dev | ScrambleText on the deploy CTA — [motion.dev](https://motion.dev) | reads as decoding: one-shot, preattentive, brandable |
| Shimmer status pill | Cursor | live-status pill, `--shimmer-duration:1.6s` — [cursor.com](https://cursor.com) | a shimmering pill says "working right now" without a word of copy |
| Hover-gated marquee | Supabase | `motion-safe:group-hover:run`, paused until hover, inside the reduced-motion guard — [supabase.com](https://supabase.com) | the gold-standard a11y wiring |
| Cursor-tracking spotlight | Clerk | `--mx`/`--my` gradient overlays + `mix-blend-overlay` — [clerk.com](https://clerk.com) | cheap and decorative-safe — if the vars are scoped |
| 3D-tilt header | Resend | `perspective` on the page header — [resend.com](https://resend.com) | tactile depth, and the one device that clashes with a pixel grid |

The anti-pattern [C, [motion.dev performance
tier](https://motion.dev/docs/performance)]: animating global or inherited
CSS variables — the F-tier "inheritance bomb"; scope every animated variable
to the smallest subtree that needs it. One compositor fact [C,
[Chrome scroll-driven
animations](https://developer.chrome.com/docs/css-ui/scroll-driven-animations/)]:
CSS `animation-timeline: scroll()` is the only scroll animation that runs on
the compositor at fling speed — ride it, not JavaScript scroll listeners.
And the wrapper that binds everything [C,
[web.dev](https://web.dev/articles/prefers-reduced-motion)]: every effect
lives behind `prefers-reduced-motion`, the finished state — never a blank —
as the reduced-motion render.

## Performance — what earns Lighthouse 100 [C]

The Lighthouse 10 scoring weights [C,
[Chrome docs](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring)]:

| Metric | Weight |
|---|---|
| Total Blocking Time | 30% |
| Largest Contentful Paint | 25% |
| Cumulative Layout Shift | 25% |
| First Contentful Paint | 10% |
| Speed Index | 10% |

Green is ≥90; a literal 100 is, in Chrome's own words, "extremely
challenging" — the round's gate is ≥90, not perfection. The levers the three
benchmarks all pull:

- **next/font** [C, [Next.js
  fonts](https://nextjs.org/docs/app/getting-started/fonts)]: build-time
  self-hosting, zero external requests, automatic fallback adjustment that
  kills the fallback swap's CLS — the pattern both Linear and Stripe ship:
  one preloaded variable woff2 with `crossorigin` [V].
- **Images** [C, [web.dev LCP
  optimization](https://web.dev/articles/optimize-lcp)]: WebP/AVIF,
  `width`/`height` pinned, lazy below the fold, `fetchpriority="high"` on the
  LCP image.
- **Server components and streaming** [C, [Next.js server and client
  components](https://nextjs.org/docs/app/getting-started/server-and-client-components)]:
  RSC plus per-route code splitting plus streaming SSR is what keeps client
  JS near zero on a marketing page.

## Objective scoring inputs [C]

The laws the rubric can enforce without a VLM:

- **Contrast** — WCAG 2.2 AA: 4.5:1 for text (SC 1.4.3), 3:1 for large text
  and non-text UI (SC 1.4.11) — [w3.org/TR/WCAG22](https://www.w3.org/TR/WCAG22/).
- **Type-scale ratios** — minor third 1.200, major third 1.250, perfect
  fourth 1.333 ([type-scale.com](https://type-scale.com/)); elite practice
  lands at roughly 1.25–1.33 for H1-to-body, with negative tracking at
  display sizes (Linear's -0.015em [V]; Vercel's even steps [V]).
- **Spacing** — Carbon's 2× grid tokens: 2 / 4 / 8 / 12 / 16 / 24 / 32 / 40
  / 48 / 64 / 80 / 96 / 160 px
  ([Carbon](https://carbondesignsystem.com/guidelines/spacing/overview/)).
- **The release audit** — the Frontend Checklist's 350+ rules
  ([frontendchecklist.io](https://frontendchecklist.io/)), used as a
  pre-ship pass, not as design law.
- **Unown's own gates worth re-adopting** [V, in-repo]: the landing page's
  per-page scroll and word budgets
  ([landing research](landing-research.md) Part 13); every number on the
  page receipt-derived (the landing contract at
  [`src/components/landing/AGENTS.md`](../src/components/landing/AGENTS.md));
  JSON-LD asserted in e2e.

## VLM design critique — the literature [C]

The papers this round's critique harness stands on:

| Paper | The finding this round uses |
|---|---|
| [UICrit (arXiv:2407.08850)](https://arxiv.org/abs/2407.08850) | 3,059 expert critiques over 983 mobile UIs; LLM UI evaluation does not yet match human evaluators — VLM scores are directional, never ground truth |
| [Iterative refinement (arXiv:2412.16829)](https://arxiv.org/abs/2412.16829) | MLLMs struggle with visually-grounded critique; the working recipe is screenshot + design guidelines → comments → iteratively re-prompt with the prior output |
| [Design2Code (arXiv:2403.03163)](https://arxiv.org/abs/2403.03163) | GPT-4V judging rendered-versus-reference screenshots — the screenshot-diff pattern |
| [WebGen-V (arXiv:2510.15306)](https://arxiv.org/abs/2510.15306) | critique per SECTION with localized screenshots beats whole-page critique |

Unown's in-repo precedent [V,
[tui-beautification-plan.md](tui-beautification-plan.md)] is the
architecture the round's harness copies — the four-pass loop: still critique
→ motion critique (5 frames per video) → pixel audit (dominant-color ground
truth) → defect-tally-to-source trace, which found mean polish 3.9/10 and
mean motion 4.0/10 at baseline. The harness adds the literature's two
lessons: WebGen-V's section-level screenshots and iterative re-prompting.

## The synthesis — tokens this round consumes

Two consumers: the flagship app and the benchmark rubric. One rule of use:
Unown's brand is warm Game-Boy paper, ink and gold (the landing's GBA-locked
palette — dark Hoenn navy #102039 with gold #ffc55a, light Kanto paper
#e6e6d5, in [`src/app/globals.css`](../src/app/globals.css)) — so the
flagship applies this craft baseline through the brand lens, not as a Linear
clone. What transfers is the discipline — ramp structure, contrast law,
alpha borders, one accent — never Linear's blue-blacks.

### Canvas, text and border ramps

| Role | Linear [V] | What the flagship takes |
|---|---|---|
| canvas-0 — deepest surface | #08090a | a brand-derived warm near-black; the deepest surface the app owns |
| canvas-1 — raised panel | #0f1011 | one raise above canvas-0, felt not seen |
| canvas-2 — overlay chrome | #141516 | second raise |
| canvas-3 — highest surface | #191a1b | menus, modals, popovers |
| text-0 — headings | #f7f8f8 | ink at full strength, ≥7:1 on canvas-0 |
| text-1 — emphasized body | #b4bcd0 | the dim step |
| text-2 — body | #8a8f98 | must clear 4.5:1 on canvas-0 (Linear's clears at 6.1:1) |
| text-3 — labels only | #62666d | decorative or de-emphasized labels only — Linear's reads 3.45:1, under the body bar, over the 3:1 non-text bar |
| borders, faint → strongest | white alpha 5 / 8 / 12 / 15% | ink-color alpha at the same steps — alpha borders adapt over every level |
| accent + states | #7170ff / #8989f0 / #18182f | one accent, three states — base, hover, tint wash — gold through the brand lens |

The light mode maps the same roles onto the warm paper family (Linear's
light canvases #ffffff / #f8f8f8 / #f4f4f4 / #f0f0f0 and text #282a30 /
#3c4149 / #6f6e77 are the reference structure [V]).

### Type scale and tracking

| Step | Sizes | Tracking | Line-height |
|---|---|---|---|
| display-1…5 | 72 / 56 / 48 / 40 / 32 px | -0.015em | ≤1.1 |
| body-large…caption | 17 / 15 / 14 / 12 px | 0 | 1.6 body, 1.5 small |

Negative tracking applies at 32px and above only. No page uses more than
seven of these sizes at once — the QA gate below enforces it.

### Spacing tokens

Carbon's 2× grid [C]: 2 / 4 / 8 / 12 / 16 / 24 / 32 / 40 / 48 / 64 / 80 /
96 / 160 px. The 4px sub-grid is allowed for micro-adjustments; the 8px
rhythm governs layout. (Linear's heading ramp already sits on the 8px grid
above 24px [V] — the two systems interlock.)

### Motion tokens

| Token | Value | Use |
|---|---|---|
| duration-fast | 150ms | hover, focus, micro-feedback |
| duration-base | 250ms | one-shot reveals — the ≤300ms law |
| duration-slow | 400ms | page-level transitions; nothing on a marketing page runs longer |
| easing-reveal | ease-out | entrances — arrive fast, settle |
| easing-interactive | spring | user-triggered movement only |

Standing rules: every effect behind `prefers-reduced-motion` with the
finished state as the reduced render; no loop without status meaning;
scroll-scrubbed beats autonomous; never animate a global or inherited CSS
variable.

### Section grammar — the page order

| # | Section | Rule |
|---|---|---|
| 1 | Hero | the claim, plus exactly two CTAs: convert and docs |
| 2 | Trust strip | receipts, not logos — Unown's own numbers, every figure receipt-derived |
| 3 | Feature bands | problem-oriented storytelling — the early-stage best practice |
| 4 | Interactive proof | the live demo — the cohort's "power move" |
| 5 | Curated proof | hand-picked quotes beside the features they prove |
| 6 | Changelog / devlog | the "we're alive, we're shipping" signal |
| 7 | FAQ | the skeptic's objections, answered on the record |
| 8 | Finale | the last ask |

Sources: the Evil Martians order [C], cross-checked against Linear's and
Stripe's live homepage structures [V].

### Performance gates

| Gate | Threshold |
|---|---|
| LCP | < 2.5s |
| CLS | < 0.1 |
| TBT | < 200ms |
| Lighthouse performance | ≥ 90 — a 100 is not the gate |

### QA gates

| Gate | Threshold |
|---|---|
| Text contrast | ≥ 4.5:1 — WCAG AA SC 1.4.3 |
| Large-text and non-text contrast | ≥ 3:1 — SC 1.4.11 |
| Font sizes per page | ≤ 7 |
| Spacing | on the 4/8 grid |
| Heading order | strictly increasing, no skipped levels |
| Scroll budget | per-page cap — the landing precedent |

### Critique protocol — scores, ground truth, and the trace

| Pass | What runs |
|---|---|
| 1 — still critique | per-section screenshots (WebGen-V granularity), VLM scored 0–10 per axis, iterative-refinement re-prompting with prior output (arXiv:2412.16829) |
| 2 — motion critique | 5 frames per video, judged for pacing, continuity and transition quality |
| 3 — pixel audit | dominant-color ground truth against the VLM's color claims |
| 4 — trace | defect tally mapped to source, every recurring defect named where it lives |

Axes, each scored 0–10: hierarchy, typography, spacing, color/contrast,
alignment, density, motion. Scores are directional — UICrit's caveat — which
is exactly why pass 3 exists.

**The rubric contract: a run without a receipt never counts; a score without
a pixel ground-truth is an opinion.**
