# Marketing landing page (src/components/landing/)

## Purpose

The marketing landing page served at `/` and auto-deployed to Vercel by a push to
`main`. Thirteen self-contained sections plus the shared primitives they are
built from: a hand-drawn 28-form "Unown script", the Pokédex-derived lexicon
each form decodes, an accessible terminal session replay, and the effects layer
that owns scroll reveals, the letter-rain and the Konami easter egg.

## Ownership

- Owns: everything in this folder, plus `src/app/landing.css` (its stylesheet),
  `src/app/page.tsx` (composition only) and `scripts/vendor-provider-marks.mjs`.
- Owns the landing palette, which is declared in `src/app/globals.css` — see
  Local Contracts for why it cannot live here.
- Children: none. A flat folder.

## Local Contracts

- `page.tsx` is **composition only**. It imports sections and arranges them; it
  contains no markup beyond the providers, the skip link and the shell. Section
  order in `page.tsx` is the page's argument — the comment above the component
  explains each placement, and `NAV_LINKS` in `shell.tsx` mirrors the anchors.
  Adding a section means adding it in both places or the page grows an orphan.
- **Dashboard affordances link in-page, never to `/dashboard`.** The marketing
  route is the only thing Vercel hosts; the live `/dashboard` there has no
  engine behind it and would show an empty app. So the nav "Dashboard", the
  footer "Dashboard" and the mechanisms infrastructure tile point at
  `#showcase` (the captured screenshots), and the showcase call-to-action points
  at `#quickstart` ("Install it and open the dashboard"). `__tests__/landing-copy.test.tsx`
  asserts these targets — restoring a `/dashboard` href is a regression, not a
  fix.
- **The Unown script is the identity.** `glyphs.ts` holds 28 stroke paths on a
  100×100 grid plus `EYES[]` (per-form eye placement) and `MARKS` (decorative
  non-letters). It is drawn from scratch: no Pokémon sprite, card, logo or font
  is vendored, hotlinked or reproduced anywhere in this repo. If a form looks
  wrong, change the path — never substitute an official asset.
- Two weights from one path set. `WEIGHT.heavy` (21) is the silhouette, `WEIGHT.script`
  (8.5) is the reading weight. `heavy` is capped at 21 because three horizontal
  bars on `E`/`F` need a clear gap or they merge into a slab.
- The eye is a **disc**, not a lens. A lens reads as a keyhole the moment it
  overlaps a stroke, and on the closed forms it always does. `EYES[]` places it
  in the counter where a form has one and over the centre of mass where it does
  not. Radii are authored against `WEIGHT.heavy`; the renderer scales them.
- Eye tone is a hierarchy, not a style: `dim` by default, `lit` only where one
  glyph is the subject (hero seal, pinned alphabet form, spellbox). A wall of
  twenty-eight lit eyes strobes.
- **Every factual claim is a real artifact.** The loop section quotes the note
  template from `termhooks.ts`, the log strings from `harness.ts`, and real
  AutoDream-written lines from `.unown/memory/project.md`. Benchmarks come from
  `benchmarks/`. Unverifiable live counters ("60+ verified runs") must never
  appear — they are not checkable in this checkout and the page's whole argument
  is that its numbers are checkable.
