# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated here by AutoDream. Edit freely — your edits are preserved as a new version.

## Tool inventory
- Unown sessions have access to: todo, note, task, fetch_url, web_search, webfetch, lsp, read, ls, grep.

## Engine restart procedure
- Find bun --hot PID with cwd mini-services/agent-service via /proc/<pid>/cwd.
- Kill it, then re-run .zscripts/dev.sh.
- bun --hot does NOT reload changes outside mini-services/.

## Pre-commit checklist (engine changes)
- Run: bunx biome check --write on changed files in pi-repo/.
- Verify engine restart: GET /api/overview returns ok:true.
- Confirm dashboard: :3000 returns 200.

## Known pitfalls
- LLM bridge calls timeout at 240s with 3 retries; agent watchdog at 600s.
- Failed cycles auto-recover — do NOT restart engine to fix them.

## Environment
- Current Bun version: 1.4.3 (released October 2026) [note 1]
