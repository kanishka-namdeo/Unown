# public/landing/tui — captured terminal assets

Real `unown` sessions captured end-to-end by the TUI-capture harness
(`scripts/tui-capture/`, workflow contract in `docs/tui-capture-workflow.md`).
Every still passed the pane-truth + pixel + VLM audit; every video passed
frame sampling; nothing here was edited by hand — a bad frame means re-running
the scenario that produced it.

Captured 2026-10-20 against the live stack (bridge + engine, kimi-k2.5 via
the Dashscope bridge) with the TUI beauty releases in effect: the full
ten-scenario re-capture ran against the beauty trilogy (beauty-1/2/3), and
hero-bugfix + fleet — the two scenarios whose surfaces beauty-4 changed
(the footer diff-stat chip, the subagent lane rails) — were re-captured
once more against beauty-4 (`+1 -1` chip verified in the pane receipts).
The fresh set replaced the 2026-10-19/20 landing assets wholesale (the
wiki lane had crashed after one still; the hero lane's first audit ran
through a broken vision lane and was re-audited). Acceptance receipts —
per-still audits, the numeric polish and motion critiques, and the
wall-of-green pixel measurements — live in
[benchmarks/tui-beauty/RESULTS.md](../../../benchmarks/tui-beauty/RESULTS.md).

| scenario | story | assets |
|---|---|---|
| hero-bugfix | failing suite → agent finds and fixes the off-by-one → green | 6 stills + mp4/webm/gif |
| plan-mode | /plan → numbered plan → approval overlay → execute → complete | 5 stills + mp4/webm/gif |
| checkpoints | rename → /checkpoints list → /undo revert → /redo restore | 4 stills + mp4/webm/gif |
| overlays | /model picker → model switch → /permissions → /hooks | 5 stills + mp4/webm/gif |
| review | /review on the uncommitted fix → reviewers → SHIP verdict → artifact | 4 stills + mp4/webm/gif |
| subagent-explore | task subagent maps the real unown repo | 4 stills + mp4/webm/gif |
| fleet | async spawn → fleet widget (waiting-for-answer) → ask_question → task_control steer answer → result steered back → /tasks resume registry | 5 stills + mp4/webm/gif |
| wiki | /wiki generate → search with scores | 3 stills + mp4/webm/gif |
| cli-doctor | shell showcase: doctor, models, usage | 3 stills + mp4/webm/gif |
| memory-learn | two sessions in one pane: teach house rules + a real task → /note the lesson → /quit → AutoDream consolidates → a fresh session boots with the learned memory (footer chip v0 → vN) → /memory search recalls it scored → the closing task applies the lesson unprompted | 6 stills + mp4/webm |
| browser-verify | the visitor check: browser tool opens the landing page on :3000 → a11y snapshot → the exact curl install command → click the GitHub link → screenshot → report | 3 stills + mp4/webm |
| dream-dashboard | `unown dashboard dreams`: the real dream rows → dream detail (canary/guard note, rendered output) → the Memory screen (four tiers, injection budget) | 3 stills + mp4/webm |
| split-view | the split-view display mode: the thinking + tools band, the files dock with its edit-diff subpanel, the geometry commands, live reasoning, an agent turn | 5 stills (see the note below) |

The memory-learn / browser-verify / dream-dashboard lanes were captured
2026-10-23 against the live stack (bridge + engine, agnes-3.0-flash through
the Agnes AI upstream, the ONNX bge-small embedder installed for real
semantic recall) — the first lanes captured with the post-swap memory
platform. The memory-learn lane is the catalog's first two-session story
(one pane, one take): its mid-scenario AutoDream trigger is the same engine
path the dashboard's "dream now" key hits (`POST /api/dreams/run`), and its
closing still receipts the lesson applied unprompted ("bun test run twice
(per this repo's flake-guard convention) — 6/6 passing both times").

Stills are full-frame (128x36 grid, ~2214px wide, everything the user sees:
header/transcript, input box, cwd + model status). Videos are paced (8fps,
spinner-idle compressed, ~6-22s each). Regenerate or extend via the harness —
this directory is the curatation of audited output, not the source of truth.

The split-view scenario is the exception to the harness paragraph above, and
this note is the honest provenance: its stills were captured with a PTY driver
and a terminal-emulator render of real unown sessions at 128x36 (2026-10-20,
same live stack), not the ttyd pipeline in `scripts/tui-capture/` — and it
ships stills only (no videos), so the pane-truth + pixel + VLM audit has not
been applied to it. Consumed by the landing page's capability dex
(`src/components/landing/dex.tsx` + `dex-data.ts`) as the screen of its
№ 018 "Split view" entry — the movie entries' posters come from each
scenario's own audited stills above. (Until 2026-10-23 the consumer was the
standalone feature-carousel band; the captures merged into the dex with it.)
