# The Toccata round — the Claude Code touch study, shipped (2026-11-15)

**Mission:** reverse-engineer Claude Code's TUI experience like an expert
UI/UX researcher (popular and niche sources, every claim cited), map it
against every Unown feature and capability, implement the proven
learnings end to end, then test, iterate and improve — production grade,
cross-platform, keyboard-honest.

A toccata is a "touch" piece — written to showcase virtuosity of touch.
This is the keyboard round.

## Phase ledger

| Phase | Status | Artifact |
|---|---|---|
| CP0 research — the teardown + 47-point audit | ✅ done | `docs/tui-claude-code-parity-research.md` |
| CP1 the editor lane — history, search, stash, drafts | ✅ done | `test/input-history.test.ts` (16) + tui `editor-history-persistence` (10) + `history-lane-keybindings` (6); suites 5768/0 |
| CP2 the queue/image lane — send-now, image chips | ✅ done | send-now in CP1's commit; chips: tui `editor-image-chips` (10/10) |
| CP3 the transcript lane — viewer keys, aggregation, timestamps | ✅ done | tui `tui-alt-screen-transcript` (9/9) + coding-agent `tool-call-groups` (11/11); tui suite 1059/0 |
| CP4 the dialog/command lane — permission comments, aliases, rewind picker, mid-prompt completion | 🔲 pending | |
| CP5 the personality lane — spinner verbs, AGENTS.md flight | 🔲 pending | |
| CP6 verification — suites + PTY lanes as a real user | 🔲 pending | |
| CP7 docs/landing/blog/CHANGELOG/DOX + version + release | 🔲 pending | |

## CP0 — the research (2026-11-15)

