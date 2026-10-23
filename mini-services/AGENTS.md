# Mini-services (mini-services/)

## Purpose

The two bun background services that make up the agent runtime: `llm-bridge` (OpenAI-compatible LLM gateway on :3031) and `agent-service` (boots the self-learning engine on :3030 for the TUI dashboard and API clients). A third, sandbox-only upstream shim `zai-upstream/` serves as an OpenAI-compatible GLM endpoint on :3032 for environments with no external provider key; it has no `package.json`/`dev` script and is not launched by the stack supervisor.

## Ownership

- Owns: shared boot conventions for the two runtime services and this doc; `agent-service/index.ts` directly (a thin wrapper — ~15 lines calling `startServer()` from `pi-repo/packages/self-learning/src/index.ts`).
- Child owns: `llm-bridge/` — see Child DOX Index.
- Parked, not owned: `zai-upstream/` (sandbox-only shim, port 3032, no package.json or AGENTS.md; run manually when needed). It is intentionally outside the ownership index because its supervisor launch depends on a dev script it does not provide.
- Does not own: engine internals (`pi-repo/packages/self-learning/`), the landing page (`src/`), launch orchestration (`scripts/start.ts`, root `package.json`).

## Local Contracts

- Ports: engine `PI_AGENT_PORT` (3030), bridge `BRIDGE_PORT` (3031). Both default from the root `.env`, delivered by TWO paths: `scripts/start.ts` parses it and exports every variable into each spawned child (bun does NOT read the repo-root `.env` from a service cwd), and `scripts/install.ts` symlinks the root `.env` into each service dir (`mini-services/<service>/.env → ../../.env`) so supervisor launches that just run the `dev` script from the service dir (e.g. the sandbox's `.zscripts/dev.sh` scanning `mini-services/*/package.json`) inherit the same config — bun auto-loads `.env` from the process cwd. Symlink creation is idempotent and non-fatal where symlinks are unavailable (Windows without Developer Mode; the launcher export still covers `agent:start`). Config changes happen in the root `.env`, never per-service copies.
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
- Logs: `.run/*.log` (via `scripts/start.ts`) or `.zscripts/mini-service-*.log` (via the supervisor).

## Child DOX Index

- `llm-bridge/AGENTS.md` — the OpenAI-compatible gateway to the upstream Agnes AI endpoint
- `zai-upstream/` (no AGENTS.md) — optional sandbox upstream shim (port 3032, model id `glm-4-plus`); not supervisor-managed
