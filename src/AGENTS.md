# Dashboard (src/)

## Purpose

The mission-control dashboard: a single-page Next.js 16 App Router client that visualizes and drives the self-learning engine — 7 tabs (Overview, Learning Lab, Memory, Dreams, Hooks, Console, Router) fed by live SSE from `:3030`.

## Ownership

- Owns: `src/app/` (routes + layout), `src/hooks/`, and this doc.
- Children own: `src/components/dashboard/` (tab UI surfaces) and `src/lib/` (engine client + types + state) — see Child DOX Index.
- `src/components/ui/` is vendored shadcn/ui primitives — treat as generated code; do not hand-edit, regenerate via the shadcn CLI instead.

## Local Contracts

- Entry: `src/app/page.tsx` composes `DashboardProviders` + `Header` + the seven `*-tab.tsx` surfaces in a shadcn `Tabs`. Adding a tab = new component in `src/components/dashboard/`, wired here.
- All engine data flows through `src/lib/agent-api.ts` (REST + SSE) and `src/lib/agent-types.ts` (schema types mirroring the engine's API). Components never fetch engines directly.
- Deployment modes (see `agent-api.ts`): DIRECT when `NEXT_PUBLIC_AGENT_API_BASE` is set; otherwise GATEWAY mode with `?XTransformPort=3030` query params so the sandbox Caddy gateway routes to the engine.
- `src/lib/db.ts` + root `prisma/schema.prisma` are legacy scaffold (User/Post models, unused). Do not build features on them; live data comes from the engine API. Keep `db:*` scripts working.
- Styling: Tailwind CSS 4 + shadcn/ui conventions (`cn()` from `src/lib/utils.ts`), `lucide-react` icons, `framer-motion` motion, charts via `recharts`.
- State: server state via `@tanstack/react-query` (see `providers.tsx`); cross-tab client state via zustand (`agent-store.ts`).
- Root `package.json` owns commands: `bun run dev` (port 3000), `bun run build`, `bun run start`, `bun run lint`.

## Work Guidance

- Run the dev dashboard with `bun run dev` (logs tee to root `dev.log`); it expects the engine on `:3030` for live data.
- Match the existing file naming: tab surfaces `*-tab.tsx`, shared fragments in `bits.tsx`, detail views `run-detail.tsx`.
- Type every engine payload through `agent-types.ts` — no `any` against API responses.
- Keep tabs self-contained: each `*-tab.tsx` owns its query hooks and render; shared pieces graduate to `bits.tsx`.

## Verification

- `bun run lint` (eslint + eslint-config-next) — must be clean; CI (`.github/workflows/ci.yml`) enforces it on push/PR.
- Dashboard responds 200 on `http://localhost:3000/dashboard` with live KPIs and no console errors when the engine is up.

## Child DOX Index

- `src/components/dashboard/AGENTS.md` — the 7-tab UI surfaces and shared fragments
- `src/lib/AGENTS.md` — engine API client, types, state, SSE
