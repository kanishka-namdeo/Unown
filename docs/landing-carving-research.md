# Landing Effects Research — the carving round

Why the landing page (`/`) gained the effects it gained in the 2026-10-28
"carving round" (v0.0.37), what was considered and rejected, and the sourcing
rules that keep the additions inside the page's existing motion, a11y and
honesty contracts. Companion to
[`docs/landing-effects-research.md`](landing-effects-research.md) (the
presence round, which answered the first half of the same brief — the page
answering the visitor) and to
[`docs/landing-research.md`](landing-research.md) Part 4 (the standing motion
rules). The binding contracts live in
[`src/components/landing/AGENTS.md`](../src/components/landing/AGENTS.md).

**The question this round answers:** *what effects, animations and elements can
make the landing page stunning and intuitive for the end user?* — asked again,
one round after the presence round shipped its eight. The brief for THIS round
was therefore the remainder: what survives the same four standing invariants
(motion is additive, never load-bearing; the base state of every animated rule
is the finished state; the palette stays on the GBA grid; nothing loops for
decoration unless a visitor asked for it) AND does not duplicate what the page
already answers.

**Contents**

- [Part 1 — What the 2025–2026 catalogs ship that this page had not](#part-1--what-the-20252026-catalogs-ship-that-this-page-had-not)
- [Part 2 — What the research says works (and what the standards require)](#part-2--what-the-research-says-works-and-what-the-standards-require)
- [Part 3 — The shortlist: what fits THIS page now](#part-3--the-shortlist-what-fits-this-page-now)
- [Part 4 — What was rejected, and why](#part-4--what-was-rejected-and-why)
- [Part 5 — The shipped set, mapped to contracts](#part-5--the-shipped-set-mapped-to-contracts)

---

## Part 1 — What the 2025–2026 catalogs ship that this page had not

A verification pass over the pattern catalogs (Magic UI, Aceternity, 21st.dev,
motion.dev) and the shipped markup of the dev-tool cohort, reading what each
candidate IS before judging fit:

| Candidate | What it is (in shipped markup) | Precedent |
|---|---|---|
| Glyph draw-on | SVG strokes revealed via `pathLength`/`strokeDashoffset` — the "signature is written" device | Magic UI's whole "shiny text" family rides the same one-shot reveal grammar; the technique itself is SVG-native |
| Scroll-linked word fill | paragraph words resolve from dim to full as they enter, `animation-timeline: view()` per word | Apple/OpenAI statement pages; Amp (ampcode.com) ships the accessible rotator form — `sr-only` real text + `aria-hidden` animated copy; the effect is pure CSS on this page |
| kbd chips | keyboard sequences shown as keycaps in prose — the affordance that says "this product is keyboard-first" | Raycast's hero IS a keyboard; Tauri/Bun/Starship ship "Search ⌘K / `/`" chips in nav chrome |
| Status-message copy feedback | the copy button announces "Copied" to assistive tech, not just swaps its icon | WCAG 2.1.1-era status-message pattern; Bun ships copy buttons on every install snippet; cline/astro announce "Copied!" |
| `text-wrap: balance` on headings | the browser balances the last two lines of a wrap so headings block into a shape | Cursor, Zed and Amp all ship `text-balance` on their H1/H2s (verified in their CSS); Baseline widely available (Chrome 114 / Firefox 121 / Safari 17.4 — MDN BCD) |
| Shimmer text | a light band pans across `background-clip: text` | Cursor ships ~60 instances with `--shimmer-*` custom props and a `.shimmer-synced` class; Linear ships `data-shimmer` badges |
| Conic rotating border | `@property --angle` animates a `conic-gradient` border | Resend (inline `--border-color: conic-gradient(from var(--angle)…)`) and Clerk |
| Split-flap stat flip | characters flip like an airport board (Vestaboard) | Aceternity "text-flipping-board" |
| Interactive grid cells | background grid cells light under the cursor | Magic UI "interactive-grid-pattern" |
| Meteors / shooting stars | decorative spans falling diagonally | Magic UI "meteors"; Aceternity "shooting-stars-and-stars-background" |
| CRT scanlines | `repeating-linear-gradient` overlay on terminal chrome | retro-terminal CSS generators; shipped by several pixel-art sites |
| Multi-step loader chips | pipeline stages that light stepwise ("parse → plan → patch → PR") | Aceternity "multi-step-loader" |
| Word-rotator subhead | rotating benefit phrases in an H2 | Amp (ampcode.com) — the reference accessible implementation, CSS-var-parameterized entrances |
| cmd-K landing search | a keyboard palette over a static index of sections/docs | Resend ships `CmdKPublic` on the marketing site; Tauri/Bun ship "Search `/`" affordances |

## Part 2 — What the research says works (and what the standards require)

- **One-shot reveals stay under ~500ms; feedback under 300ms** (NN/g,
  *Animation Duration* — the 100–400ms window; the page's own decode wave at
  ~1s is the deliberate exception because it is the brand gesture). The draw-on
  lands at 450ms — spectacle, but inside the drag threshold.
- **A scroll-scrubbed effect is honest where a looping one is noise** (NN/g
  scroll-fading; the presence round's route-bar finding, restated). The word
  fill is scrubbed by the reader's own scroll — it cannot fire at anyone.
- **AA at every frame, not just at the ends.** axe-core (the e2e gate) measures
  contrast on whatever state the document is in; the a11y pass returns to the
  top of the page before scanning, where below-viewport words sit at their
  backwards-fill `from` color. The fill therefore animates between two
  *palette text tokens* (`faint` → `dim`, 7.8:1 → 11.3:1 on canvas) instead of
  between opacities — the Apple-style 40%-opacity frame would read ~2.4:1 and
  fail the very gate this page runs on both motion passes. Animating `color`
  between two AA tokens is the only honest spelling of this effect here.
- **Status changes must be announced** (WCAG 2.1.3? no — *4.1.3 Status
  Messages*): a copy button that only swaps its icon and its own `aria-label`
  is silent to a screen reader mid-page; a `role="status"` polite region is
  the two-line fix. The page already does this for the session-replay
  announcements — the copy buttons were the one surface that forgot.
- **Keyboard affordances are content, not chrome, for a terminal product.**
  The Konami hint lives in two places as plain prose today; a keycap-shaped
  chip is the recognition-over-recall spelling (NN/g) of the same words, at
  zero new words.
- **`text-wrap: balance` is Baseline-widely-available** (MDN BCD: Chrome 114,
  Firefox 121, Safari 17.4) and is what stops a long SectionHead heading from
  stranding one word on its own line — a polish every 2026 cohort page ships
  on its H-pair and this page already ships on its H1.
- **Motion's tier list still binds** (motion.dev): the draw-on animates SVG
  attributes (paint, bounded to one glyph), the fill animates `color` (paint,
  bounded to one paragraph), the announcements change no pixels at all —
  nothing this round adds touches layout or a compositor-hosted var.

## Part 3 — The shortlist: what fits THIS page now

Ranked by impact-per-contract-cost, given everything the presence round already
shipped (decode wave, route bar, scrollspy, spotlight, glint, Live chip,
count-up, pane-swap):

1. **Glyph draw-on** — the page's own `Glyph` component has shipped an unwired
   `reveal`/`drawStagger` stroke-reveal hook since the alphabet was authored;
   nothing on the page drives it. One small driver (`DrawGlyph` +
   `useGlyphReveal` in `effects.tsx`) makes the alphabet decode panel's subject
   glyph carve itself on first view and re-carve on every hover/pick — the
   "engraving stuck to a wall" lore of the hero seal, made literal. The finale
   spellbox gets the same driver per typed letter: the visitor spells a word,
   the letters draw themselves.
2. **The decode fill on the finale lead** — the last band is the calmest on
   the page (one FadeUp); its lead paragraph resolves word-by-word from faint
   to dim as it enters, a per-word `view()` timeline with a capped stagger.
   The brand story (unknown → known) gets its third spelling, in prose, after
   the kicker's scramble and the seal's assembly.
3. **kbd chips** — the Konami sequence in the alphabet hint and the finale
   receipt line renders as keycaps: mono text in a pixel-bordered chip, the
   words unchanged.
4. **"Copied" announced politely** — the three copy buttons gain an sr-only
   `role="status"` region that says "Copied" for the two seconds the icon is
   a checkmark, closing the WCAG 4.1.3 gap.
5. **`text-balance` on the section headings** — SectionHead's H2 joins the
   H1 in balanced wrapping.

The round also **re-verified the two a11y elements the research says are
table stakes** and found them already shipped: scroll offsets
(`scroll-mt-16` on every banded section, `scroll-mt-24` on the quickstart) and
benchmark receipts (every figure links its committed run under `benchmarks/`).
Both were left untouched; the pass is recorded here so the next round does not
re-open the question.

## Part 4 — What was rejected, and why

- **CRT scanlines on the terminal chrome** — the research round proposed them
  (every retro-terminal template ships them); the page had already rejected
  them on hardware-fidelity grounds before the presence round: *a Game Boy
  Advance is a TFT panel, it has no scanlines to photograph, and the grid is
  the only screen artefact the hardware actually has* (`landing.css`, the LCD
  pixel-grid section). Rejected again, and the reason is now recorded here so
  the proposal stops returning.
- **Hover-scramble on the nav links** (the encrypted-text pattern, Aceternity)
  — the decode wave's own contract is pixel/monospaced type only: a decoy
  glyph must occupy exactly the final glyph's cell or the line jitters. The
  nav is deliberately Geist (Press Start 2P overruns the bar below 1200px),
  so scrambling it would violate the zero-CLS rule the wave was designed
  around.
- **Shimmer text / conic border beams** — the CTA already carries the
  hover-gated `steps(4)` glint; a second light-sweep language on the same
  page is the restlessness the motion rules exist to prevent. Cursor ships
  shimmer 60 times because Cursor's whole page is glass; this one is a TFT.
- **Split-flap stat strips** — the stat band already owns its numbers with
  `CountUp` (DOM ships the receipt figure; frames are artifacts); a second
  number-motion would put two clocks on one wrist.
- **Interactive grid cells** — the hero grid is texture, not interface, and
  the pointer already has a job on this page (the scoped spotlight). Two
  cursor-following systems is one too many.
- **Meteors / shooting stars / any autonomous sky** — the standing "nothing
  loops unless a visitor asked" rule; the letter rain is the sanctioned sky
  and it is user-triggered.
- **Word-rotator on the hero subhead** — rotating copy is load-bearing by
  construction (the subhead carries the deploy gate's signature sentence,
  raw-HTML asserted); the word-settle and decode wave already own the
  entrance. Amp ships it as a beautiful one-off; this hero is already full.
- **The seal's eye blinking** — considered as an ambient "alive" touch and
  rejected on the same fidelity grounds as the scanlines: the games' Unown
  never blinks; the halo drift is the sanctioned ambient.
- **cmd-K landing search, blog hover-preview popovers** — genuinely good
  next-round candidates (both are shipped patterns: Resend's `CmdKPublic`;
  the popover API is Baseline 2024+), but each needs a static index surface
  and its own a11y pass; neither is a polish this round can honestly carry
  inside its budget. Recorded here as the head of the queue, not forgotten.
- **Cross-document View Transitions** — still Chrome-only (MDN BCD) and the
  same-document form was already rejected in the presence round.

## Part 5 — The shipped set, mapped to contracts

| Shipped | Where | Contract |
|---|---|---|
| `DrawGlyph` + `useGlyphReveal` (pure `glyphRevealAt` exported for the suite) | `effects.tsx`; wired in `alphabet.tsx` (decode panel) + `finale.tsx` (spellbox) | SSR ships the finished glyph (`reveal` starts at 1); the draw is IntersectionObserver-gated so it plays on first view, then replays on id change; reduced motion never starts the rAF; happy-dom (no IO) stays finished; decorative glyphs only (`aria-hidden`), so the a11y surface is zero |
| `.ink-fill` decode fill | `landing.css` + `SectionHead`'s `decode` prop (finale lead only) | `@supports (animation-timeline: view())` + `no-preference` gated; per-word ranges capped (`--wf` ≤ 8, 4%/48%); **color-only between two AA text tokens** so every frame passes the contrast gates; inter-word spaces in the parent inline flow (the word-settle rule) so textContent is unchanged; base = finished |
| `.gb-kbd` keycap chip | `landing.css` + `alphabet.tsx` hint + `finale.tsx` receipt | words unchanged (the `psst` deploy assertion still holds); mono face for the arrows (Press Start 2P's latin subset has no ↑↓←→ — the same reason `▶` is drawn as SVG); palette tokens only |
| "Copied" status region | `shell.tsx` `CopyButton` | sr-only `role="status"`, polite, empty when idle — WCAG 4.1.3; the dex band's "exactly two live regions" pin is untouched (no copy button lives there) |
| `text-balance` on SectionHead H2 | `shell.tsx` | Baseline widely available; zero layout risk (balance never widens) |

Budget accounting: the round adds **three** words of DOM text (the "Copied"
regions × 3) and zero scroll height. The 0.0.37 release stop's ~30 generated
rail words plus these three land as the measured budget delta in the session
record; the scroll/word gates were re-measured before the release was cut.
