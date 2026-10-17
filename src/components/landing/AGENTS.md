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
- `lexicon.ts` lore may only contain facts verified against Bulbapedia,
  PokémonDB, Wikipedia or ssbwiki, quoted with the source named. Popular but
  wrong (the sleeping-stick line, Lavender Town, Unown letters in Deltarune
  SAVE points) is deliberately absent. The audit is in `docs/landing-research.md`.
- Motion is additive, never load-bearing. CSS scroll reveals (`rise`,
  `seal-form`) animate from the *finished* state so a browser without
  `animation-timeline` or a visitor with reduced motion sees an identical page.
  `prefers-reduced-motion` is honoured in CSS and in every JS animation path.
- **The no-JS case is part of that rule, and it needed a fix.** Framer Motion
  serialises `initial` into the SSR markup, so ~56 elements shipped as
  `style="opacity:0;transform:translateY(20px)"` — a visitor with scripting
  disabled got a blank page. `LandingStyles` now ships a `<noscript>` override
  that undoes the inline hidden state. It is scoped to
  `[style*="opacity:0"][style*="transform"]` because that is precisely what
  framer writes and nothing else on the page hides itself that way. React does
  not hoist it out of `<noscript>`, which is what keeps it inert with scripting
  on — if you touch it, re-check that.
- Provider marks are CC0 Simple Icons, **vendored** as path data by
  `scripts/vendor-provider-marks.mjs`. Never hotlink the CDN and never add
  `npm i simple-icons` for eight glyphs. OpenAI and DashScope are text-only on
  purpose — one mark was retired at its owner's request and the other has no
  slug; see the header of `provider-marks.tsx`.
- `star-count.tsx` is a **server** component that fetches at build/ISR time. It
  must never fail a build: any error, timeout or shape mismatch renders the
  fallback. It sets `revalidate: 3600`, which is what makes `/` ISR.

### The retro design system

The page is a Game Boy that is switched on. Everything below is the local
spelling of that: sections compose these parts, they do not invent parallel
ones.

- **The palette is DMG-01, in both lights.** Declared in `src/app/globals.css`
  (see root `src/AGENTS.md` for why it lives there). The four canonical shades
  `#0f380f / #306230 / #8bac0f / #9bbc0f` are public-domain facts about a 1989
  LCD — using them is not using Pokémon art, which is why this page can look the
  way it does without shipping any. Tokens: `canvas` `panel` `panel-2`, `line`
  `line-bright` (borders), `ink` `dim` `faint` (text), `glow`/`glow-soft`
  (DMG shade 4 and a step above it), `amber` `#ffcb05` and `poke` `#ff6a4d`
  (cartridge accents), plus `sgb-cream`/`sgb-amber`/`sgb-brick`/`sgb-purple`
  (the Super Game Boy frame hues, below). Every token is **dual-valued**: a dark
  `:root`, a `prefers-color-scheme: light` block, and a `[data-theme="light"]`
  override that wins the cascade — same names in both, so a section restyles
  for free. **Never write a `dark:` variant on this page**: theming is an
  attribute on `<html>`, not a `.dark` class, and the tokens already carry both
  schemes.
- **Light mode is the same handheld in daylight, not a re-skin.** A real DMG-01
  is a *reflective, unlit* LCD — dark ink on a pale reflector, and the famous
  green-on-black is the emulator / low-light look. So the light scheme is the
  unlit screen (`#eae5c8` reflector, `#1c2810` ink) and the nav toggle picks the
  room. The toggle cycles auto → daylight → dark, persists to
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
  breaks one of the two schemes — re-check both if you do.
- **Three faces, one job each** (loaded in `src/app/layout.tsx`):
  `font-pixel` (Press Start 2P) for chrome only — eyebrows, buttons, badges,
  tile captions, kbd hints, never more than a few words; `font-display`
  (Pixelify Sans) for every `h1`/`h2`; `font-term` (VT323) for terminal
  bodies, dialogue text and `.quote`. Geist Sans stays for paragraphs — a
  pixel body face is a nostalgia trap that also costs the Lighthouse 1.00.
- **Console furniture lives in `landing.css` and `shell.tsx`.** Use these
  rather than re-deriving the look:
  - `.gb-box` — light dialogue box (bright fill, dark frame, light rim). The
    correct surface for a quotation, a dex entry, a call-to-action.
  - `.gb-panel` — dark console panel with a lit rim. The correct surface for
    a card. Square corners.
  - `.gb-btn` / `.gb-btn-dark` — pressable buttons; the press is an inset
    bevel plus a `steps(2)` translate.
  - `.gb-hp` — the stat bar. Always pair it with the printed number; colour
    is never the only signal.
  - `.gb-label`, `.gb-h`, `.gb-term`, `.gb-inset`, `.gb-cont` — pixel label,
    pixel heading, terminal body, inner hairline, blinking continue arrow.
  - `PixelCursor` (battle-menu `▶`), `ContinueArrow` (blinking `▼`),
    `HpBar` (label + bar + figure) in `shell.tsx`.
