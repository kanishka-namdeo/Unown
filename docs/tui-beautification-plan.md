# TUI Beautification Plan (docs/tui-beautification-plan.md)

An evidence-based design plan for making the `unown` TUI beautiful — derived
from the audited capture set (`public/landing/tui/`, 34 stills + 8 story
videos) by running a VLM design critique over every frame, a pixel-level color
audit over key frames, and a defect-to-source trace through the rendering code.
The goal: a TUI that looks as premium as the product behaves.

- [Method — how this plan was derived](#method--how-this-plan-was-derived)
- [What the evidence says](#what-the-evidence-says)
- [Defect → root-cause map](#defect--root-cause-map)
- [The design moves](#the-design-moves)
- [Priority matrix](#priority-matrix)
- [Validation loop](#validation-loop)
- [Non-goals](#non-goals)

## Method — how this plan was derived

Three passes over the same capture set, then a trace into the renderer:

1. **Still critique** — each of the 34 audited stills sent (full-frame, no
   crops) to a vision model with a strict design-review prompt
   (score / strengths / defects / beautify-moves). Mean polish score:
   **3.9 / 10**.
2. **Motion critique** — 5 frames sampled evenly from each of the 8 story
   videos, sent together so the model could judge pacing, continuity, and
   transition quality. Mean motion score: **4.0 / 10**.
3. **Pixel audit** — dominant-color and band sampling on key frames to
   ground-truth the VLM's color complaints (see
   [What the evidence says](#what-the-evidence-says)).
4. **Source trace** — every recurring defect was located in the rendering code
   (`pi-repo/packages/tui`, `pi-repo/packages/coding-agent/src/modes/interactive`)
   so each move below names the file(s) it touches.

Review artifacts (42 raw VLM reviews + scripts) are kept out of the repo; the
distilled findings are below.

## What the evidence says

**Pixel audit of key frames:**

| frame | dominant color | share | reading |
|---|---|---|---|
| hero / agent-editing | `rgb(0,80,0)` ≈ ANSI-22 green | **62%** of frame | the edit tool paints its entire preview diff with a solid success background — a wall of green |
| hero / red-test-run | pure black `#000000` | 93% | the TUI paints no surface of its own; content floats on raw terminal black |
| overlays / model-picker | pure black `#000000` | 92% | overlays are thin gray text on undifferentiated void — no sense of a raised surface |
| wiki / search-results | pure black `#000000` | 89% | same flat void; footer and transcript share the same visual plane |

The 62%-green frame is the smoking gun for the single loudest VLM complaint
("massive green block breaks visual hierarchy", "solid electric blue block
feels aggressive" for the pending/running tint). The black-void frames explain
the rest: with no owned surfaces, borders are the only structure, and borders
are thin slivers on a 93% black canvas.

**Recurring defect themes across the 34 still critiques** (72 defect bullets
total, keyword tally): footer (12), status (10), hierarchy (8), color (7),
flat (6), alignment (5), density (5), indentation (4), contrast (4), border (4),
harsh (3), clutter (3).

**Motion verdicts across the 8 story videos** (scores 2–6): hard cuts between
states ("layout elements popping in and out abruptly"), text arrival as layout-
shifting dumps ("binary jump rather than a fluid reveal"), status transitions
without resolution ("Working…" fades without a completion beat), static gaps
between bursts of output. The captures already compress spinner-idle well —
the problem is transitions and arrival pacing, not recording.

## Defect → root-cause map

| evidence | root cause in code |
|---|---|
| "wall of green/blue" tool blocks | `tool-execution.ts` renders tool calls inside a full-width `Box` whose whole background is `toolPendingBg` / `toolSuccessBg` / `toolErrorBg`; `edit.ts` additionally paints the **entire diff preview** with the success/error tint (`getEditHeaderBg`) |
| intra-line diff flicker | `diff.ts` uses `theme.inverse()` on changed tokens of both removed and added lines — inverse video on a tinted box doubles the saturation |
| "jarring yellow headers" | theme `mdHeading: #f0c674` — bright Tomorrow-Night gold at body scale |
| "harsh", "stark" borders | theme `border: blue #5f87ff` — saturated blue on every input box; `borderAccent cyan #00d7ff` even brighter |
| "flat gray block" user messages | `userMsgBg #343541` full-width slab with no edge treatment |
| "footer cramped / cluttered / low-contrast" | `footer.ts` renders 2–3 lines of uniformly `dim` text: pwd+branch+session crammed on one line, tokens/cache/cost/context% crammed on the next, no grouping, no divider, semantic states only visible when >70% context |
| "'Working…' indistinct from content" | `status-indicator.ts` — accent spinner + muted text inline in the transcript; no fixed region, no completion beat |
| "zero vertical rhythm", "inconsistent padding" | spacing is ad-hoc `Spacer(1)` between blocks; boxes use `Box(1,1)` but renderers mix 0-padding `Text(0,0)` |
| "model list lacks hierarchy", overlay pops | overlay components (`select-list`, `model-selector`) render plain rows on the terminal background — no scrim, no selection bar treatment, no left-rail |
| neon-green degradation in captures | the capture terminal approximates truecolor to 256 colors: `#283228` → ANSI 22 (`#005f00`). Real terminals with 256-color fallback show the same neon shift — the theme has no hand-tuned 256-color ladder |

## The design moves

Ten moves, ordered by leverage. Moves 1–3 are theme-only (one release);
4–7 are component-level (one milestone); 8–10 are motion and system polish.

### 1. One palette, one hue-ladder (theme JSON)

Today's dark theme mixes Tomorrow-Night accents (`#81a2be`, `#b5bd68`,
`#cc6666`), VS Code Dark+ syntax colors, and two loud primaries
(`#00d7ff` cyan, `#f0c674` gold) on a gray text base. Re-tint the whole ladder
on a single harmonious base — **One Dark** (`#282c34` family) as reference —
and lower the chroma of every accent ~30%:

- `border`: `#5f87ff` → `#3e4b66` (calm slate-blue, borders stop shouting)
- `borderAccent`: `#00d7ff` → `#56b6c2` (soft teal)
- `mdHeading`: `#f0c674` → `#e5c07b` at **dimmer weight** (see move 4)
- `accent`: `#8abeb7` → `#56b6c2`, keep one accent, not three

Files: `theme/dark.json`, `theme/light.json` (re-tint light to match the same
hue relationships). No code changes.

### 2. Chrome gets surfaces, canvas stays terminal (Box backgrounds)

Paint a background only on the **chrome** — input box, overlays, footer — not
on the transcript. This gives depth (chrome reads as raised surface, transcript
as canvas) without wallpapering scrollback with background escape codes:

- new theme vars `chromeBg: #16161c` (input + footer), `overlayBg: #1c1c24`
- overlays additionally get a one-line dim scrim above/below (moves 8)
- the input box becomes the visual anchor: the one always-on surface

Files: `interactive-mode.ts` (editor box), `footer.ts`, overlay components.

### 3. End the wall-of-color: edge rails, not full fills (biggest win)

Replace whole-box tool backgrounds with a **2-cell left rail** carrying the
semantic color, title line on app background:

```
▌ edit  src/math.ts                                    ✓
▌ @@ -12,6 +12,7 @@
   context line (dim)
  - removed line (red)
  + added line (green)
```

- `tool-execution.ts`: drop `theme.bg("tool*Bg", text)` over content; paint
  the rail + a status glyph in the title line (⟳ pending / ✓ success / ✗ error)
- `edit.ts`: the diff body renders on the terminal background with
  `toolDiffAdded/Removed` foregrounds only — never a background fill
- `diff.ts`: inverse-video only on **removed** tokens; added tokens become
  **bold** green — halves the perceived flicker
- user messages: keep `userMsgBg` but add a `▌`-style left rail in `borderAccent`
  and stop the fill one column before EOL so text doesn't read as a slab

This one move changes the 62%-green frame into ~4% accent-green. It is the
single highest-leverage change in the plan.

### 4. Typographic hierarchy for markdown (markdown theme)

- H1/H2: **bold + a `─` underline rule** at heading width — structure from
  geometry, not color
- H3+: accent-colored bold text, no rule
- body stays `text`; code spans keep `mdCode`; list bullets keep `accent`
- collapse the `[Section]` label zoo (`[Themes]`, `Context`, `Skills`) into one
  label style: dim `── Section ──` centered rules — one treatment everywhere

Files: `markdown.ts` + `theme/*.json`.

### 5. Footer → status bar (footer.ts)

From a 2–3-line dim text dump to a deliberate bar:

- **top hairline divider** (`dim ─` × width) separating chrome from transcript
- line 1, left: `cwd` + `⎇ branch` + dirty dot `●`; right: `model` + thinking
  chip; two-space gaps, `·` separators
- line 2, left: context meter as a mini bar — `ctx ▕████░░░░▏ 42%` — numbers
  become a visual; color shifts only at thresholds (>70% warning, >90% error);
  cache/cost stay on this line, dimmed one step further than today
- extension statuses only render when non-empty (today's behavior) but with a
  leading dim `┆`

### 6. Input editor: the hero element (interactive-mode.ts)

- border `borderMuted` at rest; on focus/activity brighten to `borderAccent`
  **and add a `»` chevron on the left edge** — a single animated accent point
- thinking-level and bash-mode stop repainting the whole border: render as an
  inline badge on the top border (`── plan ──`), border color stays calm
- keep the caret — but never inverse-video full cell on `chromeBg`; use
  `accent` underline caret

### 7. Status region with a completion beat (status-indicator.ts)

- the working line lives directly above the input box (already true), but:
  verb-first labels — `Editing src/math.ts…`, not `Working…`
- add an elapsed-time chip (`mm:ss`, dim, updates 1/s)
- **completion beat**: spinner morphs to `✓` in `success` for ~600 ms before
  the tool block renders — gives motion a resolution (directly answers the
  "binary jump" critique)
- retry/compaction inherit the same shape, warning-tinted

### 8. Overlay choreography (select-list, model-selector, dialogs)

- one dim scrim row above + below the overlay body → the list reads as raised
- selected row = full-width `selectedBg` bar + 1-cell `accent` left rail
- number keys hint line dimmed one step below the list body
- overlay titles get the move-4 label treatment

### 9. Arrival pacing (TuiMainScreen / streaming path)

- batch streaming line-appends to ≤8 fps so long outputs arrive in smooth
  chunks instead of line-flicker (the capture harness already proves 8 fps
  looks calm — apply the same math live)
- when history compaction hides earlier lines, render a visible affordance:
  `⋯ 14 earlier hidden · ctrl+o` dim chip — the VLM flagged hidden history as
  "missing visual affordances for collapsed earlier lines"

### 10. 256-color safety ladder (theme.ts)

The capture terminal degraded `#283228` to ANSI-22 neon green. Real users on
256-color terminals see the same. Ship hand-tuned 256-color fallbacks for every
theme color (closest-perceptual, not closest-RGB), so no fill ever lands on a
neon palette entry. Test with `TERM=xterm-256color` + truecolor disabled.

## Priority matrix

| # | move | effort | visual delta | touches |
|---|---|---|---|---|
| 3 | edge rails, not fills | M | ★★★★★ | `tool-execution.ts`, `edit.ts`, `diff.ts` |
| 1 | palette re-tint | S | ★★★★ | theme JSONs |
| 5 | footer status bar | M | ★★★★ | `footer.ts` |
| 6 | input editor focus | S | ★★★ | `interactive-mode.ts` |
| 4 | markdown hierarchy | S | ★★★ | `markdown.ts` + theme |
| 2 | chrome surfaces | M | ★★★ | editor/footer/overlays |
| 7 | status beat | S | ★★★ | `status-indicator.ts` |
| 10 | 256-color ladder | S | ★★ | `theme.ts` |
| 8 | overlay scrim | M | ★★ | overlay components |
| 9 | arrival pacing | M | ★★ | streaming/render path |

Suggested releases: **beauty-1** = moves 1+3+5+10 (the "stop shouting"
release); **beauty-2** = 4+6+7+2; **beauty-3** = 8+9.

## Validation loop

Every move is measurable against the same harness that produced this plan:

1. implement, then re-run the affected capture scenarios via
   `scripts/tui-capture/` (workflow in
   [tui-capture-workflow.md](tui-capture-workflow.md));
2. re-run the VLM critique over the new stills — the mean polish score
   (today **3.9/10**) is the metric; target ≥ 7/10 for the "beauty-1" release;
3. re-run the pixel audit — the wall-of-green share (today 62% on the editing
   frame) should fall under 10%;
4. motion re-critique after moves 7–9; today's mean **4.0/10**, target ≥ 6.

The same three scripts used here (still critique, motion critique, pixel
audit) are small enough to fold into `scripts/tui-capture/` as a
`--beauty-check` lane when move 1 lands.

## Non-goals

- No NERD-font glyph dependencies — every icon used (`▌ ✓ ✗ ⟳ ⎇ ● ─ ⋯ ▕▏`) is
  in the core terminals' Unicode coverage.
- No wallpapering the transcript background — scrollback stays clean; surfaces
  live only on chrome.
- No new dependencies; everything above is re-tinting and component layout.
- No light-theme redesign before dark lands; light inherits the same ladder in
  a follow-up pass (its current palette is a separate defect class).
