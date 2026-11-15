# Claude Code TUI parity research — the touch study

> Purpose: the 2026-11-15 reverse-engineering sweep of Anthropic's Claude Code terminal experience — the input editor, the keyboard matrix, the command surface, the transcript, the permission dialogs, and the personality layer — from official reference docs, community catalogs and the sibling-agent landscape, mapped item by item against Unown's shipped TUI surface (the 47-point audit below). Verdict up front: **Unown's chassis is already frontier-grade (queueing with take-back, permission-mode cycling, plan approval, split view, quiet footer, differential rendering with Kitty progressive-enhancement) — the gaps the research proves are concentrated in five places: the input-history lane (not persisted, no reverse search), the draft lifecycle (no stash key, no cleared-draft recall), the transcript viewer (expand-only, no in-viewer navigation/help/export), the permission comment lane (questions have notes, permission asks do not), and the personality layer (honest labels, no verbs). Those five are this round's scope; the full vim editor, voice input and spell check are the deliberate non-adoptions, with reasons on record.**

Related pages: [usage](usage.md) · [BEHAVIOR](BEHAVIOR.md) · [sdlc-feature-parity](sdlc-feature-parity.md) · [memory-encore-round-research](memory-encore-round-research.md) · [session-lifecycle](session-lifecycle.md)

