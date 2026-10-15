# Mini-services (mini-services/)

## Purpose

The two bun background services that make up the agent runtime: `llm-bridge` (OpenAI-compatible LLM gateway on :3031) and `agent-service` (boots the self-learning engine on :3030 for the dashboard).

## Ownership

- Owns: shared boot conventions for both services and this doc; `agent-service/index.ts` directly (a thin wrapper — ~15 lines calling `startServer()` from `pi-repo/packages/self-learning/src/index.ts`).
- Child owns: `llm-bridge/` — see Child DOX Index.
- Does not own: engine internals (`pi-repo/packages/self-learning/`), dashboard (`src/`), launch orchestration (`scripts/start.sh`, root `package.json`).

## Local Contracts

- Ports: engine `PI_AGENT_PORT` (3030), bridge `BRIDGE_PORT` (3031). Both default from `.env`, which is symlinked into each service cwd so bun loads it there — config changes happen in the root `.env`, never per-service copies.
- Each service directory must keep a `package.json` with a `dev` script: the sandbox supervisor `.zscripts/dev.sh` scans `mini-services/*/package.json` for `dev` and launches each with `bun --hot`.
- Dev entrypoints: `bun run agent:bridge` / `bun run agent:engine` from the repo root (both `bun --hot`).
- Production: run WITHOUT hot reload — `cd mini-services/<service> && bun index.ts` (`--hot` can detach in-flight engine cycles from the router mutex when sources change mid-run).
- Single-tenant by design (engine busy-mutex); scale by running more engine instances against separate `PI_SELFLEARNING_DATA` / `PI_SELFLEARNING_DB`.
- `agent-service/smoke.ts` is a manual smoke script for the engine boot path.

## Work Guidance

- Service code stays minimal: business logic lives in `pi-repo/packages/self-learning` (engine) or the bridge module; wrappers here only boot it.
- Restart the whole stack via the root supervisor command (see root AGENTS.md "Stack lifecycle"); stop with `bun run agent:stop`.

## Verification

- `curl -s localhost:3031/health` — bridge up, upstream healthy.
- `curl -s localhost:3030/api/overview` — engine up, reports real provider/model.
- Logs: `.run/*.log` (via `scripts/start.sh`) or `.zscripts/mini-service-*.log` (via the supervisor).

## Child DOX Index

- `llm-bridge/AGENTS.md` — the OpenAI-compatible gateway to the upstream Dashscope endpoint
