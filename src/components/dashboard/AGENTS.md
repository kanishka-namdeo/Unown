# Dashboard components (src/components/dashboard/)

## Purpose

The tab surfaces of the mission-control dashboard — the user-facing window onto the engine: live KPIs, harness cycles, memory versions, dreams, hook decisions, an interactive sandboxed console, and router job controls.

## Ownership

- Owns every `*-tab.tsx` surface plus the shared pieces: `bits.tsx` (fragments), `header.tsx`, `providers.tsx` (react-query + toast providers), `run-detail.tsx`, `activity-feed.tsx`.
- Does not own: shadcn primitives (parent `src/components/ui/` — vendored, do not hand-edit), data access (`src/lib/`), route composition (`src/app/dashboard/page.tsx`).

## Local Contracts

- Tab set (composed in `src/app/dashboard/page.tsx`): `overview-tab` (pass rate, learning-suite KPI with saturated badge, shipped improvements, dreams, memory version, hook decisions, token usage; benchmark task rows carry seed/minted + capability/regression provenance badges), `learning-lab-tab` (baseline → diagnosis → patch → candidate → ship/reject cycles with transcripts), `memory-tab` (4 tiers + version history + rollback + AutoDream-minted Agent Skills with status badges, rollback-to-previous and retire confirm actions), `dreams-tab` (AutoDream sessions), `hooks-tab` (guardrail decision log), `console-tab` (drive the sandboxed agent, streaming transcript), `router-tab` (background jobs: toggle, trigger, next-fire).
- Every fetch/SSE subscription goes through `src/lib/agent-api.ts` helpers; every payload type comes from `src/lib/agent-types.ts`.
- Presentation conventions: shadcn `Card`/`Tabs`/`Badge` composition, `lucide-react` icons, `recharts` for charts, `framer-motion` for motion, timestamps formatted via `date-fns` + `src/lib/agent-format.ts` helpers.
- Live updates: subscribe to the engine SSE stream (`EVENTS_URL` from `agent-api.ts`) and invalidate react-query caches on events; do not poll where SSE exists.

## Work Guidance

- Add a new dashboard surface as `<name>-tab.tsx`, register it in `src/app/dashboard/page.tsx` tabs list, keep its queries local to the file.
- Extract only genuinely shared UI into `bits.tsx`; single-call-site fragments stay inline.
- Destructive actions exposed here (memory rollback, job toggles, dream runs) must confirm with the user first in the UI.

## Verification

- Lint: `bun run lint` from the repo root (see `src/AGENTS.md`).
- Browser check on `http://localhost:3000/dashboard` with the engine running: tab switches, SSE updates arrive, no console errors.

## Child DOX Index

(none — flat component directory)
