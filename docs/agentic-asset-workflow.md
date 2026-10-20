# The agentic asset workflow — generating on-brand visual assets through a gated pipeline

This document captures the process that shipped the landing page's feature
creatures (2026-10-20), written so a future agent or contributor can drive
the next visual-asset exercise — a new sprite set, a new illustration family,
an icon batch — without rediscovering any of it. The one-sentence version,
as v2 states it:

**Research the style, author the pixels in code from one shared kit, gate
the hard rules in the pipeline, keep the model as a reviewer behind
arbitration, review with element-level crops, and push per milestone.**

The concrete artifacts of the first run: `scripts/creature_sprites.mjs`
(generation + GBA-ification + gates + VLM pass), `scripts/creature_crops.mjs`
(element-level review crops), `src/components/landing/creature.tsx` (the
rendering contract), the creature section of the landing `AGENTS.md` (the
durable contract), and `docs/landing-research.md` Part 14 (the round's
evidence). The same day's atlas round rewrote the pipeline into three files
and removed the AI-generation lane: `scripts/creature_kit.mjs` (the drawing
kit + the atlas palette), `scripts/creature_atlas.mjs` (the ten
compositions) and `scripts/creature_sprites.mjs` (gates + render + review
only) — the v2 story is `docs/landing-research.md` Part 16, and Phase 2
below states the corrected position.

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

## Phase 2 — Lock the style: the code draws, the pipeline gates

For pixel art, the authoring stage is code. Ten assets match each other
only if the shared properties — proportions, face, palette, outline,
baseline — are imposed by one place, and a drawing kit in a committed
script is that place. The model's role flips from generator to REVIEWER
(Phase 3); regeneration needs no API, no credentials and no network.

**v1 (superseded 2026-10-20, kept as history).** The original split —
practitioner consensus (Pixel Art XL et al.): prompts set the *style
direction*, post-processing enforces *palette and grid*. Stage 1 (AI):
one locked style template, the only free variable a per-asset CONCEPT
line, one idea per asset. Stage 2 (deterministic): box-average downscale
(box, not nearest — it flattens shading and never rings outlines), 1-bit
alpha threshold, OKLab snap onto the site's own palette tokens (a mirror
list in the script — a token move updates it in the same change), palette
prune to N colors with the outline force-kept, nearest ×4 ship, 1:1
logical display. The autopsy of the shipped set killed the split: an AI
illustration is smooth art, and box-averaging smooth art onto a 64px grid
makes mush — soft outlines, dissolved props — because averaging places
pixels near where the art was, never on purpose. Pixel art is placement
on purpose; the two-stage split could approach it but never construct it.

**v2 — authored compositions from one shared kit.**

- **The drawing kit** (`creature_kit.mjs`): the atlas palette (per-family
  hue-shifted ramps, every value on the GBA 5-bit channel grid), region
  predicates (ellipse/roundRect/triangle, composed with union/minus),
  `rim()` directional cel bands under one top-left light, `shade()`
  (base + light band + shadow band), the `outlinePass` — every opaque
  pixel touching transparency becomes the outline key, a 1px outline by
  construction that follows every silhouette and island — the shared face
  template (low-set 3×4 eyes with top-left glints, cheeks, mouth variants
  including closed sleeping arcs), stubby feet on a shared baseline, side
  and raised arms, the `chibi()` standing-creature composer.
- **The compositions** (`creature_atlas.mjs`): one per asset, one prop
  each (a 64px sprite stops reading past one idea), built only from kit
  parts plus hand-drawn stamps. Consistency across the set is by
  construction — one kit, one face, one baseline — not prompt discipline.
- **The pipeline** (`creature_sprites.mjs`) never draws: it runs the
  outline pass, the deOrphan cleanup, the hard gates, the render
  (uniform 4× nearest) and the contact sheet. What the drawing claims,
  the gates prove (Phase 3).

## Phase 3 — Gates: hard rules in code, opinions behind arbitration

Distinguish two gate classes and never let them trade places:

**Hard gates (fail the run, non-negotiable):**

- *Background cut sanity* (v1, generator lane — retired with it) — the cut
  ratio must be plausible, or the background wasn't what the cutout
  expected.
- *Edge-clip on the raw* (v1, generator lane — retired with it) — a limb
  cut by the generator's frame edge reads broken at every display size.
  Run it on the RAW: a trimmed sprite always touches its own bounding box,
  so checking the shipped PNG false-positives on every file (that cost one
  confused round).
