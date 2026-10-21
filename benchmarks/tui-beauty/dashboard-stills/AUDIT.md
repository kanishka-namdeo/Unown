# Dashboard stills — audit receipt (Task C, 2026-10-21)

Landing-asset set for the TUI dashboard: 11 standalone screens + the embedded
`/dashboard` mount, captured through the sanctioned PTY lane
(`scripts/tui-capture/pty_capture_dashboard.py` +
`pty_capture_dash_embedded.py`, workflow contract in
`docs/tui-capture-workflow.md`; PTY-lane geometry 128x36 pane, PIL render at
14x28 px cells = 1792x1008 frames, `PTY_TITLE=off` — the pure terminal frame,
no harness title bar).

Data source: the capture-safe fixture engine
(`scripts/tui-capture/dashboard_fixture_engine.ts`, port 3930) fronting the
repo's own dashboard test double — scrubbed of every test-double marker,
re-branded to the live engine's provider string (`zai-bridge/kimi-k2.5`),
enriched with internally consistent now-relative rows, newest-first lists,
reconciled `/api/overview` KPIs and a scripted SSE timeline. Hermetic:
loopback only, no DB, no LLM (except the embedded still's one real chat turn,
below), no credentials. The dashboard client pointed at it via
`UNOWN_ENGINE_URL` (the same env var the CLI uses).

## Capture commands (final run)

```bash
bun scripts/tui-capture/dashboard_fixture_engine.ts          # fixture on :3930
OUT=<capture-root> UNOWN_ROOT=/home/z/unown \
UNOWN_ENGINE_URL=http://127.0.0.1:3930 PTY_TITLE=off SCREEN_WAIT=3.0 \
  python3 scripts/tui-capture/pty_capture_dashboard.py        # 11 screens
OUT=<capture-root>/embedded UNOWN_ROOT=/home/z/unown \
UNOWN_ENGINE_URL=http://127.0.0.1:3930 PTY_TITLE=off \
  python3 scripts/tui-capture/pty_capture_dash_embedded.py    # embedded mount
```

(`python3` = the host venv with pyte/pexpect/Pillow; `/usr/bin/python3` has no
PIL on this host.)

The embedded lane's warm-up chat turn (a REAL model answer, agnes-3.0-flash
via the llm-bridge) runs against a scratch `UNOWN_HOME` seeded from
`scripts/tui-capture/fixtures/providers/` + the brand theme — the real
`~/.unown` (whose pinned default model the current upstream 404s on) is never
touched. The transcript above the mount is a genuine model reply.

## Lane output (verbatim, final run)

```
  ✓ overview: pane truth OK        ✓ gateway: pane truth OK
  ✓ memory: pane truth OK          ✓ automations: pane truth OK
  ✓ dreams: pane truth OK          ✓ webcache: pane truth OK
  ✓ notes: pane truth OK
  ✓ skills: pane truth OK          PASS: 11 screen(s) captured with pane truth intact
  ✓ lab: pane truth OK
  ✓ hooks: pane truth OK           PASS: embedded dashboard mounts, switches, drills, and exits cleanly
  ✓ router: pane truth OK
```

## Post-copy re-verification (shipped stills vs their in-repo pane receipts)

Pane-truth vocabulary = the capture script's own per-screen assertions,
re-run against the `.pane.txt` copies shipped next to each PNG. Variance =
the lane's near-blank-frame detector (blank ≈ 0). Scrub = no
`mock`/`test-double` vocabulary anywhere in the pane text.

| still | audit | pane-truth vocabulary | variance | size | scrub |
|---|---|---|---|---|---|
| 01-overview | PASS | unown, dashboard, engine, LEARNING, benchmark tasks | 229.6 | 161KB | clean |
| 02-memory | PASS | engine tiers, injection budget, project memories | 54.1 | 124KB | clean |
| 03-dreams | PASS | pending notes, autodream | 37.1 | 96KB | clean |
| 04-notes | PASS | NOTES, filter | 55.3 | 129KB | clean |
| 05-skills | PASS | SKILLS, shipped | 61.4 | 119KB | clean |
| 06-learning-lab | PASS | learning lab, cycles, improvements, runs | 48.4 | 124KB | clean |
| 07-hooks | PASS | HOOKS, events, filter | 40.0 | 120KB | clean |
| 08-router | PASS | router jobs, auto-dream, sandboxes | 47.8 | 151KB | clean |
| 09-gateway | PASS | requests, latency | 151.6 | 137KB | clean |
| 10-automations | PASS | AUTOMATIONS, cron | 43.0 | 106KB | clean |
| 11-webcache | PASS | entries, saved | 48.6 | 127KB | clean |
| 12-embedded-mount | PASS | LEARNING, benchmark tasks, esc-esc chat, engine | 263.1 | 184KB | clean |

12/12 shipped stills re-verified. Every still is 1792x1008, well under the
500KB gate (96-184KB), emerald-on-zinc brand palette confirmed by pixel
sampling (dominant `#09090b` zinc, accent `#5fd787` emerald, `#ffaf00`
amber warnings).

## VLM critique (Agnes agnes-3.0-flash via the llm-bridge) — one iteration

Pass 1 (hero `01-overview` + `04-notes`, `09-gateway`, `12-embedded-mount`):
notes 8/10 SHIP, gateway 7/10 SHIP, but overview 4/10 FIX ("solid-block
placeholders … looking like corruption" over the benchmark-task rows) and the
embedded mount 3/10 FIX (the fresh-boot Skills/Themes info block above the
mount read as "a stub" / "dense wrapped text block").

Root causes found and fixed (both REAL, pane-vs-pixel verifiable):

1. **Tofu glyphs.** The PTY renderer's primary font (JetBrains Mono) lacks
   `★☆` (task difficulty), `⏸` (paused), `⟳` (running), `⎇` (rollback) —
   PIL drew the `.notdef` box, which the VLM correctly read as corruption.
   Fix: per-glyph font fallback in `pty_common.py` (primary → DejaVu Sans
   Mono → Sarasa Mono SC, cmap-probed via fontTools, graceful without it) —
   the same per-glyph chaining a real terminal stack does.
2. **Boot-info block above the embedded mount.** A fresh session shows the
   Skills/Themes boot info where a transcript belongs. Fix: one REAL model
   turn (bridge-served model, scratch home) before `/dashboard`, so the
   still shows a genuine prompt + answer above the mounted dashboard.

Pass 2 (the two FIX stills only): `01-overview` **9/10 SHIP**, 
`12-embedded-mount` **10/10 SHIP** — "Exceptional technical authenticity and
brand consistency". Remaining nits (sidebar group-header alignment, empty
rows at the frame bottom) are the product's real k9s-style layout at 36 rows,
not capture defects. Raw receipts, both passes verbatim:
`receipts/vlm-critique/dashboard-stills-20261021-*.txt`.

## Files

- `receipts/*.png` + `receipts/*.pane.txt` — byte-identical copies of the
  shipped set (`public/landing/tui/dashboard/stills/`; the pane files also
  carry their raw capture names, e.g. `dashboard-overview.pane.txt` =
  `01-overview.pane.txt`), plus the extras the lane produced (embedded
  memory + exited panes).
- `receipts/dashboard-standalone.pane.log` — every pane dump in sequence
  (the lane's full-run ground truth).
- `receipts/pty_capture_dashboard.capture.log` / `pty_capture_dash_embedded.capture.log` —
  lane run logs.
- `receipts/vlm-critique/` — both Agnes critique passes, raw.
