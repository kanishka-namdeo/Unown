# The agentic asset workflow — generating on-brand visual assets through a gated pipeline

This document captures the process that shipped the landing page's feature
creatures (2026-10-20), written so a future agent or contributor can drive
the next visual-asset exercise — a new sprite set, a new illustration family,
an icon batch — without rediscovering any of it. The one-sentence version:

**Research the style, lock it in a deterministic pipeline, make the model
draw composition while the pipeline owns every pixel, gate hard rules in
code and soft opinions behind arbitration, review with element-level crops,
and push per milestone.**

The concrete artifacts of the first run: `scripts/creature_sprites.mjs`
(generation + GBA-ification + gates + VLM pass), `scripts/creature_crops.mjs`
(element-level review crops), `src/components/landing/creature.tsx` (the
rendering contract), the creature section of the landing `AGENTS.md` (the
durable contract), and `docs/landing-research.md` Part 14 (the round's
evidence).

---

## Phase 0 — Pin the acceptance criterion before generating anything

The failure this phase exists to prevent: the first creature round generated
"nice flat 2D chibi illustrations" that failed review because nothing about
them matched a Game Boy Advance page — soft shading, anti-aliased edges,
off-palette color. The generator will happily produce a good asset for the
wrong brand.

Before the first prompt, write down what "on-brand" means in checkable
terms. For the GBA exercise those were: 64px logical grid, hard pixels
(no anti-aliasing), 1-bit alpha, ≤16 colors, shading in two tones, and —
the decisive one — **every pixel inside the page's own palette**. If the
criterion cannot be checked by a script, it will be argued about by
reviewers instead, and reviewers flip.

## Phase 1 — Research with subagents, not from memory

Launch research subagents aggressively; they return denser material than
recall. Two lanes worked, and both should run again for a new exercise:

1. **Style + domain research**: what the target aesthetic actually is
   (hardware specs, era conventions, sprite dimensions and color counts —
   GBATEK and the pret/pokeemerald decomp settled the GBA facts), plus what
   makes it recognizable (outline weight, proportions, palette limits).
2. **Tooling research**: which library can actually enforce the criterion.
   The finding that shaped everything: **sharp cannot remap to an arbitrary
   palette** (its `palette:true` quantizes to a generated one), ImageMagick
   `-remap` snaps in RGB space and cannot combine ordered dithering with a
   custom palette, and PIL's `quantize` is RGB-space too — so the pipeline
   is a custom raw-buffer loop with OKLab nearest-color (Bottosson's
   coefficients) and sharp only for decode/encode.

IP safety research belongs in this phase whenever the style is adjacent to
a franchise: copyright protects expression, not genre; the safe vocabulary
is generic ("creature companion", "chibi monster") and the banned vocabulary
is any species name, capture iconography, or named-artist phrasing. Keep the
citation list — it is the defense if the result is ever questioned.

## Phase 2 — Lock the style into two stages: model draws, pipeline owns pixels

Practitioner consensus (Pixel Art XL et al.): prompts set the *style
direction*, post-processing enforces *palette and grid*. Ten assets match
each other only if the shared properties are imposed by one deterministic
stage — prompt-only consistency drifts per generation.

- **Stage 1 (AI)**: one locked style template; the only free variable is a
  per-asset CONCEPT line. One idea per asset — a 64px sprite stops reading
  past one prop. Concepts that fail get edited in the script (the script is
  the source of truth, not a chat log), with the failure reason as a comment
  so it does not recur.
- **Stage 2 (deterministic)**: the transform that makes the output yours.
  For creatures: box-average downscale (box, not nearest — it flattens
  shading and never rings outlines), 1-bit alpha threshold, OKLab snap onto
  the site's own palette tokens (a mirror list in the script — a token move
  updates it in the same change), palette prune to N colors with the
  outline force-kept, nearest ×4 ship, 1:1 logical display with
  `image-rendering: pixelated`.

## Phase 3 — Gates: hard rules in code, opinions behind arbitration

Distinguish two gate classes and never let them trade places:

**Hard gates (fail the run, non-negotiable):**

- *Background cut sanity* — the cut ratio must be plausible, or the
  background wasn't what the cutout expected.
- *Edge-clip on the raw* — a limb cut by the generator's frame edge reads
  broken at every display size. Run it on the RAW: a trimmed sprite always
  touches its own bounding box, so checking the shipped PNG false-positives
  on every file (that cost one confused round).
- *Dark-ratio* — for a dual-scheme site: a body that snaps mostly to the
  dark half of the palette is a smudge on the light scheme (measured, not
  theorized — coral/gold/aqua/cream bodies pass both schemes; dark navy
  bodies do not).
