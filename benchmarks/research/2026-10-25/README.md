# 2026-10-25 competitive research sweep

Seven agent reverse-engineering reports driving the v0.0.16 completion round: Claude Code (v2.1.310), Codex CLI (0.164), Gemini CLI (0.64), OpenCode V1/V2 + Crush, aider + goose, Amp + Cursor CLI, and the vendored pi upstream audit. Each report is research-only (web-verified sources; no invented flags) and feeds the [Unreleased] changelog entries.

| Report | Product(s) | Key convergence |
|---|---|---|
| claude-code.md | Claude Code | bare --resume picker, /cost, stream-json, rewind menu, hooks breadth |
| codex.md | Codex CLI | resume picker + preview, delete/rename, exec --json, /status, /diff |
| gemini-cli.md | Gemini CLI | /resume browser, x-delete, stream-json, /compress, notifications |
| opencode-crush.md | OpenCode + Crush | session lifecycle, doom-loop recovery, warming, /init provenance |
| aider-goose.md | aider + goose | /tokens, auto-commit+undo, recipes retry, configure TUI |
| amp-cursor.md | Amp + Cursor CLI | threads, --stream-json, effort dial, worktree --base, rules globs |
| pi-upstream-gaps.md | vendored pi | HTML export, OAuth providers, --thinking, unknown-flag passthrough |
