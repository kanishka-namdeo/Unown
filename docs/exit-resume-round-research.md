# Exit-resume round — research record

> The online grounding for the exit-resume round (2026-11-02): how the major
> terminal coding agents handle keyboard exit and session resume, Windows
> shell quoting rules for printed commands, and Ctrl+C mechanics in raw-mode
> TUIs. Condensed from subagent research runs (Claude Code + Codex; Windows
> quoting + signals + OSC 52) plus direct doc fetches (Gemini CLI, aider).
> Companion log: [exit-resume-round-session.md](exit-resume-round-session.md).

## Claude Code

- **Ctrl+C**: interrupts a running operation; idle + text → first press
  clears input, second press exits. The first-press hint is literally
  "Press Ctrl-C again to exit" (issue anthropics/claude-code#88097 quotes
  it; changelog v2.1.248). Ctrl+D: two presses within 800 ms exit.
- **Exit message** (issue #102467 quoting real output):
  `Resume this session with:` / `claude --resume <session_id>`; named
  sessions print `claude --resume <name>`. Introduced v2.1.31; a v2.1.105
  fix addressed the hint not printing on exit.
- **Resume surface**: `--continue`/`-c` = most recent conversation in the
  current directory; `--resume`/`-r` = picker, also accepts sessionId, name,
  or an absolute `.jsonl` path; `--fork-session`; `--session-id`;
  `--no-session-persistence`. Sessions saved continuously to
  `~/.claude/projects/<project>/<session-id>.jsonl`; interrupted tool calls
  are not re-run on resume; partial/interrupted turns persist.
- Docs: https://code.claude.com/docs/en/interactive-mode,
  https://code.claude.com/docs/en/cli-reference,
  https://code.claude.com/docs/en/sessions
- Windows note: #88097 documents the double-press flow breaking on Windows —
  the exact platform where our operator's report came from.

## OpenAI Codex CLI

- **Current key model**: Esc = `interrupt_turn` (Esc+Esc = edit-last-message
  backtrack); Ctrl+C closes modals → clears composer → interrupts the
  running turn → otherwise quits immediately. A double-press-to-quit design
  (1 s window, footer hint "<Ctrl+C> again to quit") was shipped and then
  DISABLED (PRs #8936 then #9220, both 2026-01-14: "feels janky in
  practice… while we rethink the quit/interrupt flow") — the churn itself is
  evidence that quit-vs-interrupt key semantics are a live design axis.
- **Exit messages** (source `codex-rs/tui/src/app/exit_summary.rs`):
  `To continue this session, run:` / `  codex resume <thread_id>`; named:
  `Or run codex resume and select <name>.`; bad id:
  `No saved session found with ID {id}. Run \`codex resume\` without an ID…`.
  Disconnect/kill paths print reconnect commands too.
- **Resume surface**: `codex resume` (picker, cwd-filtered),
  `codex resume --last`, `codex resume <SESSION_ID|name>`, `--all`;
  `codex fork`, `codex queue --resume`; in-TUI `/resume`. Sessions persist
  as `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`, appended
  continuously; interrupted turns persist and are marked interrupted on
  resume.
- Windows: several resume regressions reported (#54038 resume-by-name,
  #57031/#57002 picker hiding sessions, #7109 WSL2 exit keys) — again the
  roughest platform.

## Gemini CLI

- `/chat` is now an alias for `/resume`: an auto-saved session browser plus
  tagged checkpoints (`/resume save|resume|delete <tag>`); `--resume, -r`
  resumes the last session; `--list-sessions`, `--delete-session <n>`;
  `/exit --delete`. Sessions under `~/.gemini/tmp/<project_hash>/`.
  Docs: https://geminicli.com/docs/cli/tutorials/session-management,
  https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/commands.md

## aider

- Ctrl+C is always safe to interrupt; "The partial response remains in the
  conversation" (docs: https://aider.chat/docs/usage/commands.html — the
  Interrupting-with-CONTROL-C section). `--continue` and `--resume` flags
  over `.aider.chat.history.md`.

## Windows quoting for printed commands (the core question)

- **cmd.exe has no single-quote syntax**: the de-facto parser spec (SO
  "How does the Windows Command Interpreter (CMD.EXE) parse scripts?",
  jeb/dbenham, https://stackoverflow.com/questions/4094699) treats only `"`
  as a quoting character; the C-runtime/`CommandLineToArgvW` rules Node's
  argv follows agree (https://learn.microsoft.com/en-us/cpp/c-language/parsing-c-command-line-arguments).
  So `pi --session-dir 'C:\…'` pasted into cmd passes the literal token
  `'C:\…'` including quotes → file-not-found. Recurring bug class in the
  wild (e.g. MoonshotAI/kimi-code#3318, objectionary/eoc#1483).
- **PowerShell 5.1/7**: single quotes ARE verbatim string delimiters
  (about_Quoting_Rules,
  https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_quoting_rules);
  double quotes re-quote correctly for native commands.
- **Git Bash / MSYS2**: POSIX rules (https://www.msys2.org/docs/what-is-msys2/;
  POSIX 2.2.2). Detect via `MSYSTEM` (MINGW64/UCRT64/…).
- **Conclusion adopted**: quote per host — double quotes on win32, single
  quotes (with `'\''` escapes) under MSYSTEM and POSIX. Double quotes are
  the only spelling that works in all three Windows shells.

## Ctrl+C in a raw-mode Node TUI

- Node docs: "'SIGINT' from the terminal … is not generated when terminal
  raw mode is enabled and Ctrl+C is used"
  (https://nodejs.org/api/process.html#signal-events,
  https://nodejs.org/api/tty.html). With raw mode, Ctrl+C arrives as the
  `\x03` byte in stdin `data` events — the TUI must handle it itself
  (ink's `exitOnCtrlC` documents the same contract). libuv's win tty raw
  mode clears `ENABLE_PROCESSED_INPUT`; conhost and Windows Terminal/ConPTY
  behave alike.
- pi's model (Esc = interrupt matrix; Ctrl+C = clear editor, double-press
  within 500 ms exits; Ctrl+D exits) already matches the current Codex
  shape; the round added the visible first-press notice (Claude Code
  parity) instead of changing the keys.

## OSC 52 clipboard copy (evaluated, not adopted)

Write-only OSC 52 (`\x1b]52;c;<base64>\x07`) is supported by Windows
Terminal, kitty, iTerm2, alacritty, tmux (`set-clipboard on`); refused by
gnome-terminal/vte; Neovim ships it as a clipboard provider
(https://neovim.io/doc/user/provider.html). Not adopted this round: no
evidence Claude Code or Codex use it for exit hints, and the printed line is
already copy-pasteable; noted as a possible future affordance (with reads
never relied upon — terminals gate them for exfiltration safety).

## Best-practice synthesis (what the round implemented)

1. Print a copy-pasteable resume command on **every** exit path (after
   terminal restore), naming the launcher the user actually ran.
2. Quote for the host shell — on Windows that means double quotes.
3. First Ctrl+C on an empty editor shows "press again to exit"; the
   interrupt-first key (Esc) stays separate.
4. An exit during a running turn rides the SAME cooperative abort matrix as
   the in-session abort: partial persisted with `stopReason: "aborted"`,
   nothing re-run on resume.
5. Non-TTY stdout gets no hint (machine-readable contracts).
