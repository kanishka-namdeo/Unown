---
name: restart-engine
description: Use when code changes in mini-services/agent-service require hot-reloading the self-learning engine. Does NOT apply to changes outside mini-services/.
---

# Restart Engine

Restart the self-learning engine after code changes.

1. Find PID: `pgrep -a bun | grep -- '--hot'`
2. Verify cwd: `readlink /proc/<PID>/cwd` — must end with `mini-services/agent-service`
3. Kill: `kill <PID>`
4. Restart: run `.zscripts/dev.sh`
5. Verify: `GET /api/overview` returns `ok:true`

Note: bun --hot does NOT reload changes outside mini-services/ directory tree.