`docs/tui-claude-code-parity-research.md` — the official interactive-mode
and commands references fetched in full (every keybinding, the queue
contract, the history contract, the transcript-viewer keys, the vim
surface, the spinner-verbs product layer), the sibling landscape
cross-checked (Amp's palette/history keys, Codex's cycle feature-request,
Gemini's /theme, opencode's fork, Aider's git-ceremony — rejected), and
the 47-point audit of Unown at `47e4eca3` with the seam for every item.

**The verdict:** five gap clusters — input-history lane, draft
lifecycle, transcript viewer, permission comments, personality — plus
six alias/picker gaps. Sixteen adoption decisions (A1-A16), six
deliberate non-adoptions on record (vim editor, voice, spell check,
emoji shortcodes, Enter-queues, ghost text).

## Environment notes (for resume)

- Stack: bun 1.4.3 (`~/.bun/bin` first in PATH); `bun run agent:install`
  done; `.env` carries the operator-provided Agnes upstream key
  (BRIDGE_UPSTREAM_KEY — never committed; .env is gitignored).
- Stack boot: `bun run agent:start` (bridge :3031 + engine :3030);
  headless smoke: `bun bin/unown -p "…" < /dev/null` (stdin MUST be
  closed or the idle-safe reader waits — recorded as expected behavior).
- The upstream PAT lives only in the git remote URL (DOX rule).
- Engine systemd service not installed (container has no user bus) —
  agent-side auto-start covers it; `unown doctor` shows the engine
  unreachable warning, memory still works.
- `.unown/memory/project.md` + `project.provenance.json` carry runtime
  AutoDream writes from this session's smoke tests — never staged into
  round commits (DOX: stage explicit paths only).

## CP1 — the editor lane (done, 2026-11-15)

Landed: A1 persistent per-cwd history (`input-history.ts` — 500-cap JSONL
per sha256(cwd), consecutive-dup suppression, corrupt-line tolerance,
`UNOWN_INPUT_HISTORY=0` kill switch, editor seeded at session_start), A2
cleared-draft recall (Ctrl+C clear + Esc-Esc with text land the draft in
session history, "Up restores it" hint), A3 the Ctrl+R search dialog
(fuzzy filter, previews, Ctrl+R next, Ctrl+S scope cycle
session→project→all; Enter submits, Tab edits), A4 Ctrl+S stash/restore of
the full editor snapshot (paste markers + bash badge included, undoable),
A5 Ctrl+D 800 ms two-press exit confirm (delete-forward-when-text
verified), A6 Esc-Esc clear-draft-first. Bonus: Ctrl+Enter/Alt+S
send-queued-now (the draft joins the queue, then the abort matrix drains
it) and the 100→500 in-memory cap rise.

Verification: self-learning suite **5768/0** (267 files), tui suite green
(incl. the new 10-case history-persistence battery), coding-agent
startup-input test updated to the recordHistory seam + the new 6-case
dispatch battery; the pre-existing coding-agent failures (model-registry,
model-resolver, syntax-highlight, theme-detection, tools/find) verified
present at the pristine baseline 47e4eca3 — environment artifacts, not
this round's regressions. CHANGELOG entry filed, landing rail regenerated
(62 stops), `.env.example` + `docs/configuration.md` + `docs/usage.md`
keybinding tables updated, self-learning AGENTS.md contract added.

## CP2 — the queue/image lane (done, 2026-11-15)

A7 (send-queued-now: Ctrl+Enter where the terminal reports extended keys,
Alt+S everywhere, draft joins the queue then the abort matrix drains it)
landed inside CP1's commit. A8 image chips: Ctrl+V inserts an atomic
`[Image #N]` (stable ids, atomic segmenting beside paste markers, undo +
stash aware, submit expands to the stored path, literal unregistered chips
stay literal). tui suite green including the 10-case chip battery.

## CP3 — the transcript lane (done, 2026-11-15)

A9 transcript mode: fullscreen Ctrl+O toggles a MODAL review view (CC's
transcript viewer is modal — bare `{`/`}`/`q`/`v` keys can never shadow
editor typing, so the mode consumes unknown keys and yields on the first
key when a docked dialog wants the keyboard). Keys: `{`/`}` prompt jumps
(reusing the OSC-133 seam), `/` search + `n`/`N` (the last query survives
search-close), less-nav (`j`/`k`/`g`/`G`/ctrl+u/d/ctrl+b/f/space/b — j down,
k up, the vim contract), `[` write-to-scrollback (stop → park hint →
keypress → start → re-enter; the press-any-key wait is injectable for the
virtual terminal), `v` open-in-$EDITOR (host-owned stop/start dance, the
conversation as markdown via `transcript-export.ts` — a viewing artifact,
not the share format), `?` help panel (config-live from the registry),
`q`/Esc/Ctrl+C exit. Tool output auto-expands on entry and restores on
exit (`onTranscriptModeChange`, the silent setToolsExpanded option);
expanded blocks carry a dim `HH:MM:SS` result timestamp (updateResult
gains `timestamp`; live callers stamp `Date.now()`, replay passes the
message's own). Regular mode keeps Ctrl+O as expand-all — the fork's
split, documented in usage.md. New `tui.altScreen.transcript*` binding
ids (16), all rebindable.

A10 aggregation: `ChatTranscriptContainer` wraps consecutive
same-name tool calls into a `ToolCallGroupComponent` at the container
level (all four creation paths — live message_update,
tool_execution_start fallback, replay, and future ones — group for
free; any other component splits the run). Collapsed: one dim chip
`⋯ called bash ×N · ctrl+o` (present tense `calling …` while streaming);
expanded: the individual blocks (the group implements the Expandable
fan-out and sums diffLineCounts). Single-call groups delegate to the
bare block byte-identically. Per-call routing (pendingTools,
updateResult) still addresses the individual components.

Research verification (the resume session's fresh sweep): the official
interactive-mode + fullscreen pages were re-fetched and quoted — the
transcript-viewer key table, the `[` scrollback semantics ("lasts until
you exit transcript mode"), `v`'s $VISUAL/$EDITOR contract, and the
aggregation example (`Called slack 3 times` for MCP runs; consecutive
runs split on a different tool — pinned by CC's own v2.1.234 changelog).
Binary string-extraction from CC v2.1.325 confirmed no literal "Called
Bash N times" — category-specific wording — so the fork's `⋯ called
<tool> ×N` chip stays the decided form.

Verification: tui suite **1059/0** (46 files), the new transcript battery
9/9; coding-agent `tool-call-groups` 11/11 with the affected neighbors
(tool-execution-component, truncation-chip, interactive-tui,
history-lane, glyph-placement, execution-lanes) 55/55; the full
coding-agent battery green over its documented environment baseline
(model-registry, model-resolver, syntax-highlight, theme-detection,
tools/find — all `fd`/model-catalog artifacts, verified present at the
pristine baseline in CP1).

## CP4 — the dialog/command lane (pending)

Scope: A11 permission comment lane, A12 mid-prompt slash completion,
A13 /cost + /theme aliases, A14 interactive /rewind picker +
doubleEscapeAction "rewind".

## CP5 — the personality lane (pending)

Scope: A15 spinner verbs (thinking-time flavor, honest labels keep
priority), A16 the AGENTS.md first-flight offer.

## CP6 — verification (pending)

Unit batteries per surface + the PTY capture lane phases; the full
suite green; cross-platform keybinding matrix (win32/WSL alt-fallbacks
documented).

## CP7 — ship (pending)

CHANGELOG (+ Agent Behavior where behavior moves), docs/usage.md
keybinding tables, self-learning AGENTS.md contract lines, blog post +
landing captures via the TUI capture lane, version bump + release, the
dependabot/code-scanning sweep.
