# Mini-services (mini-services/)

## Purpose

The background service boot wrappers: `agent-service` (the self-learning engine's serving surface on :3030), `llm-bridge` (the OpenAI-compatible gateway on :3031) and `zai-upstream` (a sandbox-only shim on :3032). The engine's actual code lives in `pi-repo/packages/self-learning`; these wrappers only boot it.

## Ownership

- Owns: `mini-services/agent-service/` (its `index.ts`, `smoke.ts`, `package.json`) and this doc.
- Children own: `mini-services/llm-bridge/` (its own contract doc).
- `zai-upstream/` has no `package.json`/`dev` script and is NOT supervisor-managed — `scripts/start.ts` starts it only when `BRIDGE_UPSTREAM_URL` points at `127.0.0.1:3032`.

## Local Contracts

- Each service has a `package.json` with `dev: bun --hot index.ts`; `scripts/start.ts` discovers and detaches them, keeping pidfiles and logs in `.run/` (bridge.pid/engine.pid/bridge.log/engine.log, usage-log.jsonl).
- `agent-service/index.ts` is 20 lines: it calls `startServer(PI_AGENT_PORT ?? 3030)` from the self-learning package. If `startServer` returns null (single-instance lock lost), it exits 0 — "already running" is healthy for a supervisor. Fatal errors exit 1.
- Config delivery: the root `.env` is the single config source, delivered two ways — `scripts/start.ts` parses it and exports vars to spawned children, and `scripts/install.ts` symlinks each service's `.env` to the root one. Config changes happen in the root `.env` only.
- Production runs WITHOUT `--hot` (hot reload can detach in-flight engine cycles from the router mutex); `--hot` is the dev lane only.
- The engine is single-tenant by design (busy-mutex); scale by running more engine instances against separate `PI_SELFLEARNING_DATA` / `PI_SELFLEARNING_DB`.

## Work Guidance

- Engine behavior, API, jobs and env contracts are documented in `pi-repo/packages/self-learning/AGENTS.md` — read it before changing anything the wrapper touches.
- `agent-service/smoke.ts` is a manual smoke: it drives pi headlessly through the bridge and asserts a file gets created.

## Verification

- `bun run agent:start` then `curl -s localhost:3031/health` (bridge, `ok:true`) and `curl -s -H "Authorization: Bearer $(cat data/self-learning/engine.token)" localhost:3030/api/overview` (engine, `ok:true`); `bun run agent:stop` must leave the ports quiet.
- The bridge unit suite: `cd mini-services/llm-bridge && bun test` (181 tests: 176 hermetic + 5 env-gated live-VLM skips).
- CI's build-test matrix runs the full-stack boot/survive/stop smoke (services must answer 20s after the launcher exits — the bun#31603 regression gate).

## Child DOX Index

- `mini-services/llm-bridge/AGENTS.md` — the OpenAI-compatible gateway: model routing, admission lanes, failover, usage log, health shape
