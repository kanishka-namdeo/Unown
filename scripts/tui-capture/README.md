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

A second, dependency-light lane — [pty-README.md](pty-README.md) — drives the
TUI through a plain PTY + pyte when the host lacks tmux/ttyd; use it for
quick addon-surface verification.

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
| s10-memory-learn | teach house rules + a real task → /note the lesson → /quit → AutoDream consolidates → a fresh session boots with the learned memory (footer chip v0 → v1) → /learning stack → the lesson applied unprompted | `default` (pristine `.unown` scaffold — no provenance sidecar) |
| s11-browser-verify | browser tool visitor check: open the landing page on :3000 → a11y snapshot → find the curl install command → click the GitHub link → screenshot → report | — (repo; landing dev server already up on :3000) |
| s12-dream-dashboard | `unown dashboard dreams`: the real dream rows → dream detail (canary/guard note, output, consumed notes) → Memory screen (tiers, versions, injection budget) | — (repo; richest after s10 — its dream is the newest row) |
| s13-websearch | the keyless chain live: web_search → the answer with its cited source (stable-forever question so the lane never rots) | `default` |
| s14-mcp | a real MCP stdio server joins the session — the harness's `fixtures/mini-mcp-dice.mjs` (JSON-RPC initialize/tools/list/tools/call), its dice/roll tool called live | `s14-mcp` (adds the dice server at user scope via `unown mcp add`) |
| s15-lsp | /repomap → a cross-tree rename while typescript-language-server diagnostics ride every edit's tool result (needs `typescript-language-server` on PATH) | `default` |
| s16-parity-round | the 2026 consensus round: /output-style listing + set → /btw overlay (background-lane call — allow for dream queue drain) → /insights → the auto-title via /name | — (repo) |
| s17-harness | `unown dashboard lab` against real cycles (engine-prep: `POST /api/tasks/<id>/run` first) | — (repo; engine up) |
| s18-router | `unown dashboard router`: the real job table | — (repo; engine up) |
| s19-routines | `unown dashboard routines` with a real CLI-created routine + its history | — (repo; engine up; `unown routines create` first) |
| s20-skills | `unown dashboard skills` after the loop shipped a skill (engine-prep: mint + run until a ship lands) | — (repo; engine up) |
| s21-goals | a real /goal run: objective → todos → [GOAL:COMPLETE] with both evidence kinds → /goal status | `default` |
| s22-split-view | /split mounts the band + dock, a live turn fills it (the filmed cut of the old PTY stills lane) | `default` |

Scenarios share one port block (7610–7621 for s1–s12, 7622–7631 for
s13–s22); run one at a time against the same fixture. The s17–s20 dashboard
lanes read the engine instead of driving turns and can run beside a session
lane. `driver.js` closes gracefully on SIGTERM (time-box long scenarios with
`timeout 575` and re-run on failure — never edit a failed frame).
`run_lane.sh <spec> [prep]` runs one lane end to end (prep → capture →
assemble → all three audit gates + an md5-distinctness check);
`pipeline-a.sh` / `pipeline-b.sh` / `pipeline-c.sh` chain lanes sequentially.
