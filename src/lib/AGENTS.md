# Dashboard lib (src/lib/)

## Purpose

The dashboard's data layer: engine API client (REST + SSE), the engine schema types, client state store, formatting helpers — everything between the tab components and the engine on `:3030`.

## Ownership

- Owns: `agent-api.ts`, `agent-types.ts`, `agent-store.ts`, `agent-format.ts`, `utils.ts` (`cn()`), `db.ts`.
- Does not own: the engine API itself (`pi-repo/packages/self-learning/src/server.ts` defines it), UI consumption patterns (`src/components/dashboard/`).

## Local Contracts

- `agent-api.ts` — two deployment modes: DIRECT (`NEXT_PUBLIC_AGENT_API_BASE` set → absolute URLs) and GATEWAY (default → relative URLs carrying `?XTransformPort=3030` for the sandbox Caddy gateway). All fetches build URLs through `apiUrl()`; SSE lives at `EVENTS_URL`. Never hardcode engine URLs elsewhere.
- `agent-types.ts` — the typed mirror of the engine's REST schema (overview, runs, cycles, improvements, memory tiers + versions, dreams, notes, hooks, jobs, bridge responses). When the engine API changes, update types here in the same change.
- `agent-store.ts` — zustand store for cross-tab client state; server state belongs to react-query, not here.
- `agent-format.ts` — display formatting (durations, token counts, statuses); keep renderers free of logic.
- `db.ts` — instantiates PrismaClient against root `prisma/schema.prisma` (legacy scaffold, User/Post, unused by the UI). Do not extend; engine data is the source of truth.

## Work Guidance

- Engine API surface (port 3030): `GET /api/overview`, `GET /api/tasks`, `GET|POST /api/runs`, `GET /api/runs/:id`, `GET|POST /api/cycles`, `GET /api/improvements`, `GET /api/memory`, `GET /api/memory/history`, `POST /api/memory/rollback`, `GET /api/dreams`, `POST /api/dreams/run`, `GET|POST /api/notes`, `POST /api/notes/sync`, `GET /api/hooks`, `GET /api/jobs`, `POST /api/jobs/:id/toggle`, `POST /api/jobs/:id/trigger`, `POST /api/prompt`, `GET /api/events` (SSE).
- Type every response; no `any` on API boundaries.

## Verification

- `bun run lint` from the repo root.
- With the engine up, the Overview tab renders live KPIs (proves api client + types + SSE end to end).

## Child DOX Index

(none — flat module directory)
