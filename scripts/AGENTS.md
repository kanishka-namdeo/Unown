# Scripts (scripts/)

## Purpose

Two kinds of content live here: (1) the project's bootstrap/lifecycle scripts wired into root `package.json` (`agent:install` / `agent:start` / `agent:stop`), and (2) verification artifacts from the session that configured the Dashscope endpoint — probes, captured search results, and dashboard screenshots kept as evidence.

## Ownership

- Owns: `install.sh`, `start.sh`, `stop.sh` (product scripts) and the verification artifacts (`probe_*.py`, `test_bridge.py`, `search_*.json`, `modelsdev.json`, `dash_*.png`).
- Sandbox-template artifacts also parked here (NOT part of Unown): `init-fullstack.sh`, `dev-all.sh`, `scaffold.tar` — installed by the hosting sandbox, tracked only for provenance.

## Local Contracts

- `install.sh` — one-time bootstrap: root `bun install` → `pi-repo` `bun install` → `pi-repo` `bun run build:offline` (offline skips the ai package's network model-data hydration).
- `start.sh` — loads root `.env` (`set -a`), starts llm-bridge (:3031), engine (:3030), dashboard (:3000) as background processes with pidfiles in `.run/`.
- `stop.sh` — halts by pidfile, falls back to pattern matching when stale.
- Probe contract: probes hit the upstream endpoint directly or through the bridge and use `BRIDGE_UPSTREAM_KEY`-style env from the root `.env` — they must never hardcode keys.
- `search_*.json` / `modelsdev.json` are captured research data (model strengths comparison, models.dev snapshot) that justified the model assignment — treat as read-only evidence.
- New ad-hoc verification scripts go here (not `/tmp`) when their results matter to the worklog; keep them re-runnable.

## Work Guidance

- Run product scripts only via their npm aliases (`bun run agent:install|start|stop`) so cwd + `.env` loading behave as designed.
- Keep scripts `set -euo pipefail` + `cd "$(dirname "$0")/.."` like the existing ones.

## Verification

- `bash -n scripts/*.sh` (syntax) — cheap gate before committing script changes.
- `bun run agent:stop && bun run agent:start` round trip: all three services healthy (see mini-services doc for endpoints).

## Child DOX Index

(none — flat directory)