- **Colour rides on the furniture as Super Game Boy tones — the frame only,
  never the play area.** The SGB (1994) drew full-colour borders around a
  monochrome screen, so on this page a section's hue lives in its *chrome* —
  box rims, terminal/browser title bars, the pixel kicker — while body copy and
  `font-display` headings stay DMG green. Mechanism: `landing.css` declares
  `--tone-fill` / `--tone-rim`, defaulted per furniture class (`.gb-box`,
  `.gb-panel`, `.gb-bar`) and overridden by `[data-tone="cream|amber|brick|purple"]`
  (`glow` is the DMG-green default and takes no attribute). A toned `.gb-box`
  fills with the hue (text is `text-canvas`); a toned `.gb-panel` recolours only
  its rim. `shell.tsx` exports `type Tone` and `toneAttr(tone)`, and `SectionHead`,
  `TerminalWindow`, `BrowserFrame` take a `tone` prop that recolours the kicker /
  title bar / url bar. Apply one hue per section to its chrome; do not tone every
  nested element (rainbow soup), and never recolour paragraph text or glyph
  fills. The alphabet is the one deliberate exception: its 28 tiles cycle the four
  hues as rims by index (`TILE_TONES`) for a labelled-drawer wall — the eyes stay
  `dim`, because lit eyes strobe. `.gb-hp`'s `data-tone` is a *different* system
  (`mid`/`low` → green/amber/red stat step) and shares only the attribute name;
  its values never overlap the four SGB hues.
- **Square corners are the rule.** Nothing on this page uses `rounded-*`.
  A pixel language with antialiased corner radii is a contradiction, and the
  one-pixel chamfer people remember from Gen 1 cannot be faked cleanly.
- **Stepped motion, never eased, for anything that is furniture.** `.lift`
  and `.link-sweep` already use `steps()`. Hover states on boxes and buttons
  advance in discrete frames; scroll reveals and `FadeUp` keep their existing
  smooth behaviour, because those are page motion rather than UI state.
- **The box rule in one line:** on a dark canvas an offset drop shadow paints
  nothing, so depth comes from a stacked ring — dark ring, light gap, dark
  edge. `.gb-box` and `.gb-panel` already do this; do not add `shadow-*` on
  top of them, it will fight their `box-shadow`.
- **No official art, still.** Nothing Pokémon-derived is vendored, hotlinked
  or reproduced: no sprite, card, logo, Poké Ball or Pokémon font. The
  nostalgia is carried by palette, geometry, type and the hand-drawn script.
  Fonts are SIL OFL-1.1 (Press Start 2P, Pixelify Sans, VT323) — the same
  license as the Geist faces.

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
- Voice: concrete, honest about limits, no buzzwords. The engine section gets
  the whole "integrity" section because for a self-modifying agent that is the
  objection that decides installs. Keep the "what we did not run" box.
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
  `bun scripts/contrast_audit.mjs` (against the production build, same base URL
  convention as `landing_shots.mjs`) walks every visible text node and fails
  the run below AA; it is the gate for this paragraph, not the arithmetic
  below. The audit walks **both schemes** (it emulates `prefers-color-scheme`
  dark and light in turn and asserts `--color-canvas` resolved to the hex each
  should produce, so a cascade bug cannot fake a pass). Worst-case ratio of
  every text token against the three surfaces text lands on (canvas / panel /
  panel-2, taking the lowest):
  - DARK:  `ink` 14.16 · `dim` 9.30 · `faint` 5.85 · `glow` 7.28 · `amber` 10.48 ·
    `poke` 5.63 · `sgb-cream` 13.19 · `sgb-amber` 6.08 · `sgb-brick` 5.04 ·
    `sgb-purple` 6.05 · `text-canvas`-on-`bg-glow` 8.59
  - LIGHT: `ink` 9.49 · `dim` 6.50 · `faint` 5.08 · `glow` 5.50 · `amber` 5.55 ·
    `poke` 5.16 · `sgb-cream` 5.12 · `sgb-amber` 5.02 · `sgb-brick` 4.94 ·
    `sgb-purple` 9.41 · `text-canvas`-on-`bg-glow` 7.05
  `line-bright` (1.99 dark, ~2.4 light) is exempt by design in both modes: it is
  only ever a border or a bar-chart track, never text and never the sole carrier
  of a state — the audit caught it used as a `──` terminal rule once, and the
  rule was changed to `text-faint` rather than the exemption widened. `faint` has
  been moved before for exactly this reason (`#6d675f` failed at 3.16 while
  carrying 10-11px captions, which are normal text, not large text). The SGB tone
  rims were also gated per-mode before shipping: text on a toned `.gb-box` fill
  is `text-canvas` and clears 5.94–15.54 dark / 6.34–12.05 light. If you re-tune
  the palette, re-run the audit before shipping it.

## Child DOX Index

(none — flat directory)