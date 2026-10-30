# sessions-competitor-research.md — source notes (2026-10-30)

> Verbatim extraction of the round's online research pass (offline copy for
> the record). Cited as `[C]` in docs/session-lifecycle.md.

## Claude Code (official docs)
- Esc = graceful interrupt mid-turn — "Claude keeps the work done so far";
  queued messages sent next. Esc-Esc (empty input) = rewind menu.
  Ctrl+C = interrupt if running, else clear input, 2nd press exits.
- Sessions: `~/.claude/projects/<project>/<session-id>.jsonl`, written
  continuously; 30-day retention sweep. `claude -c`, `claude -r`,
  `-r <id|name|path>`, `--session-id <uuid>`, `--fork-session`, `/branch`,
  `/rename`, `/resume` picker (search, preview, rename Ctrl+R, Ctrl+A all
  projects).
- "Interrupted tool calls: a tool that was still running when the previous
  process ended, for example in a crash, doesn't get rerun when you
  resume."
- Checkpoints: snapshot of tracked files before each turn-starting prompt;
  restore code+conversation / conversation only / code only / summarize.

## OpenAI Codex CLI (codex-rs source)
- Rollout files `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<thread-id>.jsonl`;
  first line SessionMeta; RolloutLine {timestamp, ordinal, item}. SQLite
  session index, writer lock, compression worker.
- `codex resume` (picker by default), `codex resume --last`,
  `codex resume <id|name>` with `--all`; `codex exec resume --last`;
  fork/archive/delete/unarchive.
- Esc = interrupt current turn via first-class `turn/interrupt` protocol
  call; Esc-Esc = backtracking (edit previous message).

## Gemini CLI
- `~/.gemini/tmp/<project_hash>/chats/`, auto-saved even if interrupted;
  30d retention. `--resume`/`-r` (latest/index/uuid), `--list-sessions`,
  `/resume` Session Browser; `/resume save|list|resume|delete|share <tag>`.
- Ctrl+C = cancel current request or quit when input empty.

## aider
- `.aider.chat.history.md` transcript; `--restore-chat-history` (default
  false); Ctrl+C always safe, partial response stays in conversation;
  `/undo` = undo last aider git commit.

## pi coding agent (the base Unown builds on)
- Esc (`app.interrupt`) cascades AbortControllers through LLM stream, every
  tool call, compaction, retry, branch summary, bash; partial assistant
  message kept with `stopReason:"aborted"`; queued msgs returned to editor.
- Session JSONL: append-only tree, version 3, migrations v1→v2→v3;
  compaction entries keep originals; `--continue`, `--resume`,
  `--session`, `--session-id`, `--fork`, `/resume` picker.

## 12-factor-agents consensus
- Factor 6 "Launch/Pause/Resume with simple APIs"; Factor 12 stateless
  reducer: resume = replay/reduce the append-only log.
- Graceful interrupt ≠ kill: abort the run, keep partial work.
- On resume: never blindly re-run interrupted tool calls.

Sources (fetched live during the round):
- https://code.claude.com/docs/en/interactive-mode · /sessions ·
  /checkpointing · /cli-reference
- https://github.com/openai/codex (codex-rs: cli/src/main.rs,
  rollout/src/lib.rs, protocol, tui/src/chatwidget.rs)
- https://github.com/google-gemini/gemini-cli (docs/cli/session-management.md,
  checkpointing.md, rewind.md)
- https://github.com/Aider-AI/aider (website/docs)
- https://github.com/earendil-works/pi (badlogic/pi-mono redirect;
  packages/coding-agent/docs/{sessions,session-format,keybindings}.md)
- https://mariozechner.at/posts/2025-11-30-pi-coding-agent/
- https://github.com/humanlayer/12-factor-agents
