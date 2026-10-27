# TUI Capture Workflow (docs/tui-capture-workflow.md)

How agents and humans capture authentic, full-frame screenshots and video of
the `unown` TUI/CLI for the landing page — the reusable workflow, its measured
failure modes, and the gates that make the output trustworthy. The harness
lives in `scripts/tui-capture/` (see its README for the command surface).

- [Why this stack](#why-this-stack)
- [Principles](#principles)
- [The geometry rules](#the-geometry-rules)
- [Renderer choice](#renderer-choice)
- [The audit model](#the-audit-model)
- [Recipe: add a new scenario](#recipe-add-a-new-scenario)
- [Video assembly](#video-assembly)
- [Asset curation](#asset-curation)
- [Failure playbook](#failure-playbook)
- [Machine wiring](#machine-wiring)
- [Related pages](#related-pages)

## Why this stack

A terminal recording must show **exactly what a real user sees**: the branded
header, the transcript with tool calls and diffs, the input box, the cwd/model
status chrome — at full fidelity, with no harness artifacts (no browser
chrome, no tmux status bar) and no fake content. Options considered:

- **Native terminal + OS screen capture** — not scriptable headlessly, and the
  window chrome leaks into frames.
- **asciinema / terminalizer** — record event streams, but both need an
  external renderer to turn frames into pixels, and none of the available
  ones matches the TUI's real fonts/layout.
- **VHS (charmbracelet)** — drives its own vt100-compliant emulator, not a
  real terminal; layout-sensitive TUIs can render subtly wrong, and the tool
  was not available here.
- **tmux + ttyd + headless Chromium + Playwright** (chosen) — the TUI runs in
  a real 128x36 tmux pane; ttyd serves an xterm.js client; headless Chromium
  screenshots the xterm canvas. Input goes directly to tmux (`send-keys`), so
  the render side is a pure view. Anchors poll `tmux capture-pane`, which is
  the terminal's own state — not pixels, not OCR.

The one thing this stack adds that the others do not: the pane text and the
pixels can be **cross-checked** (`capture-pane` vs the screenshot), which is
what makes an unattended capture trustworthy.

When the host lacks tmux/ttyd/Chromium, a dependency-light **PTY lane**
(`scripts/tui-capture/pty-README.md`) preserves the same invariants for
addon-surface stills: pyte is the vt100 emulator in-process, so the pane text
and the pixels come from the same emulator state and the cross-check is exact
by construction. Use the tmux lane for landing-page assets; use the PTY lane
for quick addon-surface verification.

## Principles

1. **Real sessions only.** Every scenario runs the real TUI against the real
   stack (bridge + engine on :3031/:3030) and a real fixture repo with a
   seeded bug, real LLM turns included. No canned transcripts: the agent
   genuinely fixes the bug, renames the function, generates the wiki.
2. **The pane is the truth for content; the screenshot is the truth for
   looks.** Never assert on pixels when the pane text can be checked, and
   never accept pixels without checking them against the pane.
3. **Audit before shipping, re-run instead of repairing.** A failed frame is
   re-captured, never edited in an image tool.
4. **Time-box every run.** `driver.js` closes gracefully on SIGTERM (writes
   `frames-meta.jsonl`, kills browser/ttyd/tmux), so `timeout 575` per scenario
   inside a 600s budget is the standard pattern; incomplete stories are
   re-run, and long waits are trimmed at the scenario level, not skipped.

## The geometry rules

Each rule below was measured as a failure before it was a rule. The
calibration tools that re-prove them are `render-matrix.js`,
`corner-test2.js`, and `render-stress.js` in `scripts/tui-capture/`.

| # | Rule | Failure it prevents |
|---|------|--------------------|
| G1 | `deviceScaleFactor: 1`, always | At `deviceScaleFactor: 2` the xterm canvas renderer in ttyd 1.7.7 draws cells at 2x into a 1x canvas: the screenshot shows only the top-left half of the pane (measured: cols cut at ~66 of 128, rows at ~19 of 36). Hi-res comes from the big font instead — G2. |
| G2 | `fontSize=30` (+ JetBrains Mono) | Equivalent pixel density to a 15px font at 2x (~2214x1484 frames), natively crisp, and no dpr code path anywhere. |
| G3 | tmux `window-size manual` + `status off` | Without `manual`, the attaching client resizes the window; without `status off`, tmux's status bar is recorded into every frame as a harness artifact (found as a solid inverted band at the pane bottom reading `[cap-<name> …]`). |
| G4 | Never register a Playwright route on the ttyd page | Any `page.route` makes Playwright proxy the WebSocket upgrade and breaks ttyd's connection. |
| G5 | Type semicolons safely | `tmux send-keys -l ';'` with the `;` as a standalone argv element is parsed by tmux as a command separator and silently swallowed — a typed `unown() { :; } …` became an unterminated function and the shell sat at `>` forever. `driver.js` never emits a lone `;` piece. |
| G6 | Fit the xterm grid to the pane (`autoFitGrid`), then pin the viewport | The xterm fit must equal the tmux pane (128x36); the driver resizes the browser viewport until they match and persists the measured grid box to `geometry.json`. |
| G7 | `cursorBlink=false` | A blinking cursor is caught in its dark phase ~50% of frames; a steady cursor makes the input box visibly alive in every frame. |
| G8 | Before every still: settle, repaint, verify, resync | Four hazards live between "the TUI printed something" and "the pixels show it": (a) mid-stream stills drift rows — wait for two consecutive identical pane captures (spinner normalized away); (b) renderers can sit on a stale frame — force `term.refresh(0, rows-1)` and, for the dom renderer, wait until the DOM contains the pane's last line; (c) the ttyd WS can drop a dense burst and desync the xterm buffer from the pane for good — compare `term.buffer.active` lines against `capture-pane` and reload the page once on mismatch (tmux redraws the full grid to the new client); (d) the canvas glyph atlas can corrupt after long sessions — that is a re-run (see [Renderer choice](#renderer-choice)), not something still-time logic can fix. |
| G9 | Write the pane dump at every still (`capture.log`) | It is the audit's ground truth — the still is judged against what the terminal actually held at that moment, wherever the TUI laid it out (input box, plan-approval selector, plan-progress footer, or a bare shell for CLI scenarios). |

## Renderer choice

`rendererType=canvas` is the production choice. The alternatives were
measured, not guessed:

- **dom** — stably dropped colored diff rows from real captures (the `-/+`
  diff block of an `edit` tool call simply did not render; the pane had them,
  the pixels did not). Disqualified: missing content is worse than anything.
- **webgl** — mis-dropped content mid-update at `deviceScaleFactor: 2` during
  calibration; never needed once G1 made canvas geometry-correct.
- **canvas** — correct geometry and crisp glyphs, with two observed failure
  modes under long unattended sessions, both detected by the audit gates:
  1. *glyph-atlas corruption* (once in ~3 scenario-hours): a solid
     test-summary-green block with a vertical column of repeated glyph tiles
     painted over real content;
  2. *stale-paint / WS desync* (several times around dense erase/redraw
     bursts like `/undo`): the canvas keeps showing a pre-command frame —
     handled by G8's model-vs-pane check + one page reload.

Both failure modes mean the same operational thing: re-run the scenario and
re-audit. `scan_frames.py` flags the worst signature (a large uniform block
with no interior text) as an advisory sweep; it also false-positives on real
bun test summary blocks, so VLM sampling (`audit_video.py`) is the arbiter.

## The audit model

`audit_stills.py` gates every still with three evidence layers, because each
layer alone was measured to mislead:

1. **Pane truth** — parse the `--- pane @still <name> ---` dump from
   `capture.log`: the exact rows the terminal held. The still is judged
   against its own pane, never against a fixed chrome layout (plan-mode
   approval overlays replace the input box; plan execution replaces the model
   name with `plan N/M`; CLI stills have no unown chrome at all).
2. **Pixel verification** — with `geometry.json`'s measured grid box
   (`pitch = elH/rows`, `offset = elTop`): every non-empty pane row must have
   pixels in its band (proves no row was clipped or dropped by the renderer);
   no solid bright band in the bottom 8% (tmux status-bar artifact); the frame
   signature (~2200x~1480) must match the calibrated config.
3. **VLM content check** (GLM vision via the `z-ai` CLI): readable,
   artifact-free, plausible. The VLM is *not* asked about cropping or
   input-box presence — those are decided by pixels. Its answers on those
   questions were measured to be noisy: the same frame passed and failed
   across runs because an empty input row is only recognizable when the
   cursor block reads as a "box", and a scrolled-away header reads as "top
   cropped" even though it is exactly what a user mid-session sees.

`audit_video.py` VLM-samples N frames across each assembled MP4 (the last
frame always). A video ships only when all samples read clean.

## Recipe: add a new scenario

1. **Prep the world the user sees.** Fixture state via `prep_demo.sh`
   (`seed` = the bug is present, suite red; `fixed` = clean green; `seed`+fix
   = one uncommitted hero change for `/review`). For repo-wide stories (s6)
   no prep is needed. The `.unown/` project memory is preserved on purpose —
   it is part of the boot screen a real user sees.
2. **Write the spec** in `scenarios/` (see `index.js` for the shape):
   `cwd`, a free `port` in 7610–7617, then `steps`. Type prompts like a human
   (`cps: 26-30`). Wait on pane anchors that survive layout changes —
   tool-block prefixes ("read ", "edit "), state strings (" 2 fail",
   "VERDICT:", "Plan ready (", "Undid "), and prefer external state checks
   (`waitForExternal` + `git diff --name-only`, or the session receipt
   `.unown/receipts/*.jsonl` itself) over screen parsing for
   tool-agnostic steps. Two anchor classes the builder round (s25,
   2026-10-27) proved can NEVER match a pane: an `exclude` that matches the
   green state itself (bun renders ` 0 fail` on a green piped run —
   excluding `" fail"` blocks your own match), and any command text inside
   a multi-line bash script (the echoed tool row collapses the script to
   its first line + "⋯ N earlier hidden"). The receipt is the agent's own
   record of both — wait on it instead.
3. **Budget the clock.** Real LLM turns cost 30-90s each; a scenario must fit
   ~9.5 minutes. Shrink the *task*, not the realism ("no new tests, just
   keep the suite green"), and make tail waits soft (`try/catch` around
   `wait`) so the closing still always fires.
4. **Still every beat**: 1.5-3s `linger` before each `still` (the assembler
   converts dwells to on-screen time).
5. **Run + assemble + gate**:
   `node driver.js scenarios/<spec>.js` (under `timeout 575`), then
   `assemble.py <name>`, `audit_stills.py <name>`, `scan_frames.py <name>`,
   `audit_video.py <name> 4`. All gates green or the scenario is re-run.
6. **Commit** the spec and fixture changes together, and record in
   `capture.log`-derived notes what the scenario shows.

## Video assembly

`assemble.py` turns the change-triggered frame sequence into a paced video at
8fps (125ms/frame):

- spinner-idle runs (agent "Working..." with no content change) are sampled
  at one frame per ~2s of real wait, capped at ~2.5s on screen — the wait is
  work the viewer should feel, not sit through;
- byte-identical dwell runs keep 12 frames (1.5s), the final dwell 18
  (~2.2s) so the end state reads;
- near-blank frames (the G8 page-reload resync windows) are dropped — they
  are harness plumbing, not user-visible states.

Outputs: `<name>.mp4` (H.264 CRF19, 1600px wide, faststart), `<name>.webm`
(VP9, same geometry), `<name>.gif` (880px, bayer-dithered palette). VP9 is the
slow encode (~1-4 minutes per video) — assemble one scenario per command,
and run it detached (a detached `tmux` session) when the frame count is
four digits: the assembler outlived one 600 s tool cap on the builder
round's 1514-frame set.

The **trailing idle run** is trimmed too (rule 2b, builder round 2026-10-27):
frames after the last active frame per `frames-meta.jsonl` (every frame
`changed:false` and `working:false`) are post-session idle — the wait-burn
after a still-time anchor misses and the harness keeps recording an
already-finished session. A footer heartbeat (the "memory:" chrome line
refreshing every ~50 s) keeps those frames byte-DISTINCT, so the dwell cap
alone saw many short runs and kept ~16 s of dead ending. The whole tail is
ONE dwell: its head (~2.2 s) plus the true final frame.

## Asset curation

Shipped to the repo under `public/landing/tui/`:

- `stills/<scenario>-<beat>.png` — the audited PNGs (full 2200px width);
- `<scenario>.mp4` + `<scenario>.webm` — landing embeds;
- `<scenario>.gif` only where a GIF is genuinely needed (GitHub-rendered
  contexts); GIFs are 4-5x the MP4 for the same story.

Never shipped: raw `frames/`, `seq/`, `frames-meta.jsonl`, `capture.log` —
they stay in the capture root (`OUT_ROOT`, outside the repo) as provenance
until the asset set is superseded.

## Failure playbook

| Symptom | Cause | Action |
|---|---|---|
| Screenshot shows only the top-left ~half of the pane | dsf != 1 (rule G1) | Set `dsf: 1`; re-prove with `render-matrix.js` |
| Solid inverted band at the frame bottom (`[cap-…]`) | tmux status line | `set-option status off` (G3) |
| Frame shows an old command's output; pane shows the new one | WS desync / stale paint (G8c) | The driver reloads once; if logs show repeated desync, re-run the scenario |
| Solid block of repeated glyph tiles over content | canvas atlas corruption | Re-run the scenario; keep runs under ~15 min per session |
| Pane rows have content, pixels don't (audit: rows_missing) | renderer dropped rows / clipping | Check geometry.json matches; re-run; switch renderer only with fresh calibration |
| Shell stuck at `>` continuation prompt after typing | lone `;` swallowed by tmux (G5) | driver handles it; verify no other tool sends `send-keys -l ';'` |
| Anchor never matches | wrapped line or text changed upstream | Re-read the feature's real output strings (`bun bin/unown doctor`, `/undo` toast) — anchor on stable substrings ("ready to chat", "Undid ") — or drop pane text entirely for an external check (the session receipt, `git diff`) |
| A wait's `exclude` matches the state it waits FOR (green suite: `exclude: [" fail"]` vs bun's green ` 0 fail` row) | the anchor excluded its own match | Anchor on the green-unique row itself (` 0 fail`), no exclude — or wait on the receipt; keep the miss soft and short so the next wait carries the beat |
| Still-time waits burn past session end (stills 06/07 byte-identical idle summary) | an earlier soft wait's anchor could never match, then the following wait polls an already-finished pane | Fix the anchors; re-curate the still from the frame record (same pipeline, same geometry; VLM + the receipt timeline as the pane-truth substitute; document it — the builder round's `CURATION.md`); trim the trailing idle at assembly (rule 2b) |
| Videos too short / unreadable | pacing compression | Bump scenario lingers; check the spinner/static caps in `assemble.py` |

## Machine wiring

Env knobs (all optional): `UNOWN_ROOT` (repo root, default resolved from the
harness location), `UNOWN_DEMO_DIR` (fixture checkout),
`UNOWN_TUI_CAPTURE_DIR`/`OUT_ROOT` (capture output root),
`TMUX_BIN`, `TTYD_BIN`, `LD_LIB` (host binaries; the defaults match this
workspace's root-installed tmux and ttyd).

Host requirements: `bun`; the stack up (`bun scripts/start.ts`); `tmux`;
`ttyd 1.7.7` (+ `ttyd-index.html` built by `make_ttyd_index.sh`); `ffmpeg`;
Python 3 with `Pillow` and `numpy`; the repo's `node_modules/playwright`
(Chromium); JetBrains Mono; the `z-ai` CLI for the VLM lanes. In sandboxes
that reap the launching shell's process tree, launch the driver (and any
multi-minute encode) inside a detached `tmux` session — the builder round
lost two silent `nohup`/`setsid` launches (~8-17 s in, SIGKILL-class, no
stderr) before the tmux lane survived.

The harness is CommonJS inside a `type: module` package —
`scripts/tui-capture/package.json` pins `"type": "commonjs"`.

## Related pages

- [scripts/tui-capture/README.md](../scripts/tui-capture/README.md) — the command surface and scenario catalog
- [scripts/tui-capture/pty-README.md](../scripts/tui-capture/pty-README.md) — the PTY+pyte dependency-light lane for addon-surface verification
- [usage.md](usage.md) — the slash commands and CLI shown in the scenarios
- [BEHAVIOR.md](BEHAVIOR.md) — what the TUI's footer/status chrome means
- [landing-research.md](landing-research.md) — the landing page's sourcing rules these assets must satisfy