- *Budget / a11y / palette gates the page already enforces* — scroll
  budget, contrast audit, the no-hex-literal scan. New assets enter the
  existing verification set, they don't get an exemption.

**Soft gates (VLM reviewer's aids):** a contact-sheet pass with a rubric
tied to the acceptance criterion, and element-crop reviews for placement.
Two VLM behaviors to expect and route around:

- **Oscillation.** Identical files drew PASS and FIX on alternating rounds.
  A flag that changes nothing between rounds is noise; a flag that repeats
  across independent reviews with a concrete mechanism is signal. When a
  Pokémon/named-character flag fires, arbitrate with a **signifier audit**:
  list the specific character's defining features, count how many the asset
  carries, require several for a NEAR-IDENTICAL verdict. This caught one
  genuine Pikachu derivative (round + warm-gold + pointed ears is a
  generator attractor — steer aqua/coral/cream and bird/blob silhouettes)
  and cleared a false positive the same day.
- **Wrong-subject reviews.** A full-page screenshot is useless for judging
  a 64px sprite — one review described the page's pre-existing seal glyphs
  when asked about creatures. Generate element-level crops
  (`creature_crops.mjs`) and say so in the prompt.
- **Send pixel art to VLMs with nearest-neighbor resizing** — a lanczos
  resize of the contact sheet smooths the pixels in transit and the review
  then reports the smoothing you sent it.

## Phase 4 — Integration with the page's contracts

- The rendering component owns the display contract: intrinsic dims table
  (pipeline prints them; regeneration updates the table in the same
  change), 1:1 logical display, pixelated class, lazy + async decode.
- Decorative when a text label sits beside it (WAI decorative-image rule:
  `alt=""` + `aria-hidden`); an explicit label prop for the future
  sole-content case.
- Placement is a review question, not a guess: run the crop reviews and take
  the repeated verdicts. (Floated-in-its-own-row read as disconnected with a
  dead band; anchored beside the title read as an anchor. A two-sprite pair
  read as clutter twice; one sprite per tile won.)
- Words and height are budgets: decorative assets cost zero words
  (`innerText` counts visible text only) but every placement costs height —
  re-run the scroll budget gate in the same change.

## Phase 5 — Verify the full set, then push per milestone

The verification set for a landing change (all of it, in the same change):
typecheck, eslint, unit tests (the new component needs tests — the coverage
gate demands them), the palette gate, the scroll budget gate, the contrast
audit (both schemes), production screenshots (both schemes + reduced
motion), element crops + VLM passes for the new assets, OG image
regeneration if the hero changed, changelog entry + rail regeneration, and
the research/AGENTS docs updated in the same commit. Then `git push` per
milestone — one cohesive shippable unit per push — and rebase if the remote
moved.

Sandbox notes that cost debugging time and are now known: kill `next-server`
processes by name (Next 16 renames the process, so `pkill -f` on the start
command misses them — a zombie then serves stale HTML from a `.next` you
have since deleted, and every symptom points at a build bug that does not
exist); don't build while a standalone server serves the same `.next`; run
the audit scripts against a live dev server with an explicit
`LANDING_*_URL` when in doubt.

## The dex round (2026-10-20) — the workflow's second application, to an interactive component

The creature round's brief was "generate assets"; the dex round's was "research
an interactive Pokédex library and move the sprites there." The workflow held,
and where it stretched is worth recording:

- **Phase 0 translated cleanly from pixels to interaction.** The acceptance
  criterion for a sprite batch was checkable art rules; for the dex it became:
  all ten creatures in one place (pinned by test — nothing renders outside it),
  search driven by a real dependency, the listbox contract, the pane contract,
  every entry receipts-linked, and the scroll budget PAID FIRST (the band was
  priced before it was built: party strip + bento + DexCard retired in the
  same change, and the nine-band page shipped half a viewport shorter than
  the eight-band one — 12.0vh / ~2,490 words).
- **Phase 1's honest negative.** The research found no reusable interactive
  Pokédex UI component anywhere on npm — everything is a PokéAPI data client
  or a tutorial app shipping official Nintendo art, which the non-affiliation
  wall forbids. The deliverable dependency is fuse.js (zero-dep fuzzy search)
  driving the search; the FRLG pattern itself is hand-built in the page's own
  furniture. A researched negative plus one honest dependency beat a
  decorative install.
- **Phase 3's arbitration protocol, exercised for real.** Three Agnes VLM
  rounds oscillated FIX↔PASS on UNCHANGED elements (dark PASS→FIX, light
  FIX→PASS between rounds with no edits in between) — exactly the variance
  the first round catalogued. The discipline that worked: take only findings
  that survive a second round AND survive triage against the binding gates
  (contrast AA, palette, axe, budget); overrule the rest in writing. Two
  findings made it in (the 3× specimen, all-ten-rows on desktop), one more
  from the element crops (the centered name block); the "softer/modern"
  suggestions died as pattern conflicts.
- **Parameter measurement is part of the pipeline.** fuse.js's default-ish
  threshold 0.38 matched a third of a ten-item list for a three-letter query
  — "forgiving" reads as broken. Threshold 0.3 + `minMatchCharLength: 2` was
  measured against the real entry list before committing, and the measurement
  lives in the component's comment next to the values it justifies.
- **Tests follow moved content; they do not merely keep passing.** The bento's
  SDLC-parity assertions moved to `dex.test.tsx`, the party/bento creature
  assertions became "the dex mounts all ten + NOTHING renders outside it,"
  and `landing-copy.test.tsx` gained a moved-not-duplicated assertion that
  fails if the capability copy grows a second home. When content moves, the
  tests pin the move — otherwise the next editor re-adds the old placement
  and every gate stays green.

## The failure catalogue (what actually happened, so it isn't re-learned)

| Symptom | Cause | Fix |
| --- | --- | --- |
| Assets look "modern flat", off-brand | Generator owns rendering | Deterministic stage-2 transform owns pixels + palette |
| One sprite is a Pikachu lookalike | round + warm-gold + pointed ears attractor | Steer aqua/coral/cream, bird/blob; signifier audit on every IP flag |
| Sprites "read as smooth" in review | Contact sheet lanczos-resized before the VLM | Nearest-neighbor every resize of pixel art |
| 20 ramp steps, "airbrushed" verdicts | Too many palette entries survive the snap | Prune to 8 (two-tone) with outline force-kept |
| Limb cut at frame edge | Generator clipped the pose | Edge-clip gate on the raw + regenerate with margin guardrails |
| Dark smudges on the light scheme | Body snapped to dark palette half | Dark-ratio gate + bright-body concept steers |
| Sprite unreadable at display size | Too many ideas in one 64px asset | One prop per concept; regenerate with "bold simple shapes" |
| Review describes the wrong element | Full-page screenshot too wide for the asset | Element-level crops (`creature_crops.mjs`) |
| PASS/FIX flip-flop between rounds | VLM variance on genre-adjacent art | Repeat-flag rule + signifier-audit arbitration; VLM stays an aid, never a gate |
| Every build "missing chunks", 500s | Zombie `next-server` serving deleted `.next` | Kill by process name before build/serve; verify all page resources return 200 |
| 3-letter query matched a third of the dex | fuse.js threshold 0.38 too loose for a 10-item list | Measure the threshold against the real list (0.3 + `minMatchCharLength: 2`) and record it beside the values |
| `getByRole` finds nothing in the dex detail | testing-library role queries exclude `hidden` panes (by design) | Select the entry first (click the option), then query; or assert on `textContent` |
| A multi-edit left the file half-applied | Edit batches apply sequentially and stop at the first non-matching string | One edit per call while strings are uncertain; re-read the file after any failure before re-editing |
| Appended `.env` values ignored by the bridge | bun's .env loading is first-key-wins; an empty earlier definition shadows the append | Set values at the FIRST definition; verify with `bun -e "process.env.VAR"` before starting the service |
| "local lane ENABLED" missing after restart | `bun --hot` in a subdir does not inherit the root .env the way `bun run` does | Pass the lane's vars explicitly on the command line, or verify loading from the service's own cwd |
| `EADDRINUSE` restarting the bridge | `bun --hot` survives a pattern-matched pkill | Kill by PID from `ss -tlnp` output, then restart |

## Reuse checklist

1. Write the acceptance criterion as checkable rules (Phase 0).
2. Launch style + tooling research subagents (Phase 1); keep citations.
3. Lock the style template + per-asset concepts in a committed script; the
   script is the source of truth (Phase 2).
4. Implement the deterministic transform + hard gates; wire soft gates as
   aids with an arbitration protocol (Phase 3).
5. Integrate behind a rendering component that owns the display contract;
   respect every existing page gate (Phase 4).
6. Run the full verification set, update docs/changelog/AGENTS in the same
   change, push per milestone (Phase 5).
7. Append the run's failure catalogue rows — the catalogue is the part of
   this document that grows.
