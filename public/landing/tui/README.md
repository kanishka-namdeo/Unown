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
| browser-subagent | the delegated web lane: task → browser (humanized live labels) → ✓ with wall clock → child report; async ◉ fleet row + /tasks lifecycle metadata (2026-10-24, PTY lane) | 6 stills |
| wiki | /wiki generate → search with scores | 3 stills + mp4/webm/gif |
| cli-doctor | shell showcase: doctor, models, usage | 3 stills + mp4/webm/gif |
| memory-learn | two sessions in one pane: teach house rules + a real task → /note the lesson → /quit → AutoDream consolidates → a fresh session boots with the learned memory (footer chip v0 → vN) → /memory search recalls it scored → the closing task applies the lesson unprompted | 6 stills + mp4/webm |
| browser-verify | the visitor check: browser tool opens the landing page on :3000 → a11y snapshot → the exact curl install command → click the GitHub link → screenshot → report | 3 stills + mp4/webm |
| dream-dashboard | `unown dashboard dreams`: the real dream rows → dream detail (canary/guard note, rendered output) → the Memory screen (four tiers, injection budget) | 3 stills + mp4/webm |
| websearch | the keyless chain live: web_search cascading providers in a real session → the answer with its cited source (2026-10-24) | 3 stills + mp4/webm |
| mcp | a real MCP stdio server (the harness's own `fixtures/mini-mcp-dice.mjs` — actual JSON-RPC initialize/tools/list/tools/call) joins the session via `unown mcp add`; its dice/roll tool called live (2026-10-24) | 3 stills + mp4/webm |
| lsp | /repomap's graph-ranked map → a cross-tree rename while typescript-language-server diagnostics ride every edit's tool result (2026-10-24) | 3 stills + mp4/webm |
| parity-round | the 2026 consensus round in one live session: /output-style listing + set → the /btw side-question overlay → /insights → the auto-titled session proven by /name (2026-10-24; the ttyd-lane movie of the story the PTY stills told) | 5 stills + mp4/webm |
| harness | `unown dashboard lab` against the live engine after a real cycle ran through the engine API (`POST /api/tasks/<id>/run`) — the baseline, the verify, the mined-rule decision (2026-10-24) | 2 stills + mp4/webm |
| router | `unown dashboard router`: the engine's real job table — dreams, harness, automations, one busy-mutex (2026-10-24) | 2 stills + mp4/webm |
| routines | `unown dashboard routines` with a real routine created through the CLI (a daily 09:00 morning brief, read-only) and its history row (2026-10-24) | 2 stills + mp4/webm |
| skills | `unown dashboard skills` after the harness loop actually shipped a skill — the loop's own minted row, not a mock (2026-10-24) | 2 stills + mp4/webm |
| goals | a real /goal run: the objective injection → todo-tracked work → the [GOAL:COMPLETE] gate passing on both kinds of cited evidence → the /goal status record (2026-10-24) | 4 stills + mp4/webm |
| split-view | the split-view display mode FILMED: /split mounts the band + dock, a live turn fills the Thinking and Tool Usage panels while the files dock carries the edit diff, the response-only transcript closes it (2026-10-24; supersedes the PTY stills-only cut — see the note below) | 4 stills + mp4/webm |

The memory-learn / browser-verify / dream-dashboard lanes were captured
2026-10-23 against the live stack (bridge + engine, agnes-3.0-flash through
the Agnes AI upstream, the ONNX bge-small embedder installed for real
semantic recall) — the first lanes captured with the post-swap memory
platform. The memory-learn lane is the catalog's first two-session story
(one pane, one take): its mid-scenario AutoDream trigger is the same engine
path the dashboard's "dream now" key hits (`POST /api/dreams/run`), and its
closing still receipts the lesson applied unprompted ("bun test run twice
(per this repo's flake-guard convention) — 6/6 passing both times").

The 2026-10-24 round — websearch, mcp, lsp, parity-round, harness, router,
 routines, skills, goals and the filmed split-view — was captured against
the same live stack (bridge + engine, agnes-3.0-flash through the Agnes AI
upstream) with one addition: the mcp lane's dice server is the harness's own
dependency-free MCP stdio fixture (`scripts/tui-capture/fixtures/
mini-mcp-dice.mjs`, real JSON-RPC — initialize, tools/list, tools/call), and
the harness/router/skills lanes read real engine state produced by actual
harness cycles, a CLI-created routine, and a skill the loop genuinely mined
and shipped. The s1/s5/s6 lanes were also re-captured this round: their
posters had shipped byte-identical to other lanes' boot frames (the pane
never showed what the poster's name claimed), and the closed lanes now
capture distinct, pane-true beats — the review poster shows the actual
uncommitted diff, the subagent poster the typed exploration ask, and the
hero lane closes on the user's flake-guard re-run of the suite.

Stills are full-frame (128x36 grid, ~2214px wide, everything the user sees:
header/transcript, input box, cwd + model status). Videos are paced (8fps,
spinner-idle compressed, ~6-22s each). Regenerate or extend via the harness —
this directory is the curatation of audited output, not the source of truth.

The split-view lane's provenance, updated 2026-10-24: its first cut
(2026-10-20) was captured with a PTY driver and a terminal-emulator render,
ships stills only, and never passed the pane-truth + pixel + VLM audit. The
shipped cut is a full ttyd-pipeline capture — audited like every other lane
here — filmed through the same driver as the rest of the catalog. Consumed
by the landing page's capability dex (`src/components/landing/dex.tsx` +
`dex-data.ts`) as the reel of its № 018 "Split view" entry — every movie
entry's poster comes from its own lane's audited stills above.
