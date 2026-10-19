# public/landing/tui — captured terminal assets

Real `unown` sessions captured end-to-end by the TUI-capture harness
(`scripts/tui-capture/`, workflow contract in `docs/tui-capture-workflow.md`).
Every still passed the pane-truth + pixel + VLM audit; every video passed
frame sampling; nothing here was edited by hand — a bad frame means re-running
the scenario that produced it.

Captured 2026-10-19 against the live stack (bridge + engine, kimi-k2.5 via
the Dashscope bridge), unown v2.2.0 @ 19439ba.

| scenario | story | assets |
|---|---|---|
| hero-bugfix | failing suite → agent finds and fixes the off-by-one → green | 6 stills + mp4/webm/gif |
| plan-mode | /plan → numbered plan → approval overlay → execute → complete | 5 stills + mp4/webm/gif |
| checkpoints | rename → /checkpoints list → /undo revert → /redo restore | 4 stills + mp4/webm/gif |
| overlays | /model picker → model switch → /permissions → /hooks | 5 stills + mp4/webm/gif |
| review | /review on the uncommitted fix → reviewers → SHIP verdict → artifact | 4 stills + mp4/webm/gif |
| subagent-explore | task subagent maps the real unown repo | 4 stills + mp4/webm/gif |
| wiki | /wiki generate → search with scores | 3 stills + mp4/webm/gif |
| cli-doctor | shell showcase: doctor, models, usage | 3 stills + mp4/webm/gif |

Stills are full-frame (128x36 grid, ~2214px wide, everything the user sees:
header/transcript, input box, cwd + model status). Videos are paced (8fps,
spinner-idle compressed, ~6-22s each). Regenerate or extend via the harness —
this directory is the curatation of audited output, not the source of truth.