- **Every fact is stated exactly once, in the section that argues it.** A
  measurement audit found the verify-twice rule stated seven times and the
  sandbox three times, which is what made the page's middle read as a wall: the
  eye learns that a paragraph carries no new fact and stops reading the third
  time. A second audit found it had *grown* to ten statements of verify-twice,
  four of the non-affiliation notice, five of the provider list and five of the
  tier resolver. Canonical homes, which are load-bearing — do not restate a
  claim in another section, link to its owner instead:
  - **the gates** (`integrity.tsx` `GATES[]`) — `mechanisms.tsx` 02/04/05 and
    `loop.tsx` describe the loop, not the gate table;
  - **the sandbox, both layers** (`integrity.tsx`) — `mechanisms.tsx` keeps only
    the Flatpak/Claude Code comparison, which integrity has no equivalent of;
  - **the model allow-list and the bridge** (`models.tsx`) — `hero.tsx`'s trust
    chip, `faq.tsx`'s "which models" answer and the `Z` decode all point here
    instead of re-listing providers;
  - **the non-affiliation notice** (`shell.tsx` footer, the copy
    `verify-deploy.mjs` asserts). `alphabet.tsx` and `field-notes.tsx` keep
    their own one-liners because they are the sections making a Pokémon claim.
    `faq.tsx` answers the question in one sentence and points at the footer;
  - **"no font file, no image sprite"** (`alphabet.tsx` only — `finale.tsx` used
    to restate the weaker "28 forms, all inline SVG" seven sections later);
  - **`DEX_QUOTES.origin`** (`field-notes.tsx` dex card, which reads it from
    `lexicon.ts`). `origin.tsx` used to print the same 33 words as a second
    pull-quote; it now carries only the "odd power" quotation and states the
    "which came first" argument in prose;
  - **the caching negative control** (`benchmarks.tsx` only — once as a caption,
    once as the control box; it used to be three times);
  - **the terminal-agent command surface and its session tools**
    (`quickstart.tsx` — the `COMMANDS` list, the `--goal` evidence contract,
    and the session-tools paragraph naming `lsp`, the MCP join and the slash
    commands) — no other section lists commands or session tools;
  - **the project-config trust gate** (`integrity.tsx`, the cloned-configs
    block, receipts-linked to `config-trust.ts`) — the quickstart names
    `.unown/mcp.json` as where servers are configured without restating the
    gate.
- **`lexicon.ts` `means` is a DECODE, not a specification, and stays under
  ~12 words.** Twenty-eight entries at eighteen words each is a wall; at eleven
  it is a reference table you can skim, which is the only instrument that suits
  twenty-eight rows. The file used to carry 507 words of `means` prose that
  restated the gate table, the sandbox, the tier resolver, the provider grid and
  the benchmark numbers back at the page. Name the mechanism; let the section
  that owns it do the explaining. `proof` stays a bare number or repo path.
- **Lore must be reachable without interacting.** The decode panel shows one
  lexicon entry at a time, so `HIGHLIGHTS` in `alphabet.tsx` lifts three forms
  into the intro column as a static strip. A section narrated as a payoff but
  built as a hover-revealed reference table delivers nothing to the ~90% of
  visitors who scroll past it — the page's best writing was behind a pointer
  event. If you add lore, add it somewhere it can be read without a click.
- `lexicon.ts` lore may only contain facts verified against Bulbapedia,
  PokémonDB, Wikipedia or ssbwiki, quoted with the source named. Popular but
  wrong (the sleeping-stick line, Lavender Town, Unown letters in Deltarune
  SAVE points) is deliberately absent. The audit is in `docs/landing-research.md`.
- Motion is additive, never load-bearing. CSS scroll reveals (`rise`,
  `seal-form`) animate from the *finished* state so a browser without
  `animation-timeline` or a visitor with reduced motion sees an identical page.
  `prefers-reduced-motion` is honoured in CSS and in every JS animation path.
- **`page.tsx` wraps the tree in `LandingMotion` (`MotionConfig
  reducedMotion="user"`), and that is the only place reduced motion has to be
  handled for framer.** `FadeUp` branches on `useReducedMotion()` itself, which
  protects reveals written through the primitive — but the page also has staged
  reveals written as bare `motion` elements because they need per-item delays:
  the `origin` pipeline (rail `scaleX`, then three staggered `motion.li`), the
  `integrity` hook log (seven staggered rows) and the `finale` spellbox
  (per-letter `motion.span`). Without the wrapper those three would move a
  reduced-motion visitor through the page. Wrap new animation in
  `LandingMotion`, not in another `useReducedMotion()` branch.