- [Method and claim tiers](#method-and-claim-tiers)
- [The teardown — the official interactive-mode reference](#the-teardown--the-official-interactive-mode-reference)
- [The 47-point audit: Claude Code vs Unown at HEAD](#the-47-point-audit-claude-code-vs-unown-at-head)
- [The sibling landscape — what the other agents prove](#the-sibling-landscape--what-the-other-agents-prove)
- [Adoption decisions](#adoption-decisions)
- [Corrections register](#corrections-register)

## Method and claim tiers

Research performed 2026-11-15 from public sources: the official Claude Code
reference at `code.claude.com/docs/en` (the interactive-mode and commands
pages fetched in full — they are the product's own statement of its
keyboard contract), the permission-mode docs, Anthropic engineering blog
pointers, the community spinner-verbs catalog
(`github.com/AlexPl292/awesome-claude-spinners`), the Amp keybinding
reference (`ampcode.com/docs/cli/keybindings`), Codex/Gemini/opencode/aider
documentation and issue threads, and the prior in-repo teardowns
(`docs/memory-encore-round-research.md` already tore down Claude Code's
*memory* UX — this round covers the *terminal* UX and does not repeat that
ground).

Claims are tiered like the other decision records:

- **[V]** — verified during this research: read directly in fetched docs,
  catalogs or source during this session.
- **[C]** — community-claimed (multiple independent reports; not vendor
  documentation).
- **[U]** — unknown or inference; labeled as such, never presented as fact.

## The teardown — the official interactive-mode reference

The official reference (fetched 2026-11-15, `code.claude.com/docs/en/interactive-mode`
— internally versioned, citing behaviors up to v2.1.314) defines the
contract. The load-bearing details, quoted or paraphrased from that page
(all [V] unless noted):

**General controls.** `Ctrl+C` interrupts a running operation; on an idle
prompt the first press clears the input and a second exits. `Ctrl+D` shows
a confirmation hint, a second press within **800 ms** exits; with text in
the prompt it deletes the character after the cursor instead. `Ctrl+G` /
`Ctrl+X Ctrl+E` open the prompt in the user's editor. `Ctrl+L` redraws the
screen. `Ctrl+O` toggles a **transcript viewer** with timestamps and the
model used on each assistant message. `Ctrl+R` is reverse history search.
`Ctrl+V` / `Alt+V` (WSL) paste an image as an **`[Image #N]` chip** "so you
can reference it positionally in your prompt". `Ctrl+B` backgrounds the
running Bash command (tmux users press twice). `Ctrl+T` toggles the task
checklist. `Ctrl+S` **stashes the draft** — "Pressed again on an empty
prompt, restores the stashed text, cursor position, pasted content, and
input mode, so a stashed `!` shell command comes back in shell mode".
`Esc` interrupts, closing work-keeps-so-far; `Esc`+`Esc` **with text**
clears the draft and saves it to history for `Up` recall; `Esc`+`Esc` on
empty input opens the **rewind menu** (checkpoint restore). `Ctrl+Enter` /
`Ctrl+X Ctrl+S` send queued messages now (v2.1.275+). `Shift+Tab` cycles
permission modes — the cycle now includes `bypassPermissions` and `auto`
"where available" (a change from the earlier three-mode cycle; the
three-mode limit was itself a filed feature request,
`github.com/anthropics/claude-code/issues/21062` [V]). `Alt+P` switches
model, `Alt+T` toggles thinking, `Alt+O` fast mode.

**Text editing.** Readline conventions with precise word semantics:
`Alt+B/F/D` treat a word as "a run of letters and digits" (punctuation
separates — `src/utils/foo.ts` stops at `ts`, `foo`, `utils`, `src`);
`Ctrl+W` is different — "ignores punctuation and deletes back to the
previous whitespace", removing the whole path in one press. `Alt+Y` after
`Ctrl+Y` cycles paste history. `Ctrl+_` undoes the last input edit.

**Multiline.** Four lanes: `\`+`Enter`, `Option+Enter` (Meta configured),
`Shift+Enter` (native in iTerm2, WezTerm, Ghostty, Kitty, Warp, Windows
Terminal), `Ctrl+J` "in any terminal without configuration".

**Queueing.** Messages typed while Claude works are queued and "show in
gray until Claude starts responding to them"; `Up` from the first row
takes queued messages back; `Ctrl+Enter` sends now.

**History.** "Input history is stored per working directory"; `/clear`
starts a new session with the new session's prompts first and earlier
sessions after them; consecutive duplicate submissions record one entry;
cleared drafts are recoverable — "press `Up`, either right away or after
you've sent a message or command", ten most recent cleared drafts kept;
`Ctrl+R` opens a search dialog with a preview pane, `Ctrl+S` cycles scope
through **this session / this project / all projects**.

**Transcript viewer keys.** Inside `Ctrl+O`: `?` toggles a keyboard-help
panel, `{` / `}` jump to the previous/next user prompt "like vim paragraph
motion", `[` writes the conversation to the terminal's **native
scrollback** so `Cmd+F` and tmux copy mode can search it, `v` opens the
conversation in `$VISUAL`/`$EDITOR`, `q`/`Ctrl+C`/`Esc` exit.

**Vim mode.** A full implementation: modes, motions (`f/F/t/T/;/,` and
`%` bracket matching), text objects (`iw/aw/i"/a(/a{`), visual
character/line modes, `vimInsertModeRemaps` (e.g. `jj`→`Esc`, one-second
window, and the setting is deliberately ignored from project-level
settings "so a checked-out repository can't remap your keystrokes").

**Commands.** The fetched command table lists 100+ built-ins
(`/add-dir /autocompact /branch /btw /clear /code-review /color /compact
/config /context /copy /cost /diff /doctor /effort /export /focus /fork
/init /loop /mcp /memory /model /output-style /permissions /plan /resume
/rewind /security-review /status /tasks /terminal-setup /theme /usage
/vim /voice …`). Command completion works **mid-prompt**: "type `/` after
a space, then the first letters of a name, as in `run the tests, then
/com`" — outside fullscreen as **ghost text** with a `+2` count, `Tab` to
insert. Some commands run immediately mid-turn (`/status`, `/tasks`,
`/usage`); hidden commands exist and run only when typed in full
(`/heapdump`).

**The `?` panel.** Typing `?` on empty input toggles the shortcut help
panel.

**Spinner personality.** The loading spinner shows rotating "spinner
verbs" — "Pondering", "Percolating", "Booping" (catalog:
`medium.com/@agnamihira` "Claude's Thinking Words" [C]; Anthropic's Boris
Cherny announced user/team customization on Threads [C]; the
`awesome-claude-spinners` catalog documents the `spinnerVerbs` settings
key and 46 themed packs [V]). The verbs are shown *while the model
thinks*; tool execution shows contextual text instead.

## The 47-point audit: Claude Code vs Unown at HEAD

Audited 2026-11-15 against the vendored pi TUI at `47e4eca3`. Full-item
table (E = exists / E* = exists-differently / N = does not exist, with
the Unown seam):

| # | Surface | Claude Code | Unown at HEAD | Verdict |
|---|---|---|---|---|
| 1 | Multiline lanes | `\`⏎, Opt⏎, Shift⏎, Ctrl+J | all four (`tui/src/keybindings.ts:145`, `editor.ts:959-966`) | E — parity |
| 2 | Vim editor | full (motions, text objects, visual) | N (Emacs-style only) | **gap (deferred — see decisions)** |
| 3 | Input undo | `Ctrl+_` | `ctrl+-` + per-OS overrides (win32 `ctrl+z`, WSL `alt+z`) | E — parity |
| 4 | Kill ring / yank-pop | `Ctrl+K/U/W/Y` + `Alt+Y` | identical incl. yank-pop (`editor.ts:2049-2081`) | E — parity |
| 5 | Word nav semantics | letters+digits words; `Ctrl+W` whitespace | `Intl.Segmenter` + ASCII punct; `Ctrl+W` consumes whitespace+word | E* — close enough, documented |
| 6 | Draft stash `Ctrl+S` | stash/restore (content+cursor+mode) | N (Ctrl+S bound in pickers only) | **gap — this round** |
| 7 | Cleared-draft recall | Ctrl+C-then-Up restores; 10 kept | undo-only, no hint, Up browses submitted history | **gap — this round** |
| 8 | History persistence | per-cwd, cross-session, dedup | in-memory, 100 cap, consecutive-dedup only | **gap — this round** |
| 9 | Reverse search `Ctrl+R` | dialog + preview + scope cycle | N | **gap — this round** |
| 10 | Image paste | `[Image #N]` chip | raw `/tmp` path inserted | **gap — this round** |
| 11 | Queue lane | queue gray, Up take-back, Ctrl+Enter send-now | steer-Enter, `Alt+Enter` queue, `Alt+↑` take-back; no send-now | **partial gap — this round** |
| 12 | Emoji shortcodes | `:name:` | N | deliberate N (see decisions) |
| 13 | Spell check | as-you-type underline | N | deliberate N |
| 14 | `@` mentions | files + live sessions | files (fd-backed, quoted paths); no session mentions | E* (sessions N/A — no cross-session bus) |
| 15 | `!` / `#` / `:` prefixes | shell / memory / emoji | `!` + `!!` (context-excluded); no `#`, no `:` | E* (memory is Unown's tiered stack, not a `#` lane) |
| 16 | Transcript viewer | Ctrl+O, `?` `{` `}` `[` `v` keys, timestamps | Ctrl+O = expand-all; fullscreen has ctrl+↑/↓ + ctrl+shift+f search | **partial gap — this round** |
| 17 | Todo toggle / Ctrl+D / Ctrl+L / Ctrl+G | Ctrl+T / two-press 800ms / redraw / editor | ctrl+shift+t / single-press / model selector / editor | **partial gap — this round** |
| 18 | Model/thinking keys | Alt+P / Alt+T / Alt+O | Ctrl+P / Alt+T / effort via settings | E* (deliberate fork moves) |
| 19 | Permission cycle | Shift+Tab (+Alt+M win) | Shift+Tab, default→acceptEdits→plan (bypass deliberately excluded) | E — parity by design |
| 20 | Esc matrix | interrupt / deny / Esc-Esc rewind | interrupt matrix + Esc-Esc tree/fork picker | **partial gap — this round** |
| 21 | Permission comment lane | Tab adds comment to a Yes/No answer | N on permission asks (`n`-notes exist on ask_user_question) | **gap — this round** |
| 22 | `?` help panel | on empty input | searchable live-from-config palette | E — parity (better: config-live) |
| 23 | Mouse | hover/click in menus + transcript | fullscreen scrollbar/click-drag; no click-to-accept | E* |
| 24 | Voice | hold-Space dictation | N | deliberate N |
| 25-26 | Slash surface | 100+ built-ins | ~65 unown + 23 pi built-ins + skills + custom | E (see aliases below) |
| 26b | Mid-prompt `/cmd` completion | ghost text + `+N`, Tab | N (start-of-first-line only) | **gap — this round** |
| 27 | Immediate commands | /status /tasks /usage mid-turn | extension commands run immediately | E — parity |
| 28 | Tool render + aggregation | ⏺ bullets, collapse, "Called X 3 times" | glyph column, collapse, per-call blocks | **partial gap — this round** |
| 29 | Diffs | red/green, intra-line | unified + inverse-video intra-line tokens | E — parity |
| 30 | Thinking display | dim + summaries | italic dim blocks, hidden-label, level badge | E (summaries N — model-dependent) |
| 31 | Todo live render | checklist overlay | overlay above editor + `○ ◐ ● ⊘` inline | E — parity |
| 32 | Spinner | verb phrases + elapsed | contextual honest labels + elapsed + shimmer | **partial gap — this round (verbs)** |
| 33 | Context meter | `━╸` bar | `ctx ▕████░░░░░▏ 42%/200k (auto)` 10-cell | E — parity |
| 34 | Turn/cost meter | cost line | `turn 3.4s · ttft 0.8s · ~$0.0084` | E — parity |
| 35 | Footer | status+context | quiet footer (2 rows, attention chips) | E — parity (fork's own design) |
| 36 | Title/notify | OSC title, notify | OSC title + deferred OSC-9/BEL | E — parity |
| 37 | Compact | manual + auto | manual + tiered auto + idle compact | E — parity |
| 38 | Resume/rewind | picker + rewind menu | picker + tree + /undo /redo /restore /edit-resend (text listings) | **partial gap (picker) — this round** |
| 39 | Themes | /theme | settings submenu w/ live preview (no /theme alias) | **alias gap — this round** |
| 40 | Onboarding | trust, theme, CLAUDE.md offer | provider wizard, theme picker, flights, trust gates | **partial gap (AGENTS.md offer) — this round** |
| 41 | /context | colored grid | 32-cell bar + tier breakdown + band advice | E (fork's own, richer breakdown) |
| 42 | /cost | alias of /usage | /usage only | **alias gap — this round** |
| 43 | /btw, /focus | side Q, focus view | /btw exact parity; focus N | E* (focus deferred) |
| 44 | Keybinding overrides | file | keybindings.json full surface + legacy migrations + live help | E — parity |
| 45 | Windows/WSL alt-keys | Alt+V etc. | alt+z/alt+v/ctrl+q/alt+q/alt+p/ctrl+f matrix | E — parity |
| 46 | tmux | Ctrl+B twice | extended-keys docs + csi-u paste decode | E* |
| 47 | Kitty protocol | progressive | full ?u negotiation + modifyOtherKeys fallback | E — parity |

## The sibling landscape — what the other agents prove

Cross-checks so the adoption decisions are not made in a vacuum (all [V]
from fetched docs unless noted):

- **Amp** (`ampcode.com/docs/cli/keybindings`): command palette as the
  central hub (`Ctrl+O` — "most important"); `Ctrl+R` **prompt history**;
  `↑/↓` navigate to queued and previous messages for editing; Enter
  steers by default with explicit queue commands; two-key exit chords
  (`Ctrl+C` `Ctrl+N` archive+new). Proves: reverse history search is now
  table stakes, not nostalgia; queue take-back deserves top-level keys.
- **Codex** (`developersdigest.tech/reference/codex/keyboard-shortcuts`,
  issue `openai/codex#19226`): 14 shortcuts; the community filed for a
  Shift+Tab permission-mode cycle "similar to how other coding CLIs" —
  i.e., Claude Code's cycle is the reference the field asks for.
  Issue #2's "approval prompts can steal input while user is typing"
  proves the input-steal failure mode Unown's ask dialogs already avoid.
- **Gemini CLI** (`geminicli.com/docs/cli/themes`): `/theme` + live
  preview; `Ctrl+T` tool-description toggle; custom theme JSON —
  validates the `/theme` alias decision.
- **opencode** (`opencode.ai/terminal`, `kau.sh/blog/opencode-power-user-tips`):
  session forking from the message you point at (`/fork ##`); the
  terminal UI is marketed on speed + diff-per-edit. Unown's `/tree` +
  `/edit-resend` already cover the substance.
- **Aider** (`aider.chat`): auto-commit-per-edit with `/undo` — a git-as-
  checkpoint UX Unown deliberately rejects (checkpoints are already
  in-repo, no git ceremony) — record stands.
- **Spinner verbs**: the 46-pack catalog and Anthropic's own
  customization announcement prove the personality layer is a *product
  surface*, not a joke — but Claude Code itself scopes the verbs to
  model-thinking time, with honest contextual labels during tool runs.

## Adoption decisions

Shipped this round (the Toccata round, `docs/toccata-round-session.md`):

| # | Decision | Source | Unown form |
|---|---|---|---|
| A1 | Persistent per-cwd input history | CC history contract [V] | `~/.unown/agent/input-history/<hash>.jsonl`, 500-cap, consecutive dedup, cross-session Up recall; kill switch `UNOWN_INPUT_HISTORY=0` |
| A2 | Cleared-draft recall | CC "bring back a cleared draft" [V] | Ctrl+C-clear saves the draft as newest history entry + status hint; Up on empty recalls it |
| A3 | Reverse history search | CC Ctrl+R + Amp Ctrl+R [V] | `Ctrl+R` in-editor dialog: fuzzy filter, preview, `Ctrl+R` next, Tab/Enter accept, Esc cancel; `Ctrl+S` cycles scope session/project/all |
| A4 | Draft stash | CC Ctrl+S [V] | `Ctrl+S` stash/restore (content, cursor, paste markers, bash-mode badge) |
| A5 | Ctrl+D two-press + delete-forward | CC Ctrl+D [V] | 800 ms confirmation window; deletes char after cursor when text present |
| A6 | Esc-Esc draft-clear first step | CC Esc-Esc [V] | text present → clear-to-history (CC parity); empty → existing tree/fork picker; new `doubleEscapeAction: "rewind"` option opens the checkpoint picker |
| A7 | Send-queued-now | CC Ctrl+Enter / Ctrl+X Ctrl+S [V] | both chords flush the queue; Ctrl+Enter only when the terminal reports it (Kitty/modifyOtherKeys), Ctrl+X Ctrl+S always |
| A8 | Image paste chips | CC `[Image #N]` [V] | atomic `[Image #N]` chip + session registry, submit expands to the stored path |
| A9 | Transcript viewer keys | CC transcript section [V] | fullscreen viewer gains `?` help, `{`/`}` prompt jumps, `[` write-to-scrollback, `v` open-in-editor; timestamps on expanded tool blocks |
| A10 | Tool-call aggregation | CC "Called X 3 times" [V] | consecutive same-tool collapses to `⋯ called <tool> ×N · ctrl+o` |
| A11 | Permission comment lane | CC Tab-on-permission [V] | Tab opens a comment field on the permission ask; comment rides the decision to the model |
| A12 | Mid-prompt slash completion | CC mid-prompt `/` [V] | `/` after whitespace anywhere offers the command list (no ghost text — the fork's list-with-hints form) |
| A13 | `/cost` + `/theme` aliases | CC command table [V] | aliases onto the existing `/usage` and the theme submenu |
| A14 | Interactive rewind picker | CC rewind menu [V] | `/rewind` picker over checkpoints (restore code+conversation / code only), wired to `doubleEscapeAction: "rewind"` |
| A15 | Spinner verbs | CC spinner verbs [V][C] | verb flavor while the model thinks (honest labels keep priority during tool runs); `spinnerVerbs` setting + `UNOWN_SPINNER_VERBS=0` |
| A16 | AGENTS.md first-run offer | CC /init CLAUDE.md offer [V] | first flights gains an "initialize AGENTS.md" flight when the repo has none |

Deliberately not adopted, on record:

- **Full vim editor** — a real implementation is a multi-thousand-line
  surface (CC's covers text objects, visual modes, remaps); shipping a
  partial one that traps power users is worse than none. The fork's
  emacs-style editor plus `~/.unown/agent/keybindings.json` covers the
  navigation/deletion core. Revisit as its own round if demand appears.
- **Voice input** — microphone access from a TUI sandbox is out of scope
  for a coding agent whose lanes run headless; no sibling ships it in-terminal.
- **Spell check** — a dictionary dependency for marginal value in a
  code-heavy prompt; the grammar of prompts is mostly identifiers and paths.
- **Emoji shortcodes** — `:name:` expansion is fun but adds a trigger
  character that collides with path/protocol typing in code prompts.
- **Enter-queues (CC's classic model)** — the fork's Enter-steers default
  is a deliberate differentiator (Amp validated the same default);
  queueing stays on Alt+Enter, now with A7's flush key.
- **Ghost-text autocomplete** — the fork's list-with-argument-hints form
  is richer than ghost text for command discovery; A12 ports the
  *trigger surface* (mid-prompt `/`), not the ghost rendering.

## Corrections register

- 2026-11-15: an earlier draft of this page said Claude Code's
  Shift+Tab cycle was fixed at three modes. The fetched interactive-mode
  reference states the cycle includes `bypassPermissions` and `auto`
  "where available" — Unown's three-mode cycle (bypass excluded) is
  therefore a *deliberate divergence*, now labeled as such in the audit
  table (item 19), not a parity claim.
