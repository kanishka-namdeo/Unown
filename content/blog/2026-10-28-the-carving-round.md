---
title: "The carving round: the letters draw themselves"
description: "Glyph draw-on for the decode panel and the spellbox, a decode fill that stays AA at every frame, keycap chips, and copy buttons that finally speak."
date: 2026-10-28
lastmod: 2026-10-28
tags: [landing, design]
type: feature
media: [/blog/2026-10-28-the-carving-round/carving-choreography.webm, /blog/2026-10-28-the-carving-round/decode-panel-mid-carve.png, /blog/2026-10-28-the-carving-round/decode-panel-carved.png, /blog/2026-10-28-the-carving-round/spellbox-hello.png, /blog/2026-10-28-the-carving-round/finale-lead-filled.png, /blog/2026-10-28-the-carving-round/kbd-chip-alphabet.png, /blog/2026-10-28-the-carving-round/kbd-chip-receipt.png]
---

One round ago the page learned to answer you: the kicker decodes, the
headline settles, the route bar scrubs, the nav names your band. This
round — [v0.0.37](https://github.com/kanishka-namdeo/Unown/releases/tag/v0.0.37),
"the carving round" — carries the remainder of the same brief: *what
effects, animations and elements can make the landing page stunning and
intuitive?* — asked again with eight effects already shipped, so the only
candidates left are the ones that survive the page's four standing motion
invariants **and** do not repeat anything the page already says. The full
survey, with citations and the rejection reasons, is
[`docs/landing-carving-research.md`](https://github.com/kanishka-namdeo/Unown/blob/main/docs/landing-carving-research.md).

The round's namesake came from inside the repo. The `Glyph` component —
all 28 hand-authored Unown forms — has shipped a stroke-reveal hook since
the alphabet was drawn: a `reveal` prop that walks each path's
`strokeDashoffset` from nothing to the finished letter. It was never wired
to anything. This round points it at the two places where a glyph *is* the
subject.

## What shipped

**The draw-on, twice.** The alphabet band's decode panel — the terminal
window that decodes whichever form you pick — now carves its subject when
you first scroll to it, and re-carves on every hover and every pick. The
finale's spellbox (type a word, read it in the script) draws each letter
as it arrives, a touch faster, because typing is the faster gesture. The
driver is a new `DrawGlyph` in `effects.tsx`, and its honesty contract is
the same one every effect on this page signs: the server ships the
*finished* glyph, so no-JS, crawlers, pre-hydration and reduced-motion
visitors all see the complete letter; the carve runs only after an
IntersectionObserver confirms the glyph is actually on your screen; and
the moment the draw finishes, the dash ladder is removed and the resting
form is plain paths again.

<video src="/blog/2026-10-28-the-carving-round/carving-choreography.webm" controls muted loop playsinline poster="/blog/2026-10-28-the-carving-round/decode-panel-carved.png"></video>

**The decode fill.** The finale's lead paragraph — *Clone it, run one
session, come back tomorrow with memory that already knows what you told
it…* — resolves word by word as you read into it, a left-to-right wave from
the page's faint body token to its dim one. This is the Apple-style
scroll-linked word reveal, spelled the only way this page can spell it:
those pages animate opacity, and a 40%-alpha frame of body text on this
navy canvas measures about 2.4:1 — an instant fail against the WCAG AA
contrast gate the page runs in *both* motion states. So the fill animates
**color between two AA palette tokens**, every frame as readable as the
finished state, scrubbed by the reader's own scroll so it fires at no one.
Under reduced motion, and on any browser without scroll-driven
animations, the paragraph is simply there.

**The intuitiveness half.** Three smaller answers to the same brief:

- **Keycap chips.** The Konami code — the page's one easter egg, and the
  one signal that this product is keyboard-first — now wears a keycap in
  both of its homes: the alphabet's hint line and the finale's receipt.
  Same words, new shape: a mono-faced chip with a 3px keycap depth, sized
  off the page's own badge grammar. (Not the pixel face — Press Start 2P's
  latin subset carries no arrows, which is also why every ▶ on this page is
  drawn as SVG.)
- **"Copied," spoken.** The copy buttons have always swapped their icon to
  a checkmark for two seconds. But an icon swap is silent to a screen
  reader mid-page, and so is an `aria-label` change — WCAG 4.1.3 (Status
  Messages) exists precisely for this gap. Each button now carries a
  polite status region that says "Copied" for exactly the window the
  checkmark is up, and says nothing at any other time.
- **Balanced headings.** The section headings join the H1 in
  `text-wrap: balance` — the browser now breaks a long heading so it
  blocks into a shape instead of stranding one word on its own line.

## What the verifier caught

The round's Agnes VLM review (the repo's `review:vlm` lane, over the
apihub endpoint) earned its keep exactly once: the first cut of the keycap
chip measured 21.5px inside a 16.5px text line — it grew its host line and
overhung the baseline by 6.5px. Compacted to the badge-proportioned
metrics, re-reviewed: PASS. Its other suggestions — scanlines, blinking
text — are things this page has already rejected on the record (a Game Boy
Advance is a TFT panel; nothing on this page loops for decoration), which
is the review lane working as designed: a critic's findings are checked
against the contracts, not just shipped.

The verification pass also caught something better than a styling nit:
**the scroll-budget gates were measuring a moving target.** The session
replay in the hero autoplays once — about 111 words of transcript typing
in over nine seconds — and the gates measured at "page load plus a fixed
settle," which meant the same build could record counts up to ~90 words
apart depending on when the clock caught the replay. Worse, at the
replay's finish the transcript counted *twice* (the animated screen plus
its screen-reader-only copy, and `innerText` counts both). Both gates —
the audit script and the CI spec — now wait for the replay to finish and
count readable words once, subtracting the screen-reader lanes. The
result is deterministic, the twin gates agree, and the budget number is
unchanged: **13.3 viewports / 3,153 readable words against 13.5 / 3,320**.
The old green numbers were riding on mid-replay measurement, not on a
smaller page.

## The receipts

- Research + rejection reasons:
  [`docs/landing-carving-research.md`](https://github.com/kanishka-namdeo/Unown/blob/main/docs/landing-carving-research.md)
- The resumable session record, with every gate's measured result:
  [`docs/carving-round-session.md`](https://github.com/kanishka-namdeo/Unown/blob/main/docs/carving-round-session.md)
- The contracts in the page's own doc:
  [`src/components/landing/AGENTS.md`](https://github.com/kanishka-namdeo/Unown/blob/main/src/components/landing/AGENTS.md)
- The tests that pin it all: `carving.test.tsx` (15), plus the full suite
  at 374 passing; e2e 15/15 including axe-core zero-violation in both
  motion states; contrast audited on 1,812 text nodes in both schemes; a
  16-expectation real-user browser pass that caught the carve mid-draw,
  typed HELLO into the spellbox, and sampled the fill's two color states.

The next round's queue, recorded in the research doc: a cmd-K palette over
the page's sections, and hover-previews on the blog link. Both need their
own surfaces and their own a11y passes — the same bar this round had to
clear.
