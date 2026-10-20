# scripts/tui-capture — the TUI/CLI capture harness

Drives the real `unown` TUI and CLI through realistic end-to-end scenarios and
records landing-page assets: full-frame PNG stills and JPEG frame sequences
assembled into MP4/WebM/GIF. Everything here is agent-operable: content waits
anchor on literal pane text, assets are audited by pixel geometry + a vision
model, and the whole flow is documented as a reusable workflow in
[docs/tui-capture-workflow.md](../../docs/tui-capture-workflow.md) — read that
page first.

## One-time setup

```bash
bun scripts/start.ts                                # bridge :3031 + engine :3030 (TUI needs the bridge)
bash scripts/tui-capture/prepare_fixture.sh         # demo repo at $UNOWN_DEMO_DIR with `seed`/`fixed` tags
bash scripts/tui-capture/make_ttyd_index.sh          # ttyd-index.html (patched index; regenerate after ttyd upgrades)
```

Requires on the host: `bun`, `tmux`, `ttyd 1.7.7`, `ffmpeg`, `python3` with
`PIL`/`numpy`, the repo's `node_modules/playwright` (Chromium), JetBrains Mono
installed, and the `z-ai` CLI for the audit lane.

## Run a scenario

```bash
bash scripts/tui-capture/prep_demo.sh s1-hero-bugfix        # set the fixture state the scenario expects
node  scripts/tui-capture/driver.js scripts/tui-capture/scenarios/s1-hero-bugfix.js
python3 scripts/tui-capture/assemble.py hero-bugfix        # frames -> MP4/WebM/GIF (pacing model inside)
python3 scripts/tui-capture/audit_stills.py hero-bugfix     # pane-truth + pixel + VLM gate (must PASS)
python3 scripts/tui-capture/scan_frames.py hero-bugfix       # advisory corruption sweep
python3 scripts/tui-capture/audit_video.py hero-bugfix 4     # VLM-samples the assembled MP4
```

Output lands in `$OUT_ROOT/<scenario>/` (default
`/home/z/my-project/download/unown-tui-captures/`): `stills/*.png`,
`frames/*.jpg` + `frames-meta.jsonl`, `geometry.json`, `capture.log` (includes
a pane dump at every still — the audit's ground truth), `<scenario>.mp4`,
`.webm`, `.gif`.

## Calibration gates (run when geometry or renderers change)

- `node scripts/tui-capture/render-matrix.js` — grades renderer/font/dsf
  combinations on a marker pane; `deviceScaleFactor` must stay 1 (see the
  driver header for the dpr failure mode).
- `node scripts/tui-capture/corner-test2.js` — driver-exact boot + full-width
  marker rows; proves the pane↔pixel row mapping is 1:1.
- `node scripts/tui-capture/render-stress.js` — scrolling colored flood; watch
  for glyph corruption (canvas atlas) or dropped rows.

## Scenario catalog

| id | story | fixture prep |
|---|---|---|
| s1-hero-bugfix | failing suite → agent fixes the bug → green | `s1-hero-bugfix` |
| s2-plan-mode | /plan → numbered plan → approval overlay → execute | `default` |
| s3-checkpoints | rename → /checkpoints → /undo → /redo | `s3-checkpoints` |
| s4-overlays | /model picker → switch → /permissions → /hooks | `default` |
| s5-review | /review on the uncommitted fix → verdict → artifact | `s5-review` |
| s6-subagent-explore | task subagent maps the real unown repo | — (runs in the repo) |
| s7-wiki | /wiki generate → search with scores | `default` (runs in the demo dir) |
| s8-cli-doctor | shell: doctor, models, usage | `default` |
| s9-fleet | async spawn → fleet widget → ask_question → task_control steer answer → result → /tasks registry | — (runs in the repo) |

Scenarios share one port block (7610–7618); run one at a time against the same
fixture. `driver.js` closes gracefully on SIGTERM (time-box long scenarios with
`timeout 575` and re-run on failure — never edit a failed frame).
