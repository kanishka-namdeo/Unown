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

The 2026-10-25 SOTA re-capture round — thirteen lanes re-filmed end to end
against the live stack (bridge + engine, agnes-3.0-flash through the Agnes
AI upstream): hero-bugfix, overlays, subagent-explore, wiki, websearch, mcp,
parity-round, harness, router, split-view, browser-subagent, sdlc and
cli-doctor. The round was driven by a frame-sampled VLM audit against the
SOTA terminal-demo bar: the shipped cuts of these lanes showed dead air,
idle screens mid-story, test-case prompts, blank closing frames or — for
router — no visible interaction at all. Every lane below carries its
2026-10-25 provenance in its story column; the eleven lanes not listed in
the round paragraph (plan-mode, checkpoints, review, fleet, memory-learn,
browser-verify, dream-dashboard, lsp, routines, skills, goals) kept their
audited 2026-10-20/23/24 cuts (aggregating a VLM pass at 8-9/10). The
superseded set is archived outside the repo in the capture root
(`_superseded-2026-10-25/`), and git history holds every byte.

| scenario | story | assets |
|---|---|---|
| hero-bugfix | failing suite → agent finds and fixes the off-by-one → green → the user's flake-guard re-run (2026-10-25 re-cut: the stills anchor states that differ by construction — the fast upstream lands edit+bash+answer inside one mid-beat linger) | 5 stills + mp4/webm/gif |
| plan-mode | /plan → numbered plan → approval overlay → execute → complete | 5 stills + mp4/webm/gif |
| checkpoints | rename → /checkpoints list → /undo revert → /redo restore | 4 stills + mp4/webm/gif |
| overlays | fresh session → /model picker → model switch → /permissions → /hooks (2026-10-25 re-cut: opens on the session itself instead of cold on a slash command) | 6 stills + mp4/webm/gif |
| review | /review on the uncommitted fix → reviewers → SHIP verdict → artifact | 4 stills + mp4/webm/gif |
| subagent-explore | task subagent maps the real unown repo (2026-10-25 re-cut, tmux csi-u warning-free boots) | 4 stills + mp4/webm/gif |
| fleet | async spawn → fleet widget (waiting-for-answer) → ask_question → task_control steer answer → result steered back → /tasks resume registry | 5 stills + mp4/webm/gif |
| browser-subagent | the delegated web lane: task → browser (humanized live labels) → ✓ done row → report → async ◉ fleet row + /tasks lifecycle registry (2026-10-25 re-cut of the filmed lane — the report still anchors the parent-side Outcome block) | 6 stills + mp4/webm |
| wiki | fresh session → /wiki generate → search with scores (2026-10-25 re-cut: the story opens on the session the user works in) | 4 stills + mp4/webm/gif |
| cli-doctor | shell showcase: doctor, models, usage — with real accumulated usage rows (2026-10-25 re-cut, captured last so the usage table is lived-in) | 3 stills + mp4/webm/gif |
| memory-learn | two sessions in one pane: teach house rules + a real task → /note the lesson → /quit → AutoDream consolidates → a fresh session boots with the learned memory (footer chip v0 → vN) → /memory search recalls it scored → the closing task applies the lesson unprompted | 6 stills + mp4/webm |
| browser-verify | the visitor check: browser tool opens the landing page on :3000 → a11y snapshot → the exact curl install command → click the GitHub link → screenshot → report | 3 stills + mp4/webm |
| dream-dashboard | `unown dashboard dreams`: the real dream rows → dream detail (canary/guard note, rendered output) → the Memory screen (four tiers, injection budget) | 3 stills + mp4/webm |
| websearch | the keyless chain live: a live first ask (the web results store cleared for the lane) → web_search cascading providers → the answer with its cited source (2026-10-25 re-cut) | 3 stills + mp4/webm |
| mcp | a real MCP stdio server (the harness's own `fixtures/mini-mcp-dice.mjs` — actual JSON-RPC initialize/tools/list/tools/call) joins the session via `unown mcp add`; the d20 roll picks the fixture server's port and a second real turn checks the port is free (2026-10-25 re-cut) | 3 stills + mp4/webm |
| lsp | /repomap's graph-ranked map → a cross-tree rename while typescript-language-server diagnostics ride every edit's tool result (2026-10-24) | 3 stills + mp4/webm |
| parity-round | the 2026 consensus round in one live session: a real docs question for context → /output-style listing + set → the /btw side-question overlay (its own chrome anchored) → /insights → the auto-titled session proven by /name (2026-10-25 re-cut) | 5 stills + mp4/webm |
| harness | `unown dashboard lab` against the live engine after real cycles ran through the engine API (`POST /api/tasks/<id>/run` — fizzbuzz, csv-parser, debounce) — the cycle list, the baseline/verify, the mined-rule decision (2026-10-25 re-cut) | 2 stills + mp4/webm |
| router | `unown dashboard router`: the engine's real job table — dreams, harness, automations, one busy-mutex — then the screen's own action: the selection walks onto auto-dream and Space triggers it, toast on screen (2026-10-25 re-cut — the shipped cut had no visible interaction: the detail step selected nothing and every frame showed the same table) | 2 stills + mp4/webm |
| routines | `unown dashboard routines` with a real routine created through the CLI (a daily 09:00 morning brief, read-only) and its history row (2026-10-24) | 2 stills + mp4/webm |
| skills | `unown dashboard skills` after the harness loop actually shipped a skill — the loop's own minted row, not a mock (2026-10-24) | 2 stills + mp4/webm |
| goals | a real /goal run: the objective injection → todo-tracked work → the [GOAL:COMPLETE] gate passing on both kinds of cited evidence → the /goal status record (2026-10-24) | 4 stills + mp4/webm |
| split-view | the split-view display mode FILMED: /split mounts the band + dock, a live turn fills the Thinking and Tool Usage panels while the files dock carries the edit diff, the response-only transcript + the user's flake-guard green tally close it (2026-10-25 re-cut) | 5 stills + mp4/webm |
| sdlc | the № 010 Parity plate: a real read task → /context → the session workflow — /sessions list → /sessions export --md → the exported markdown on disk → /sessions list --all (2026-10-25 re-cut: the machine-wide listing settles before the closing beat) | 7 stills + mp4/webm |
| build-session | one prompt, zero keystrokes after: an empty project (just the brief) → the agent reads the brief, plans 4 todos, writes the whole Glyph Quests app (store/api/server + vanilla frontend + test suite) → 39 tests green across fix iterations → the live curl round-trip on :8787 (201/PATCH/DELETE/404/400, statics content-types) → the brief's closing summary, 4/4 todos, 47 tool calls, 12 minutes uncut (2026-10-27) | 7 stills + mp4/webm |
| sota-round | the mission's round-receipt lane: the dashboard's Skills / Memory / Dreams / Overview screens captured live mid-round over the loop the Fugue build fed — the three minted skills shipped (test-cadence-domain promoted beside the two minted from the build's own notes), the tier stack at project v46 with the injection budget line, AutoDream with pending notes, the suite saturated 6/6 over the cumulative pass chart (2026-10-29; consumed by the landing's built-improved band) | 4 stills |

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

The 2026-10-27 builder round — the catalog's first whole-app lane, and
the longest single-session story it carries (~12 minutes of real turns,
compressed to an 81s paced cut). Filmed against the live stack (bridge +
engine, agnes-3.0-flash through the Agnes AI upstream) in a fresh fixture
directory holding nothing but `PRODUCT-BRIEF.md`; the one keystroke burst
is the mission prompt itself. The lane is also the capture workflow's
stress test: four anchor cuts, two killed launch attempts (the sandbox
reaps the launching process tree — the driver now runs detached in tmux),
and a still-time lesson that changed the harness — the green-suite wait's
`exclude: [" fail"]` blocked its own match (bun renders ` 0 fail` on a
green piped run), and the run-4 stills 06/07 shipped identical until the
still was re-anchored on the frame record (see the lane's `CURATION.md`
in the capture root; the fifth-cut anchors wait on the session receipt,
an external state check, instead of pane text). The assembled cut trims
the post-session idle (the harness's own wait-burn) to one final dwell —
`assemble.py` rule 2b, documented in `docs/tui-capture-workflow.md`.

Stills are full-frame (128x36 grid, ~2214px wide, everything the user sees:
header/transcript, input box, cwd + model status). Videos are paced (8fps,
spinner-idle compressed, ~4-22s each). Regenerate or extend via the harness —
this directory is the curation of audited output, not the source of truth.

The split-view lane's provenance, updated 2026-10-24: its first cut
(2026-10-20) was captured with a PTY driver and a terminal-emulator render,
ships stills only, and never passed the pane-truth + pixel + VLM audit. The
shipped cut is a full ttyd-pipeline capture — audited like every other lane
here — filmed through the same driver as the rest of the catalog. Consumed
by the landing page's capability dex (`src/components/landing/dex.tsx` +
`dex-data.ts`) as the reel of its № 018 "Split view" entry — every movie
entry's poster comes from its own lane's audited stills above.
