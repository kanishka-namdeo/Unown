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
| CP1 the editor lane — history, search, stash, drafts | 🔲 pending | |
| CP2 the queue/image lane — send-now, image chips | 🔲 pending | |
| CP3 the transcript lane — viewer keys, aggregation, timestamps | 🔲 pending | |
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

## CP1 — the editor lane (pending)

Scope: A1 persistent per-cwd history, A2 cleared-draft recall, A3
Ctrl+R reverse search with scope cycle, A4 Ctrl+S stash/restore, A5
Ctrl+D two-press + delete-forward, A6 Esc-Esc clear-draft first step.

## CP2 — the queue/image lane (pending)

Scope: A7 send-queued-now chords, A8 image paste chips.

## CP3 — the transcript lane (pending)

Scope: A9 transcript viewer keys (? { } [ v, timestamps), A10 tool-call
aggregation chip.

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