- *Dark-ratio* (v1 and v2) — for a dual-scheme site: a body that snaps
  mostly to the dark half of the palette is a smudge on the light scheme
  (measured, not theorized — coral/gold/aqua/cream bodies pass both
  schemes; dark navy bodies do not). In v2 it drove design decisions, not
  just concept steers.
- *The atlas gates* (v2, authored pixel art) — the 5-bit GBA grid gated on
  the palette itself, ≤ 15 visible colors per sprite (GBA OBJ: 16 slots,
  slot 0 transparent), **edge-outline integrity** (every opaque pixel
  4-adjacent to transparency must be the outline key — the crispness
  invariant no downscale can ever satisfy), the 8-neighbor orphan rule
  with the deterministic deOrphan merge pass (white glints exempt),
  dark-ratio ≤ 30%, content margins, the shared standing baseline, and
  X-mask symmetry where the composition claims it.
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

## The atlas round (2026-10-20) — the workflow's third application, and its first course correction

The dex round stretched the workflow to an interactive component; the
atlas round stress-tested its core premise and corrected it. The user
reviewed the v1 creature set and rejected it ("don't look great — rethink
and redraw"), and the workflow's own machinery is what surfaced the real
problem: the Phase 3 VLM review, read through the repeat-rule arbitration,
kept flagging soft outlines and dissolved props that no prompt edit could
fix — because v1's acceptance criterion (hard pixels, crisp outlines, page
palette, ten matching sprites) was achievable by construction only if the
pixels were authored. A generator owns pixel placement, so no post-process
could ever guarantee edge-outline integrity, and ten independent
generations could never guarantee consistency.

The correction generalized the workflow rather than replacing it: Stage 1
authoring can be code — the kit and the compositions — and the model's
role moves to review. The spine is unchanged: Phase 0 still pins the
criterion before anything is drawn; Phase 1 still supplies the craft
(Slynyrd's ramps and light, Saint11's clusters and orphans, Lospec's
outlines, GBATEK, and the measured pret/pokeemerald canon); Phase 3's
gates grew teeth the generator lane never had (edge-outline integrity,
the orphan rule with a deterministic deOrphan pass, the 5-bit palette
gate that caught 23 off-grid values); and the arbitration protocol earned
two more receipts — a signifier audit that cleared a zero-signifier
sprite of a Jigglypuff flag, and an overrule-by-mechanism of a
"anti-aliased edges" claim the edge gate makes impossible. The evidence
and the full reasoning are `docs/landing-research.md` Part 16.

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
| AI illustration downscaled to 64px reads as mush (soft outlines, dissolved props) | the generator owns pixel placement; averaging smooth art is not pixel art | author pixels in code; gate edge-outline integrity (v2 — the atlas round) |
| Snapping art to the page's UI tokens gives flat or muddy shading | a text palette carries one step per hue — no ramps | per-family hue-shifted ramps on the 5-bit grid, hues from the page's families |
| Ten generated sprites don't match each other | prompt-only consistency drifts per generation | one shared kit + face/baseline/proportions — consistency by construction |
| Rim-band ends pinch into orphan pixels | shift-based bands taper at the ends | deterministic deOrphan merge pass (8-neighbour orphan rule) |
| Hand-computed "on-grid" palette values are off the grid | mental arithmetic on floor(255·v/31) slips | gate the palette itself and fix what it names (23 values caught) |
| VLM reports "anti-aliased edges" on gated pixel art | reviewer variance; the claim is mechanically impossible under the edge gate | arbitrate against the binding gates; overrule in writing |
| VLM names a specific IP character on a zero-signifier sprite | chibi over-trigger (documented since v1) | signifier audit: list the character's defining features, count how many the asset carries, require several |

## Reuse checklist

1. Write the acceptance criterion as checkable rules (Phase 0).
2. Launch style + tooling research subagents (Phase 1); keep citations.
3. Author the art in code in a committed script — one drawing kit plus one
   composition per asset; the script is the source of truth, and for pixel
   art it IS the art, not the prompts (Phase 2).
4. Implement the deterministic transform + hard gates; wire soft gates as
   aids with an arbitration protocol (Phase 3).
5. Integrate behind a rendering component that owns the display contract;
   respect every existing page gate (Phase 4).
6. Run the full verification set, update docs/changelog/AGENTS in the same
   change, push per milestone (Phase 5).
7. Append the run's failure catalogue rows — the catalogue is the part of
   this document that grows.
