# The 2026-10 convergence round — verification receipts

Scope: the seven workflows shipped in v0.0.16 (OSC 7501 program status, the
turn meter, the monitor tool, /review team checks, /recap, idle compaction,
print-mode stall progress). Every claim below was verified against the real
stack (Agnes upstream through the bundled bridge) on 2026-10-25; unit pins
live in `pi-repo/packages/self-learning/test/`.

## Functional (live model + real processes)

| Feature | Method | Receipt |
|---|---|---|
| monitor tool | `unown -p` with a real turn that called the tool on a `for i in 1..5; do echo tick-$i; sleep 1; done` loop, `duration_ms=10000`, `stop_pattern='tick-5'` | agent's verbatim answer: `MONITOR_OK stoppedBy=stop_pattern lines=5` — the bounded window ran the real process, the stop pattern ended the watch, all 5 lines captured |
| OSC 7501 emission | raw pty byte log of a real TUI session (one prompt → answer → /quit), `osc-7501-raw.bin` | spec-exact sequences on the wire: `state=working:app=unown:msg=<base64 "Reply with exactly: READY">` → `state=idle:app=unown:msg=<base64 "READY">` → `state=clear:app=unown`; boot's `state=idle:msg=<base64 "Session ready">` captured in the first run (`unown` v0.0.15-rc working tree, 2026-10-25 09:06 UTC) |
| /review team checks | real TUI session in a git repo with two planted checks (`.unown/review/checks/no-secrets-in-logs.md` severity P1; `console-drift.md` severity P2 + per-check model) | the `--dry-run` plan rendered on-screen (still `02-review-plan.png`, pane receipt below): "Review plan: 1 built-in reviewer(s) … 2 team check(s) … console-drift [model: zai-bridge/agnes-2.5-flash] (floor P2) — No console.log drift … no-secrets-in-logs (floor P1) — No secrets in build output" |
| /recap | real TUI session; `/recap` after one real turn | overlay rendered (still `03-recap.png`): "── recap — what happened in this session ──" + the live /btw-lane model summary + "recap · 1 turn, 0 tool calls" + "esc / enter / q — dismiss · never enters the transcript" |
| turn meter | same real session, footer after a live turn | chip on-screen (still `01-turn-meter.png`): `turn 1.6s · ctx 2% · in 13.1k out 2` |
| stall progress | unit-pinned (`test/cli-stall-progress.test.ts`: milestone order, once-each, full-window simulation); the live pathology that motivated it was observed in the wild — the Agnes flash upstream answered 200 streams with zero content (`usage-log` receipts: two 0-token completions on 2026-10-25), and pre-change `unown -p` sat silent through its whole stall budget in four consecutive fresh runs (reproduced at 06:33–06:38 UTC; A/B on the pre-change commit d6a37c4 confirmed the wedge predates the round) | — |
| idle compaction | unit-pinned (`test/auto-compact-idle.test.ts`: the 45m/50% curve, the kill switch, env overrides, the notice line); live fire needs a ≥45-minute-old half-full session — covered by the pins + the `ctx.compact()` seam being /compact's own path | — |

## Known issue (pre-existing, out of this round's scope)

`unown -p` intermittently (≈50% of runs this afternoon) completes its answer
and note delivery, then parks — no timers fire — until the process is killed
externally. **Proven pre-existing** by A/B on the pre-round commit d6a37c4
(identical wedge, no round code in the tree), and consistent with the repo's
documented F10/M2 keep-alive class ("intermittent because the sockets
sometimes close in time"). The stall watchdog force-exits parked-loop runs
when the loop is alive; frozen-loop cases remain (filed for the next round;
the stall-progress lines make the difference visible to unattended callers
whenever the loop lives).

## Files

- `01-turn-meter.png` / `.pane.txt` — the footer chip after a real turn
- `02-review-plan.png` / `.pane.txt` — the `--dry-run` team-check plan
- `03-recap.png` / `.pane.txt` — the recap overlay
- `osc-7501-raw.bin` — the raw pty byte stream carrying the 7501 sequences
