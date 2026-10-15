---
name: pre-commit-engine-check
description: Use before committing any engine changes to ensure code quality, clean restart, and dashboard health.
---

# Pre-Commit Engine Check

Run before committing engine changes.

1. Lint changed files: `bunx biome check --write` on files in `pi-repo/`
2. Restart engine (see restart-engine skill)
3. Verify engine: `GET /api/overview` returns `ok:true`
4. Verify dashboard: `GET :3000` returns 200

If any step fails, fix before committing.
