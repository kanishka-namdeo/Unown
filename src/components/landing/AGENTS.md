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

- **The palette is DMG-01, inverted.** Declared in the `@theme` block of
  `src/app/globals.css` (see root `src/AGENTS.md` for why it lives there).
  The four canonical shades `#0f380f / #306230 / #8bac0f / #9bbc0f` are
  public-domain facts about a 1989 LCD — using them is not using Pokémon art,
  which is why this page can look the way it does without shipping any.
  Tokens: `canvas` `panel` `panel-2` (dark greens), `line` `line-bright`
  (borders), `ink` `dim` `faint` (text), `glow`/`glow-soft` (DMG shade 4 and
  a step above it), plus `amber` `#ffcb05` and `poke` `#ff6a4d` as
  cartridge-era accents.
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
  and run `bun scripts/landing_shots.mjs` — it photographs every top-level
  section plus a reduced-motion pass into `download/landing/`, and exits
  non-zero on a console error. The plan is derived from the DOM, so a section
  you add is photographed without editing the script. Look at the output; a
  green run that nobody looked at is not a visual check.
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
  below. Every text token clears 4.5:1 on `panel-2`, the highest-luminance
  surface any of them lands on: `ink` 14.16, `dim` 9.30, `faint` 5.85, `glow`
  7.28, `amber` 10.48, `poke` 5.63. Light boxes are `text-canvas` on `bg-glow`
  at 8.59, and dark text on the DMG shade-4 fill is 6.02. `line-bright` (1.99)
  is exempt by design: it is only ever a border or a bar-chart track, never
  text and never the sole carrier of a state — the audit caught it used as a
  `──` terminal rule once, and the rule was changed to `text-faint` rather
  than the exemption widened. `faint` has been moved before for exactly this
  reason (`#6d675f` failed at 3.16 while carrying 10-11px captions, which are
  normal text, not large text). If you re-tune the palette, re-run the audit
  before shipping it.

## Child DOX Index

(none — flat directory)