- **The FAQ accordion animates on `height`, and it needs two files to do it.**
  The vendored `ui/accordion.tsx` already emits
  `data-[state=open]:animate-accordion-down`, but Tailwind only resolves
  `--animate-*` in the file that pulls in `tailwindcss` — `globals.css` — so
  `--animate-accordion-down` / `-up` live in its `@theme` block and the
  `@keyframes` live in `landing.css`. Both were missing, which compiled the
  classes to nothing: every answer had been snapping open with no motion, and
  nothing in the build failed. `landing.css` also carries a
  `prefers-reduced-motion: reduce` override that sets `animation: none` on
  both utilities, because plain CSS keyframes do not consult the preference.
  With the animation off, an open answer keeps its Radix-measured height and a
  closed one unmounts — the finished state. Do not edit the vendored primitive.
- **The no-JS case is part of that rule, and it needed a fix.** Framer Motion
  serialises `initial` into the SSR markup, so ~56 elements shipped as
  `style="opacity:0;transform:translateY(20px)"` — a visitor with scripting
  disabled got a blank page. `LandingStyles` now ships a `<noscript>` override
  that undoes the inline hidden state. It is scoped to
  `[style*="opacity:0"][style*="transform"]` because that is precisely what
  framer writes and nothing else on the page hides itself that way. React does
  not hoist it out of `<noscript>`, which is what keeps it inert with scripting
  on — if you touch it, re-check that.
- **That restore can only reach a reveal that carries BOTH `opacity:0` and a
  `transform`, so nothing on this page may reveal by tweening `width`.** A width
  tween serialises as `style="width:0"`, matches neither substring, and the
  element stays at zero with scripting disabled. `BarRow` used to do exactly
  that and rendered every benchmark bar in both track cards as an empty track;
  `LiftBar` was already correct. The pattern for a bar reveal is: put the
  **finished** value in `style`, animate `scaleX` from 0 with `origin-left`, and
  branch on `useReducedMotion()` so the finished state is the initial state.
  The printed figure beside the bar is a second signal, not a substitute for the
  bar itself.
- Provider marks are CC0 Simple Icons, **vendored** as path data by
  `scripts/vendor-provider-marks.mjs`. Never hotlink the CDN and never add
  `npm i simple-icons` for eight glyphs. OpenAI and DashScope are text-only on
  purpose — one mark was retired at its owner's request and the other has no
  slug; see the header of `provider-marks.tsx`.
- `star-count.tsx` is a **server** component that fetches at build/ISR time. It
  must never fail a build: any error, timeout or shape mismatch renders the
  fallback. It sets `revalidate: 3600`, which is what makes `/` ISR.

### The retro design system

The page is a Game Boy Advance that is switched on. Everything below is the
local spelling of that: sections compose these parts, they do not invent
parallel ones.

- **The palette is Generation III, in both lights.** Declared in
  `src/app/globals.css` (see root `src/AGENTS.md` for why it lives there).
  Every colour is a **legal Game Boy Advance colour**: the console holds 5 bits
  per channel and the ROM palettes render value `v` as `floor(255*v/31)`, which
  admits exactly 32 values per channel (`00 08 10 18 20 29 31 39 41 4a 52 5a 62
  6a 73 7b 83 8b 94 9c a4 ac b4 bd c5 cd d5 de e6 ee f6 ff`). So `#ffffff` is
  allowed and `#f8f8f8` is not. `bun scripts/gba_palette_check.mjs` fails the
  run on anything off that grid, which is what makes the claim checkable rather
  than decorative — and it is also why no landing component may write its own
  hex. Tokens: `canvas` `panel` `panel-2`, `line` `line-bright` (borders),
  `ink` `dim` `faint` (text), `gold`/`gold-soft` (the navy-plus-gold accent that
  reads Gen 3), `amber` `poke` (stat-bar steps), plus the five section hues
  `gold` `aqua` `magma` `leaf` `psychic`, each with a `-field` companion. Every
  token is **dual-valued**: a dark `:root`, a `prefers-color-scheme: light`
  block, and a `[data-theme="light"]` override that wins the cascade — same
  names in both, so a section restyles for free. **Never write a `dark:`
  variant on this page**: theming is an attribute on `<html>`, not a `.dark`
  class, and the tokens already carry both schemes.
