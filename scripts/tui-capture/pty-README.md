# PTY capture — the tmux/ttyd-free lane

`pty_capture*.py` drive the real `unown` TUI in a real PTY (128×36), feed
keystrokes, parse the screen with [pyte](https://github.com/selectel/pyte),
and render full-frame PNG stills with PIL — same pane-truth discipline as the
tmux+ttyd+Chromium stack, minus the browser and the host dependencies
(`tmux`, `ttyd`, Chromium, JetBrains Mono on the fontconfig path).

Because pyte IS the vt100 emulator in-process, the pane text and the pixels
come from the same emulator state: the pane-truth/pixel cross-check the
workflow demands is exact by construction. Each still is written together
with `<name>.pane.txt` — the literal screen text at capture time, the audit's
ground truth.

## Requirements

- python3 with `pyte`, `pexpect`, `Pillow`
  (e.g. `pip install --user pyte pexpect pillow`; on a uv-managed host:
  `uv pip install --system --break-system-packages pyte pexpect` — or into
  the active venv)
- `bun` + the repo's `node_modules` (root `bun install` + the
  `scripts/install.ts` steps for pi-repo when driving from a fresh clone)
- the LLM bridge on `:3031` — boot only for the pure-TUI lane; live model
  turns for the ask/advisor lanes (a failover-configured bridge serves these
  fine while the primary is throttled)
- a TUI font at `~/.local/share/fonts/JetBrainsMono-{Regular,Bold}.ttf`
  — auto-falls back to DejaVu Sans Mono when absent (override with
  `FONT_PATH` / `FONT_BOLD_PATH`)

## Scripts

