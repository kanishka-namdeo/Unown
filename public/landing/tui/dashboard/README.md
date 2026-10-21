# public/landing/tui/dashboard — TUI dashboard stills

Landing-asset stills of the `unown` TUI dashboard (`unown dashboard`, 11
screens) and its embedded `/dashboard` mount inside a live session. Captured
2026-10-21 by the PTY capture lane (`scripts/tui-capture/pty_capture_dashboard.py`
+ `pty_capture_dash_embedded.py`, `PTY_TITLE=off`, 128x36 pane → 1792x1008
frames) against the capture-safe fixture engine
(`scripts/tui-capture/dashboard_fixture_engine.ts`): scrubbed, re-branded,
enriched data — a real lived-in system, no test-double vocabulary.

| still | screen |
|---|---|
| `01-overview.png` | Overview (hero: KPIs, trend sparkline, activity rail, benchmark tasks) |
| `02-memory.png` | Memory (engine tiers, injection budget, project memories) |
| `03-dreams.png` | Dreams (pending notes, autodream history) |
| `04-notes.png` | Notes (filter, pending/dreamed session notes) |
| `05-skills.png` | Skills (minted skills, versions, projects) |
| `06-learning-lab.png` | Learning Lab (cycles, improvements, runs) |
| `07-hooks.png` | Hooks (event log, denies/augments) |
| `08-router.png` | Router (jobs, next auto-dream, sandboxes) |
| `09-gateway.png` | Gateway (bridge requests, latency, models, request log) |
| `10-automations.png` | Automations (cron schedules, lifecycle, last runs) |
| `11-webcache.png` | Web Cache (hit rate, store meter, recent events) |
| `12-embedded-mount.png` | `/dashboard` embedded in a live session (chat chrome + esc-esc footer) |

Every PNG ships with its `<name>.pane.txt` pane dump — the literal terminal
text at capture time (the audit ground truth; the capture lane's pane-truth
vocabulary assertions were re-verified against these copies post-shipment).
`12-embedded-mount.png` includes one real model turn (agnes-3.0-flash via the
llm-bridge, scratch home) above the mounted dashboard — a genuine session
transcript, not staged text. Acceptance receipt and method:
`benchmarks/tui-beauty/dashboard-stills/AUDIT.md`. Regenerate via the
harness — this directory is the curation of audited output, not the source
of truth.