- **The two schemes are the two halves of the generation.** DARK is Hoenn — the
  Ruby/Sapphire/Emerald menu, PokéNav and cave navy (`#102039`) with gold.
  LIGHT is Kanto in daylight — the FireRed/LeafGreen interior cream (`#e6e6d5`)
  with that same navy as its ink. Caveat that must stay disclosed: **no public
  FRLG `.pal` dump exists**, so the light scheme is the verified RSE dumps
  pushed to their warm, bright end. It is art-direction, not a colour-meter
  reading. The toggle cycles auto → daylight → dark, persists to
  `localStorage.unown-theme`, and the inline `<head>` bootstrap in `layout.tsx`
  replays it before first paint (no flash, and inert with scripting off). The
  auto default is `prefers-color-scheme`, so an untouched visitor gets their OS.
- **Tokens live in a non-inline `@theme` block; only the fonts are
  `@theme inline`.** Tailwind emits `var(--color-…)` for a non-inline theme, so
  the `:root` / media-query / `[data-theme]` cascade can repaint utilities at
  runtime — an inline block would bake one scheme's value into every utility and
  freeze the page. The font tokens must stay inline because their `--font-*`
  variables are set on `<body>`, and an inline utility resolves them from
  `:root`, where they do not exist. Moving a token between the blocks silently
  breaks one of the two schemes — re-check both if you do. The same var-emitting
  property is what makes the per-section hue cascade below possible at all.
- **Three faces, one job each** (loaded in `src/app/layout.tsx`):
  `font-pixel` (Press Start 2P) for chrome only — eyebrows, buttons, badges,
  tile captions, kbd hints, never more than a few words; `font-display`
  (Pixelify Sans) for every `h1`/`h2`; `font-term` (VT323) for terminal
  bodies, dialogue text and `.quote`. Geist Sans stays for paragraphs — a
  pixel body face is a nostalgia trap that also costs the Lighthouse 1.00.
- **Console furniture lives in `landing.css` and `shell.tsx`.** Use these
  rather than re-deriving the look:
  - `.gb-box` — the game's text window (accent fill, field-coloured gutter, lit
    rim). The correct surface for a quotation, a dex entry, a call-to-action.
  - `.gb-panel` — console panel whose card surface blends toward its section's
    field. The correct surface for a card. Square corners.
  - `.gb-btn` / `.gb-btn-dark` — pressable buttons; the press is an inset
    bevel plus a `steps(2)` translate.
  - `.gb-hp` — the stat bar. Always pair it with the printed number; colour
    is never the only signal.
  - `.gb-label`, `.gb-h`, `.gb-term`, `.gb-inset`, `.gb-cont` — pixel label,
    pixel heading, terminal body, inner hairline, blinking continue arrow.
  - `.gb-dither` / `.gb-dither-fine` / `.gb-hatch` — the era's gradient. A GBA
    can address 32,768 colours but its blend and brightness effects move in
    discrete bands, so ramps step and dither; they replace any `blur()` glow,
    which is continuous-tone photography in a world made of switches.
  - `PixelCursor` (battle-menu `▶`), `ContinueArrow` (blinking `▼`),
    `HpBar` (label + bar + figure) in `shell.tsx`.
- **One hue per section, and it carries the whole section.** A GBA screen is
  full-colour, so there is no "monochrome play area" rule any more — instead a
  section declares `data-hue` on its own `<section>` and that hue becomes its
  field, its heading, its kicker, its buttons, its rims and (blended) its card
  surface. Mechanism: `landing.css` sets `--hue-bg` / `--hue-accent` on `:root`
  (canvas + gold) and overrides both per `[data-hue="gold|aqua|magma|leaf|psychic"]`;
  `section[data-hue]` then paints its background and blends
  `--color-panel-2` toward the field so a tinted section never puts a neutral
  grey card on itself. `shell.tsx` exports `type Hue`, `type Tone`, `hueAttr()`
  and `toneAttr()`. `[data-tone="…"]` on a furniture element still overrides
  just that element's `--tone-fill` / `--tone-rim`.
  - **Allocation is a rule, not taste:** `psychic` is reserved for the three
    sections about Unown itself (hero, alphabet, field-notes); the other ten
    cycle `aqua → leaf → magma → gold` in page order, so no two adjacent
    sections share a hue and "which hue does this get" is answerable without
    opening the file.
  - `SectionHead`, `TerminalWindow` and `BrowserFrame` take **no** hue prop —
    they inherit their section. A header that could disagree with its section is
    how the page gets eleven hues fighting each other.
  - Body copy (`text-dim`, `text-faint`) never takes a hue. The alphabet is the
    one deliberate intra-section variation: its 28 tiles cycle
    `TILE_TONES = [aqua, leaf, magma, gold]` as rims by index — the eyes stay
    `dim`, because lit eyes strobe.
  - `.gb-hp`'s `data-tone` is a *different* system (`mid`/`low` → gold/poke stat
    step, high is `leaf`) and shares only the attribute name with the hue tones.
