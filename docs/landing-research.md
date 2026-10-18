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
schemes), axe on `/` clean, palette gate PASS, units 241 pass / 0 fail,
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
