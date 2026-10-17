# Landing Page — Research & Design Rationale

Why the marketing page (`/`) looks the way it does, and the sourcing rules that
keep its claims defensible. First written 2026-10 when the page was a
conventional hero-plus-features layout; rewritten after the page was rebuilt
around a purpose-drawn alphabet; rewritten again when that page was re-skinned
as a Game Boy — the structure above barely moved, but the palette, type and
surface treatment all did, and the reasoning for each is below.

**Contents**

- [Part 1 — Products studied](#part-1--products-studied)
- [Part 2 — Why the page is built on an alphabet](#part-2--why-the-page-is-built-on-an-alphabet)
- [Part 3 — What replaced what](#part-3--what-replaced-what)
- [Part 3b — Why the page is a Game Boy](#part-3b--why-the-page-is-a-game-boy)
- [Part 4 — Motion rules](#part-4--motion-rules)
- [Part 5 — Sourcing rules for the page](#part-5--sourcing-rules-for-the-page)
- [Part 6 — Third-party assets](#part-6--third-party-assets)
- [Part 7 — Assets](#part-7--assets)
- [Part 8 — Headline work](#part-8--headline-work)
- [Part 9 — How to keep it honest](#part-9--how-to-keep-it-honest)
- [Part 10 — The second scheme, and where the colour is allowed to live](#part-10--the-second-scheme-and-where-the-colour-is-allowed-to-live)

Related pages: [benchmark-research.md](benchmark-research.md) — the numbers the
page quotes; the page's binding contract lives one level up in
[`src/components/landing/AGENTS.md`](../src/components/landing/AGENTS.md).

---

## Part 1 — Products studied

Two passes. The first looked at how coding agents present themselves; the second
at how *any* excellent dev-tool page earns its first scroll.

| Product | H1 pattern | Hero visual | What it proves |
|---|---|---|---|
| Linear | feeling-claim | the site itself is the demo | restraint is the brand |
| Resend | category + audience | a code block where the screenshot would go | the command is the conversion |
| Cursor | category definition | annotated real UI mid-task | density reads as respect |
| Supabase | incumbent replacement | a working mini-demo in the page | friction between interest and understanding |
| Raycast | specificity | the command palette as the hero | non-targets self-qualify out |
| Clerk | superlative | floating real components | show the component, not the code |
| Warp | infra claim + live terminal | warm-charcoal band, DM Mono | warmth is a point of view |
| Vercel | the site is the pitch | product surface | speed is the proof |
| Evil Martians' meta-study | — | 100+ dev-tool pages | trust block directly after the hero; "no salesy BS, clever and simple wins" |

Two findings shaped the rebuild more than any single reference:

1. **A trust block belongs above the fold.** Converting pages answer "is this
   real" before the visitor has to ask. The old page buried its proof under the
   hero; the new one puts the trust strip directly under the CTAs.
2. **The identifiable thing beats the competent thing.** Every page above is
   remembered for one device, not for its whole layout. For Unown that device
   was already sitting in the name.

## Part 2 — Why the page is built on an alphabet

The app is named after **Unown**, the Symbol Pokémon. That is an unusually
generous gift for a page: the name is a pun you have to read twice, the
Pokémon is a flat black letter with one eye, and — the part that actually
matters for an agent with memory — it *reads what is written on walls*.

So the page is built on a 28-form alphabet, drawn from scratch:

- **Nothing is vendored.** No sprite, card, logo, artwork or audio from any
  Pokémon release is bundled, linked or reproduced. The script is 28 stroke
  paths on a 100×100 grid (`glyphs.ts`), rendered as inline SVG at two weights.
  Fan-made Unown fonts exist on DaFont and FontStruct, but "free download" is
  not a licence for web embedding and those faces derive from Game Freak
  letterforms.
- **The eye is the signature.** One eye per form, always. Disc-shaped, because a
  lens shape reads as a keyhole the moment it overlaps a stroke — and on the
  closed forms it always does. Placement is per-form (`EYES[]`).
- **Tone is a hierarchy, not a style.** Twenty-eight lit eyes strobe, so tiles
  are dim and only the hero seal, the pinned form and the spellbox light up.
- **Each form decodes twice.** The verified Pokémon lore it borrows, and the
  real mechanism it stands for here. That second column is the whole page's
  credibility argument compressed into a wall of glyphs: every line under
  *in unown* describes something that actually runs.

The pun becomes the hero H1: **"It reads what you write down."** — true of both
the Pokémon and an agent that reads its own memory tiers.

## Part 3 — What replaced what

| Old | New | Why |
|---|---|---|
| Centred eyebrow pill + centred H1 + centred subhead | Left-aligned copy, asymmetric two-column hero | The centred three-line stack is the single most recognisable template shape on the web |
| Three-column icon grid of six features | Problem-first: three pains, then five mechanisms as rows with a source link each | Icon tiles prove nothing; a row naming the pain and linking `memory.ts` does |
| Static screenshot + chart | Accessible session replay with a `role="slider"` scrubber | A typed session *is* the product demo for a CLI tool |
| "Work → Learn → Dream" as three static cards | The same three steps as tabs over the engine's real note template, log strings and AutoDream-written memory | The formats are the proof; a diagram of the idea is not |
| "Any model" as a row of text pills | Nine tiles with vendored CC0 Simple Icons marks, plus a note on why two are text | Named marks read faster than pills; the two omissions are themselves a trust signal |
| Benchmarks as a 4-up card grid | Full-bleed headline row (a deliberate rhythm break), then four tracks, then a "what we did not run" box | Full-bleed breaks a page that has started to feel like one long column |
| Cold zinc throughout | Game Boy DMG-green palette on `/` only | The dashboard is an application and a tinted canvas reads as a mistake there; the marketing page is a choice — and the product is a terminal agent with a TUI, so it is drawn as the screen it lives in |
| One font pair | Geist Sans for body + three pixel faces for chrome, headings and terminal text | A serif italic used to signal "someone else's words, quoted"; on a Game Boy page the quoted word is game text, so `.quote` is VT323 and the serif was dropped |

## Part 3b — Why the page is a Game Boy

The second redesign. The alphabet stayed; everything it is printed on changed.

- **The palette is DMG-01, inverted.** `#0f380f / #306230 / #8bac0f / #9bbc0f`
  are public-domain facts about a 1989 LCD, which is what lets the page look
  like this without shipping any Pokémon art. The canvas is the darkest of the
  four pushed one step down (`#0a140a`); `bg-glow` *is* the DMG shade-4 fill,
  so a dialogue box on this page is literally the game's dialogue box.
- **Two accents, both cartridge-era.** Pokémon yellow `#ffcb05` and Poké-Ball
  red `#ff6a4d`, used sparingly — stat figures and deny states, never fills.
- **Depth is stacked rings, not drop shadows.** On a dark canvas an offset
  shadow paints nothing, so `.gb-box` / `.gb-panel` build a dark ring, a light
  gap and a dark edge instead.
- **Square corners, everywhere.** A pixel language with antialiased corner
  radii is a contradiction; the one-pixel chamfer people remember from Gen 1
  cannot be faked cleanly.
- **Stepped motion for furniture, smooth for page motion.** Buttons, hovers and
  toggles advance in `steps(2)` frames like a sprite swap; scroll reveals keep
  their smooth interpolation because they are page motion, not UI state.
- **The screen has a screen.** A 4px LCD pixel grid sits over the canvas and a
  fixed CRT scanline layer sits over that — the grid is the screen, the
  scanlines are the camera.

## Part 4 — Motion rules

The rule the page follows everywhere: **motion is additive, never
load-bearing.**

- Scroll reveals are CSS `animation-timeline: view()`, gated behind
  `@supports ((animation-timeline: view()) and (animation-range: 0% 100%))`.
  The un-animated base state is the *finished* state, so Firefox and
  reduced-motion visitors see an identical page.
- The hero seal assembles itself on scroll for the same reason.
- Micro-interactions (`lift`, `glow-hover`, `link-sweep`) are 150–260ms state
  changes on hover or focus. Nothing loops for decoration.
- `prefers-reduced-motion` is honoured in CSS **and** in every JS path,
  including the session replay, which paints the finished transcript and never
  autoplays.

Scroll-driven animations are Chromium + Safari 26 today and not Baseline, which
is exactly why the finished state is the base state rather than the animation.

## Part 5 — Sourcing rules for the page

The page quotes copyrighted game text and leans on a trademark. Both are handled
by the same posture: **short, attributed, and never more than the point needs.**

### Quoting game text

Commodore, check every entry in `lexicon.ts` and `field-notes.tsx`:

- **Verified only.** Each line was checked against Bulbapedia, PokémonDB,
  Wikipedia or ssbwiki. Quotes carry the source in the UI (`Pokédex · Platinum`,
  `Ruins of Alph inscription`) so a reader is never left guessing whose words
  these are.
- **Short and transformative.** One or two sentences each, used to make a point
  about *this* product. No dex-text database, no bulk reproduction.
- **Bulbapedia prose is CC BY-NC-SA**, which is incompatible with this repo's
  licence. Non-quote lore is therefore paraphrased from facts (facts are not
  copyrightable), not lifted from Bulbapedia's sentences.

### Claims that were checked and deliberately dropped

The first lore pass produced several popular-but-wrong claims. They are absent,
and the audit is recorded here so nobody re-adds them:

| Claim | Status |
|---|---|
| Japanese name is "Fontoasshi" (font) | **False.** It is アンノーン, the word "Unknown" |
| Unown appear in Lavender Town | **False.** The Ruins of Alph |
| "If it sleeps it becomes a stick" | **False.** Belongs to Ditto |
| Unown letters in Undertale/Deltarune SAVE points | **Unsupported.** W.D. Gaster's Wingdings text, not Unown |
| Unown's ability is Hidden Power | **Wrong.** Levitate is the ability; Hidden Power is its move |
| "Form depends on what the observer desires" | **Not canon.** Closest real thing is the film's wish-granting |
| Letters rain when a Unown faints | **Unverified.** No documentation found |

### What the page does say, and why it is true

- **Unown is #0201, the Symbol Pokémon**, alive since Gen II — Bulbapedia.
- **26 letters in 1999, `!` and `?` in 2004** — Bulbapedia, Wikipedia.
- **The punctuation forms have half-closed eyes; the letters do not** —
  Bulbapedia, Biology. The page's own `!` and `?` follow the rule.
- **"When alone, nothing happens. However, if there are two or more, an odd
  power is said to emerge."** — Pokédex, Platinum/Black/White. This is the
  design brief for the two-half architecture, quoted in full and attributed.
- **"…a mystery as to which came first, the ancient writings or the various
  UNOWN."** — Pokédex, Ruby/Sapphire.
- **"OUR WORDS SHALL REMAIN HERE FOR THE AGES"** — Ruins of Alph inscription.
- **In Johto a wild Unown's letter came from its IVs** — Gen II internals.
- **Icognito (German), Zarbi (French, verlan)** — PokémonDB, Bulbapedia.

### Non-affiliation

The footer and the two lore sections carry the same sentence: an independent
open-source project, not affiliated with, endorsed by or sponsored by Nintendo,
Game Freak, Creatures Inc. or The Pokémon Company, with the trademarks attributed
to their owners. On a page that leans this hard on the reference, that sentence
is load-bearing.

## Part 6 — Third-party assets

Everything shipped is either generated here or explicitly licensed:

| Asset | Source | Licence | How it ships |
|---|---|---|---|
| The 28-form script | drawn in this repo | ours | inline SVG path data |
| LCD pixel grid + CRT scanlines | repeating gradients in `landing.css` | ours (generated) | a few hundred bytes, no `feTurbulence`, no network request |
| Press Start 2P, Pixelify Sans, VT323 | Google Fonts | OFL-1.1 | self-hosted by `next/font`; pixel chrome, headings and terminal/dialogue text |
| Geist Sans | Vercel | OFL-1.1 | self-hosted by `next/font`; all body copy — a pixel body face costs readability and the Lighthouse 1.00 |
| Provider marks | Simple Icons | CC0-1.0 | path data vendored by `scripts/vendor-provider-marks.mjs` |
| Star count | `api.github.com` | public API | fetched at build/ISR, with a hard fallback |

**Not used, on purpose:** any Pokémon sprite, card, logo, artwork or audio;
Bulbapedia or Serebii imagery (fair-use on their site is not a licence to
rehost); fan-made Unown fonts; stock nebula photography (a public-domain NASA
frame still reads as template slop behind a dev-tool page at any opacity worth
seeing); and live star-history widgets (broken by GitHub's 2026 stargazer-listing
restriction).

## Part 7 — Assets

Live dashboard captures in `public/landing/`, seeded with real engine data:
`dash-overview.png` (primary), `dash-learning-lab.png`, `dash-hooks.png`.

## Part 8 — Headline work

- **H1:** "It reads what you write down." — the pun, the mechanic, and a
  question the reader has to finish.
- **Rejected:** "The self-improving terminal agent." (correct, forgettable),
  "Your terminal agent, dreaming at night." (kept as section copy),
  "Stop re-explaining your codebase." (kept as the closing line, where it earns
  its place after the page has made the case).

## Part 9 — How to keep it honest

- Every number on the page has a receipt in `benchmarks/`. If a benchmark lands,
  update the const **and** the receipts in the same commit.
- The engine artifacts quoted in the loop section are literal formats from
  `termhooks.ts`, `harness.ts` and `.unown/memory/project.md`. If any of those
  change, the quotes change with them.
- Live counters the current checkout cannot reproduce ("60+ verified runs") are
  not on the page and must not be added.
- New lore goes through Part 5 before it goes into `lexicon.ts`.

## Part 10 — The second scheme, and where the colour is allowed to live

The page originally shipped one scheme: the emissive green-on-black everyone
associates with the handheld. It now ships two, and the second one had to be as
defensible as the first. This part is the research behind the light scheme and
the colour treatment.

### What the hardware actually does

The 1989 DMG-01 has **no backlight**. It is a reflective STN LCD: a mirror
behind the panel bounces ambient light back through the polariser and the
liquid-crystal layer, and a pixel reads dark when the crystals twist to block
that light. Four nominal shades per pixel (`#0f380f / #306230 / #8bac0f /
#9bbc0f`, darkest to lightest) — the same public-domain facts the rest of the
page is built on.

So there are two honest presentations of one screen, and the page uses one per
scheme:

| Presentation | How you see it | Page scheme |
| --- | --- | --- |
| Unmodified hardware in a lit room | dark olive ink on a pale reflector | **light** |
| Backlit mod, emulator, low-light photo | the four shades glowing on dark | **dark** |

"Green-on-black" is not what a stock DMG looks like in daylight — it is the
emulator / backlit presentation. Both are period-correct; the nav toggle just
picks which room the handheld is sitting in.

### The reflector value is art-directed, not sampled — and the tradeoff

A real unlit DMG reflector is a pea-soup yellow-green (around `#c4cfa1`). The
page's light canvas is `#eae5c8` — warmer and lighter than the hardware. That
is a deliberate, disclosed trade: WCAG AA needs every text token to clear
4.5:1 against the canvas, and a darker, more accurate reflector squeezes the
headroom on the lighter tokens (`faint`, the SGB rims) below the line. The
light scheme is therefore "an unlit LCD in a bright room, tuned for
legibility", not a colour-meter reading of a photographed screen. The ink
(`#1c2810`) is the dark-olive end of the same family, so the pair still reads
as one LCD.

### Why the colour lives in the frame: the Super Game Boy

The brief was "more colour in both modes" without abandoning a monochrome
identity. The Super Game Boy (1994, SNES accessory) is the period-accurate
answer: it ran Game Boy cartridges but had the SNES draw a **full-colour
decorative border** around a play field that stayed the handheld's four shades
unless a game explicitly opted into colourisation. The default behaviour —
vivid frame, monochrome content — is precisely the constraint this page wants:
body copy and headings stay DMG, and the colour budget is spent on chrome.

### The colour budget, and what it deliberately does not spend

- **Spent on:** dialogue-box and panel rims, terminal/browser title bars, the
  pixel kicker on each section head, and the alphabet's 28 tiles (which cycle
  the four hues as rims — a labelled-drawer wall, the SGB border at its most
  literal).
- **Not spent on:** body copy, `font-display` headings, or glyph fills — the
  play area stays monochrome. The Unown eyes stay `dim` except where one glyph
  is the subject; twenty-eight lit eyes strobe.
- **The four hues** (`sgb-cream / sgb-amber / sgb-brick / sgb-purple`) were
  picked to clear AA as a rim against the panel surface *and* as a fill under
  `text-canvas` in **both** schemes. Each has a dark/light dual, separately
  tuned: the light scheme's hues sit at the dark, saturated end so they hold on
  a pale reflector, the dark scheme's at the bright end so they read on
  near-black. Every ratio is in the landing `AGENTS.md` Verification section
  and re-checked by `bun scripts/contrast_audit.mjs`, which walks both schemes.

### Rejected

- **A pastel "light mode"** (white cards, blue accents) — it would read as a
  generic modern site and throw away the LCD premise. The light scheme had to
  be the *same hardware in different light*, not a second brand.
- **Full-colour text or headings** — the moment body copy takes a hue the page
  stops being a Game Boy screen and starts being a slide deck, and contrast
  collapses: one accent that passes on a dark panel fails on a pale reflector.
- **Pixel-sampling a photographed DMG screen** for the reflector — it costs the
  contrast headroom the AA contract needs. Disclosed and tuned instead.