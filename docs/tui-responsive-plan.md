# TUI Responsive + Intuition Plan (docs/tui-responsive-plan.md)

Round 5 of the TUI program. The [beautification plan](tui-beautification-plan.md)
( beauty-1..4) fixed the palette, the walls of color, the typographic
hierarchy, overlay choreography, arrival pacing and the feedback chips — its
receipts live in [benchmarks/tui-beauty/RESULTS.md](../benchmarks/tui-beauty/RESULTS.md)
(polish 3.9 → 4.7 overall / 6.7–8.0 on showcase surfaces; wall-of-green
62% → 0.45%). This round attacks what that plan explicitly left open and
what the residual critique names: **the TUI must scale with the terminal**
(the remaining polish deductions are "layout-density critiques of dense
working terminals", worst exactly where width runs out) and **the TUI must
explain itself** (discoverability: no in-session help, no palette, no
contextual hints).

- [Method](#method)
- [The two evidence bases](#the-two-evidence-bases)
- [The moves](#the-moves)
- [Milestones](#milestones)
- [Validation loop](#validation-loop)
- [Non-goals](#non-goals)

## Method

1. **Code audit** — every width/height-sensitive path in the vendored TUI
   (`pi-repo/packages/tui` + `coding-agent/src/modes/interactive`) was
   inventoried: the two renderers (`TuiMainScreen`, `TuiAltScreen`), the
   fullscreen layout engine (`layout.ts`, basis/grow/shrink/minSize),
   per-component width math (editor, footer, select lists, markdown tables,
   overlays), and the resize handling in both `doRender()`s.
2. **External research** — the published practice of the leading agent
   CLIs (Claude Code, Codex, gemini-cli, opencode, Amp, Crush, aider) and
   TUI frameworks (Textual, Ratatui, Bubble Tea/Charm, Ink): breakpoint
   models, dock width caps, priority-based chrome hiding, min-size notices,
   palette conventions, hint-bar discipline. ~40 primary sources.
3. **Live driving** — the real TUI driven over a PTY at multiple geometries
   against the live stack, capturing pane ground truth at each width tier.

## The two evidence bases

### 1. The TUI has no size model

The audit found a renderer that is *safe* at every size (both renderers
carry final `visibleWidth > width` clamps; wrapping is grapheme-aware) but
has no *design* for sizes other than "whatever you booted in":

- **No breakpoints.** Nothing in the tree adapts by tier. The only
  size-conditional UI is split-view's hard `MIN_TERM_WIDTH = 90` cutoff —
  the dock is either 34–48 cols or gone.
- **No minimum-size gate.** Below any width the TUI still renders; at very
  narrow geometries the footer's stats line collapses into a `...`
  truncation that eats the context meter (the one thing that must survive),
  the editor competes with the transcript for rows, and overlays clamp to
  the terminal width with no content adaptation.
- **Blind truncation, not priority hiding.** `footer.ts` truncates the
  whole left side as one string; research and leading CLIs all converge on
  dropping *segments* by priority (cost → cache → tokens) so the meter and
  model identity survive.
- **Overlays default to `min(80, width)`** — a 2010-vintage constant; at
  60 cols a selector is full-bleed, at 200 cols it hugs the left edge.
- **Claude Code's published model** (the only published breakpoint system
  in the category): diff dock hidden < 110 cols, available 110–143,
  auto-open ≥ 144, docked panes capped at 45% of terminal width.

### 2. The TUI doesn't explain itself

- Keybinding hints exist **only in the startup header** (an expandable
  block that scrolls away) — after the first exchange the user is relying
  on memory or docs/usage.md.
- No `?` help (Claude Code, Amp, htop, irssi convention), no command
  palette (Crush/opencode/Textual/Amp all ship one; our own **dashboard**
  already uses ⌘K), no contextual hint strip (CC's "3–7 keys, state
  dependent, low-value hints auto-hide").
- `ctrl+k` is unbound in the TUI; `?` is unbound everywhere; the footer's
  extension-status line is the only always-visible chrome below the editor.

## The moves

Nine moves. R1–R5 are the responsive release; I1–I4 the intuition release.
Each names its files and its acceptance test.

### R1. Viewport tiers — a breakpoint vocabulary for the TUI

A small `viewport-tiers.ts` in the `tui` package (pure functions, no deps):

```
narrow  < 80    compact: meter-only footer, no hints, overlays = 86% width
regular 80–109  default footer (context meter + model), hints 3 keys
wide    110–143 dock-capable: split-view dock allowed (today's ≥90 stays),
                hint strip full
ultra   ≥ 144   auto-dockable (split-view may auto-open), transcript
                reading-measure options open up
```

- helpers: `viewportTier(width)`, `isCompactViewport(width)`,
  `overlayWidthFor(width, preferred?)` — used by both modes; `visible()`
  predicates and `render(width)` call sites import the same truth.
- The tiers are exported so extensions (split-view, addons) share the
  vocabulary instead of private constants.

Files: `pi-repo/packages/tui/src/viewport-tiers.ts` (new), consumers below.

### R2. The minimum-size gate

Fullscreen mode renders a **"terminal too small" notice** when the geometry
is below `48×16`: what is wrong (needs WxH, has wxh) and that content
resumes when the terminal grows. It is a *gate on layout*, not on the
process: the component tree stays alive, resize restores the session
untouched. Regular mode needs no gate (scrollback tolerates any width) —
but the footer and editor still degrade by tier (R3/R4).

Files: `tui-main-screen.ts`/`tui-alt-screen.ts` (render entry), notice
component in `tui/src/components/`.

### R3. Footer priority degradation

Replace the blind `truncateToWidth(statsLeft)` with ordered segment
dropping (research-consistent, right-to-left by information value):

1. always: context meter (short form at `narrow`: `ctx 42%` without the
   bar) + model name
2. `regular`: + tokens ↑↓ + diff chip `+N -M`
3. `wide`: + cache R/W/CH + cost $
4. location line: at `narrow` drops session name → branch → `..`-folds the
   cwd; never disappears

Files: `footer.ts` (+ unit tests at 56/72/96/128 cols — extending
`footer-width.test.ts`).

### R4. Overlay scaling

`resolveOverlayLayout`'s `min(80, availWidth)` becomes
`overlayWidthFor(termWidth)` — 86% of width (rounded), clamped to a
[40, 96] band, callers may override. Select lists already drop their
description column under 40 cols; the selector family inherits tier-aware
title/desc rendering. Scrim rows already exist (beauty-3).

Files: `tui.ts` (`resolveOverlayLayout`), `select-list.ts`.

### R5. Split-view graduated dock

`MIN_TERM_WIDTH = 90` becomes a tier function: hidden < 90 (unchanged),
**90–119 narrow dock** (34 cols, one-column file list), **≥120 full dock**
(25% clamped 34–48, today's layout). Prevents the today-or-nothing cliff
at 89 vs 90 cols.

Files: `self-learning/src/splitview.ts` (`dockColsFor` + visibility).

### I1. `?` — universal help

When the editor is empty and unmodified, `?` opens a searchable keybinding
reference (the same keybindings registry the startup header prints, as a
selector: category, key, description — live values, so custom
`keybindings.json` shows through). `?` with text in the editor stays a
literal character (it's prose).

Files: `interactive-mode.ts`, new `components/help-selector.ts`.

### I2. `ctrl+k` — the command palette

A fuzzy palette over the action surface: slash commands, models, themes,
sessions, plan mode, split-view toggles, todos, exit. Matches the
dashboard's ⌘K vocabulary (cross-surface consistency), runs in the editor
slot like the other selectors, arrow-preview + Enter-commit.
`ctrl+k` was unbound; `ctrl+p` stays model-cycle (pi convention).

Files: `interactive-mode.ts`, new `components/command-palette.ts`.

### I3. Contextual hint strip

One line under the footer (only `regular`+ tiers, only when idle-ish):
3–5 state-dependent hints — idle: `? help · / commands · ! bash · ctrl+o
tools`; working: `esc interrupt · ctrl+t thinking`; queued messages:
`alt+↑ edit queue`. Auto-collapses to 0 when the terminal is `narrow` or
the extension-status line is present (chrome budget discipline).

Files: `footer.ts` or a `components/hint-strip.ts` wired in
`interactive-mode.ts`.

### I4. Onboarding beat

The startup header's compact line gains the two keys that unlock
everything: `? all shortcuts · ctrl+k palette` — the hint strip then
reinforces them in-context. Docs table (usage.md) gains the two rows.

## Milestones

| # | scope | lands | verification |
|---|---|---|---|
| **M1** | R1–R4 (tiers, gate, footer, overlays) | responsive core | unit tests at 4 widths + PTY stills at 56/72/96/128 + manual drive |
| **M2** | I1–I4 (help, palette, hints, onboarding) | intuition core | unit tests + PTY stills + manual drive of every action |
| **M3** | R5 + density polish (spacing rhythm pass over tool blocks at each tier) | split-view graduation | PTY split-view lane at 3 widths |
| **M4** | cross-platform sweep (win32 paths, NO_COLOR, 256-color, TERM=dumb), docs/README/landing, full suite | shipping | full `bun test` + vitest + PTY lanes + audit gates |

## Validation loop

- **No-regression baseline** (before touching anything): run the existing
  suites green — `coding-agent` vitest (footer-width, layout, wrap,
  truncate, overlay, select-list, theme wiring), `tui` node tests, PTY
  addon lanes, `check_theme.mjs`.
- **Per move**: new unit tests first (width table), then the change, then
  PTY stills at 56/72/96/128 cols re-rendered and pane-diffed against
  expectations; the beauty_critique lane re-run on one showcase scenario at
  the end of each milestone.
- **End-user drive**: every milestone gets driven over a real PTY like a
  user session (boot → prompt → tool turn → selector → exit) before push.
- **Gate**: `cd pi-repo/packages/coding-agent && npx vitest run` +
  `cd ../tui && node --test` + PTY lanes all green, then commit + push.

## Non-goals

- No reflow of code/diff blocks below their natural width (wrap stays
  opt-in per content type — diffs and code never implicitly re-wrap).
- No transcript reading-measure cap in this round (ultra-wide transcript
  width stays terminal-width; revisit with receipts after M4).
- No new dependencies; tiers/palette/help are plain components.
- No change to `ctrl+p` model-cycle or any existing default binding —
  new features take only unbound keys (`?`, `ctrl+k`).
