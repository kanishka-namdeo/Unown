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
- Typography: Geist Sans for everything, Geist Mono for code/eyebrows/kbd,
  and `.quote` (Instrument Serif) **only** for attributed quotations — it
  signals "someone else's words, quoted" and must never carry body copy.
- The dashboard's cool zinc palette is untouched. Only this page is warm-dark.

## Verification

- `bunx eslint src --quiet` — clean.
- `bun run build` — exit 0. `/` must prerender; the star-count fetch is the only
  network call and it is wrapped.
- Visual check is required, not optional. Serve the production build
  (`$env:PORT=3111; $env:NODE_ENV=production; bun .next/standalone/server.js`) and
  screenshot `/` at hero, alphabet, loop, benchmarks and footer.
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
- **Contrast is a contract, not a vibe.** Every text token clears WCAG AA 4.5:1
  on the darkest surface it lands on: `ink` 17.4, `dim` 7.0, `faint` 4.7, `glow`
  10.2. `--color-faint` was `#6d675f` (3.16:1 on panel-2) and had to go to
  `#8b8279` because it carries 10–11px captions, which are normal text, not
  large text. If you re-tune the palette, re-run the arithmetic before shipping
  it. `--color-line-bright` (1.67) is exempt by design: it is only ever a
  border or a bar-chart track, never text and never the sole carrier of a
  state.

## Child DOX Index

(none — flat directory)