| Script | What it captures |
|---|---|
| `pty_capture.py` | The pure-TUI addon surfaces, no model turns needed: `/todos` (empty state), `/addons` configurator + keyboard navigation (arrow keys, advisor submenu, one toggle applied + persisted), `/addons status`, `/advisor status`. Restores the seeded config defensively on exit (AddonsJsonGuard). |
| `pty_capture_todo.py` | The todo addon overlay: boots the TUI resuming a session file that carries `unown-todo-state` entries, so the overlay mounts above the editor without a fresh model call; also `/todos` with live state (grouped-by-status view). The crafted session file is kept next to the stills as provenance. |
| `pty_capture_ask.py` | The ask_user_question dialog end-to-end: sends a prompt that makes the model call the tool, then answers the tabbed dialog through the PTY (option select → tab → submit review → submit), capturing every stage. Needs a working upstream (bridge + quota). Retries with up to 3 differently-phrased prompts. |
| `pty_capture_advisor.py` | The advisor surfaces: `/advisor status` with the advisor registered, an active-status card, and — best-effort, model-dependent — a rendered advice card from a live review (a trivial task often earns advisor silence, which is the emission guard working correctly, not a failure of the lane). |
| `pty_capture_providers.py` | The `/providers` slash command (R2): boots the TUI against a scratch `UNOWN_HOME` seeded from `fixtures/providers/` (two providers — the local bridge + a direct Agnes env-ref; the real `~/.unown` untouched), captures the manager's select list, the per-provider action menu, a **live** "Test connection" verdict against the bridge on :3031, and the `/providers list` text summary. Re-greps the pane dumps on exit (a gate, not just a picture). Dismisses the first-flights catalog at boot (a fresh scratch home opens it, and it eats the `/` keystroke). |
| `pty_capture_provider_cli.py` | The 2026-10-30 provider round's CLI surfaces: `unown providers test` (the latency chip), `unown doctor` (the model-endpoint latency + the `model health marks` row, seeded with one 5-min-old mark) and `unown models` (the `recently failed` annotation + the served list latency) against the same scratch-home seeding. Same pane-truth discipline: every still ships its pane dump, and the script re-greps them on exit. |
| `pty_common.py` | Shared machinery: PTY session (geometry-overridable `rows`/`cols`; the 2026-11-10 ready contract — an ANY-of anchor set so a 36-row pane with the first-flights catalog on it still proves readiness, and a 240 s cold-boot timeout), pyte feeding, PNG renderer (16-color palette + reverse/bold/underscore), anchor verification, blank-frame variance detection, `AddonsJsonGuard`, session-file crafting. |
| `verify_settings_hub.py` | The settings round's real-user verification: boots the TUI in an isolated `UNOWN_HOME`, asserts the hub (not pi's theme selector) opens via the extension-override patch, edits Goal budget → 25 through the item editor, asserts the save notice + `settings-hub.json` + the change ledger on disk, then `/settings search`/`diff`/`recent` in-TUI. Exit 0 = every assertion held; any failure prints the pane tail. |
| `verify_plan_retrospective.py` | The C6 lane (2026-11-03): drives the V3 `plan_retrospective` close-out on an executed plan through the real TUI — for plans whose steps executed across MANY ticket sessions, it crafts a post-approval session (the todo-overlay crafting pattern: `enabled:false, executing:true`, `planFile` at the real plan artifact, steps parsed from the plan file), resumes it in a PTY, and has the live session call the tool with an operator-authored body read from a receipt file. Exit 0 = the merge landed in the plan file (header/outcome/body-verbatim/sections-intact/single-section gates — the file is the authority); stills + pane dumps + the crafted session are kept as provenance. |
| `verify_plan_mode_matrix.py` | The plan-mode × TUI combination matrix lane. Round 1 (2026-11-09): the entry/exit keyboard matrix (Shift+Tab's full cycle, Ctrl+Alt+P, `/plan` bare/off/show/`<description>`, the `--plan` boot notice parity) and the approval-gate matrix (the four options, the full navigation set — arrows, j/k, Home/End, PageUp/PageDown — the stay-loop contract, the user-message re-arm, approve → execute → "Plan complete", the seeded-todo discipline). Round 2 (2026-11-10) EXPANDS it to nine phases: `diag` (the unknown-flag CLI guard exits loudly, status 2, no TUI), `v2` (the V2 kill-switch matrix with the V2 wordings + `/plan show`/`/plan open` no-plan answers), `narrow` (80x24 AND 60x20 — the constructor's `rows`/`cols` overrides; the ready ANY-of set covers every width), `options-a/b/c` (the approval OPTIONS matrix in three bounded sub-lanes — a specialist-spawning planning pass can outlive a 10-minute window: a = digit quick-select + the editor rounds + the 6-round cap notice; b = Ctrl+C cancel → stayed + option-4 feedback → revise → re-offer; c = option-2 approve-each-edit → Permission mode: default → the per-edit ask census → "Plan complete" + todos), `plan-model` (the live split: clean diagnostics, the footer rides the sibling, planning turns counted by model in the transcript, the unknown-model warning) and `budget` (`--max-turns` feeds the turn budget with the receipt; `UNOWN_PLAN_TURN_BUDGET=0` arms + exits clean). `--phases p1,v2,…` selects any subset; `--live` adds every live phase. The gate timeout is `MATRIX_GATE_TIMEOUT` (default 480 s — a metered upstream can stretch a full V3 planning pass well past 5 minutes; 900 covered every live phase in round 2). Exit 0 = every step held; stills + pane dumps as receipts. |
| `verify_approve_each_edit_resume.py` | The round 2 review-hardening lane (2026-11-10): the manual approval posture must survive a session RESUME — approve a tiny plan with "Execute — approve each edit", answer the first per-edit dialog, kill the process MID-execution (right after the dialog is answered — waiting longer races the plan completing, and a completed plan's resume correctly restores no posture), then resume with `unown -c` and prove the posture two ways: `/permissions` renders the seeded ask rules ("N ask rule(s) seeded (per-edit approval active)"), and a DIRECT trivial edit instruction in the resumed session prompts again. Exit 0 = both hold; the r1/r2 stills are the receipts. |

## Usage

```bash
# stack up (bridge at least; engine for full sessions)
bun scripts/start.ts

python3 scripts/tui-capture/pty_capture.py            # 9 stills, no LLM needed
python3 scripts/tui-capture/pty_capture_todo.py      # 2 stills, no LLM needed
python3 scripts/tui-capture/pty_capture_ask.py       # 5 stills, needs live upstream
python3 scripts/tui-capture/pty_capture_advisor.py   # 2-3 stills, needs live upstream
```

Stills land in `/home/z/my-project/download/unown-addon-captures/stills/`
(override `OUT`). Geometry: 128 cols × 36 rows × 14 px cells + a 34 px title
bar — the same pane geometry as the tmux lane. Every script prints a
PASS/FAIL table per surface (anchor-verified, near-blank frames warn) and
exits non-zero when any surface fails.

## Why this lane exists

The tmux+ttyd+Chromium lane (driver.js) is the reference (video, xterm.js
fidelity, landing-page assets), but it needs host binaries many machines
lack. The PTY lane keeps the workflow's invariants where they matter for
addon verification: real process, real keystrokes, real renderer output,
pane-text anchors, and per-still pane dumps for audit. Use it for quick
addon-surface verification; use the tmux lane for landing-page assets.

Known limits: no scrollback (36 rows only), no ligatures, one palette (the
16 pyte colors mapped to the theme's terminal hues — 256-color `38;5;N`
sequences resolve to exact hex, so stills match the shipped unown theme's
256-color approximations rather than a truecolor render), italics render as
regular, and modal-select gotchas apply — always Escape out of any
`ctx.ui.select` before sending the next command, or the keystrokes land in
the select instead of the input box. Typing prompts uses the
Esc-before-Enter protocol (closes the debounced autocomplete popup first —
without it Enter can race the popup's stale prefix and submit a mangled
completion like `/addaddons`).

## The round-session driver (2026-10-28)

`pty_round_session.py` drives ONE long real working session (a build / review
/ QA round — the sessions behind the landing page's live-demo band) through
this lane: boots the TUI in the round's project dir, types the round's
prompt, rides the long turns with SOFT pane anchors (the s25 lessons, all of
them), captures milestone stills + pane dumps, heartbeats a `status.json`
for detached polling, and closes through the real `/quit` path (session
persistence + note delivery). Env knobs and outputs: see its module
docstring. Run it detached (`nohup … &`) — a round session runs 10–25 min.

### The first-flights fix (2026-10-28)

The "First flights" onboarding catalog (a FOCUSED component riding every
fresh session's boot since 017c109) eats typed keystrokes while mounted —
the lane hung its first wait 20 s on exactly this, and a stray `x` in a
typed prompt would latch never-again PERSISTENTLY. Both lanes now dismiss
it before typing: `dismiss_first_flights()` in `pty_common.py` (PTY lane)
and `Session.dismissFirstFlights()` after `waitReady` in `driver.js` (tmux
lane). Per-session dismiss only — the never-again latch is never sent.