- **Square corners are the rule.** Nothing on this page uses `rounded-*`.
  A pixel language with antialiased corner radii is a contradiction, and the
  one-pixel chamfer Gen 3 drew into its window skins cannot be faked cleanly.
- **Stepped motion, never eased, for anything that is furniture.** `.lift`
  and `.link-sweep` already use `steps()`. Hover states on boxes and buttons
  advance in discrete frames — a button's hover lights its rim rather than
  brightening its fill, because a lighter fill step would be an off-grid value;
  scroll reveals and `FadeUp` keep their existing smooth behaviour, because
  those are page motion rather than UI state.
- **The box rule in one line:** on a dark canvas an offset drop shadow paints
  nothing, so depth comes from a stacked ring — dark ring, light gap, dark
  edge. `.gb-box` and `.gb-panel` already do this; do not add `shadow-*` on
  top of them, it will fight their `box-shadow`.
- **The screen has one overlay, not two.** A 3px LCD pixel grid sits over the
  canvas. The CRT scanline and vignette layer is gone: a GBA is a TFT panel and
  has no scanlines, and the grid's pitch tightened from the DMG's 4px because
  the handheld's dot pitch is far finer. Fonts are SIL OFL-1.1 (Press Start 2P,
  Pixelify Sans, VT323) — the same license as the Geist faces.
- **No official art, still.** Nothing Pokémon-derived is vendored, hotlinked
  or reproduced: no sprite, card, logo, Poké Ball or Pokémon font. The
  nostalgia is carried by palette, geometry, type and the hand-drawn script.
  A GBA palette value is a fact about 2001 hardware, the same kind of fact the
  DMG shades were — it is not somebody's artwork.

## Work Guidance

- Sections are flat files named after what they show (`alphabet.tsx`,
  `integrity.tsx`). Shared primitives live in `shell.tsx`; effects in
  `effects.tsx`; the script's data in `glyphs.ts` and its renderer in
  `glyph.tsx`.
- Before changing a glyph by eye, regenerate the contact sheet and look at it:
  `bun download/contactsheet.ts` writes `download/glyphs.html` with every form
  at hero, tile and inline scale in both eye tones. Judging letterforms from
  path data alone is how you ship a keyhole.
- Alternate the layout rhythm. Most sections are a left column beside a right
  one on purpose so the ones that are not (the loop's horizontal tabs, the
  full-bleed benchmark row, the centred spellbox) still read as a change.
