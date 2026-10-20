# providers fixture — the `/providers` PTY capture lane

A two-provider registry copied into a private scratch `UNOWN_HOME/agent/` by
`pty_capture_providers.py` before the TUI boots (the developer's real
`~/.unown` is never touched):

- `zai-bridge` — the bundled llm-bridge shape: local endpoint
  (`http://127.0.0.1:3031/v1`, the live bridge during a capture run), the
  `bridge-local` placeholder key in models.json, two served models. This is
  the row "Test connection" drives live.
- `agnes` — a direct provider with an `$AGNES_API_KEY` env-ref key: bun
  auto-loads the repo `.env`, so the reference resolves inside the TUI
  process and the list renders `key: $AGNES_API_KEY` (the headless/CI key
  pattern, visible in the pane truth).

`settings.json` pins the default to `zai-bridge/agnes-3.0-flash` so the boot
banner and the summary's canonical default-model line are deterministic.
