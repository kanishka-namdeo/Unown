# Landing Page — Research & Design Rationale

Why the marketing page (`/`) looks the way it does, and the sourcing rules that
keep its claims defensible. First written 2026-10 when the page was a
conventional hero-plus-features layout; rewritten after the page was rebuilt
around a purpose-drawn alphabet; rewritten again when that page was re-skinned
as a Game Boy — the structure above barely moved, but the palette, type and
surface treatment all did, and the reasoning for each is below. A later pass
changed no pixels: an audit of what the page says twice, in Part 12.

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
- [Part 11 — The generation changes: Game Boy Advance, and a grid you can check](#part-11--the-generation-changes-game-boy-advance-and-a-grid-you-can-check)
- [Part 12 — The density pass: one fact, one home](#part-12--the-density-pass-one-fact-one-home)
- [Part 13 — The eight-band compression: scroll, words and the budget that keeps them down](#part-13--the-eight-band-compression-scroll-words-and-the-budget-that-keeps-them-down)

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

*This part describes the pre-GBA palette and is superseded by Part 11; it is
kept because it records why the page went retro in the first place.*

## Part 4 — Motion rules

The rule the page follows everywhere: **motion is additive, never
load-bearing.**

- Reveals run on two systems: CSS `animation-timeline: view()` for the `.rise`
  blocks and the hero seal, gated behind `@supports ((animation-timeline:
  view()) and (animation-range: 0% 100%))`, and framer-motion `whileInView` for
  the copy (`FadeUp`). The un-animated base state is the *finished* state on
  both, so Firefox and reduced-motion visitors see an identical page.
- The hero seal assembles itself on scroll for the same reason.
- Micro-interactions (`lift`, `glow-hover`, `link-sweep`) are 150–260ms state
  changes on hover or focus. Nothing loops for decoration.
- `prefers-reduced-motion` is honoured in CSS **and** in every JS path, and
  since the density pass the page root enforces it for framer wholesale:
  `page.tsx` wraps the tree in `LandingMotion` (`MotionConfig
  reducedMotion="user"`), which covers the staged reveals written as bare
  `motion` elements — the origin pipeline, the integrity hook log, the finale
  spellbox — without every call site re-checking the preference. The session
  replay paints the finished transcript and never autoplays.
- A framer reveal may animate `opacity` and `transform` only. The `<noscript>`
  restore in `effects.tsx` keys on the two properties framer serialises, so a
  `width` tween stays at zero with scripting off; bars keep their finished
  width in `style` and animate `scaleX` from 0.
- The FAQ accordion is the one animation on `height`, and it is furniture
  rather than a reveal: a closed panel has no finished state to preserve. Its
  `@keyframes` live in `landing.css` and its `--animate-*` tokens in
  `globals.css`, because Tailwind only resolves theme tokens in the file that
  imports it. It also carries its own `prefers-reduced-motion` override, since
  plain CSS keyframes do not consult the preference. It had been silently
  broken — the utilities compiled to nothing and no gate noticed — so the
  landing doc now checks it by computed style.

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
| LCD pixel grid | repeating gradients in `landing.css` | ours (generated) | a few hundred bytes, no `feTurbulence`, no network request |
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

*(Superseded 2026-10-21 — D7 retired the web dashboard: the `dash-overview.png` / `dash-learning-lab.png` / `dash-hooks.png` captures and the later `dash-*.png` set were removed. The showcase now frames real `unown dashboard` TUI stills from `public/landing/tui/dashboard/stills/` — twelve PTY captures with pane receipts, produced by the `scripts/tui-capture/` lane. The research below is kept as the record of the original asset decision.)*

Live dashboard captures in `public/landing/`, seeded with real engine data:
`dash-overview.png` (primary), `dash-learning-lab.png`, `dash-hooks.png`.

## Part 8 — Headline work

- **H1:** "It reads what you write down." — the pun, the mechanic, and a
  question the reader has to finish.
- **Rejected:** "The self-improving terminal agent." (correct, forgettable),
  "Your terminal agent, dreaming at night." (kept as section copy),
  "Stop re-explaining your codebase." (was the closing line for two revisions;
  cut in the density pass, because mechanisms 01 already names that pain. The
  close is now "One afternoon, and then it starts remembering.", which states
  the payoff instead of the problem).

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

*Superseded by Part 11 — the DMG reflector premise and the Super Game Boy frame
rule were replaced by the Game Boy Advance palette; the disclosures below are
kept because they are the precedent Part 11 follows for disclosing
art-direction.*

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

## Part 11 — The generation changes: Game Boy Advance, and a grid you can check

The page now simulates a [Game Boy Advance](https://en.wikipedia.org/wiki/Game_Boy_Advance) —
a 2001 full-colour TFT handheld — and the whole colour system moved with it: two
schemes, five hues, and a hardware rule a reader can check. Parts 3b and 10 are
superseded on colour and stay as written; their disclosures are the precedent
this part follows.

### Why the DMG premise had to go

- A GBA screen is **full-colour** — 15 bits per pixel, 32,768 colours on screen
  ([Tonc](https://gbadev.net/tonc/hardware.html)) — so "monochrome play area,
  colour only in the frame" cannot survive as a rule. There is no monochrome
  play area to protect.
- The Super Game Boy is a **different machine** from the one now referenced: a
  1994 SNES accessory, not a GBA feature. And even the DMG-01 quad Parts 3b and
  10 are built on cannot be painted on a GBA — `0f`, `38`, `30`, `9b` and `bc`
  are not channel values the panel can produce.

### The hardware rule, and why it is checkable

- A GBA pixel stores **5 bits per channel** (0-31)
  ([Tonc](https://gbadev.net/tonc/hardware.html)), and a ROM palette value `v`
  reaches the screen as `floor(255*v/31)`
  ([GBATEK, LCD Colour Palettes](https://problemkaputt.de/gbatek-lcd-color-palettes.htm))
  — which admits exactly **32 values per channel**:
  `00 08 10 18 20 29 31 39 41 4a 52 5a 62 6a 73 7b 83 8b 94 9c a4 ac b4 bd c5 cd d5 de e6 ee f6 ff`.
- Consequences worth stating plainly: `#ffffff` **is** a legal GBA colour and
  `#f8f8f8` **is not**. Everything the previous palette leaned on was off the
  grid — `#0a140a`, `#0f1d0f`, `#142614`, `#e9f6d9`, `#b3cf90`, `#88a66a`,
  `#9bbc0f`, `#c3e06a`, `#ffcb05`, `#ff6a4d`, `#eae5c8`, `#5f7f4a`, `#04100a`,
  and the four SGB hues `#f8e8c8`/`#d89048`/`#e86a5a`/`#b48cf2`.
- The reference palettes are **ROM data, not taste**: `pret/pokeruby`'s
  [`graphics/` `.pal` files](https://github.com/pret/pokeruby) are published as
  the Lospec
  "[Pokémon Ruby & Sapphire Exterior](https://lospec.com/palette-list/pokemon-ruby-sapphire-exterior)"
  (56 swatches) and
  "[Interior](https://lospec.com/palette-list/pokemon-ruby-sapphire-interior)"
  (33 swatches) sets, and every swatch in both renders onto the 32-value grid.
- `scripts/gba_palette_check.mjs` fails the run on any channel value not on the
  grid. That is what turns the sentence "every colour on this page is a legal
  Game Boy Advance colour" from a vibe into a falsifiable claim.

### The two schemes are the two halves of the generation

- **DARK is Hoenn at night (Ruby/Sapphire/Emerald).** The canvas family is the
  navy the menu, the PokéNav and the cave interiors are drawn from; the panels
  step up `#102039 → #182952 → #29315a`, the ink is `#dee6ee`, and the
  navy-plus-gold pairing (`#ffc55a`) is what reads Gen 3 to anyone who grew up
  in it.
- **LIGHT is Kanto in daylight (FireRed/LeafGreen).** The canvas is the interior
  cream `#e6e6d5` (panels `#d5d5b4`/`#cdcdc5`), the ink is that same Hoenn navy
  — the two schemes share their darkest value.
- **The honest caveat: no public FireRed/LeafGreen `.pal` dump exists.** The
  light scheme is built from the verified RSE dumps pushed to their warm,
  bright end. That is disclosed art-direction, in the same tradition as
  Part 10's reflector disclosure — nothing on the page should be read as
  claiming the light values were sampled from an FRLG ROM.

### The five hues, and where each comes from

- **aqua** (dark `#62acee` / light `#203952`) and **magma** (`#ff8b41` /
  `#732908`) are Ruby's and Sapphire's two teams. **leaf** (`#83c562` /
  `#294118`) is Hoenn's grass plus Emerald's documented blue→green shift of the
  window-frame hue
  ([Voliol, Pokémon Palettes in Generation III](https://voliol.neocities.org/articles/genIIIpalettes)).
  **psychic** (`#f67b9c` / `#6a2052`) is Unown's own Pokémon type
  ([ColorDex](https://www.pokemonaaah.net/art/colordex/)), snapped onto the
  grid. **gold** (`#ffc55a` / `#5a3108`) is the default — Gen 3's menu
  highlight.
- Each hue ships a `-field` companion used as that section's tinted surface:
  aqua `#102939`/`#dee6ee`, magma `#291020`/`#eed5cd`, leaf `#102918`/`#d5e6cd`,
  psychic `#291029`/`#e6d5de`, gold `#292010`/`#eee6cd`. Colour now rides on the
  section itself, not its chrome — the fields are the successor to the frame
  rule.
- **Allocation is a rule, not a vibe:** `psychic` is reserved for the three
  sections about Unown itself (hero, alphabet, field notes); the remaining ten
  sections cycle aqua → leaf → magma → gold in page order.

### What the CRT layer was doing there, and why it is gone

- The old page painted a fixed CRT scanline + vignette layer **over an LCD
  simulation** — a camera looking at a tube that the machine never had. A GBA is
  a thin-film-transistor panel
  ([Wikipedia](https://en.wikipedia.org/wiki/Game_Boy_Advance)); it has no
  scanlines, so the layer could not survive the move.
- The LCD pixel grid stays — the panel is still made of addressable squares —
  retuned from 4px to 3px because the GBA's dot pitch is much finer than the
  1989 handheld's. It remains art-directed for the same disclosed reason as
  before: a browser cannot address 0.25mm, only approximate it.

### Contrast, measured, both schemes

- The invariant widened with the fields: a text token is no longer checked only
  against the three neutral surfaces, but against **all five section fields and
  every `/10` tint chip composited over each field — 43 surfaces per scheme**.
- The widening was caused by a real regression the first version of the static
  gate missed: it checked each accent only against *its own* field, and
  `text-gold` inside a magma section resolved to **4.49:1** — a pass that was
  not one.
- Worst-case ratio per text token, measured over all 43 surfaces:
  - DARK: `ink` 9.57 · `dim` 7.49 · `faint` 5.74 · `gold` 7.69 ·
    `gold-soft` 9.47 · `amber` 7.39 · `poke` 4.53 · `aqua` 4.97 ·
    `magma` 5.18 · `leaf` 5.82 · `psychic` 4.73
  - LIGHT: `ink` 9.81 · `dim` 8.55 · `faint` 7.52 · `gold` 6.73 ·
    `gold-soft` 7.84 · `amber` 6.15 · `poke` 6.46 · `aqua` 7.15 ·
    `magma` 6.17 · `leaf` 6.78 · `psychic` 6.51
- The live browser audit (`scripts/contrast_audit.mjs`) scanned **1059 visible
  text nodes across both schemes and reported zero AA failures** — the gate for
  this paragraph, same as before.

### Rejected

- **Inventing FireRed/LeafGreen hexes.** There is no dump to quote, so a
  "sampled" light scheme would be a citation to a ROM that does not exist in
  public. Disclosed art-direction instead.
- **Keeping the frame-only colour discipline.** It describes an SNES accessory,
  and it would strand five verified GBA hues in chrome on a machine whose whole
  point is a colour screen.
- **Keeping the scanline layer.** A GBA has none; there is no honest reading of
  the hardware on which it belongs.
- **A `filter: brightness()` hover.** Brightening a legal colour by a float
  factor invents an off-grid value — the claim dies at the first hover. The
  GBA's own route to a lighter step is
  [colour special effects](https://problemkaputt.de/gbatek-lcd-i-o-color-special-effects.htm)
  (alpha blending / brightness shifts), and `color-mix()` in the CSS is that
  mechanism.
- **Snapping the palette to multiples of 8.** A tempting 5-bit-ish grid — and a
  *different* 5-bit scale from `floor(255*v/31)`. It would have broken every
  value the ROM dumps actually use; `ff` alone is not a multiple of 8.

## Part 12 — The density pass: one fact, one home

The most recent pass deleted more than it wrote, and it began with a count
rather than an opinion. Two audits measured how often the page argues its own
load-bearing facts:

- The first found "verified twice in a fresh sandbox" stated **seven** times and
  the sandbox **three** times. Neither was a copy problem. Both were an
  information-architecture problem: by the third repetition the eye has learned
  the paragraph carries no new fact and skips the fourth.
- The fix was to give every load-bearing claim one canonical home and let all
  other mentions point at it. The second audit, run against that fix, found the
  page had instead *grown* — verify-twice back to ten statements, the
  non-affiliation notice to four, the provider list and the tier resolver to
  five each.

The rule both audits produced: **a duplicate fact is the cheapest word on the
page to delete, and deletion is the only edit that raises the lore share
without inventing prose.** About 450 words of restatement were cut across the
lexicon, the origin acts, the FAQ and the hero.

### The canonical homes

- **the gates** — `integrity.tsx` `GATES[]`; mechanisms 02/04/05 and the loop
  section describe the loop rather than restating the gate table;
- **the sandbox, both layers** — `integrity.tsx`; the mechanisms section keeps
  only the Flatpak / Claude Code comparison, which integrity has no equivalent
  of;
- **the model allow-list and the bridge** — `models.tsx`;
- **the non-affiliation notice** — the footer copy `verify-deploy.mjs` asserts.
  The two lore sections keep their own one-liners because they are the sections
  making a Pokémon claim;
- **"no font file, no image sprite"** — `alphabet.tsx`;
- **the Pokédex entry** — `field-notes.tsx`, reading `DEX_QUOTES` from
  `lexicon.ts`, so the same 33 words are no longer printed in origin too;
- **the caching negative control** — `benchmarks.tsx`.

### `means` is a decode, not a specification

The 28 lexicon `means` lines had accumulated 507 words that restated the gate
table, the sandbox, the tier resolver, the provider grid and the benchmark
numbers back at the page. They now sit under about twelve words each: name the
mechanism, and let the section that owns it do the explaining. `proof` stays a
bare number or a repo path.

### Lore you can read without hovering anything

The decode panel shows one lexicon entry at a time, so 25 of the 28 verified
lore bodies were reachable only through a pointer event. The `HIGHLIGHTS` strip
in `alphabet.tsx` lifts three forms into the intro column as static text —
chosen for register rather than fame — reading them from `LEXICON_BY_ID` so the
quotation stays single-sourced with the panel.

### The FAQ is seven questions

It carried nine. The dream-canary answer, the two-sandbox-policies answer, the
bridge spec and the long non-affiliation answer were all reprints of sections
the visitor had just scrolled past. The two that cannot be cut are the naming
question, and the one that admits the loop may correctly find nothing to do.
Every answer still has to pass "which section already said this?".

### Two relocations

- The **Konami hint** moved from the footer — 10px, under 58 words of
  trademark boilerplate, and `hidden sm:inline` — to the alphabet tiles, where
  a reader is already poking at glyphs. There the code reads as an escalation
  of an interaction they have already found.
- The **0.0 extension-authoring admission** moved from the bottom of benchmarks
  to a lit box directly under the gate table in integrity. It is the page's
  strongest trust artifact, and it was the least likely thing there to be
  read; beside the gates it is also the right kind of neighbour, a gate that
  says no.

### A lore budget, measured per screen

Authored lore-to-tech prose sits near 1:2, and that aggregate hides the real
problem: the lore arrived in two lumps (origin and alphabet at positions 2 and
3, field notes at 11) and left seven consecutive technical sections at 0%
between them. Two rules came out of it:

- **No more than three consecutive sections at zero lore.**
- **One punchline per section, each a different kind of thing** — an aphorism,
  a reveal, a callback, a joke, an admission, a plain instruction. The middle
  seven were all aphorisms, and three of them were the same joke told with
  different nouns, which is what actually reads as boring.

The proof zone stays technical on purpose: Pokémon in a benchmark table would
be a costume and would fight the no-fabrication rule. And where a sequence was
rendered as simultaneity — the origin acts fading in together, a hook log as a
static table — the fix was staging, not a paragraph. One exception is
deliberate: a number that counts up, or a figure that ticks from zero, reads as
fabrication on a page whose argument is that its numbers are checkable. Animate
the container, never the measurement.

`field-notes` stays at position 11 despite reading better next to `alphabet`:
the three psychic sections are interleaved on purpose so no two neighbours
share a hue, and front-loading the lore would run the conversion path
(benchmarks → integrity → quickstart → finale) together as one technical block.
## 2026-10-18 — quickstart copy: the SDLC-parity session surface

The quickstart's "The whole command surface" block and its session-tools
paragraph are the canonical home of the terminal-agent command claims (the
quickstart test pins every line). The 2026-10-18 feature-parity effort
(`docs/sdlc-feature-parity.md`) added five capabilities to the terminal agent —
LSP code intelligence, checkpoints + the receipts audit ledger, the MCP
client, `/review`, and `/goal` — so this section's copy moved with them:

- `COMMANDS` gains the `unown --goal "…"` line ("durable goal — completion
  needs cited evidence"), next to `--plan`, matching the same flag-driven
  framing. The line states the evidence contract because that is the
  differentiator versus plan mode, and the claim is checkable against
  `docs/usage.md#goals-goal`.
- The session-tools paragraph now names `lsp` ("language-server intelligence —
  diagnostics ride every edit"), the MCP join story (`.unown/mcp.json` →
  `mcp__server__tool`), and the six load-bearing slash commands
  (`/plan /review /goal /undo /receipts /mcp`) before the originals. The
  one-fact-per-section rule is respected: no other landing section states any
  of these — the mechanisms/integrity sections keep describing the five
  self-learning mechanisms, which did not change.
- No palette, layout, or motion changes: the additions reuse the existing
  `text-faint`/`text-dim`/`font-mono` classes on the same grid, so the palette
  gate and contrast audit results are unchanged (palette check re-run: PASS,
  21 dark + 21 light tokens, all AA). The quickstart component test pins the
  new claims so the changed-line coverage gate stays satisfied.

## 2026-10-18 — productization copy: the mcp quickstart line and the trust-gate story

The same day's productization pass (P1, see CHANGELOG) made the SDLC surface
manageable without hand-editing JSON and hardened it against hostile configs
(H2). Two claims moved onto the page, each into its canonical home:

- `quickstart.tsx` `COMMANDS` gains `unown mcp add playwright npx
  @playwright/mcp@latest` ("connect any MCP server — its tools join every
  session"). The command is real (`mcp-cli.ts`'s flag grammar: `add <name>
  <command> [args...]`, user scope default) and shows the zero-config-to-MCP
  path in one line — the fastest answer to "can it use my MCP servers?".
  Placement follows the existing command list; classes unchanged.
- `integrity.tsx` (the section that owns safety/hook/sandbox claims) gains
  the "Cloned configs don't get to execute" block: project-scoped MCP/LSP
  configs are trust-gated refuse-first; approvals pin file fingerprints, so
  a changed file or the same name in another checkout re-arms the gate.
  The receipts row "config trust gate" links to `src/config-trust.ts`. No
  other section restates the gate — the quickstart names `.unown/mcp.json`
  as where servers live, without the safety claim.
- Canonical-homes list (`AGENTS.md` in this folder) registers both new
  claims AND back-registers the 2026-10-18 quickstart session-surface
  claims that shipped without registration (audit finding — the most
  expensive future-staleness vector).
- No palette/layout/motion changes — text-only additions on existing
  classes; palette gate re-run: PASS (21 dark + 21 light tokens, all AA);
  `public/landing/*.png` regenerated via the og-shots pipeline (the hero
  renders the quickstart command list). Quickstart component test extended
  to pin the new line.

## 2026-10-18 — the shipping rail: a timeline the repository can vouch for

The brief was to show the project's continuous feature additions as a timeline.
The research changed that design twice before a line of the section was written,
and the second change was the reason the section exists at all.

### What was studied

Live fetches of the changelog/roadmap surfaces dev tools actually maintain.
Every row below was read on the day; the fetches that failed are listed after
the table rather than filled in from memory.

| Site | Metaphor | Dates shown | Grouping | Shipped vs planned | Depth before linking out |
|---|---|---|---|---|---|
| [Linear](https://linear.app/changelog) | date-grouped cards, one column | `October 8, 2026` | none | shipped only | paginated |
| [Vercel](https://vercel.com/changelog) | date-headed cards | `17 Oct` | none | shipped only | 10, then "Show more" |
| [Raycast](https://www.raycast.com/changelog) | version-led cards | `v2.8` + full date | **by version** | shipped only | numbered pages |
| [Cursor](https://cursor.com/changelog) | flat reverse-chronology | `Oct 16, 2026` | none | shipped only | **4** |
| [Supabase](https://supabase.com/changelog) | list | `YYYY-MM-DD` | none | shipped | type + product tags |
| [GitHub changelog](https://github.blog/changelog/) | month-headed cards | `Oct.16` | by month | shipped | product tags, RSS |
| [PostHog](https://posthog.com/changelog) | month → date | month headers | by month | shipped | tags |
| [Plaid](https://plaid.com/docs/changelog/) | list | `Month Day, Year` | none | shipped | "Filter by product" |
| [Devin release notes](https://docs.devin.ai/release-notes/overview) | date-headed blocks | `October 16, 2026` | by date | shipped | docs index |
| [Bun](https://bun.com/blog) | **year-grouped** | `Oct 10, 2026` | by year | shipped | RSS |
| [Figma What's new](https://www.figma.com/whats-new/) | topic grid | loose | by topic | **"In progress" / "Shipped"** | detail links |
| [Astro roadmap](https://github.com/withastro/roadmap) | repo process | none | by stage | Proposal → RFC → Ship it | stage |
| [shadcn/ui](https://ui.shadcn.com/docs/changelog) | `Month Year – Title` | absolute | none | shipped | **2**, then "More Updates" |

Failed fetches, recorded so nobody re-cites them: OpenAI release notes (403),
Fathom `/changelog` (404), Plus UI (network), Height.io roadmap (522 twice),
`supabase.com/roadmap` (404), `astro.build/blog/releases` (404), Carbon's
timeline usage page (404), and the roadmap-example roundups that ship as a JS
shell. Resend returned a bare link list, which is inconclusive rather than
evidence.

Four decisions came out of it, and each is visible in the section:

1. **A window, not an archive.** Cursor shows 4 entries, shadcn 2, Vercel 10.
   The rail lists at most 8 titles per stop and counts the remainder out to
   `CHANGELOG.md`. A landing section that reproduces the changelog is a worse
   copy of the changelog.
2. **Absolute dates only.** Relative dates ("last week") rot the moment an
   entry is appended, and a stale relative date is a lie that no edit caused.
3. **Unshipped work carries no date.** [NN/g on roadmaps vs
   timelines](https://www.nngroup.com/videos/roadmaps-vs-project-timelines/):
   roadmaps deliberately avoid dates because a dated plan is a promise, and
   Figma's two-label split is the minimum honest version of the same idea. So
   `[Unreleased]` renders as "Not cut yet" with no date at all.
4. **Every entry links to an artifact**, which is also the only way to satisfy
   the page's own sourcing rule. [Keep a Changelog
   1.1.0](https://keepachangelog.com/en/1.1.0/) supplies the heading and
   category grammar the parser reads, and [Common
   Changelog](https://common-changelog.org/) the stricter four-category variant;
   the repo follows KaC, so the parser follows KaC.

Rejected: commit-graph and contribution-heatmap metaphors (decorative, and the
underlying counts are not in the checkout), colour-only status (fails
[WCAG 1.4.1](https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html)
against this page's five section hues), and any hover-revealed detail, which
Part 12 already rules out.

### The finding that killed the obvious design

A timeline invites a cadence sentence, and this repository cannot support one.
`git log` (measured in this checkout, `[V]`): 190 commits, and only **seven
distinct commit days**, with a 48-day hole between 2026-08-28 and 2026-10-15.
Two tags, `v2.0.0` and `v2.1.0`, both dated 2026-10-18 and cut 2.6 hours apart,
with 13 untagged commits since. `gh release list` `[V]`: both published,
08:22:44Z and 11:06:10Z.

So "shipping weekly", "a release every two weeks", or a rail whose spacing
implies rhythm would have been the page's first fabricated claim, in the section
whose entire purpose is being a record. The section states dates and says nothing
about rhythm; `__tests__/changelog.test.tsx` greps its own rendered text for
weekly/monthly/continuous phrasing so a later copy-edit cannot add it by
accident. The honest version of "continuous" here is the top stop: work merged
and waiting to be cut, which is what a rail with an undated head actually shows.

Writing the parser surfaced the `CHANGELOG.md` hazards that a naive one would
swallow silently `[V]`: two `### Fixed` blocks inside one stop (a `###`-keyed map
merges them into a bucket of the wrong size), `### Added (Agent Behavior)` and
`### Added (folded from Unreleased)` as non-spec suffixes, behavior entries filed
as a heading in `[Unreleased]` but as `**Agent Behavior:**` bullet prefixes in
`[2.1.0]`, and bottom-of-file link defs that are stale in both directions (no
`[2.1.0]` def, and the comment "No tags exist yet" sitting under two tags). Each
is now either handled by a stated rule or a hard failure.

### Generated, not authored

The section is the page's only content that is not typed into a component.
`scripts/landing_changelog.mjs` derives
`src/components/landing/changelog-data.ts` from `CHANGELOG.md`, and CI's landing
job runs `--check`, so the rail and the changelog cannot disagree. That is the
answer to the question this doc keeps having to re-answer, namely how a landing
page stays true after the session that wrote it: the entry the next agent is
already required to add to `CHANGELOG.md` *is* the update to the page. The
binding rule is recorded in root `AGENTS.md`'s same-change sync map and in
`CONTRIBUTING.md`'s checklist, and it is enforced by a red build rather than by
good intentions.

Because `--check` compares the committed file against the same parser, it cannot
detect a parser that mislabels an entry, so the extractor has its own suite
(`node --test scripts/landing_changelog.test.mjs`, also a CI step). One of its
tests spawns the CLI purely to assert it still prints a verdict: a
self-invocation guard that never matches would exit 0 having checked nothing,
which is how a gate becomes decorative.

### Accessibility shape, and what it forbade

The ARIA authoring practices define no timeline pattern, so the markup invents
nothing: an `<ol role="list" reversed>` of stops, each with a real heading so
heading navigation reaches the dates
([WCAG 1.3.1](https://www.w3.org/WAI/WCAG21/Understanding/info-and-relationships.html),
techniques H42 and H48), entries as a nested `<ul role="list">` (the
`role="list"` is required because Safari drops list semantics when markers are
hidden, per [Scott O'Hara's
note](https://www.scottohara.me/blog/2019-01-12/lists-and-safari.html)), and
`<time datetime>` carrying the ISO date with no element descendants. The
`shipped`/`not cut` distinction is carried by the words "Not cut yet" and the
version label, never by the node marker's fill. The rail is a single column at
every width, so there is no narrow-screen reflow to get wrong.

Motion follows the folder's existing rule rather than adding a new one: the
vertical rail is a static `border-l`, and stops arrive through `FadeUp`, which
carries both `opacity:0` and a `transform` and is therefore reachable by the
`<noscript>` restore. A `scaleY` rail tween would have been the width-tween bug
reopened, and the no-JS pass confirms it is not: with scripting disabled the
section renders complete, as it does under `prefers-reduced-motion`.

### Two defects the verification pass caught

- **`57` rendered as `S7`.** The first draft set the entry count in the `h2`,
  and Pixelify Sans's 5 and 7 are indistinguishable at that size in both
  schemes. On the one page whose argument is that its numbers are checkable, an
  ambiguous digit is a defect, so counts now live in the lead (Geist, with a
  `font-mono` span) and the component test asserts its own `h2` holds no digit.
  The rule is in `src/components/landing/AGENTS.md` under the type system.
- **Four landing gates could not run on a clean checkout.** `landing_shots`,
  `contrast_audit`, `theme_toggle_check` and `landing_og_shots` resolve
  chromium from a candidate list ending in the bare specifier `playwright`, but
  passed every candidate through `pathToFileURL`, which turns it into
  `file:///playwright`. The documented fallback was dead code, and with the
  retired `download/.pwtools/` scratch install absent the gates exited with
  "playwright not resolvable". Bare specifiers now stay bare (as
  `brand_render`/`mermaid_check`/`shots_capture` already did); recorded in
  `scripts/AGENTS.md`.

### Receipts

Palette gate PASS (21 dark + 21 light tokens, all AA, no hex in the new
component). Contrast audit PASS, 1372 text nodes across both schemes (up from
1059 before the section). axe-core on `/` PASS, zero WCAG 2.1 AA violations.
Theme-toggle check PASS. `landing_shots --mobile` PASS: 28 section shots in two
schemes with no console errors, the new section picked up by the DOM-derived
plan without editing the script. Unit suite 237 pass / 0 fail; parser suite
8 pass / 0 fail; `bun run build` green with `/` prerendered; `check:changelog`
green: 3 stops, 57 entries, 2 dated. `public/landing/*.png` regenerated against
the shipped palette. Mobile 390px and 320px, reduced-motion and no-JS passes
captured for this section specifically, since the shared shot plan samples only
first/middle/last for those passes.


## 2026-10-18 — the rail goes horizontal, and why not the flashy way

The first cut of the shipping rail was a vertical list of release stops. It
passed every gate and the owner rejected it on two grounds: it was not cinematic,
and it could not scale — a vertical list makes the section's height a function of
how much the project has shipped, so the page grows a screen taller every few
releases. Both complaints are the same complaint: the shape was wrong for the
data.

### What the second round of research settled

The structural claim worth having is that **nothing that ships encodes years of
history as a page-growing vertical list.** It is either a fixed-height chart with
a calendar axis — the [Node.js release
schedule](https://nodejs.org/en/about/previous-releases) as a static Gantt,
[endoflife.date](https://endoflife.date/firefox) rows per version, the [GitHub
contributions
graph](https://docs.github.com/en/account-and-profile/concepts/contributions-on-your-profile)
with its hard 52-week window, [Productboard's](https://support.productboard.com/hc/en-us/articles/25194944993939-Timeline-boards-Flexible-time-based-roadmaps)
zoomable weeks/months/quarters — or ordinal beads with bucketing and an archive:
[Vercel](https://vercel.com/changelog) caps and paginates,
[Firefox](https://www.firefox.com/en-US/firefox/notes/) keeps one full release and
links the rest, [Factorio](https://wiki.factorio.com/Version_history) splits by
major, [Minecraft's wiki](https://minecraft.wiki/w/Java_Edition_version_history)
collapses by era. The rail joins the second family, with native horizontal scroll
as the thing that makes "and then forty more" cost nothing.

The pattern study also corrected a habit: [Apple's product
pages](https://www.apple.com/airpods-pro/) — the obvious reference for
"cinematic" — get it from full-viewport pinned panels, and there is no horizontal
timeline anywhere on them. That is the technique this section must not copy.

### The decision that mattered most: reject the pinned horizontal panel

The scroll-jacked version (a tall container that translates the band sideways as
you scroll down) is the form that looks most cinematic in a screenshot. It was
rejected on evidence, not taste:

- It is the same defect wearing a different coat. A pinned band needs a container
  as tall as its travel — the reference implementations are multi-hundred-vh
  wrappers, e.g. [motion.dev's scroll-pinning
  example](https://motion.dev/examples/js-scroll-pinning). The page still grows;
  the growth just moves into dead space.
- [NN/g's list of when horizontal scrolling is
  acceptable](https://www.nngroup.com/articles/horizontal-scrolling/) is short and
  excludes this case: below the fold, functional storytelling, and explicitly not
  on mobile and not for text-heavy content.
- [The same author's scrolljacking
  survey](https://www.nngroup.com/articles/scrolljacking-101/) puts hijacked
  vertical scroll in the annoying-and-harmful category, and [Adrian Roselli is
  blunt about horizontal containers holding essential
  content](http://adrianroselli.com/2025/08/horizontal-scrolling-containers-are-not-a-content-strategy.html):
  keyboard and voice users lose it, focus management gets hard, and people already
  dislike carousels.

So the band is a plain `overflow-x` scroller. The reader keeps the wheel, the
thumb and the arrow keys, and the ◀ ▶ buttons exist so that snapping never gates
entry.

### The accessibility construction, item by item

Each rule here is implemented in `changelog.tsx` and cited in its doc comment:

- The scroller is a **named region in the tab order**: `role="region"`,
  `tabindex="0"`, `aria-label`. [MDN's region
  page](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/region_role)
  requires the role when you add `tabindex="0"` to scrolling content, and a region
  without a name is not a landmark at all. [axe's
  `scrollable-region-focusable`](https://dequeuniversity.com/rules/axe/4.11/scrollable-region-focusable)
  is the check; note the disagreement — axe only fails a region with no focusable
  descendants, while [Safari never adds scrollers to the tab
  order](https://th3s4mur41.me/blog/scroll-focus-polyfill/), so the attribute
  ships regardless of which rule you read.
- **Chronology is ordered content**, so `<ol>` with `<li>`, `reversed` because the
  newest stop is first. [ARIA's `list` role does not convey
  numbering](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/list_role),
  and [hiding the markers strips list semantics in
  VoiceOver/Safari](https://www.scottohara.me/blog/2019-01-12/lists-and-safari.html),
  hence `role="list"` re-declared. [The ARIA APG has no timeline
  pattern](https://www.w3.org/WAI/ARIA/apg/patterns/), so nothing else is
  invented: no `listbox` (that is a selection widget), no tabs (there are no
  tabpanels). [Matuzovic's
  note](https://www.matuzo.at/blog/2023/removing-list-styles-without-affecting-semantics)
  is the cleaner fix, but the stylesheet is shared.
- **"Current" is never colour or position alone**: `aria-current="date"` plus the
  word `latest` plus the ▶ battle cursor, on the newest *cut* stop. [MDN on
  `aria-current`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-current).
- **`scroll-snap-type: x proximity`, not `mandatory`.** [MDN's basic
  concepts](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll_snap/Basic_concepts)
  says never mandatory when a snap child's content can overflow, because the
  reader cannot scroll the overflow into view. [Roselli's scroll-snap field
  report](http://adrianroselli.com/2021/07/scroll-snap-challenges.html) adds the
  keyboard case — mandatory swallows partial arrow-key scrolls — and tells you to
  test the result against 1.4.4, 1.4.10 and 1.4.12.
- **1.4.10 Reflow is satisfied structurally, not by argument.** The criterion
  exempts content that genuinely needs two dimensions, and a horizontal scroller
  that merely duplicates a vertical list does not qualify. So the tile is capped at
  `min(78vw, 21rem)`: no stop is ever wider than the viewport, which means sideways
  travel moves you between stops and never into the middle of one. [Understanding
  Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).
- The axis line and node markers are `aria-hidden` decoration — [1.3.1
  Info and Relationships](https://www.w3.org/WAI/WCAG21/Understanding/info-and-relationships.html)
  is carried by the `<ol>`, the `<time datetime>` and the headings, not by
  position. They still clear [1.4.11 non-text
  contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
  because they are drawn in the section accent (5.18:1 on its own field, dark).
- [2.3.3 Animation from
  Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
  is served by its CSS technique: the route draw lives inside
  `@media (prefers-reduced-motion: no-preference)`. [2.2.2 Pause, Stop,
  Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) does not
  apply — it governs motion that starts automatically, and nothing here autoplays;
  the day that changes, a pause control becomes mandatory. [Heydon Pickering's
  content-slider](https://inclusive-components.design/a-content-slider/) is the
  reference for the controls that do exist.

### What is safe to rely on, and what is a bonus

`overflow-x`, `position: sticky`, scroll snap, container queries and `:has()` are
all Baseline and used unconditionally. **Scroll-driven animation is not**:
[Chrome/Edge 115+ and Safari 26, with Firefox still treating it as an open
request](https://caniuse.com/wf-scroll-driven-animations) (~88% global — [WebKit
shipped it in
26](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/), [Mozilla's
status](https://connect.mozilla.org/t5/ideas/implement-css-scroll-driven-animations-animation-timeline/idi-p/116931)).
So the route draw sits behind `@supports (animation-timeline: view())` and is
authored from its finished state — the line is full width by default and the
keyframe supplies only the `from`, which is the same rule this page already
applies to `rise` and to the no-JS `<noscript>` restore. [MDN's
guide](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations)
and [WebKit's](https://webkit.org/blog/17101/a-guide-to-scroll-driven-animations-with-just-css/)
both show the guard; [NRK's production
report](https://developer.chrome.com/blog/nrk-casestudy) is the case that it is
cheap enough to ship and old enough to gate. `scrollbar-color` is used;
`scrollbar-gutter` is not relied on ([inert under overlay
scrollbars](https://developer.mozilla.org/en-US/docs/Web/CSS/scrollbar-gutter)),
and `::-webkit-scrollbar` is untouched because iOS ignores it. `overflow-anchor`
is avoided: it is only newly Baseline
([Safari 27](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/)), so
it cannot be the thing that keeps the band from jumping.

### The defect the gate caught on the way

The band's exit tile — the dashed route stub carrying the CHANGELOG.md and
Releases links — was marked `aria-hidden="true"` because it is chrome, not a
release. axe failed the page with `aria-hidden-focus`, serious: two Tab-reachable
links sat inside a subtree screen readers had been told to skip. That is a
keyboard user focusing an element the assistive technology says is not there, and
the fix went in the markup, not the rule set. It is the second time this section
has had a defect that every static check was blind to (the first was `57`
rendering as `S7`), which is the argument for running the browser gates rather
than reading the source.

### Measurements, on the production build

`download/rail_shots.mjs` measures the claims happy-dom cannot see, because
happy-dom performs no layout:

| Case | Section height | Tile width | Rail client / scroll | Verdict |
|---|---|---|---|---|
| 1280 dark, light, reduced-motion, no-JS | 839px | 336px | 1104 / 1392 | ok |
| 390px | 974px | 304px | 350 / 1265 | ok |
| 320px | 1055px | 250px | 280 / 1046 | ok |

Height is constant in the one variable that matters: it does not move with the 73
entries the changelog currently holds, only with how the header text wraps. Every
tile is narrower than its viewport, the band scrolls, Tab reaches the region and
arrows move it, nothing is hidden with scripting off or reduced motion on, and the
document has no horizontal overflow. Contrast audit PASS (1375 text nodes, both
schemes), axe on `/` clean — *qualified in the 2026-10-19 addendum below: that
gate scanned only the first screenful and the claim did not survive the wider
scan*, palette gate PASS, units 241 pass / 0 fail,
`check:changelog` green (3 stops, 73 entries, 2 dated).
## 2026-10-19 — models: the zero-LLM tier paragraph (retroactive rationale)

The models section is the canonical home for the model-allow-list, the bridge
local lane and — since the nonllm campaign receipts landed — the zero-LLM
tier. The paragraph that shipped with those receipts (MinHash note dedup at
~0.2ms/note, dream-input ranking on a 33M ONNX encoder at 15ms, curation
lanes, 3-OS CI under Bun and Node, "the LLM calls that remain are only the
ones that genuinely generate") never got its rationale entry here, which this
section records.

Why the copy lives in the models section and nowhere else: the
one-fact-per-section rule. The local-lane sentence pair above it already owns
"background learning can run on a small local model"; the zero-LLM paragraph
is the stronger claim in the same argument (much of the learning layer needs
no generation at all), so it extends the same block rather than opening a new
section. Every number in it is a receipt from `benchmarks/nonllm/results/
REPORT.md`: MinHash 0.18ms/doc (rounded to ~0.2ms on the page), bge-small
embed p50 13–39ms across the CI matrix with rerank at 10–34ms/pair after the
chunk-8 batching fix (the page keeps the conservative 15ms headline), and the
H9 3-OS matrix run 39142263790 is the "verified on Linux/macOS/Windows CI
under both Bun and Node" claim. The numbers are deliberately NOT test-pinned
in `landing-copy.test.tsx`: they are campaign receipts, superseded whenever a
re-run lands, and the checkable-artifact contract is the linked REPORT — the
same treatment the local-lane lines get.

The sentence deliberately ends on what remains remote: extraction and
consolidation stay on the LLM (the nonllm campaign's executive answer — every
credible agent-memory system keeps generation generative), so the paragraph
cannot be read as "Unown needs no LLMs", only as "the auxiliary tiers are
free, local and verified".
## 2026-10-19 — quickstart copy: subagent structured outputs + worktree isolation

The SDLC-parity round 2 (see `docs/sdlc-feature-parity.md`) shipped two task-tool
upgrades, and the quickstart's session-tools sentence is the page's canonical
place where the task tool is described — so the sentence grew the two new
affordances, in the same shape the existing copy uses (tool name + one-line
capability, no marketing adjectives):

- `task` … typed replies via `output_schema` (a JSON Schema the subagent's final
  message must satisfy — validated locally, invalid replies retried with the
  exact defects quoted back, permissive/strict verdicts), and
- per-child git `worktree_isolation` (each isolated writer gets its own
  worktree at HEAD; kept trees are reported for merge).

Sourcing rules, same as every quickstart claim: both affordances are code-backed
in this checkout (`pi-repo/packages/self-learning/src/jsonschema.ts`,
`src/worktree.ts`, the `TaskParams` schema in `src/tools.ts`) and pinned by
`test/jsonschema.test.ts`, `test/worktree.test.ts` and
`test/cli/task-structured.test.ts`. No numbers were added, so no artifacts
moved; the claim is existence-only ("ships these two affordances"), which the
repo can vouch for at any commit. The landing copy test
(`src/components/landing/__tests__/landing-copy.test.tsx`) is not assertion-bound
to this sentence, so no test churn was required.
## 2026-10-19 — models: the zero-LLM paragraph gains the shipped-integration clause

The H15 integration (src/localml.ts + the optional local-ml side package)
closed the loop the zero-LLM paragraph opened: the lanes are no longer
bench-only receipts — they run in the engine. The paragraph gained one
clause after the CI-verification sentence: "and since H15 those lanes ship
in the engine itself: opt-in flags around the dream call, a `shadow` mode
that reports what they would change without touching the prompt, and the
embedding model as an install-on-demand side package".

Why a clause and not a new section: the one-fact-per-section rule — the
claim is still "the auxiliary tiers are free, local and verified"; what
changed is its strength (measured → measured AND shipped). No new numbers
were added: the shipped-integration facts are structural (flags exist,
shadow mode exists, the package is optional), all checkable in
`docs/configuration.md`'s `PI_LOCAL_ML` rows and
`pi-repo/packages/self-learning/local-ml/README.md` — the receipts behind
the existing numbers stay in `benchmarks/nonllm/results/REPORT.md`, which
now also carries the live shadow receipt (the running engine's real
auto-dream job emitting `lane:dream` with the embedding tier engaged and
the dream completing on the byte-identical prompt). The deliberate reading
constraint is unchanged: extraction and consolidation stay on the LLM.

## 2026-10-19 — quickstart copy: the automations command line

Round 3 of the SDLC-parity effort (`docs/sdlc-feature-parity.md`) shipped the
scheduled actor — Automations, the zcode port — so the quickstart `COMMANDS`
list (the page's canonical home for the command surface) gained one line:

- `unown automations create --cron '0 9 * * 1-5' --title 'brief'` —
  "scheduled unattended runs — read-only by default". The line carries exactly
  two claims, both checkable against
  `docs/usage.md#automations-unown-automations`: the command exists with this
  grammar (`automations-cli.ts`), and unattended runs default to the
  read-only toolset (`READ_ONLY_TOOLS` in `automations.ts`, pinned by
  `test/automations.test.ts`'s allowlist case). The trust story itself
  (engine-DB config, no recursion, nothing auto-merges) stays off the page —
  one fact per section, and the quickstart names affordances, not arguments.

Sourcing: command grammar from `pi-repo/packages/self-learning/src/automations-cli.ts`;
read-only default from `src/automations.ts` (`mode: "read-only"`, the
`--tools` allowlist `read,grep,find,ls,todo,note,fetch_url,lsp`); both pinned
by `test/automations.test.ts` (29) and verified live through the bridge.
No numbers were added, so no artifacts moved. The quickstart component test
pins the `COMMANDS` list, so the line is covered by the existing changed-line
gate; the landing rail was regenerated in the same change because the
CHANGELOG entry is part of the feature (`bun run check:changelog` green).

## 2026-10-19 — showcase copy: nine tabs (dashboard engine-parity round)

The dashboard engine-parity round (see `CHANGELOG.md` [Unreleased] "Added" and
`docs/sdlc-feature-parity.md`) added two tabs — `Sandboxes` (the isolated
workspaces view) and `Gateway` (the llm-bridge request log) — plus the ⌘K
command palette and the `?tab=` URL-synced tab strip. The showcase section is
the page's canonical home for "what the dashboard shows" (its `TABS` array is
the claim, the section copy around it the framing), so it moved in the same
change: seven → nine entries, the Console line now says the transcript streams
over SSE (it literally does since this round — `run:tool`/`run:text` frames),
and the lead sentence drops the ⌘K mention so the tab list stays the only
enumerated claim. The `Router` line keeps "the seven background jobs" — that
seven is the engine's job count (`router.ts`), not the tab count, and it is
still correct.

Sourcing: the two new entries describe views that exist in this checkout
(`src/components/dashboard/sandboxes-tab.tsx`, `gateway-tab.tsx`, pinned by
`__tests__/sandboxes-tab.test.tsx` + `gateway-tab.test.tsx`); the
`benchmarks.tsx` mermaid diagram's "RTL coverage of all nine dashboard tabs"
node moved in lockstep (suite now covers all nine). No numbers were added; the
existing screenshots (`public/landing/dash-*.png`) still show the tabs they
were captured from, so the asset pipeline was not re-run — the two new tabs
have no screenshots yet and none of the visible frames claim they do.

## 2026-10-19 — models: the third research bench sentence (complementary mechanisms)

The models section is the canonical home of the bridge/local-lane/zero-LLM
story, so the third research campaign's headline lands in the same block —
one sentence triple, each clause a receipt from
`benchmarks/complementary/results/REPORT.md`:

- "the local lane's shared-prefix calls prefill 54% faster (llama.cpp KV
  reuse)" — H18: 54.5% prefill-time cut on same-system follow-ups (37% of
  the prompt processed vs 95% for the broken-prefix control), rounded DOWN
  to 54% on the page; the mechanism is llama-server's default, so the claim
  is "measured", not "added".
- "a small local model can cut the remote lane's input tokens 47% on mining
  jobs before the call is paid for" — H19: 47.2% median remote input-token
  cut on the same remote model (mining 4719→2337), blind judge 2T+1L-0W
  with the loss correctly attributed to the dream seam; the page keeps the
  conservative mining-only framing.
- "a sub-1B local model answers image questions at $0 where the remote lane
  bills vision tokens" — H22: the acceptance lane (boots, answers the
  vlm-smoke probe locally in 1470ms, RSS 1176MB); deliberately no quality
  claim — a screenshot corpus campaign is the gate for that.

What the sentence deliberately does NOT say: the four refutations
(n-gram/draft speculation, near-dup semantic caching, query rewriting) are
not landing copy — refutations live in the registry and the bench REPORT
where their receipts are; the page only carries what a reader choosing a
deployment topology needs (the local lane is fast on repeated prefixes, the
remote bill is compressible, vision can be $0). The three clauses are
test-pinned in `landing-copy.test.tsx` (the new "complementary-bench
sentence" case) so the numbers cannot silently rot; unlike the zero-LLM
paragraph (campaign receipts, unpinned by design), these three ARE pinned
because they are stated as present-tense capabilities, not campaign
records.
## 2026-10-19 — showcase copy: ten tabs (the Automations entry)

The engine's automations surface (the zcode-port scheduled actor, merged in
the parallel session) gained its dashboard tab in the same window, and the
showcase's tab list is the canonical enumeration — so it grew the tenth entry
("Automations — scheduled recurring agent runs: cron rhythms or one-shots,
read-only by default, full run history") and the lead count moved nine → ten.
The `Router` entry's "seven background jobs" stays seven (engine job count,
not tab count — unchanged). Sourcing: the tab exists and is pinned by
`__tests__/automations-tab.test.tsx` (12 tests) and the e2e specs scan it;
no screenshots claim to show it (same posture as the previous two additions —
the visible BrowserFrames still depict Overview/Learning Lab/Hooks).

## 2026-10-19 — the page stops hand-copying the repository (audits ran 10-18)

The rail went horizontal, and the same question was then asked of every other
section: **is this content hand-copied from a source of truth that moves?** Six
read-only audits ran over the section files, the engine, the receipts and the
docs. The finding was not that the page was ugly; it was that the page had been
quietly becoming a copy of the repository rather than a view onto it, and copies
drift.

### What the audits actually found

Ranked the way the folder's own rule ranks things — a contradiction with the code
is worse than a stale count, which is worse than a voice tell:

- **Two figures with no artifact anywhere in the repository.**
  `16,310 assertions` appears in exactly one place in the whole tree: the page
  that asserts it. `300 scored runs across two days` likewise — nothing in
  `benchmarks/polyglot/` states it, and the run files do not add up to it on
  their own.
- **An aggregate that was the sum of three stale numbers.** The card's headline
  `846 harness tests · 0 fail` was `206 + 102 + 538`. The real figures at audit
  time were 241, 109 and ~729, and the docs themselves quote three different
  bridge counts (95 / 102 / 109) depending on the file. A number that is wrong
  in the source is wrong in the sum regardless of the arithmetic.
- **A superseded receipt printed as if current.** `5,342 repo tests green` still
  has its snapshot under `benchmarks/snapshots/`, but
  `docs/testing-strategy.md` says in as many words that the figure predates the
  fixture fix and that the standing rule is per-platform, not one global total.
- **A log row the engine never writes.** `integrity.tsx`'s `Stop` row read
  `session ended · note queued → engine`. No such string exists in
  `hooks.ts` or `termhooks.ts`; the real ones are `agent loop ended after N
  messages` and `session note delivered to engine` / `queued in outbox`. The
  network-deny row was also truncated mid-string, dropping `in the sandbox`.
- **A whole beat of the loop section that is not in the code.** `loop.tsx`'s
  Learn panel opened with `baseline failed impl-map-limit - 0/1 verification`
  and `diagnosis loop drops the trailing window edge`. Grepping the package for
  either returns zero hits. The section's own doc comment claimed "every `body`
  below is the literal format the engine writes, not a paraphrase".
- **A link pointing at the wrong file.** The receipts row labelled
  "the threat model" went to `docs/configuration.md`, which is an env-var
  reference with no threat-model content. The threat model is
  `SECURITY.md#agent-threat-surface`.
- **A false statement about the page's own art.** `field-notes.tsx` said "Every
  form carries one eye at the centre of its counter". `glyphs.ts`'s header
  comment says the opposite, and documents the split: seven forms (T, I, H, N,
  X, E, F) have no counter to sit in, so their eye is over the centre of mass.
- **Figures that contradicted their own campaign.** The zero-LLM paragraph said
  "33M ONNX encoder, 15ms" for the ranking lane. `benchmarks/nonllm` says the
  33M model is the bge-small *embedder*, the reranker is 23M, and the per-platform
  timings are 13/28/39 ms and 11/8/32 ms — the 15 ms and the older "1-2 ms/pair"
  being saturated-pipeline artifacts that the report itself flags as superseded.
- **A command list titled "The whole command surface" that omitted five commands
  and three slash commands** — and a test that could not notice, because it
  asserted only that a chosen subset was present.

### The taxonomy the fixes follow

Every hand-copied claim got one of five verdicts, and the interesting part is
that the answer is different per claim rather than one policy for the page:

| Verdict | Applied to | Why |
|---|---|---|
| **GENERATE** | benchmark figures, the shipping rail, the job cadence | a machine-readable source exists and churns; a script can read it and CI can re-derive it |
| **GATE** | quoted hook/harness literals, the project-memory excerpt, the CLI command names | the text is authored for rhythm but must still exist in code; assert page→source, one direction |
| **LINK** | the zero-LLM timings, the regression-layer suites | the honest claim is "the receipt says so", not a number re-typed into markup |
| **CUT** | every test-count aggregate, the two invented figures, the run total | no artifact, and the claim cannot be repaired without inventing one |
| **LEAVE** | lore, layout, argument, the provider tiles | genuinely authored; the provider list and `setup.ts` presets are deliberately different sets, so gating them would be wrong |

`scripts/landing_benchmarks.mjs` and `scripts/landing_claims.mjs` are the first
two verdicts made executable, next to `landing_changelog.mjs`. All three follow
the same shape: committed generated file, `--check` in CI, and a separate unit
suite that pins the *extraction rules* — because a `--check` that compares the
committed file against the same parser cannot see a parser that mislabels
something.

### Why the page no longer prints test counts

This is a content decision, not a tooling one, and it is worth stating because
it removes the page's biggest number. A test total changes on almost every
commit. A page whose entire argument is "every number here is checkable" gains
nothing from printing a number that is a timestamp: it is checkable for about an
hour, and after that it is a small lie that nobody wrote. The regression-layer
card now names each suite by path and by the command that runs it, which is
checkable indefinitely and says something the count never said — where the tests
live and how to run them.

The same reasoning killed `5,342 repo tests green` in the headline stat row and
replaced it with `0/50 attacker rules shipped`, which is a measured result in
`benchmarks/memory-eval/mpbench/RESULTS.md` and does not move when someone adds
a test.

### Two defects in the gates themselves, found while wiring this up

Both are in the rail's tooling, and both are the "gate that lies" class this doc
keeps hitting:

- The curated-title override warning fired on every *fixture* parse, because the
  parser was being asked to report unused keys even when it was handed a
  three-line test document. A warning that cries wolf is a warning that gets
  ignored, so it is now scoped to real-file parses.
- The parser's own test suite spawned the CLI and asserted `--check` passes. That
  couples "the extractor's rules are correct" to "the repository happens to be in
  sync at this commit", and it duly turned the parser suite red on someone
  else's commit for a drift reason. The test now asserts only that the CLI
  *speaks* — exit 0 with its verdict, or exit 1 naming the drift and the fix —
  which is the thing that could otherwise rot silently into a no-op.

### Receipts

Figures now resolve as: `benchmarks-data.ts` ← 6 tracks ← their receipt JSON,
with the newest **complete** `rerun-*` winning (a rerun whose shared receipt
does not name every model in the track is skipped whole); `engine-data.ts` ← `JOB_DEFS` in
`router.ts`; the rail ← `CHANGELOG.md`. Gates: `check:changelog`,
`check:benchmarks`, `check:claims`, plus the three `node --test` suites
(8 + 15 + 19), all steps in CI's landing job. The claims gate currently resolves
50 page literals against `hooks.ts`, `termhooks.ts`, `harness.ts`, the CLI HELP
block and `.unown/memory/project.md`; the memory excerpt is gated rather than
exempted precisely because AutoDream rewrites that file on a schedule.
Verification on the production build: units 241 pass / 0 fail, changed-line
coverage 100% on all ten changed `src/` files, palette PASS, contrast PASS
(1396 text nodes, both schemes), axe on `/` clean — *the same first-screenful
gate, falsified the next morning; see the 2026-10-19 accessibility addendum*,
theme toggle PASS, 28 section
shots with no console errors, the rail's band claims re-measured, build green.

One process note worth keeping: three gates in this round failed *loudly on
someone else's commit* within an hour of landing, which is the intended
behaviour, and one of them failed on a test that had been written to require the
repository be in sync. A unit suite should assert that a tool is correct and that
it speaks; a `--check` step should assert that the repository agrees. Conflating
the two turns a drift failure into a confusing red suite, and that is how a
reviewer learns to ignore the gate.

### The gates were measured saying no

A drift gate that cannot fail is worse than no gate, because it buys the page a
false certificate. Each of the three was therefore mutated on purpose, checked,
and restored byte-identically:

| Injected drift | Verdict |
|---|---|
| `CHANGELOG_TOTAL_ENTRIES` 76 → 77 | `check:changelog` exit 1, names the regeneration command |
| `EDIT_BENCH` kimi `pct` 98.1 → 99.4 | `check:benchmarks` exit 1, names the regeneration command |
| an `interval` job 10m → 11m | `check:claims` exit 1, `the committed jobs data no longer matches JOB_DEFS` |

The stronger test is the retrospective one: `landing_claims.mjs` was run against
the page **as committed before this round's copy fixes** — in a detached worktree
at that commit, so the new script read the old prose. It named six literals the
engine never writes (`session ended · note queued → engine`, `candidate passed`
twice, three re-worded `.unown/memory/project.md` lines) and failed 6 of 59. That
is the difference between a gate that was tuned until it agreed with the page and
a gate that would have caught the drift when it happened.

### Deliberately out of scope, recorded so it outlives the session

The scope chosen for this round was *contradictions with the code*. Four findings
are real, unfixed, and each is a one-line or one-section decision:

- **`quickstart.tsx`'s "The whole command surface" is not it.**
  `src/completions.ts`'s `COMMANDS` list is the authoritative thirteen subcommands
  (setup, models, init, memory, doctor, mcp, automations, note, update,
  changelog, info, completions, uninstall); the page shows nine of them plus five
  invocation forms, so `changelog`, `info`, `completions` and `uninstall` are
  missing. Either the heading goes (e.g. "what people start with") or the four
  rows are added — the claims gate already verifies any command name the page
  prints, so the second option costs four lines. (Measured again after
  `automations` landed mid-rebase: twelve became thirteen, the missing set did
  not move.)
- **Duplication was not cut.** The verify-twice rule and the sandbox description
  still appear in more than one section; the folder's one-fact-one-home rule is
  violated on the page even though the audits counted it. That is an editorial
  pass over voice and length, not a correctness defect, so it did not belong in
  this round.
- **No per-section anchors were added** — deep links exist only where a nav or
  footer needed one. `landing-page.test.tsx` does gate every in-page `href^="#"`
  against a real id, which is what caught `#showcase` being dead.
- **Two dated records now disagree with the repository.** `docs/testing-strategy.md`
  says twelve CI jobs; `.github/workflows/ci.yml` defines fifteen (its own
  `[V: ci.yml]` annotation marks it as a measurement at a named commit, which is
  why it was left as a record rather than rewritten). And the `benchmarks/` result
  tables carry figures that later `rerun-*` receipts superseded — the landing page
  no longer restates any of them, which was the point of generating rather than
  copying.

**One merge note, because it is the interesting kind.** While this round's copy
fixes were uncommitted, another session landed the H15 clause on the same
paragraph of `models.tsx` — the one whose timings this round deleted. The two
edits overlap by three lines and agree on nothing but the sentence boundary: one
added "since H15 those lanes ship in the engine itself", the other removed
"15 ms" and the single-model attribution. The rebase kept both, and the shipped
paragraph now distinguishes the three lanes that actually run in `localml.ts`
(MinHash dedup with an optional bge-small cosine tier, activation ranking,
LexRank curation) from the two that stay bench-verified (kNN triage, the 23M
cross-encoder) — a distinction neither side's copy stated on its own. A page
edited by three sessions in one day is exactly why the derived content is
generated rather than typed: a merge cannot conflict inside a build result.

## 2026-10-19 — the accessibility gate was scanning one screen of a thirty-four-screen page

The coherence audit's own verification list ended with "axe on `/` clean". It was
measured, and it was nearly worthless.

**The mechanism.** `FadeUp` gives every section `initial={{ opacity: 0 }}` with
`whileInView`, `once: true`. axe-core skips a node whose computed opacity is 0 —
correctly, it is not rendered. The e2e landing test navigated to `/` and analyzed
without scrolling. So axe saw the hero and the first fold, and passed the other
~90% of the document by never looking at it.

**What the wider scan found.** Three real `link-in-text-block` failures
(WCAG 2.0 A, 1.4.1 Use of Color, AA tier): the `cold-vs-warm chart` anchor and
the two receipts links in the benchmarks section are `hover:underline` — no
underline at rest — inside paragraphs, so their only distinguishing property is
color, and axe measured that color's contrast with the surrounding text at
1.02–1.33:1 against a required 3:1. Underlines at rest; markup fixed, not the
checker.

**Why the gate is now two passes rather than one with a scroll.**

| Pass | What it proves | Measured caveat |
|---|---|---|
| `reducedMotion: reduce` | the whole document, no scroll needed — the page's own "motion is additive, never load-bearing" contract says every section renders in its final state here | the strict scan |
| `no-preference` + sweep | the state a reader actually arrives in | a 500px/120ms programmatic sweep left one wrapper parked at `opacity:0;transform:translateY(20px)`: an IntersectionObserver callback that never landed. The sweep improves coverage; it does not guarantee it. |

**A settle sleep was wrong in both directions.** Scanning 800ms after a sweep
produced 43 `color-contrast` findings — mid-fade nodes whose foreground axe
blends with the background, so the ratios were artifacts, not defects. A
first fix waited a flat 1.5s, which then *missed* the real link violation, and
the 4s used in the measuring probe was slack. The gate now waits until the count
of partially-transparent nodes plateaus (unchanged over ~700ms), which is the
claim actually being made: nothing is still fading.

**Falsified claims corrected in the same change.** "axe-core on `/` clean" in
this file (twice) and in `CHANGELOG.md`'s rail entry — each annotated rather
than quietly rewritten, because they were true of what their gate measured.
Root `AGENTS.md` and `docs/testing-strategy.md` gate 16 both still said eleven
Playwright tests; the suite is twelve.

**The general rule worth keeping.** An accessibility gate that scrolls nothing
is a screenshot of the fold. Any axe/pa11y scan of a page whose content reveals
on scroll must state which state it scanned, and the state it should state is
the one where the document is complete — which for this page is the
reduced-motion render, and that fact is a contract test, not a workaround.

## 2026-10-19 — install and try first

**The brief.** The page should lead with install and try, the way the tools a
developer already installs do, without giving up the retro identity, the
claim discipline or any of the fourteen sections.

**Products re-studied for this specific question** (hero and install surfaces
fetched live, extending Part 1): ollama.com (+ /download), bun.sh, astro.build,
docs.astral.sh/uv, ai-sdk.dev, aider.chat, continue.dev, cline.bot, docker.com,
deno.com, warp.dev, rust-lang.org, typescriptlang.org, and Microsoft's
PowerShell install docs as the reference for tabbed OS variants.

**What the study found, compressed to the patterns this page did not have.**

1. One canonical command above the fold, everything else demoted — Astro's
   hero is a button beside `npm create astro@latest`; Bun, Deno, Ollama and
   Warp each show exactly one copyable line first. A five-line panel reads as
   documentation, not invitation.
2. Installation content sits at position 1–2 of the page, never position 10 —
   uv's Installation is its first section; Ollama's homepage is one click from
   /download, which is zero marketing: platform tabs, one command, a manual
   fallback. Unown's quickstart sat at position 10 of 14, a pattern that
   existed nowhere in the studied set.
3. The payoff command is pre-chained under the install command (Bun shows
   `$ bun run index.tsx` directly under the curl line; uv follows its
   installer with "First steps"): install → verify → payoff in three visible
   lines.
4. A persistent nav install CTA (Ollama's "Download" on every page) — this
   page already had it: the nav's `Get started` button points at
   `#quickstart`. Unchanged.
5. The 2026 pattern ollama.com/download ships: "Get started by installing
   Ollama, or have your agent install it for you" — a copyable prompt the
   visitor hands the coding agent they already use. For an agent project this
   is also a brand statement.
6. Try-first without install is either a recorded session that plays itself
   (aider's homepage mp4), an in-hero live editor (TypeScript), or a scripted
   typing demo that loops. Unown's session replay already autoplays on
   viewport entry, types itself, honours reduced motion, and keeps its
   accessible scrubber — that half of the brief was already built, so the
   rework left it alone.

**What changed on the page.**

- `quickstart` moved from position 10 to position 2, directly after the hero:
  for a clone-and-run tool the install is the argument. The section's own copy
  is untouched — "Clone it, point it at a model, run it." was already the
  plain-instruction register the page wanted up front, and the section remains
  the canonical home for the command surface.
- The hero's five-command install panel became one copyable line
  (`git clone … && cd Unown && bun run agent:install`) with the payoff chain
  (`unown setup → bun run agent:start → unown`) printed under it — pattern 1
  plus pattern 3. The hero unit test pins the one-liner, the chain and that
  exactly one `<pre>` remains.
- A `<details>` under the chip carries the delegation prompt (pattern 5),
  worded as an instruction whose every command is the documented install path
  and whose last step is `unown doctor` — verification, not marketing. The
  hero test pins it and keeps the no-placeholder-key rule (`sk-` must not
  appear) from the original hero contract.
- No hue moved. quickstart keeps `gold` at position 2 (no adjacency collision:
  hero is psychic, origin is aqua), so the palette, the contrast audit surface
  and the OG shots are untouched by the reorder. The allocation paragraph in
  this folder's AGENTS.md documents the rotation as it now stands.
- Lore-run residue, recorded rather than papered over: the technical run
  between the lore sections shrinks from seven sections to six (loop through
  integrity), which still exceeds the folder's own three-at-zero rule. That is
  a pre-existing condition noted in the AGENTS.md, not something this rework
  claims to have fixed.

**Why not an OS-tabbed install or a sticky bar.** The one-liner is the same
three commands on every OS (git + bun; the sandbox ladder differs by OS and is
stated in quickstart's prerequisite table, which the section owns), so tabs
would gate a click behind nothing. A sticky install bar duplicates the nav's
`Get started` button at the cost of one more always-present element on a
thirty-four-screen page; the nav CTA already covers it.

**Where this is enforced.** `src/app/page.tsx`'s composition comment states
the new order and why; the folder AGENTS.md carries the install-first rule
("the hero chip must never grow back into a command wall");
`__tests__/landing-copy.test.tsx` pins the one-liner, the chain, the
delegation prompt and the single `<pre>`; `__tests__/landing-page.test.tsx`
still holds the fourteen-section composition and the FAQ → rail → finale
order across the move.

## 2026-10-19 — the OS tabs, after all, and the six-at-zero run they paid for

Two reversals in one afternoon, both user-directed, both recorded here because
the entries above argue the opposite.

**OS tabs.** "Why not an OS-tabbed install" (above) objected that the hero's
git-clone line is the same three commands on every OS, so tabs would gate a
click behind nothing. The objection dissolved when the tab content became the
thing that actually differs: macOS and Linux carry `curl -fsSL
https://unown-nine.vercel.app/install.sh | sh` — the documented one-line
installer (docs/install.md), which refuses root, checks git and bootstraps bun
itself, and is a shorter line than the clone path into the bargain — while
Windows carried the clone path plus the bun prerequisite, because a fresh
Windows box has no sh (docs/windows.md). Each tab's note line quotes one of
the three sandbox facts the page already claims in quickstart's prerequisite
table (bubblewrap / Seatbelt / in-process jail), verified against
`resolveOsSandboxBackend()` in `pi-repo/packages/self-learning/src/bwrap.ts`
(linux → bwrap, darwin → seatbelt, win32 → null → the in-process TS path
jail) — the tabs invent no claim, they say the visitor's one out loud. The
tab auto-defaults from the user agent (the Bun userAgentData pattern from the
research above) and never gates; the `then:` chain is unchanged under all
three. The chip stays one `<pre>` — the hero did not grow a command wall, it
grew a chooser. One implementation constraint worth remembering: the panel is
a client island (`install-panel.tsx`) precisely so `StarCount` can stay an
async RSC in the server-rendered hero.

**Correction, 2026-10-21.** Windows no longer carries the clone path:
`public/install.ps1` shipped as the `irm | iex` twin of the POSIX script, so
the Windows tab is now one command like the other two — refuses elevation,
checks git, bootstraps bun via bun's own PowerShell installer, clones, runs
`agent:install`. The manual clone sequence remains one expander below the
chip. `__tests__/landing-copy.test.tsx` pins the PowerShell one-liner and the
absence of the POSIX command on that tab.

**Correction, 2026-10-21 — the installer default and the CLI-only binary lane.**
The one-liners now install the newest **stable release tag**, not `main`:
`public/install.sh` resolves it with `git ls-remote --tags --refs
--sort=-v:refname`; `public/install.ps1` does the same. `--main` / `-Main` is
the explicit edge install, and `--version` / `-Version` pins a stable tag. The
chip's label names the policy ("install · latest stable release") instead of a
version literal that would go stale; the commands did not move — still one per
OS tab, exactly one `<pre>` in the hero.

The scripts gained a CLI-only lane: `sh install.sh --binary` and
`.\install.ps1 -Binary` download the release archive, verify its SHA-256
against that release's `sha256sums.txt`, and install atomically under
`UNOWN_INSTALL_ROOT/versions/<version>/` with a PATH shim and
`~/.unown/install.json`; `unown update`, `--check`, `--rollback` and
`uninstall` work against that layout
(`pi-repo/packages/self-learning/src/install-layout.ts`, `bin-update.ts`).
It is the terminal agent only — no engine, llm-bridge or learning stack — so
the page's manual expander states that limit and never presents the lane as
the source chain. Verified by the release workflow's `smoke-install` matrix
(`.github/workflows/release.yml`, ubuntu/macOS/Windows), which installs the
published archive with `--binary --version <tag>`, asserts `--version` matches
the tag, `update --check` exits 0 or 2, and `uninstall --dry-run` runs. The
source default has no equivalent automated run yet, recorded here rather than
implied. `__tests__/landing-copy.test.tsx` and
`__tests__/quickstart.test.tsx` pin the label, both binary invocations and
the CLI-only scope.

**Correction, 2026-10-22 — the binary becomes the default.** The 2026-10-21
record above is superseded on one point: the CLI-only binary is now the
default lane, not an expander-only alternative. `public/install.sh` and
`public/install.ps1` with no flag download the release marked latest, verify
its SHA-256 and install it; `--source` / `-Source` selects the full stack
(git + bun + `agent:install`). `--main` / `-Main` and `--dest` / `-Dest` imply
the source lane; `--binary` / `-Binary` remains as an explicit spelling of the
default. A bare run against a machine whose `install.json` records the other
mode is refused and the error names the flag that keeps it, so an existing
source install is never silently replaced. The release workflow's
`smoke-install` matrix now installs with no mode flag (the command a visitor
gets) and asserts the published scripts advertise `--source` / `-Source`.

The page follows the scripts in the same change: the chip's commands are
unchanged (`curl … | sh`, `irm … | iex`) because their meaning moved, and the
chip's chain is now `unown setup → unown · CLI only` — a binary install has no
engine to boot. The manual expander is relabelled `source`, carries the
full-stack sequence and states explicitly that the chip installs the terminal
agent alone while this lane adds the engine, llm-bridge and learning stack. Its
one-command forms are `sh install.sh --source` and `.\install.ps1 -Source`.

The default flip also moved the first-run copy: the standalone binary ships no
llm-bridge, so `cli.ts` now probes `/health` before offering "keep the bundled
bridge" and the first-run banner says no endpoint is answering instead of
claiming the bridge is wired. `firstRunGateLines` / `firstRunBannerLines` are
pure and pinned by `test/first-run-copy.test.ts`. The chip's label keeps the
same version policy ("install · latest stable release") and still carries no
version literal.

**The six-at-zero run.** The install-first rework recorded, rather than
fixed, the run of six technical sections between the lore carriers (positions
5-10, loop → mechanisms → showcase → models → benchmarks → integrity, one
over-over the folder's own three-at-zero rule). The fix the AGENTS.md had
already sketched is now applied: `field-notes` moved from position 11 to
position 8, splitting the run into two runs of exactly three (loop →
mechanisms → showcase, models → benchmarks → integrity) with the name story
as the mid-page breather. The old objection to moving field-notes — psychic
sections clustering next to alphabet — was always an objection to position 5,
not to 8: at 8 the three Unown sections stay spread (hero, alphabet,
field-notes at 1, 4, 8) and the proof path stays adjacent. The move re-walked
the hue allocation, and the re-walk came out cleaner than the original: with
the reserved hue mid-page instead of in the tail, the gold → aqua → leaf →
magma cycle runs unbroken from quickstart to finale — `faq` takes the gold
the cycle offers and `changelog` the aqua after it — and the changelog
exception paragraph is gone from the allocation rule. The composition test
now pins the entire fourteen-section hue walk, so the allocation paragraph
cannot silently drift again.

---

## Part 13 — The eight-band compression: scroll, words and the budget that keeps them down

**2026-10-20.** The complaint this round answers: too much vertical scroll, too
text-heavy. Measured first (`scripts/landing_audit.mjs`, 1440×900, reveal motion
neutralised): the page was **19,358px = 21.5 viewports** tall, carried **5,488
words** across **fourteen sections**, and its two heaviest sections were
benchmarks (3.74vh, 1,275 words, 58 paragraphs) and mechanisms (3.06vh, 745
words, 40 paragraphs).

### The research

Two research agents ran in parallel (UX practices + creative assets/interaction
patterns; raw reports under `/home/z/my-project/research/` in the work session,
condensed here):

- **Attention is front-loaded.** NN/g scroll-and-attention figures: ~57% of
  visitor attention lands above the fold, ~74% within the first two screenfuls.
  The back half of a 14-section page — models, benchmarks, integrity, faq — was
  nearly unread real estate.
- **Nobody stacks 14 full-height prose sections.** A corpus of 16 dev-tool
  homepages (Vercel, Linear, Railway, Supabase, Raycast, Bun, Cursor, Resend,
  cal.com and others) measured **500–1,700 words and ≤ 8 content bands** for the
  most-copied pages. The text-heavier sites in the corpus (Bun, Cursor) stay
  scannable only because their headings name visible things — terminals, UI
  panes — not arguments.
- **Users read 20–28% of words** on a normal page (NN/g *How Little Do Users
  Read*); only pages under ~111 words get 50%. Prose density is a cost, not a
  signal of substance.
- **The compression patterns that 2025-26 pages converge on**: bento grids for
  feature density (16/16 corpus sites carry one), tabbed explorers for sibling
  features (8/16), stat bands instead of prose proof, terminal replays as
  "show, don't tell" heroes, detail behind expanders, FAQ as accordion. None of
  these fight this page's GBA identity — the console aesthetic is the
  differentiator the trend reports (Webflow 2025, Awwwards) say 2026 rewards:
  "crafted/human/playful" over AI-slop gloss.
- **Guardrails that survive every pattern**: `prefers-reduced-motion` honoured
  (already the page's rule), SSR-first hero text for LCP, `aspect-ratio` on
  tiles for CLS, WCAG 2.2 target sizes, and terminal demos with transcripts —
  all already landing-folder contracts.

### The redesign (what moved where)

Eight bands, every checkable claim kept — the constraint the whole round was
solved under. Measured result: **12.3vh, ~2,540 words, 8 sections** (−43%
height, −54% words), verified by all three landing gates (51 gated literals),
312 unit tests, the AA contrast audit (1,020 nodes, both schemes), the theme
gate, both axe passes and the production visual pass.

| Band | Absorbed | The compression move |
|---|---|---|
| hero (+ `#quickstart`) | quickstart | the OS-tab one-liner chip stays above the fold; the manual sequence, prerequisites and the full 14-command surface live in collapsed `<details>` expanders (collapsed ≈ 40px vs a viewport) |
| loop (`#loop`) | origin, mechanisms | the three gated artifact tabs stay byte-identical; origin's pair argument became a two-card strip; the five mechanisms + the SDLC-parity index became one six-tile bento (the 8th tile of the old SDLC grid became receipt links inside the sixth tile) |
| showcase (`#showcase`) | — | 3 screenshots → 2 (the Hooks tab's story is the Integrity pane's hook log); the 10-row tab index became tiles |
| proof (`#proof`) | benchmarks, integrity, models | a NEW tabbed band; all panes mounted with `hidden` on inactive ones, so generated numbers stay in the SSR DOM for crawlers and the gates; benchmarks kept the stat band + 2 flagship cards + the lift chart and compressed the three secondary tracks into one "also run" strip |
| alphabet (`#alphabet`) | field-notes | glyph wall + decode panel + dex card in one band; the borrowed-essays column became a one-line sources footnote; 3 highlight quotes → 1 |
| faq (`#faq`) | — | 8 → 7 items (cost answer folded into the capabilities answer) |
| changelog (`#changelog`) | — | untouched — the generated rail is already the fixed-height shape this round wants everywhere |
| finale | — | untouched |

The claims-gate note: gated copy that moved files (the COMMANDS list, the
slash-command chips) now reads from `hero.tsx` — the gate's `PAGES` map follows
the copy, so a move and a map update ship in the same commit or the gate is red.

### The budget that keeps it down

The redesign's regression guard, now a contract in the landing AGENTS.md and a
CI gate (`e2e/landing-budget.spec.ts` + `node scripts/landing_audit.mjs
--budget`):

- the page stays **≤ 13 viewports** and **≤ 3,200 words** at 1440×900;
- no single band exceeds **3 viewports**;
- a breach is settled by compressing elsewhere — tabs, expanders, cutting a
  restated fact — **never** by deleting a generated number or a gated literal
  (those are receipts, not prose).

Viewport pinning matters more than it looks: Playwright's default context is
1280×720, at which the same page measures ~3vh taller — the spec pins 1440×900
or it would be gating a different page than the contract describes.

### The VLM review lane

`scripts/agnes_review.mjs` sends landing screenshots through the bridge's
second upstream (agnes-3.0-flash, vision-capable — see `.env.example`'s
second-upstream block) and prints a strict `VERDICT / DEFECTS / IMPROVE`
critique. Findings from this round's runs were triaged against the design
system: the useful ones (a contrast defect class, the empty-tab observation)
fed the pass; the rest ("make the buttons modern", "reduce the seal's
dominance") are exactly what the palette and identity contracts exist to
refuse. The rule, recorded in the AGENTS.md: **the VLM is a reviewer's aid,
not a gate — it does not know the seal is the brand.**

## Part 14 — The feature creatures: the model draws, the pipeline owns the pixels

The brief: the agent's features (MCP, web search, subagents, …) should be
denoted by 2D Pokémon-like graphics on the landing page. The first attempt
generated smooth modern flat-2D chibi illustrations and failed review for
exactly the reason the page would have predicted: nothing about them was
Game Boy Advance. Soft cel shading, anti-aliased edges, off-palette colors —
against Press Start 2P type and a 5-bit palette they read as a different
product's stickers. The round that shipped inverted the division of labor.

**Research first.** A research pass over legal analyses (TechnoLama on
Palworld; Blake Crosley's takedown record), sprite-art fundamentals (Lospec,
GBATEK, the pret/pokeemerald decomp, Bottosson's OKLab post) and practitioner
pipelines (Pixel Art XL's "generate at 1024, downscale 8× nearest" method)
produced the constraints that shaped everything after:

- **IP safety is about specific signifiers, not genre.** Copyright protects
  expression; the vocabulary that stays safe is generic
  ("creature companion", "chibi monster") and the vocabulary that does not is
  any species name, ball iconography, or a named artist's style. Round +
  warm-gold + pointed ears collapses image generators into a Pikachu
  derivative — observed, caught by a signifier audit (the arbitration method:
  list the named character's defining features, count how many the sprite
  carries, NEAR-IDENTICAL needs several; genre resemblance is not a verdict).
- **GBA sprites are 64×64, 16 colors, 1-bit alpha, 8×8 tiles** (GBATEK;
  pokeemerald ships Gen-3 front sprites as 64×64 PNGs with 16-color .pal
  files). Shading is two-tone with sparse ordered dither, never smooth.
- **Practitioner consensus: the model draws, post-process owns palette and
  grid.** Ten sprites match each other and the page only if the pixel grid
  and the palette are imposed by one deterministic stage — prompt style alone
  drifts per generation.

**The pipeline** (`scripts/creature_sprites.mjs`, and the contract now lives
in the landing AGENTS.md). Stage 1 generates composition with a locked style
template — the only free variable is the per-feature CONCEPT line, one prop
per feature because a 64px sprite stops reading past one idea. Stage 2
GBA-ifies: box-average downscale to a 64px logical grid (box, not nearest —
it flattens the cel shading and never rings the outline), 1-bit alpha
threshold, OKLab nearest-color snap onto **the page's own palette tokens**
(the mirror list in the script; the sprite inherits the page's world the way
a glyph inherits `currentColor`), prune to the 8 heaviest entries with the
outline force-kept (Gen-3 two-tone: 17–20 ramp steps read as smooth modern
flat art — the measured difference between the rejected and shipped rounds),
ship at 4× nearest-neighbor, display 1:1 logical through
`image-rendering: pixelated`. 1.4–1.8 KB per sprite.

**Gates, hard and soft.** Hard (fail the run): background-cut sanity, the
edge-clip check on the raw (a limb cut at the generator's frame edge reads
broken at every size; run it on the raw — a trimmed sprite always touches its
own bounding box, a lesson that cost a false-positive round), and the
dark-ratio check (a body that snaps mostly to the dark half of the palette is
a smudge on the light cream scheme — measured on the bento tiles; bodies
steer coral/gold/aqua/cream). Soft: the Agnes VLM pass with a GBA rubric —
an aid, not a gate. This round sharpened the policy with evidence: the VLM
flipped between PASS and FIX on identical files across rounds, twice
described the seal glyphs when asked about creatures, and once critiqued
AA-verified token contrast from a downscaled crop. Every Pokémon flag it did
raise was either confirmed by a signifier audit (one genuine Pikachu
derivative, regenerated) or dismissed with one (memory: zero signifiers,
kept). Element-level crops (`scripts/creature_crops.mjs`) replaced
full-band screenshots for creature review — a 64px sprite in a 1512px band
is invisible to a reviewer.

**Placement, from review.** The hero's "session party" strip (four chips,
each a creature labeled with the tool's real name, the prose expander staying
canonical) sits between the seal grid and the session replay — the party and
the session it joins read as one thought. The loop bento anchors one creature
beside each tile's number+title: a first cut floated the creature in its own
row above the title and two reviews called it disconnected with a dead band;
beside the title it anchors. A dream+skills pair on tile 04 was read as
clutter twice — one creature per tile, the second feature argued in prose.
The proof band stays creature-free (the benchmark costume rule). Both
schemes verified: dark "looks like native ROM assets", light clean after the
bright-body steers; the contrast audit carries the real decision (1,036
nodes, both schemes, no AA failures).

**The VLM lesson in one line:** reviewers that cannot see the design system
will optimize toward generic modern web — the contracts (palette, pixels,
one-prop, one-sprite, proof-band purity) are what the creatures are designed
inside of, and the signifier audit is the tiebreaker when a flag needs
evidence.

## Part 15 — The capability dex: an interactive bestiary for the agent's features

The brief: the agent's capabilities — MCP, web search, subagents, LSP, memory,
harness, routing, AutoDream, hooks, SDLC parity — shown as the ten original
creature sprites from Part 14, "all in one place," as an interactive Pokédex.
The research round (2026-10-20) went looking for a library to install and came
back with a negative result, a UI pattern, and exactly one honest dependency.

**Research first.** The question: does npm or GitHub hold a reusable
"interactive Pokédex UI component" — a list-plus-detail bestiary widget we
could feed our own sprites into? Search across the npm registry, GitHub,
PokéAPI's own documentation and the tutorial orbit. The answer is no, and the
shape of the no is the finding:

- **Everything called "pokedex" is a data client for PokéAPI.** The four
  packages the search surfaced — `pokedex-promise-v2` 4.2.3 (Node, promises —
  "a library used to get information about Pokemons"), `pokenode-ts` 5.0.0
  ("a typed PokéAPI client with zero runtime dependencies"),
  `pokeapi-js-wrapper` 2.0.2 (browser wrapper, cached responses and
  service-worker image caching), `@sherwinski/pokeapi-ts` 1.1.2 (TypeScript
  SDK over the REST API) — all fetch Nintendo's species data and render
  Nintendo's artwork. None of them can display a user's own sprites, because
  their subject matter is Pokémon, not catalog UI. PokéAPI's own docs
  (pokeapi.co/docs/v2) list the same wrapper family and nothing else; the
  fair-use policy there asks consumers to cache locally, and the art it
  serves is The Pokémon Company's.
- **The remainder are tutorial and demo apps** — matheusmhq/pokedex-react-js,
  mauricius/simple-react-pokedex, IdoBouskila/Pokedex, and the codementor /
  itnext / Medium "build a Pokédex" walkthroughs — every one a PokéAPI
  consumer shipping official artwork as a portfolio grid. Installable, not
  drivable: they import precisely what the page may not.
- **The non-affiliation wall forbids what every one of them would import.**
  The Pokémon Company's legal page (pokemon.com/us/legal/information) states
  that fan art grants no license to use Pokémon IP beyond personal,
  noncommercial home use, and Nintendo/The Pokémon Company actively issued
  copyright takedowns for fan art featuring their characters through
  2024–2025. The landing AGENTS.md already drew this exact line ("No official
  art, still. Nothing Pokémon-derived is vendored, hotlinked or reproduced") —
  official sprites, cries and species data are the entire payload of every
  existing pokedex library.
- **So the dex is a UI pattern, not a package.** The FRLG/Gen-3 two-pane
  Pokédex — a scrollable numbered list with a search box, and a detail pane
  with the specimen, its entry text, category, type badges and its cry — is
  interaction design, not somebody's dependency. It gets built in the page's
  own design system, the same call the eight-band redesign made for tabs:
  hand-rolled, WAI-ARIA, inside the GBA furniture.
- **The one genuine, drivable dependency is fuse.js** (npm `fuse.js`;
  krisk/Fuse on GitHub; fusejs.io). Zero dependencies, written in TypeScript
  with the types in the box (`dist/fuse.d.ts`), and small — the README's own
  table puts the basic fuzzy-only build at ~6.8 kB min+gzip (the round's ~7 kB
  gz figure) and the full build with extended/logical search at ~8.6 kB;
  checked against the registry the same day: v7.5.0, zero dependencies. It
  drives the dex's real interactivity — fuzzy search over each entry's name,
  category, type and entry text. The brief's rule — research online and
  install tools that you can drive — is satisfied honestly: a real dependency
  doing real interactive work, not a decorative install.

**The design decision.** A new band #3, `id="dex"`, `data-hue="magma"` — the
Gen-3 red the actual Pokédex device is. Magma is the page's only red section
hue; proof keeps it too, and the allocation rule ("no two adjacent bands share
one") still holds because showcase/gold separates them — the walk becomes
psychic (hero) → leaf (loop) → **magma (dex)** → gold (showcase) → magma
(proof) → psychic (alphabet) → gold (faq) → aqua (changelog) → leaf (finale),
and the composition walk gets re-pinned for nine bands as the AGENTS.md's walk
paragraph already demands.

Position — between the loop band and the showcase band — is the argument, not
a filler slot: the page becomes claim (hero) → how it learns (loop) → **what
it can do (the catalog)** → what it looks like (showcase) → receipts (proof) →
identity (alphabet) → record (changelog).

All ten creatures move here, because the requirement is "all in one place":
the dex becomes the one canonical home for creature art. The hero's
session-party strip and the loop bento's tile badges are removed in the same
change — a sprite in two places is two homes, and Part 12's one-fact-one-home
rule applies to images as much as to words. The same rule decides where the
copy goes: the bento's mechanism descriptions and the hero cli-expander's tool
prose **move into** the dex entries rather than being duplicated — the dex is
the one canonical home for the capability copy too, or it would immediately
re-fund the restatement debt Part 12 spent a round paying down.

The interaction contract, stated before the build so the build can be tested
against it:

- the entry list is an ARIA listbox with roving tabindex — arrows, Home, End
  — and selection follows focus, the way the FRLG cursor moves;
- the detail pane is `aria-live="polite"`, so a keyboard walk of the list
  narrates every entry;
- the search is a labelled input filtering the list through fuse.js, with an
  N-of-ten counter — "ten" stays a checkable number on the page;
- every entry carries its receipt link(s) — the source file on GitHub — so
  the dex keeps the page's every-number-checkable contract inside its newest
  toy.

**The cry.** One per creature, synthesized live with the Web Audio API: a
square-wave chiptune chirp whose motif is deterministic per creature (seeded
by the entry — same creature, same cry, every play). No sampled audio, so
nothing Nintendo-derived enters the repo through a sound file; it plays only
on explicit click, which also keeps the sound-never-auto-plays contract
honest.

**The scroll budget** (the binding constraint: ≤ 13 viewports at 1440×900,
≤ 3,200 words, ≤ 3vh per band; baseline measured 12.5vh / 2,603 words /
8 bands). The new band is paid for before it is built:

| Move | Δvh | Why it is free |
|---|---|---|
| remove the hero party strip | −0.1 | a four-creature preview of a home the dex now gives all ten |
| absorb the loop bento | −0.7 | its mechanism copy moves into the dex entries — moved, not duplicated |
| remove the alphabet's static DexCard | −0.4 | it mostly restated hero-seal facts (№ 0201, アンノーン, Symbol · Psychic); the interactive dex makes a static dex card redundant twice over |

Net target: **~12.6–12.9vh total** — the band arrives inside the budget with
the word count down, not up, because the copy it hosts was already on the page
once.

The build will be pinned by `__tests__/dex.test.tsx` and the updated
composition walk; the negative result above is why the diff shows one new
dependency instead of a pokedex package.

**The negative-result lesson in one line:** an ecosystem can be full of things
*named* for the pattern you want and still contain none of it — the search
returned ten reasons the page must build its own dex and exactly one
dependency worth installing, and knowing which is which was the whole point of
looking before building.

## Part 16 — The atlas redraw: authored pixels, or why the generator lost the brush

The v1 creatures of Part 14 shipped in the morning and were rejected the same
day (2026-10-20): reviewed, they "don't look great — rethink and redraw." The
round that followed is the workflow's first course correction, and the
correction was not a better prompt — it was the finding that a generator
cannot own pixel placement at 64px at all. The sprites are now authored in
code, pixel by pixel, and the model's only remaining job in the pipeline is
reviewing.

**The autopsy.** The Agnes critique of the v1 contact sheet (saved with the
round's evidence) named the symptoms: soft outlines on harness/sdlc/hooks,
props blurring into indistinguishable blobs at 64px (wrenches, gears, a
clock), consistency outliers between sprites that had passed the same gates,
and two IP near-misses (websearch read as Cyndaquilt-like, task as
Growlithe-like). Three root causes, in order of shame:

1. **An AI illustration is smooth art, and box-averaging smooth art onto a
   64px grid makes mush.** Averaging is the right filter for photographs and
   the wrong one for a medium whose entire grammar is pixel placement — the
   average of a soft edge is a softer edge, so v1's outlines could not have
   come out crisp.
2. **The page's text palette has one step per hue.** An aqua body snapped to
   #62acee and stopped there — the palette's only darker blues are
   desaturated navies — so the snap produced flat or muddy shading. A token
   palette is a set of points, not ramps; cel shading needs ramps.
3. **Consistency across ten independent generations is luck, not
   construction.** The snap, the prune and the grid are imposed after the
   fact; proportions, faces and feet are decided inside each generation, and
   v1's outliers were the luck running out.

**Research first, again — craft this time, not tooling.** Every load-bearing
rule of the redraw comes from pixel-art practitioners, and the citations are
the defense of each:

- **Hue-shifted ramps**: shadows shift toward blue/violet, lights toward
  yellow/white — Slynyrd's [Pixelblog 1 — Color
  Palettes](https://www.slynyrd.com/blog/2018/1/10/pixelblog-1-color-palettes)
  (HSB discipline) and the pret/pokeemerald palettes do exactly this.
- **One light source, no pillow shading**: lit top-left, shadowed
  bottom-right, cel bands rather than gradients — [Pixelblog 6 — Light and
  Shadow](https://www.slynyrd.com/blog/2018/6/15/pixelblog-6-light-and-shadow)
  and the [LesForges course ch. 4](https://opengameart.org/content/chapter-4-shadow-and-light).
- **Clusters and orphans**: big-to-small workflow, cluster discipline, the
  orphan-pixel definition — Pedro Medeiros (Saint11), [pixel art article
  2](https://saint11.art/pixel_art_articles/article2); sharp terminators and
  2–3 tones per material in [article
  4](https://saint11.art/pixel_art_articles/article4).
- **Outlines**: 1px, cleaned lines, identical diagonal steps — Lospec's
  [Pixel Art Outlines part
  1](https://lospec.com/articles/pixel-art-outlines/); coloured/hue-shifted
  outlines beat pure black in [part
  2](https://lospec.com/articles/pixel-art-outlines-part-2-using-color/),
  with Tsugumo's chapter-12 selective-outlining lesson via Lospec.
- **Chibi proportions**: head ≈ half the sprite, low-set eyes, stubby feet —
  the st0ven super-deformed tutorial via Lospec.
- **The hardware facts** (GBATEK): OBJ sprites max 64×64, 16 palettes × 16
  colors, color 0 transparent — so ≤ 15 visible colors per sprite is a
  budget with a reason, not a taste.
- **The measured canon** `[V]`: 16 Emerald front sprites parsed from
  [pret/pokeemerald](https://github.com/pret/pokeemerald) — content 23–61px
  wide × 22–53px tall (avg ~41×39), margins averaging ~12px on all sides,
  7–15 visible colors each (avg 12.2), and a shared outline colour of
  16,16,16 — near-black, never #000.

**The atlas.** Three files now, and the division of labor is the point:
`scripts/creature_kit.mjs` is the drawing kit — the atlas palette, region
predicates (ellipse/roundRect/triangle, composed with union/minus), `rim()`
directional cel bands, `shade()` (base + light band + shadow band under the
one top-left light), the `outlinePass` (every opaque pixel touching
transparency becomes the outline key — a 1px outline by construction, one
that follows every silhouette and island), the shared face template
(low-set 3×4 eyes with white top-left glints, cheeks, mouth variants
including the closed sleeping arcs), stubby feet on a shared baseline, side
and raised arms, the `chibi()` standing-creature composer, and the
hand-drawn stamps (star, z's, magnifier, stopwatch).
`scripts/creature_atlas.mjs` holds the ten compositions — ids unchanged from v1 —
each with exactly ONE prop: websearch's magnifier and dish ears, mcp's dock
with three gold ports, task's single psychic orb overhead, lsp's monocle
and chain, memory's filing drawer with a card slipping out, harness's gold
stopwatch, router's clock belly and courier cap, dream's cloud-star-z's,
hooks' shield with a gold boss, sdlc's badger blaze, vest and badge.
`scripts/creature_sprites.mjs` is only the pipeline now: draw → outline
pass → deOrphan cleanup → hard gates → render (uniform 256×256 at 4×
nearest) → labeled contact sheet → optional `--review`. The AI-generation
lane is gone; git history preserves it.

**The palette, rebuilt.** The 21-token snap had to die because a text
palette is one step per hue — the exact reason cause 2 above had no fix
inside v1. The atlas palette is per-family hue-shifted ramps (aqua, magma,
gold, amber, cream, leaf, psychic, plus the navy panel ramp for props and
the plate cream-blues for face and belly), every value on the GBA 5-bit
channel grid (`floor(255·v/31)`), hues taken from the page's own families —
so the page-world link survives as inheritance by hue family, with the
ramps a text palette cannot offer. The shared outline/pupil colour is
#102039, the page's canvas navy — near-black rather than #000, the same
call the measured 16,16,16 canon made. And the page's "every sprite colour
is a legal GBA colour" claim is now true pixel-for-pixel *and gated*:
`gatePalette` fails the run on any palette value off the 5-bit grid, and
during development it caught 23 hand-computed values that were off-grid
`[V]` — `floor(255·v/31)` is not mental arithmetic, and the gate failing is
the gate working.

**The construction system** (measured against the Emerald set above):
64×64 canvas; standing sprites share baseline row 52 (bottom margin ~11px
against the pret average ~12 — the page's platform renders below the
sprite, as in-game ground would); head ≈ half the sprite; eyes low-set near
the midline, 3–4px; stubby feet; ≤ 15 visible colors (ours use 9–12); one
prop per creature — a 64px sprite stops reading past one idea, and v1 died
of two to four.

**The gates.** All hard, all in the pipeline: the 5-bit grid (on the
palette itself); ≤ 15 colors per sprite; **edge-outline integrity** — every
opaque pixel 4-adjacent to transparency must be the outline key, the
crispness invariant that no downscale can ever guarantee and the outline
pass makes true by construction; the orphan rule (a pixel with no
same-colour neighbor in the full 8-neighborhood — diagonal staircase lines
are legitimate pixel art, isolated pixels are noise) enforced by a
deterministic deOrphan merge pass, the machine version of an artist's
cleanup pass, with deliberate white glints exempt; dark-ratio ≤ 30% (the
light-scheme smudge rule, which drove real design decisions: memory's
drawer got a cream face, hooks' shield field went cream under a gold
border, sdlc's vest went gold with navy trim, router's clock belly got a
thin ring, mcp's dock face went cream); content margins (nothing within 3px
of the frame); the standing baseline 52±2; and X-mask symmetry where the
composition claims it.

**Six review rounds, two arbitrations worth keeping.** Agnes again, the
same reviewer's-aid-not-gate protocol. Round 1 PASS with craft findings;
rounds 2–5 FIX with the usual oscillating flags; round 6 PASS clean —
GBA-style with no outliers, IP-safe ("original, abstracted dev-tool
mascots"), all props readable, one cohesive family. Taken under the
repeat-rule plus mechanism triage: task got face room and a belly patch;
dream got a chunky roundRect cloud, bigger z's and bigger closed-eye arcs;
sdlc's mask band — flagged in four of five rounds — was dropped outright
for a white badger blaze between standard eyes, the cleaner badger
signifier; mcp's three floating sockets (read as a dot row, or a second
pair of eyes) became one dock plate with three gold ports; harness's
stopwatch got bigger and closer; websearch's magnifier lens went cream
with an aqua glint; lsp's monocle ring went 2px. Overruled with reasons:
round 3's "lsp is a Jigglypuff copy" fell to a signifier audit — Jigglypuff
is a pink balloon with huge blue-green eyes, a forehead curl and a
microphone, and lsp carries zero of the four (amber body, small navy eyes,
a monocle; two prior rounds had cleared it); round 4's "dream has
anti-aliased edges" is mechanically impossible — the edge-outline gate
proves every boundary pixel is the outline key and the review sheet is
nearest-neighbor resized, so this is the documented case for arbitrating
against the binding gates rather than the reviewer; round 4's
"websearch+router cool tones inconsistent" mistook design intent for drift
(the page palette is deliberately navy+aqua+gold); "hooks too bean-shaped"
is silhouette variety by design. The in-context dex crops also drew
wrong-subject reviews (the № glyph, typography) — the
full-page-versus-64px-asset failure mode Part 14 documented — so the
sprite-rubric contact-sheet reviews are the ones that count.

**Verification, and what didn't move.** Typecheck, eslint, 325 unit tests
(`creature.test.tsx` now pins the uniform 256×256 dims), the GBA palette
gate (21 dark + 21 light tokens, AA in both schemes), the claims gate (51
literals), the docs gate, and the scroll budget UNCHANGED — 12.0vh / 2,492
words / 9 bands — because the layout did not move; only the PNG bytes and
the dims table did. Production-build screenshots in both schemes plus
reduced motion, and dex-band element crops in both schemes, all green. The
ship itself is uniform 256×256: every sprite on the full 64px logical
canvas, so uniform margins and the shared baseline carry the
specimen-sheet consistency — v1 shipped ragged trimmed sizes (228×256,
184×256) that no two sprites agreed on.

**The honest cost, and the lesson in one line:** authored art is slower to
produce than a generator call — a drawing kit, ten compositions and six
review rounds cost more wall-clock than ten prompts. The trade bought
determinism (regeneration is `node scripts/creature_sprites.mjs` — no
credentials, no network, same canvas every run), consistency by
construction (one kit, one face, one baseline), IP safety by construction
(nothing is generated, so the generator's attractors cannot recur), and a
palette claim that is now checked pixel-for-pixel by a gate that
demonstrably fires. Pixel art is not a resolution — it is decisions, and
decisions belong in code.

## Part 17 — The variety round: one body plan per creature

**The trigger.** v2 shipped in the morning and was rejected on review the
same evening: *"sprites look too similar, get creative."* The VLM variety
probe put numbers on it — 9 of 10 sprites shared the same head+torso body
plan, variety 3/10, "reskins of the same base character rather than
distinct creature designs." The autopsy was structural, not cosmetic: v2's
one composition pattern (`chibi()`: head ellipse + body roundrect +
template face + stubby feet) made every silhouette the same read; ramp and
prop could not carry the difference, because silhouette is what reads
first, prop second, palette third. That ordering is the whole visual trick
of the collector genre — the genre's sprites vary from floating orbs to
serpents to swarms, and the dex feels alive because no two entries share a
plan.

**The doctrine.** v3 gives each feature its own body plan — websearch the
crawler (a round two-part spider, six legs, magnifier held), mcp the socket
golem (angular, floating cube head, gold sockets, treads — the set's only
hard-cornered creature), task the coil (a limbless serpent, tail raised,
the glowing orb balanced on its tip), lsp the bookwyrm (an oval head over
segments that taper and curve, in round spectacles, holding an open book),
memory the archive turtle (side view, drawer-shell, one card already out),
harness the coach (an upright roo: ears, pouch with a stopwatch, big feet
forward, thick tail), router the signpost (a courier head wearing two
arrow boards, planted on a pole), dream the sheep (wool bumps asleep on a
cloud), hooks the guard crab (eyes up on stalks, shield planted across its
front), sdlc the works badger (a walking quadruped, blaze, vest, one
badge). Ten plans, ten poses, ten faces. The kit additions that made the
plans drawable: `tube(pts, r)` — the capsule primitive for legs, tails,
coils, stalks — and `face()`'s `cx` parameter, which lets the shared face
template travel to any head position without breaking mirror math.

**The dark-ratio curriculum.** The ≤30% gate taught two laws the hard way
(the first v3 draft failed 7 of 10 sprites):

1. **The outline is a tax on parts.** The generated 1px outline converts
   every boundary pixel of every separate part to near-black navy, which
   bills a thin appendage 35-45% of its own pixels (a 4px-wide leg is half
   outline). The first spider's long legs measured the whole sprite at
   31%; the first signpost — six separate parts — at 46%. Law: MASS
   BEFORE PARTS. One dominant solid body per creature; appendages are
   short, thick stubs (the spider's legs attach high and stay stubby; the
   crab's stalks are short with big balls).
2. **Interior details are free.** A story painted ON the mass — the
   golem's sockets and visor, the turtle's drawer fronts, the badger's
   vest, blaze and badge, the roo's pouch — costs no outline at all,
   because the outline only exists at the transparency boundary. Attached
   parts (the golem's arms grown on at the shoulders, the router's arrows
   grown from the head, the crab's shield grown against the shell) share
   an interior edge and pay half. A detached part pays full tax, so a
   prop may detach only when it IS the one story (the orb, the stopwatch).

Two palette consequences, both gated and documented in the kit: the amber
shadow step B1 was lightened (#c5834a → #d59c5a) because lsp's
three-island silhouette cannot afford a dark shadow band per segment, and
the magma creatures shade with 1px bands (shadowD [-1,-1]) for the same
reason — L1 and M1 are dark keys, and 2px bands tipped the sprites over.
The Z-stamps were redrawn with two-pixel stepping diagonals after the
orphan gate caught `O@42,18` — a one-pixel diagonal island the outline
pass had converted to a floating orphan.

**The review rounds, and the arbitration that decided them.** Six
contact-sheet review rounds plus two element-level crop reviews (the
Part 14 lesson — a 64px asset is invisible in a full sheet, so contested
sprites get isolated crops at display scale). The arc: variety 3/10 →
7/10 (form-read failures: spider read frog, bookwyrm read pancakes, roo
read salamander) → redesigns → 8/10 → prop-read fixes (contrast: the
gold-on-amber spectacle rings were a gold mask; the cream-faced stopwatch
on a cream pouch was one blob) → **9/10, all forms read, IP-safe** (the
reviewer explicitly cleared the set against Dratini/Snivy/Krabby/Corphish
comparisons). Three findings were overruled with documented mechanisms:
lsp's round-5/round-6 flags flipped PASS↔FAIL on unchanged pixels with a
different rationale each time ("no glasses" → "cyclopean visor") while the
display-scale crop review confirmed all three signifiers (glasses yes,
book yes, segments yes) — reviewer noise, not pixel defects, resolved
2-of-3 by the repeat rule; "harness and sdlc are both quadrupeds" is
objectively false (the roo is an upright biped with two feet and a tail);
"dream's wool dithering is noisy" is the deliberate per-bump light arc
that makes wool read as wool. The one finding that survived arbitration —
the stopwatch bezel — was taken: navy bezel, bright face, gold crown,
re-verified by crop.

**Verification.** All ten sprites green on every hard gate (5-bit palette,
≤15 colors, edge-outline integrity, orphan rule, dark ratio 19-30%,
margins, baseline, symmetry where claimed); typecheck, eslint, the landing
test suite, the palette/claims/docs/changelog gates and the scroll budget
all green (the entry text moved with the forms — words and bands
unchanged). The sprites ship exactly as v2 shipped: full 64px canvas,
uniform 256×256, display at integer multiples only.

**The lesson in one line:** a bestiary is not a palette swap — the set
matches by construction (kit, palette, gates, baseline), and the
CREATURES differ by plan; silhouette variety is a design contract, now
written into the landing AGENTS.md so the next sprite starts from a
different body, not a different color.

## 2026-10-20 — the detached-engine round on the integrity pane

The engine's unattended-discipline work (docs/detached-engine-architecture.md; receipts in benchmarks/detached-engine/RESULTS.md) added the eighth gate row — "Unattended discipline" (hourly/daily call + token ceilings, the upstream backoff breaker, the job watchdog; every skip logged with its reason) — and a receipts link pointing at the benchmark RESULTS.md. The proof band's caption moved from "seven gates" to "eight gates". Rationale: the pane's claim is "how the system polices itself", and the governor is the first gate that polices the engine's *spending* rather than its *writes* — the runaway-dream receipt (9 dreams / 75 calls / 630k prompt tokens in 50 minutes, pre-fix) is exactly the class of self-inflicted failure the pane exists to answer. Copy is prose (not a claims-gated literal — no engine output is quoted verbatim); the description's claims are all receipt-backed. Grid balance improved as a side effect: eight rows is an even count for the two-column list.
