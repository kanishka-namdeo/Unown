# Marketing landing page (src/components/landing/)

## Purpose

The marketing landing page served at `/` and auto-deployed to Vercel by a push to
`main`. Ten self-contained bands plus the shared primitives they are built
from: a hand-drawn 28-form "Unown script", the Pokédex-derived lexicon each
form decodes, the capability dex that catalogs the feature creatures, an
accessible terminal session replay, the shipping rail that
renders `CHANGELOG.md`, and the effects layer that owns scroll reveals, the
letter-rain and the Konami easter egg. Three of those bands carry data
derived from repository artifacts instead of authored here — the rail, the
benchmark figures and the engine's job cadence — and the proof band is a
single tabbed section hosting three panes (benchmarks, integrity, models).
The generators and the gates are what make "every number on this page is
checkable" a build result rather than a caption; the contracts live under
Local Contracts.

The 2026-10-20 redesign (see `docs/landing-research.md`, "2026-10-20 — the
eight-band compression") merged fourteen sections / 21.5 viewports / 5,488
words into eight bands / ~12.3vh / ~2,540 words after measuring that ~57% of
visitor attention lands above the fold and 74% within two screenfuls. Every
generated number, gated literal and receipt link survived the merge — that
constraint is what the whole redesign was solved under. The same day's
capability-dex round (Part 15) then added the ninth band — and paid for it
before building it, so the nine-band page measured 12.0vh / ~2,490 words:
half a viewport shorter than the eight-band page it replaced.

## Ownership

- Owns: everything in this folder, plus `src/app/landing.css` (its stylesheet),
  `src/app/page.tsx` (composition only) and `scripts/vendor-provider-marks.mjs`.
  It also owns the contracts of `scripts/landing_changelog.mjs`,
  `scripts/landing_benchmarks.mjs` and `scripts/landing_claims.mjs`, which live
  in `scripts/` but exist only to feed `changelog-data.ts`, `benchmarks-data.ts`
  and `engine-data.ts` in this folder.
- Owns the landing palette, which is declared in `src/app/globals.css` — see
  Local Contracts for why it cannot live here.
- Children: none. A flat folder.

## Local Contracts

- `page.tsx` is **composition only**. It imports sections and arranges them; it
  contains no markup beyond the providers, the skip link and the shell. Section
  order in `page.tsx` is the page's argument — the comment above the component
  explains each placement, and `NAV_LINKS` in `shell.tsx` mirrors the anchors.
  Adding a section means adding it in both places or the page grows an orphan.
- **Dashboard affordances link in-page, never out.** The marketing route is
  the only thing Vercel hosts, and mission control is not a route at all
  anymore: `unown dashboard` is a TUI, and the retired `/dashboard` web page
  is gone from the tree (D7). So the nav "Dashboard" and the footer
  "Dashboard" point at `#showcase` (the captured TUI stills), and the
  showcase call-to-action points at `#quickstart` ("Install it and run
  unown dashboard" — an anchor inside the hero since the quickstart merge).
  `__tests__/landing-copy.test.tsx` asserts these targets — restoring any
  `/dashboard` href is a regression, not a fix (there is nothing there to
  render).
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
- **The shipping rail (`changelog.tsx`) is the generated section this folder's
  other two derivations copy, and together they are what make the rule above
  enforceable instead of aspirational.**
  `changelog-data.ts` is written by `scripts/landing_changelog.mjs` from
  `CHANGELOG.md` and is never hand-edited: `bun scripts/landing_changelog.mjs`
  regenerates it, and `bun scripts/landing_changelog.mjs --check` (CI's landing
  job, also `bun run check:changelog`) fails when the two disagree. So
  "add a feature, the page follows" is a build result, not a habit: a changelog
  entry that never reached the rail is red, and so is a rail that invented a
  date. Four rules follow from the wiring:
  - **dates come only from `## [x.y.z] - YYYY-MM-DD` headings.** This repository
    has two releases, both cut on 2026-10-18, and 190 commits spread over seven
    distinct days with a 48-day hole in the middle — so any sentence about a
    shipping *cadence* is false here. The section must never acquire one, and
    `__tests__/changelog.test.tsx` greps its own rendered text for
    weekly/monthly/continuous phrasing to keep that from arriving by copy-edit.
  - **`[Unreleased]` renders undated** ("Not cut yet"). An undated entry is a
    promise, and a promise is the one thing this page cannot check.
  - **every number on the rail is read off the data** — the entry count in the
    lead, the per-stop tallies, the `+N more` overflow — because a typed figure
    cannot survive an appended changelog entry, which is how a number becomes a
    lie without anyone editing it.
  - **the extractor is tested, not trusted.** `--check` compares the committed
    file against the same parser, so it cannot see a parser that mislabels an
    entry; `node --test scripts/landing_changelog.test.mjs` (also CI, in the same
    job) pins the title rules, the duplicate-bucket merge, the heading-level
    `Agent Behavior` scope, the fail-loud paths, and that the CLI still prints a
    verdict instead of exiting 0 having done nothing.
  Entry titles are each bullet's authored `**bold**` lead where it has one, so
  the changelog's own words reach the page; the component lists at most
  `MAX_LISTED` per stop and counts the rest out to `CHANGELOG.md`.
- **The rail is a horizontal band, and the shape is load-bearing, not styling.**
  A vertical list of release stops makes the section's height a function of how
  much work has happened: the page grows every time the project ships, which is
  the wrong shape for the page and for the claim. So it is one fixed-height
  band, one tile per stop, newest at the left, and history grows sideways. Four
  rules come with that:
  - **no scroll-jacking.** A pinned `translateX` panel needs a container as tall
    as the travel (500vh for one band), which is the same page-growth problem
    turned sideways, and it takes the wheel from the reader. Native scroll only:
    trackpad, thumb, arrow keys once the band has focus, and `◀ ▶` buttons that
    call `scrollBy` so snap never gates entry.
  - **the axis is ordinal, never proportional.** Distance encodes order only. A
    scaled axis would fuse the two releases cut on the same day and print the
    48-day commit hole as a rhythm, which is the claim this repository cannot
    support. Every date is printed as text.
  - **a tile never exceeds the viewport width** (`min(78vw, 21rem)`), so
    sideways travel moves you between stops, never into the middle of one.
    That is what keeps a horizontal scroller inside WCAG 1.4.10.
  - **the band is a named region in the tab order** — `role="region"`,
    `tabindex="0"`, `aria-label` — around a reversed `<ol role="list">`.
    `aria-current="date"` and the `▶` mark the newest **cut** stop, not the
    leftmost one: the frontier stop sits ahead of the record, and conflating
    them would claim a release that has not happened. `scroll-snap-type` stays
    `proximity` — `mandatory` can strand content that overflows a snap child and
    it kills the next-tile peek that signals there is more to read.
  The route drawing itself in is behind `@supports (animation-timeline: view())`
  and authored from its finished state (scroll-driven animation is not Baseline:
  Chrome/Edge 115+ and Safari 26, no Firefox), and it is off under
  `prefers-reduced-motion`. Nothing on the band reveals by tweening `width`.
- **The benchmark figures are generated too, for the same reason.**
  `benchmarks-data.ts` is written by `scripts/landing_benchmarks.mjs` from the
  receipt JSON under `benchmarks/` — the most-churned directory in the
  repository — and `bun scripts/landing_benchmarks.mjs --check` is a CI step in
  the landing job. The tie-break is the script's rule, not an editorial choice:
  where a track has a `rerun-*` verification directory, the newest **complete**
  rerun wins over the base receipt; a rerun whose shared `summary.json` does not
  name every model in the track is skipped whole, and `benchmark-figures.ts`
  renders a genuinely missing figure as `not measured` (never `.toFixed()` on
  null). Track descriptions and field mappings live in the generated file,
  beside the receipts they describe, so this section file holds layout and
  argument only.
  - **no count that moves with every commit may be printed here.** The section
    carried a test-count card whose headline figure was the sum of three stale
    numbers, and an assertion total that exists nowhere in the repository. It
    now names each suite by path and by the command that runs it: verifiable,
    and it does not rot overnight. A test total is not a checkable artifact, it
    is a timestamp.
  - **a figure with no receipt is cut, never re-worded.** `2.4–5.4× fewer input
    tokens` stays because `benchmarks/edit-bench/results/RESULTS.md` states it;
    `300 scored runs across two days` went because nothing anywhere did.
- **Quoted engine strings are gated, and the job list is generated.**
  `scripts/landing_claims.mjs` does two jobs this folder's honesty rule depends
  on. It writes `engine-data.ts` from `JOB_DEFS` in `router.ts`, so the pair
  strip's job listing in `loop.tsx` and the routing tile's generated job
  sentence ("eight jobs … six on a timer, two on events" at the current
  JOB_DEFS) are read from the scheduler rather than retyped:
  `ENGINE_JOBS` and `ENGINE_JOB_COUNTS` are the only legal source for a job id,
  interval or tally on this page. And it gates every literal the page presents
  as engine output — `integrity.tsx`'s hook log, all three `loop.tsx` beats
  including the `.unown/memory/project.md` excerpt, `hero.tsx`'s command
  names (the COMMANDS array and slash-command chips moved there with the
  quickstart merge; the gate's `PAGES` map follows the copy, so moving gated
  copy means updating the map in the same commit) — against the files that
  write them. Two consequences for anyone editing that copy: a quoted line may
  be **wrapped** for the terminal column but never **re-worded**, and a
  paraphrase of a real message is a failing gate, not a style choice. The
  check is strictly one-directional (page implies source) because `cli.ts`
  HELP is a superset by design — a gate that punished a deliberate omission
  would be switched off within a week.
- **Every fact is stated exactly once, in the section that argues it.** A
  measurement audit found the verify-twice rule stated seven times and the
  sandbox three times, which is what made the page's middle read as a wall: the
  eye learns that a paragraph carries no new fact and stops reading the third
  time. A second audit found it had *grown* to ten statements of verify-twice,
  four of the non-affiliation notice, five of the provider list and five of the
  tier resolver. Canonical homes, which are load-bearing — do not restate a
  claim in another section, link to its owner instead:
  - **the gates** (`integrity.tsx` `GATES[]`) — `loop.tsx`'s beats and
    `dex.tsx`'s entries describe capabilities, not the gate table;
  - **the sandbox, both layers** (`integrity.tsx` — one merged paragraph);
  - **the model allow-list and the bridge** (`models.tsx`) — `hero.tsx`'s trust
    chip, `faq.tsx`'s "which models" answer and the `Z` decode all point here
    instead of re-listing providers;
  - **the non-affiliation notice** (`shell.tsx` footer, the copy
    `verify-deploy.mjs` asserts). `alphabet.tsx` keeps its own one-liner
    because it is the section making a Pokémon claim. `faq.tsx` answers the
    question in one sentence and points at the footer;
  - **"no font file, no image sprite"** (`alphabet.tsx` only);
  - **the capability descriptions** (`dex-data.ts` — one entry per creature,
    receipts-linked; `hero.tsx`'s cli expander names the session tools and
    points at `#dex`, it does not describe them — the descriptions moved
    here from the expander's prose and the retired loop bento, 2026-10-20);
  - **the TUI addon framework's copy** (`showcase.tsx`'s addons strip, data in
    `addons-data.ts` — the three pitches, the `addons.json` config surface and
    the `/addons` configurator; the key count is derived from `ADDON_KEYS`,
    and `__tests__/addons.test.tsx` re-reads `addons/config.ts` to fail the
    run when the list drifts, so the figure cannot rot. The dex owns the ten
    creatures' capabilities, the strip owns the addon framework's, and
    neither restates the other);
  - **what mission control shows** (`showcase.tsx`'s `SCREENS` — twelve
    surfaces: the eleven `unown dashboard` screens plus the embedded
    `/dashboard` mount. Each tile must name a screen that exists in the
    registry at `pi-repo/packages/self-learning/src/dashboard/dashboard-app.ts`
    (the `SCREENS` rename from the web-dashboard era's `TABS` was part of D7:
    these are TUI screens, not browser tabs); the framed stills are the PTY
    captures named above, never fabricated mockups);
  - **the caching negative control** (`benchmarks.tsx` only — the v1 + v3
    controls share one box);
  - **the terminal-agent command surface and its session tools** (`hero.tsx`'s
    collapsed expanders — the `COMMANDS` list, the `--goal` evidence contract,
    and the session-tools paragraph naming the tools and the slash
    commands) — no other band lists commands; the one exception is the
    split-view display commands, which are `split-view.tsx`'s own surface
    (the hero keeps the `unown` CLI, the split band keeps the `/split*`
    family, and `landing_claims.mjs` gates both against their sources); the
    `unown automations create` line carries the read-only-by-default claim,
    checkable against `docs/usage.md#automations-unown-automations`;
  - **the project-config trust gate** (`integrity.tsx`, the cloned-configs
    block, receipts-linked to `config-trust.ts`);
  - **the release record** (`changelog.tsx` — the rail is the page's only home
    for what shipped and when; no other band may list features as a
    chronology, and the rail never restates what a mechanism does, which is
    `dex.tsx`'s and `integrity.tsx`'s job — it names the addition, not the
    argument for it).
- **`lexicon.ts` `means` is a DECODE, not a specification, and stays under
  ~12 words.** Twenty-eight entries at eighteen words each is a wall; at eleven
  it is a reference table you can skim, which is the only instrument that suits
  twenty-eight rows. The file used to carry 507 words of `means` prose that
  restated the gate table, the sandbox, the tier resolver, the provider grid and
  the benchmark numbers back at the page. Name the mechanism; let the section
  that owns it do the explaining. `proof` stays a bare number or repo path.
- **Lore must be reachable without interacting.** The decode panel shows one
  lexicon entry at a time, so `alphabet.tsx` lifts the `Z` form into the
  intro as a static highlight (one since the 2026-10-20 merge; it used to be
  three). A section narrated as a payoff but built as a hover-revealed
  reference table delivers nothing to the ~90% of visitors who scroll past
  it — the page's best writing was behind a pointer event. If you add lore,
  add it somewhere it can be read without a click.
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
  **No digit may be set in `font-display`:** Pixelify Sans renders `57` as `S7`
  at heading size, and an ambiguous number on the one page whose argument is that
  its numbers are checkable is a defect, not a type choice. Counts go in the
  lead (Geist) or in `font-mono`; `changelog.tsx`'s test asserts its own `h2`
  holds none.
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
  - `.gb-rail` / `.gb-rail-track` / `.gb-rail-stop` / `.gb-rail-line` — the
    shipping band: the native `overflow-x` scroller (snap `proximity`,
    `scroll-padding-inline`, `scrollbar-color` only, never `::-webkit-scrollbar`
    because iOS ignores it), the flex row, the viewport-capped tile, and the
    route segment that the guarded `view()` animation draws. The tile is a
    `.gb-panel`; nothing here re-derives the look.
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
  - **Allocation is a rule, not taste:** `psychic` is reserved for the two
    bands about Unown itself (hero, alphabet); the other eight walk the four
    Gen 3 hues so no two adjacent bands share one, and "which hue does this
    get" stays answerable without opening the file. The ten-band walk
    (2026-10-20, pinned by the composition test): psychic (hero) → leaf
    (loop) → magma (dex — the capability catalog; magma is the Gen-3 red
    the actual dex device is, and showcase/gold keeps it clear of proof's
    own magma) → gold (showcase) → aqua (split — the split-view TUI band,
    which needs a hue clear of showcase's gold and proof's magma) → magma
    (proof) → psychic (alphabet — the reserved hue interrupts the cycle
    without disturbing it) → gold (faq) → aqua (changelog) → leaf (finale).
    The proof band's three panes carry
    their own `data-hue` wrappers inside the magma section (leaf / magma /
    aqua), which keeps each pane's accents on its historical hue without
    adding top-level sections to the walk. A band that joins or leaves the
    page re-walks this paragraph — the composition test pins the whole walk,
    so a drift fails the run before a review has to catch it.
  - `SectionHead` and `TerminalWindow` take **no** hue prop —
    they inherit their section. A header that could disagree with its section is
    how the page gets eleven hues fighting each other. (`BrowserFrame` was
    removed with the web dashboard — D7 retired the only thing it framed, and
    `TerminalWindow` is now the page's only window primitive; the TUI stills
    it frames are `public/landing/tui/dashboard/stills/*.png`, twelve PTY
    captures with pane receipts, not screenshots of a browser app.)
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
- **The feature creatures** (`creature.tsx`) are the one sanctioned way the
  page carries "monster companion" art: one original render per agent feature
  (the four session tools and the six engine mechanisms — ten total,
  `CREATURE_IDS`), AUTHORED IN CODE — `scripts/creature_sprites.mjs` is the
  pipeline (outline pass, deOrphan cleanup, gates, render; it never draws),
  `scripts/creature_kit.mjs` is the drawing kit plus the atlas palette, and
  `scripts/creature_atlas.mjs` holds the ten compositions. The script IS the
  art: regenerated deterministically, no credentials, no network. The IP
  wall wording stays — no Pokémon sprite, card, logo or font is traced,
  copied or reproduced; every pixel is authored. The full process —
  research, the kit/compositions/pipeline architecture, every gate, and the
  failure catalogue — is documented as a reusable workflow in
  `docs/agentic-asset-workflow.md`; it applies to any future asset batch,
  not just creatures.
  - **The code owns every pixel.** Silhouettes are region predicates,
    shading is `rim()` cel bands under one top-left light, the 1px outline
    is GENERATED from the silhouette boundary (every opaque pixel touching
    transparency becomes the outline key — it follows every silhouette and
    island), the face comes from the shared template (low-set 3×4 eyes with
    top-left glints, cheeks, mouth variants — parameterized: `cx` recenters
    it, eyeW/eyeH resize it, so every body plan carries the same face
    family), standing sprites share
    baseline row 52, and every sprite ships on the FULL 64px canvas — a
    uniform 256×256 at 4× nearest, so uniform margins + the shared baseline
    carry the specimen-sheet consistency (the DIMS table is uniform for all
    ten; `creature.test.tsx` pins it). Display at INTEGER multiples of the
    64px logical grid via the `.creature` class
    (`image-rendering: pixelated`, landing.css) — h-16 is 1:1, the dex
    detail's h-48 is 3×. A smoothed, resampled or non-integer-scaled
    creature is a defect.
  - **One body plan per creature (the v3 variety doctrine).** The ten
    sprites do NOT share a base body: websearch is a crawler (spider),
    mcp an angular golem, task a coiled serpent, lsp a segmented
    bookwyrm, memory a side-view turtle, harness an upright roo, router
    a signpost, dream a sheep on its cloud, hooks a stalk-eyed crab,
    sdlc a walking quadruped — ten plans, ten poses, ten faces. What
    makes them one bestiary is the kit, the palette discipline, the
    gates and the baseline, NOT a shared silhouette (a shared silhouette
    read as ten reskins — the v2 autopsy, docs/landing-research.md Part
    17). Two dark-ratio lessons are part of the doctrine: MASS BEFORE
    PARTS (the generated outline taxes every separate part ~35-45% of
    its pixels, so appendages are short thick stubs on one dominant
    body) and DETAILS LIVE INTERIOR (a story painted ON the mass —
    sockets, drawer fronts, vest, blaze — costs no outline; attached
    parts share an edge and pay half).
  - **The palette is hue-family inheritance, with ramps, gated.**
    Per-family hue-shifted ramps (shadows toward blue/violet, lights toward
    yellow/white — the pret/pokeemerald palettes do the same), every value
    on the GBA 5-bit channel grid, hues taken from the page's own families
    (aqua/magma/gold/amber/cream/leaf/psychic, navy props, plate
    cream-blues) — a sprite inherits the page's world by hue family and
    carries the ramps a text palette cannot offer. The shared
    outline/pupil colour is the page canvas navy #102039 (near-black, not
    #000 — the measured Gen-3 canon is 16,16,16). "Every sprite colour is
    a legal GBA colour" is true pixel-for-pixel, and the pipeline gates it.
  - **Hard gates in the pipeline** (these fail the run; the VLM pass is an
    aid behind the repeat-rule + signifier-audit arbitration): the 5-bit
    grid on the palette itself, ≤ 15 visible colors per sprite (GBA OBJ:
    16 slots, slot 0 transparent), EDGE-OUTLINE INTEGRITY — every opaque
    pixel 4-adjacent to transparency must be the outline key, the
    crispness invariant no downscale can ever guarantee — the
    8-neighbor orphan rule with the deterministic deOrphan merge pass
    (deliberate white glints exempt), dark-ratio ≤ 30% (a dark-bodied
    sprite is a smudge on the light cream scheme — the gate drove real
    design decisions across both atlas versions: mcp's gold treads and
    flat panels, lsp's lightened amber shadow step B1, harness's 1px
    magma shadow bands and navy watch bezel, router's arrows grown from
    the head, the golem's arms grown on at the shoulders), content
    margins (nothing within 3px of the frame), the standing
    baseline 52±2, and X-mask symmetry where the composition claims it.
  - **IP vocabulary is a contract.** The compositions use generic
    creature-collector words only — never a species name, never
    ball/capture iconography, never a named artist. The generator
    attractor (round + warm-gold + pointed ears collapses into a Pikachu
    derivative; caught by signifier audit 2026-10-20) can no longer recur,
    because nothing is generated — the vocabulary ban stays as a naming
    contract. A VLM Pokémon flag is arbitrated by a signifier audit
    (defining features of ONE named character), not by genre resemblance —
    VLMs over-trigger on chibi creatures and flip between rounds.
  - **Placement: the capability dex (`dex.tsx` + `dex-data.ts`) is the ONE
    canonical home — since 2026-10-20, all ten creatures and the capability
    copy live there.** The dex is band #3 (magma), an FRLG-style two-pane:
    a searchable numbered list (fuse.js drives the search) and a detail
    pane that mounts ALL ten entries with the inactive ones `hidden` (the
    proof band's pane contract — crawlers and gates read every entry), each
    with its specimen at 3×, its game-voice entry on the gb-box, the moved
    capability copy under "in practice", the skeptic pain as a weakness
    row, receipt links, and an original synthesized cry (deterministic
    square-wave motif via Web Audio — nothing sampled, plays only on
    explicit click, inert where AudioContext does not exist). The retired
    placements (the hero's party strip, 2026-10-19→20; the loop bento's
    tile badges) stay retired — `creature.test.tsx` pins that NO creature
    renders outside the dex, so re-adding one elsewhere is a regression,
    not a feature. The proof band stays creature-free ("Pokémon in a
    benchmark table would be a costume"). The hero's cli expander names
    the session tools and links `#dex`; it does not describe them
    (`dex-data.ts` owns the descriptions — see the canonical-homes list).
  - **Accessibility:** a creature is decoration beside its text label —
    `alt=""` + `aria-hidden` (WAI decorative-image rule); the `label` prop
    exists for the day one is the sole content of a meaningful control.

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
  1. **A long dry run.** Lore is carried by the capability dex (position 3 —
    the game-voice entries and categories), `alphabet` (position 7, the wall
    + the Z highlight) with a pinch in the hero's seal captions. Rule:
    **no more than three consecutive bands at zero.** The ten-band page
    meets it exactly: loop (2) runs zero alone, ended by the dex;
    showcase → split → proof (4-6) is three, ended by alphabet; faq →
    changelog → finale (8-10) is three, ended by the footer. (The dex
    joining the page in 2026-10-20 *broke up* the old loop → showcase →
    proof run of three; the split band joining between showcase and proof
    re-lengthened that run to three, which is the cap, not a breach.) If a
    band ever joins or leaves the page, re-check both runs, not just the
    one it touches.
  2. **A repeated punchline register, which is what actually reads as boring.**
     Sections 4-10 were all aphorisms, and several were the *same* aphorism:
     "An agent that forgets is a tax you pay every morning" and "Most agents
     forget. This one has to prove it remembered" are one joke twice, and "A
     self-improving agent you cannot watch is a rumour" is a third pass at it.
     Rule: **one line per section, and each line earns its place by being a
     different kind of thing** — aphorism, reveal, callback, joke, admission,
     plain instruction. Six aphorisms in a row is a drumbeat. The hero's
     manual expander summary is deliberately a plain instruction ("Clone it,
     point it at a model, run it.") to break that run, `integrity.tsx`
     carries the page's only admission, and `changelog.tsx` states a fact and
     editorialises about nothing ("What has been added, and when.") — its
     punch is the dates.
  3. **Raise the lore share by cutting, not by writing.** A duplicate fact is
     the cheapest word on the page to delete and the only lever that raises the
     ratio without inventing prose. The second audit deleted ~450 words of
     restatement across the lexicon, the acts, the FAQ and the hero, which is
     where most of the ratio improvement came from.
  4. **The proof zone stays technical.** Pokémon in a benchmark table would be a
     costume and would fight the no-fabrication rule. Loop, showcase, proof,
     faq, changelog and finale are right at ~0% lore; their job is to be
     checkable. The reward for scrolling is delivered by alphabet, so it has
     to actually deliver it.
  5. **Convert static text to motion where motion carries the meaning.** A
     process rendered as three cells that fade in together (origin's acts) and
     a log rendered as a static table (integrity's `hook_log`) are both cases
     of a *sequence presented as simultaneity*. Stepping those is worth more
     lore than a paragraph would have been. But a number that counts up, or a
     figure that ticks from zero, reads as fabrication on a page whose entire
     argument is that its numbers are checkable — animate the container, never
     the measurement.
- **The scroll budget is a contract, enforced by tooling.** The page must stay
  at **≤ 13 viewports and ≤ 3,200 words at 1440×900**, measured by
  `node scripts/landing_audit.mjs` (add `--budget` to fail the run on a
  breach; it is a CI step in the landing job). The 2026-10-20 baseline
  after the dex round: 9 bands, 12.0vh, ~2,490 words — the dex round is
  the worked example of the rule below: the ninth band was paid for BEFORE
  it was built (party strip, bento and DexCard retired; copy moved, not
  copied), so the page got a new band and half a viewport SHORTER. The
  budget exists because the page once grew
  to 21.5 viewports and 5,488 words — fourteen sections whose back half was
  nearly unread real estate (research: ~57% of attention above the fold,
  74% within two screenfuls — `docs/landing-research.md`). When a change
  pushes past the budget, compress elsewhere in the same commit: merge
  sibling content behind tabs or expanders, cut a restated fact, or move
  detail behind a receipt link. Never settle it by deleting a generated
  number or a gated literal — those are receipts, not prose.
- **Detail lives behind expanders, receipts live on the page.** The quickstart
  merge set the pattern: the hero shows the one-liner chip (fast path) and
  carries the manual sequence, prerequisites and full command surface in
  collapsed `<details>` expanders (manual path, one click away). Collapsed
  content costs ~40px; the same content laid out costs a viewport. Use the
  pattern for any future reference material — never for a first-visit claim,
  and never to hide a number the gates check.
- **The proof band is tabs, and the panes stay mounted.** `proof.tsx` hosts
  benchmarks / integrity / models as WAI-ARIA tabs (roving tabindex, same
  implementation as the loop's stage tabs). All three panes render into the
  DOM with `hidden` on the inactive ones — that keeps every generated number
  in the server-rendered HTML for crawlers and for the
  `landing_benchmarks.mjs --check` contract, and lets in-pane `whileInView`
  reveals re-trigger when a pane is shown. Do not switch to unmounting
  panes without a plan for the generated numbers.
- **Install first (2026-10-19 rework; OS tabs the same day; quickstart folded
  in 2026-10-20; installer default + binary lane 2026-10-21): the hero carries
  one command per OS tab, and the manual sequence lives collapsed right under
  it.** For a clone-and-run tool the command is the conversion, so the hero's
  chip is a three-tab install panel (`install-panel.tsx`, a client island
  inside the server-rendered hero — it must stay one, or StarCount stops being
  an RSC): macOS and Linux show the one-line installer (`curl … install.sh |
  sh`, which refuses root, checks git and bootstraps bun itself); Windows
  shows its own PowerShell one-liner (`irm … install.ps1 | iex` — the same
  contract: refuses elevation, checks git, bootstraps bun via bun's own
  installer), with the sandbox reality in the tab's note line. Both default to
  the newest **stable release tag**, not `main` (`--main` / `-Main` is the
  explicit edge install; `--version` / `-Version` pins a tag). The chip's label
  states that policy ("install · latest stable release") and carries no
  version literal, which would go stale. The tab auto-defaults from the user
  agent (`detectOS()`, pinned branch by branch) and never gates: every tab is
  one click away, the `unown setup → bun run agent:start → unown` chain is
  printed under all of them — it is the source-stack chain — and a `<details>`
  delegation prompt serves visitors who would rather have their existing
  coding agent run the install (the pattern ollama.com/download ships). The
  manual `<details>` also carries the CLI-only binary lane as one instruction
  beside the source sequence (`sh install.sh --binary` or
  `.\install.ps1 -Binary`: verified download, no git, no bun) and says
  explicitly that it installs the terminal agent alone — the engine and
  learning stack need the full install. It is never the chip's command and
  never the chain. The tab notes may only quote the sandbox trio the page
  already claims — bubblewrap / Seatbelt / in-process jail, with
  `resolveOsSandboxBackend()` in
  `pi-repo/packages/self-learning/src/bwrap.ts` as the source of truth — the
  chip must never grow back into a command wall (exactly one `<pre>` in the
  hero, pinned), and the delegation prompt is an instruction (every command in
  it is real), not a claim. Research receipts:
  `docs/landing-research.md`, "2026-10-19 — install and try first",
  "2026-10-19 — the OS tabs, after all" and "2026-10-20 — the eight-band
  compression".
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
- **`loop.tsx` is the process band (the 2026-10-20 merge, minus the bento).**
  The beats tabs are the receipts — every body is the literal format the
  engine writes, gated literal by literal — and they stay byte-identical. The
  pair strip carries what `origin.tsx` argued (two halves, the odd power) in
  two cards and one line. The mechanisms bento that closed the band from
  2026-10-19 to 2026-10-20 (five mechanism tiles plus a sixth SDLC-parity
  tile, one creature each) moved to the capability dex with the sprites —
  `dex-data.ts` carries what `mechanisms.tsx` tabulated, entry by entry,
  and the skeptic pains live on as the dex's weakness rows. If you re-add
  mechanism prose here, you are re-stating the dex's copy — the
  facts-once rule, and `landing-copy.test.tsx` pins the move.
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
  carried nine, then eight; the built-on/cost answer folded into the
  capabilities answer (2026-10-20) because "MIT, no licence fee, only your
  endpoint's bill" is three facts the capabilities answer was already
  adjacent to. Two answers must not be cut: the naming question, and "does
  the loop actually do anything on its own" — the only place the page admits
  the loop may correctly find nothing to do. The `lead` names the *tests*
  question, which is the install-decider and is in the list; do not write a
  `lead` that promises a question the list does not contain. Every answer
  still has to pass "which section already said this?" — the naming answer
  once carried the whole Symbol-Pokémon paragraph that `alphabet.tsx`
  already tells, and the affiliation answer once restated the footer notice,
  which is the copy `verify-deploy.mjs` asserts.
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
- The TUI's `unown` theme (cool zinc, emerald accents — `pi-repo/.../src/theme.ts`) is
  untouched by this page. Only the landing page is retro.

## Verification

- `bunx eslint src --quiet` — clean.
- **The scroll budget gate (2026-10-20):** `node scripts/landing_audit.mjs
  --budget` (root `bun run audit:landing` prints the table; CI's landing job
  runs the `--budget` form) loads the page at 1440×900, neutralises reveal
  motion, and fails the run when the document exceeds **13 viewports**,
  **3,200 words**, or when a top-level band exceeds 3 viewports on its own.
  Run the plain form whenever you add a section or expand copy — it prints
  per-band height/words/paragraph counts, which is how the 14-section bloat
  was found and how regressions get caught before review.
- **The VLM design-review lane (optional, needs the bridge up):** `node
  scripts/agnes_review.mjs <image…>` sends landing screenshots through the
  llm-bridge's second upstream (agnes-3.0-flash, vision-capable; wire it via
  `BRIDGE_LOCAL_URL`/`BRIDGE_LOCAL_KEY`/`BRIDGE_LOCAL_MODELS` — see
  `.env.example`) and prints a strict PASS/FIX critique (defects + top
  improvements). It is a reviewer's aid, not a gate: weigh its findings
  against the design-system contracts in this file — the VLM does not know
  the seal is the brand or that Press Start 2P is deliberate, and it will
  happily recommend the smooth, modern, off-grid thing the palette gate
  exists to refuse.
- `bun run build` — exit 0. `/` must prerender; the star-count fetch is the only
  network call and it is wrapped.
- **The rail's own two gates, both in CI's landing job, whenever
  `CHANGELOG.md` or the extractor moves:**
  `bun scripts/landing_changelog.mjs --check` (the committed data must equal
  what the parser derives from `CHANGELOG.md` today) and
  `node --test scripts/landing_changelog.test.mjs` (the extractor's rules and
  failure modes). Regenerate with `bun scripts/landing_changelog.mjs`; never
  edit `changelog-data.ts` to make a check pass.
- **The receipts gate for the benchmark section, same job, same shape:**
  `bun scripts/landing_benchmarks.mjs` regenerates `benchmarks-data.ts` from the
  receipt JSON, `bun scripts/landing_benchmarks.mjs --check` fails when the page
  and the receipts disagree, and
  `node --test scripts/landing_benchmarks.test.mjs` pins the canonical-run rule
  and the percentage validation. All three are CI steps in the landing job.
- **The quoted-string gate, run it whenever you touch engine copy:**
  `bun scripts/landing_claims.mjs --check` (root `check:claims`) regenerates the
  jobs data check and resolves every quoted literal;
  `node --test scripts/landing_claims.test.mjs` pins the matcher itself,
  including the one-directional rule. When it fails, it prints
  `FAIL <file>:<line> "<literal>" not found in <source>` — fix the page or fix
  the claim, never the matcher, unless the matcher is genuinely wrong about the
  source.
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
  session scrubber (arrows/Home/End/Space), the release band (focus it, then
  arrows, then the `◀ ▶` buttons), the spellbox, the accordion.
- **The band's claims are measured, not asserted in prose.** happy-dom performs
  no layout, so no unit test can see a tile width or a scroll range. Against the
  production build, confirm: the section's height is constant as entries
  accumulate (839px at 1280 and 1055px at 320 with 73 entries — that is the
  whole point of the shape), every tile is narrower than the viewport minus its
  padding (336/304/250 at 1280/390/320), `scrollWidth` exceeds `clientWidth`,
  `Tab` reaches the region and arrows scroll it, the `◀ ▶` buttons move it,
  nothing is hidden under `prefers-reduced-motion` or with scripting off, and
  the document has no horizontal overflow. `download/rail_shots.mjs` does all of
  it and exits non-zero; it is a check, not a committed gate.
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
- **Any axe/pa11y scan of this page must say which state it scanned, and the
  state that matters is the reduced-motion render.** Every section below the
  fold sits at `opacity: 0` until it reveals, and axe skips invisible nodes, so
  a scan that does not reveal the document inspects roughly one screen of a
  thirty-four-screen page and reports the rest as clean. That is how three real
  WCAG 1.4.1 `link-in-text-block` failures (in-text links distinguished only by
  color) lived on the page behind a green `e2e/a11y.spec.ts`. The gate is now
  two passes — reduced motion for the whole document, no-preference after a full
  sweep for what a reader actually arrives at — and a link inside a paragraph
  carries its underline at rest, not on hover.
- Do not settle a scan with a sleep. Scanning mid-fade makes axe blend the
  foreground with the background and invent contrast failures (43 of them in one
  measured run); scanning too early also skips real violations. `revealAll`
  waits for the count of partially-transparent nodes to stop changing instead.
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
  cannot silently re-bake an old palette. `layout.tsx` also names
  `/landing/tui/dashboard/stills/01-overview.png` in its OG image set — that
  file belongs to the TUI still set, not to this page's own capture pipeline:
  the twelve stills in `public/landing/tui/dashboard/stills/` are real
  `unown dashboard` PTY captures produced by the `scripts/tui-capture/` lane
  (`pty_capture_dashboard.py` + the fixture engine; pane receipts and audit
  trail under `benchmarks/tui-beauty/dashboard-stills/`), and regenerating them
  is that lane's job, never a landing screenshot script.

## Child DOX Index

(none — flat directory)