- **The Pokémon-to-engineering ratio is a per-screen rule, not a page-wide
  number, and the aggregate is actively misleading.** Measured authored prose
  sits near 1:2 lore:tech, but that number hides two different problems, and
  they need opposite fixes:
  1. **A long dry run.** Lore is carried by `origin`, `alphabet` and
     `field-notes`, which sit at positions 2, 3 and 11 — so positions 4-10
     (loop, mechanisms, showcase, models, benchmarks, integrity, quickstart)
     were seven consecutive sections at 0% lore across ~2,300 words. Rule:
     **no more than three consecutive sections at zero.**
  2. **A repeated punchline register, which is what actually reads as boring.**
     Sections 4-10 were all aphorisms, and several were the *same* aphorism:
     "An agent that forgets is a tax you pay every morning" and "Most agents
     forget. This one has to prove it remembered" are one joke twice, and "A
     self-improving agent you cannot watch is a rumour" is a third pass at it.
     Rule: **one line per section, and each line earns its place by being a
     different kind of thing** — aphorism, reveal, callback, joke, admission,
     plain instruction. Six aphorisms in a row is a drumbeat. `quickstart.tsx`
     is deliberately a plain instruction ("Clone it, point it at a model, run
     it.") to break that run, and `integrity.tsx` carries the page's only
     admission.
  3. **Raise the lore share by cutting, not by writing.** A duplicate fact is
     the cheapest word on the page to delete and the only lever that raises the
     ratio without inventing prose. The second audit deleted ~450 words of
     restatement across the lexicon, the acts, the FAQ and the hero, which is
     where most of the ratio improvement came from.
  4. **The proof zone stays technical.** Pokémon in a benchmark table would be a
     costume and would fight the no-fabrication rule. Loop, mechanisms,
     showcase, models, benchmarks, integrity, quickstart and faq are right at
     ~0% lore; their job is to be checkable. The reward for scrolling is
     delivered by origin, alphabet and field-notes, so those have to actually
     deliver it.
  5. **Convert static text to motion where motion carries the meaning.** A
     process rendered as three cells that fade in together (origin's acts) and
     a log rendered as a static table (integrity's `hook_log`) are both cases
     of a *sequence presented as simultaneity*. Stepping those is worth more
     lore than a paragraph would have been. But a number that counts up, or a
     figure that ticks from zero, reads as fabrication on a page whose entire
     argument is that its numbers are checkable — animate the container, never
     the measurement.
- **`field-notes` stays at position 11 despite reading better at 4.** Moving it
  next to `alphabet` would cluster the three `psychic` sections adjacently and
  break the hue rule that no two neighbouring sections share a hue — the three
  Unown sections are deliberately interleaved for that reason. Front-loading
  the lore also pushes the conversion path (benchmarks → integrity → quickstart
  → finale) into one unbroken technical run. If someone wants that change, the
  hue allocation has to be rewritten with it, not around it.
- Voice: concrete, honest about limits, no buzzwords. The integrity section gets
  the whole section because for a self-modifying agent that is the objection
  that decides installs. **The 0.0 extension-authoring admission now lives in
  `integrity.tsx`**, as a lit `gb-box` directly under the six gates, labelled
  "And one eval we report at zero". It used to be the last block of
  `benchmarks.tsx` — an 18rem aside under four cards, two panels and a
  full-width chart — which made the page's strongest trust artifact the least
  likely thing on it to be read, in a section that argued trustworthiness with
  no admission of a limit anywhere in it. Beside the gate table it is also the
  right *kind* of neighbour: a gate that says no and refuses to negotiate.
  `benchmarks.tsx` keeps the SWE-bench / Terminal-Bench caveat, which is a
  methodology footnote rather than a limit on the agent, and links to Integrity
  for the zero. Do not move it back.
- **Never justify a section with "research on dev-tool landing pages says".**
  Two section headers claimed it with no citation, which is both an AI tell and
  a violation of "every factual claim is a real artifact" — and the most
  dangerous kind, because the next editor trusts it as a reason. State the
  reason the section earns its place in terms of what it argues.
- **`origin.tsx`'s three acts are a stepped pipeline, not a second copy of the
  loop section.** They used to be three cells that faded in together, carrying
  the labels `Work` / `Learn` / `Dream` — byte-identical to `loop.tsx`'s tab
  labels — with bodies that restated `loop.tsx`'s leads almost sentence for
  sentence. Now: a rail draws `scaleX` left, the three `motion.li` stagger in
  behind it at 140ms, and each body is one line saying what the act is *for*
  rather than re-describing the gate `integrity.tsx` tabulates. The page's only
  genuine sequence must not be presented as simultaneity.
- **The copy must not read like a model wrote it.** The tells to edit out on
  sight: contrast-as-staging where the negative half names something nobody
  claimed ("not a diagram of the idea", "proof, not vibes", "neither half is
  clever"); a one-line closer that restates the paragraph above it; an ordinary
  fact dressed as design theory ("the whole thesis", "the design brief for
  everything in this repository"); writing about the document instead of its
  subject ("so it gets the whole section"); the same phrase twice in three
  lines; and em-dash saturation, which is the easiest tell to miss because each
  one alone looks fine. Dashes belong in labels, number ranges, quoted game text
  and the literal transcript, not in every second sentence. Judge a passage by
  whether it adds a fact the previous sentence did not have.
- Never "fix" prose that is a real artifact: the Pokédex quotations, the
  session-replay transcript lines, the note template, the hook log strings, the
  benchmark figures, or the non-affiliation text. They are quoted or measured,
  and `verify-deploy.mjs` asserts several of them verbatim.
- **The FAQ is seven questions and that is a decision, not an oversight.** It
  carried nine; the dream-canary answer, the two-sandbox-policies answer, the
  bridge spec and the long non-affiliation answer were all reprints of a section
  the visitor had just scrolled past, and half an accordion of restated
  material is what made it read as terms-of-service copy. Two answers must not
  be cut: the naming question, and "does the loop actually do anything on its
  own" — the only place the page admits the loop may correctly find nothing to
  do. The `lead` names the *tests* question, which is the install-decider and
  is in the list; do not write a `lead` that promises a question the list does
  not contain. Every answer still has to pass "which section already said this?"
  — the naming answer once carried the whole Symbol-Pokémon paragraph that
  `alphabet.tsx` already tells, and the affiliation answer once restated the
  footer notice, which is the copy `verify-deploy.mjs` asserts.
- **The Konami hint lives under the alphabet tiles**, next to the click-to-rain
  affordance, not in the footer. It used to sit at 10px under 58 words of
  trademark boilerplate and was `hidden sm:inline`, so it was visible to 30% of
  visitors at the lowest-attention point on the page. Placing it where a reader
  is already poking at glyphs turns the code into an escalation of an
  interaction they have already found. The `role="status"` receipt still renders
  in the finale.
- Typography: `font-display` (Pixelify Sans) for headings, `font-pixel`
  (Press Start 2P) for chrome labels, `font-term` (VT323) for terminal and
  dialogue text, Geist Sans for paragraphs, and `.quote` (VT323) **only** for
  attributed quotations — it signals "someone else's words, quoted" and must
  never carry body copy. `.quote` used to be Instrument Serif; the serif was
  the one modern note left on a Game Boy page, and a quoted dex entry is game
  text, so the face changed but the rule did not.
- The dashboard's cool zinc palette is untouched. Only this page is retro.

## Verification

- `bunx eslint src --quiet` — clean.
- `bun run build` — exit 0. `/` must prerender; the star-count fetch is the only
  network call and it is wrapped.
- Visual check is required, not optional. Serve the production build
  (`$env:PORT=3111; $env:NODE_ENV=production; bun .next/standalone/server.js`)
  and run `bun scripts/landing_shots.mjs --mobile` — it photographs every
  top-level section **in both colour schemes** (dark names are unprefixed, light
  are `light-*`), plus a reduced-motion pass and, with `--mobile`, a 390px pass,
  into `download/landing/`, and exits non-zero on a console error. Each scheme
  pass asserts `--color-canvas` resolved to that scheme's hex before shooting,
  so a light run cannot silently photograph the dark palette. The plan is
  derived from the DOM, so a section you add is photographed without editing the
  script. Look at the output; a green run that nobody looked at is not a visual
  check.
- `bun scripts/theme_toggle_check.mjs` (against the same production server)
  drives the nav switch through auto → daylight → dark → auto and asserts the
  `[data-theme]` attribute, the resolved `--color-canvas`, and the
  `localStorage.unown-theme` value agree at every step, that a forced choice
  survives a reload (the inline `<head>` bootstrap's job), and that the button's
  `aria-label` announces its state. `contrast_audit` cannot cover this: it
  emulates `prefers-color-scheme`, while the toggle writes the attribute.
- Tab through `/`: skip link, alphabet tiles, loop tabs (arrows/Home/End), the
  session scrubber (arrows/Home/End/Space), the spellbox, the accordion.
- **Open an FAQ answer and assert it actually moves.** The accordion shipped
  broken for as long as it existed — its `animate-accordion-down` utility
  resolved to nothing because the `--animate-*` tokens were in the wrong file —
  and no gate caught it, because a component that silently does not animate
  still builds, passes contrast and screenshots identically. In the browser
  console, click a trigger and check
  `getComputedStyle(document.querySelector('#faq [data-slot="accordion-content"]')).animationName`
  is `accordion-down`, then that `animation: none` under
  `prefers-reduced-motion: reduce`.
- Re-run the page with `prefers-reduced-motion: reduce` — every reveal must
  resolve to its finished state and the session replay must show the finished
  transcript with no autoplay.
- Fetch `/` and assert the served HTML contains a `<noscript>` block and that no
  stylesheet link for it appears in `<head>`. Both halves matter: absent means
  a blank page without JS, hoisted means every reveal is permanently disabled.
- Lighthouse on the production build must stay at 1.00 for accessibility,
  best-practices and SEO. It caught the contrast and list-structure bugs that
  reading the source did not.
- `bun scripts/verify-deploy.mjs` asserts the live deployment after any push to
  `main`. A green local build says nothing about whether the deploy landed, so
  this is the gate, not `bun run build`.
- **Contrast is a contract, not a vibe, and it is measured, not remembered.**
  `bun scripts/gba_palette_check.mjs` is the cheap half — it recomputes the
  table below straight out of the CSS, needs no browser, and is the palette gate
  CI can actually run. `bun scripts/contrast_audit.mjs` (against the production
  build, same base URL convention as `landing_shots.mjs`) is the real one: it
  walks every visible text node and fails the run below AA. The audit walks
  **both schemes** (it emulates `prefers-color-scheme` dark and light in turn and
  asserts `--color-canvas` resolved to the hex each should produce, so a cascade
  bug cannot fake a pass). Worst-case ratio of every text token, taken against
  **all 43 surfaces a token can actually land on** per scheme — the three
  neutrals, all five section fields, and every `/10` tint chip composited over
  each field:
  - DARK:  `ink` 9.57 · `dim` 7.49 · `faint` 5.74 · `gold` 7.69 ·
    `gold-soft` 9.47 · `amber` 7.39 · `poke` 4.53 · `aqua` 4.97 · `magma` 5.18 ·
    `leaf` 5.82 · `psychic` 4.73
  - LIGHT: `ink` 9.81 · `dim` 8.55 · `faint` 7.52 · `gold` 6.73 ·
    `gold-soft` 7.84 · `amber` 6.15 · `poke` 6.46 · `aqua` 7.15 · `magma` 6.17 ·
    `leaf` 6.78 · `psychic` 6.51
  The 43-surface rule exists because of a regression the 3-surface version
  missed: `text-gold` inside a magma section resolved to **4.49:1**, because
  every accent had only ever been checked against *its own* field. Gate each
  accent against **every** field, not just its own. `line-bright` is exempt by
  design in both modes: it is only ever a border or a bar-chart track, never
  text and never the sole carrier of a state — the audit caught it used as a
  `──` terminal rule once, and the rule was changed to `text-faint` rather than
  the exemption widened. `faint` has been moved before for exactly this reason
  (`#6d675f` failed at 3.16 while carrying 10-11px captions, which are normal
  text, not large text). Text on an accent-filled `.gb-box` is `text-canvas` and
  clears 4.53–10.40 dark / 6.46–9.41 light. The last live run scanned 1059 text
  nodes across both schemes with zero failures. **If you re-tune the palette,
  re-run both scripts before shipping it** — and note that the `color-mix` card
  blends are invisible to the static gate, which is exactly why the browser
  audit is not redundant.
- `public/landing/landing-{hero,full,mobile}.png` are the OpenGraph images
  `layout.tsx` names, and they are tracked screenshots of this page — so they go
  stale the moment the palette moves. Regenerate with
  `bun scripts/landing_og_shots.mjs` against the production build; it asserts
  `--color-canvas` resolved to the dark scheme's hex before each shot, so it
  cannot silently re-bake an old palette. The `dash-*.png` files in that folder
  are dashboard captures and are not this page's business.

## Child DOX Index

(none — flat directory)