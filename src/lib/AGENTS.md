# Dashboard lib (src/lib/)

## Purpose

The dashboard's data layer: engine API client (REST + SSE), the engine schema types, client state store, formatting helpers — everything between the tab components and the engine on `:3030`.

## Ownership

- Owns: `agent-api.ts`, `agent-types.ts`, `agent-store.ts`, `agent-format.ts`, `utils.ts` (`cn()`), `db.ts`.
- Does not own: the engine API itself (`pi-repo/packages/self-learning/src/server.ts` defines it), UI consumption patterns (`src/components/dashboard/`).

## Local Contracts

- `agent-api.ts` — two deployment modes: DIRECT (`NEXT_PUBLIC_AGENT_API_BASE` set → absolute URLs) and GATEWAY (default → relative URLs carrying `?XTransformPort=3030` for the sandbox Caddy gateway). All fetches build URLs through `apiUrl()`; SSE lives at `EVENTS_URL`. Never hardcode engine URLs elsewhere.
- `agent-types.ts` — the typed mirror of the engine's REST schema (overview incl. optional `suite` task-minting stats, task `origin`/`status` provenance, runs, cycles, improvements, memory tiers + versions, dreams, notes, hooks, jobs, minted skills with `shipped`/`retired` status + rollback, bridge responses). When the engine API changes, update types here in the same change.
- `agent-store.ts` — zustand store for cross-tab client state; server state belongs to react-query, not here.
- `agent-format.ts` — display formatting (durations, token counts, statuses); keep renderers free of logic.
- `db.ts` — instantiates PrismaClient (Prisma 7: client generated to gitignored `src/generated/prisma` via `bun run db:generate`; better-sqlite3 driver adapter; CLI config in root `prisma.config.ts`). Legacy scaffold (User/Post, unused by the UI). Do not extend; engine data is the source of truth.

## Work Guidance

- Engine API surface (port 3030) — full route set: `GET /api/overview`; tasks `GET /api/tasks`, `GET /api/tasks/:id`, `POST /api/tasks/:id/run`, `POST /api/tasks/mint`; skills `GET /api/skills[?project=]`, `GET /api/skills/:id`, `POST /api/skills/:id/rollback`, `POST /api/skills/:id/retire`; runs `GET /api/runs`, `GET /api/runs/:id`, `POST /api/agent/prompt`; memory `GET /api/memory`, `GET /api/memory/:tier/history`, `POST /api/memory/:tier/rollback`; `GET /api/cycles`; improvements `GET /api/improvements`, `GET /api/improvements/:id`; dreams `GET /api/dreams`, `GET /api/dreams/:id/notes`, `POST /api/dreams/run`; `GET /api/hooks`; notes `GET|POST /api/notes`, `POST /api/notes/sync`; jobs `GET /api/jobs`, `POST /api/jobs/:id/trigger`, `POST /api/jobs/:id/toggle`; `GET /api/sandboxes`, `GET /api/bridge`; `GET /api/events` (SSE). Overview `kpis.suite` carries task-suite stats (total/passing/capability/regression/minted/graduated/saturated); task rows carry `origin` (`seed`|`minted`) and `status` (`capability`|`regression`|`discarded`, null = seed/regression). Skills rows carry `status` (`shipped`|`retired`) and `version` (rollback takes the target version in the body; list may be empty until AutoDream mints one).
- Type every response; no `any` on API boundaries.

## Verification

- Lint: `bun run lint` from the repo root (see `src/AGENTS.md`).
- With the engine up, the Overview tab renders live KPIs (proves api client + types + SSE end to end).

## Child DOX Index

(none — flat module directory)
