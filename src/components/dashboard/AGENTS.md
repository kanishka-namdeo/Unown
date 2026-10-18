# Dashboard components (src/components/dashboard/)

## Purpose

The tab surfaces of the mission-control dashboard — the user-facing window onto the engine: live KPIs, harness cycles, memory versions, dreams, hook decisions, an interactive sandboxed console, sandbox workspace inspection, the LLM gateway request log, and router job controls.

## Ownership

- Owns every `*-tab.tsx` surface plus the shared pieces: `bits.tsx` (fragments), `header.tsx`, `providers.tsx` (react-query + toast providers + the SSE bridge), `run-detail.tsx`, `task-detail.tsx`, `activity-feed.tsx`, `command-palette.tsx` (⌘K), `tab-store.ts` (URL-synced tab state).
- Does not own: shadcn primitives (parent `src/components/ui/` — vendored, do not hand-edit), data access (`src/lib/`), route composition (`src/app/dashboard/page.tsx`).

## Local Contracts

- Tab set (composed in `src/app/dashboard/page.tsx`, synced to `?tab=` via `tab-store.ts`): `overview-tab` (pass rate incl. error counts, learning-suite KPI with saturated badge, shipped improvements, dreams, memory version, hook decisions, token usage; benchmark task rows carry seed/minted + capability/regression provenance badges, task names open `task-detail.tsx`, and the "Mint task" button drives `POST /api/tasks/mint` with per-outcome toasts), `learning-lab-tab` (baseline → diagnosis → patch → candidate → ship/reject cycles with transcripts; improvement cards link their baseline/candidate evidence runs into `run-detail.tsx` and show the shipped memory version), `memory-tab` (4 tiers + version history + rollback + AutoDream-minted Agent Skills with status badges, per-skill version history via `GET /api/skills/:id`, restore-to-any-version and retire confirm actions), `dreams-tab` (AutoDream sessions + the notes pipeline: manual note delivery `POST /api/notes` and outbox sync `POST /api/notes/sync`), `hooks-tab` (guardrail decision log), `console-tab` (drive the sandboxed agent — transcript lines stream live from `run:tool`/`run:text` SSE frames via `useRunStreamStore`, with the 3s poll as fallback; prompt clears on submit; the run-search gives up after 25s), `sandboxes-tab` (isolated workspace inventory from `GET /api/sandboxes`), `gateway-tab` (LLM bridge request log from `GET /api/bridge`: KPI row, per-model breakdown, latency chart, request table), `router-tab` (background jobs: toggle-with-confirm, trigger, next-fire).
- Every fetch/SSE subscription goes through `src/lib/agent-api.ts` helpers; every payload type comes from `src/lib/agent-types.ts`.
- Presentation conventions: shadcn `Card`/`Tabs`/`Badge` composition, `lucide-react` icons, `recharts` for charts, `framer-motion` for motion, timestamps formatted via `src/lib/agent-format.ts` helpers (hand-rolled; `date-fns` is a transitive dep only).
- Live updates: subscribe to the engine SSE stream (`EVENTS_URL` from `agent-api.ts`) and invalidate react-query caches on events (`providers.tsx` owns the event → query-key map, including the skill/task/mint/notes-sync/regression fan-outs and `run:finished` → `qk.bridge`); do not poll where SSE exists — polls are the fallback, not the data path.
- The `providers.tsx` invalidation map and `describe()` activity text must cover every engine event family the bus emits (see `pi-repo/packages/self-learning/src/server.ts`); new engine events land there in the same change.
- `command-palette.tsx` owns the ⌘K/Ctrl-K shortcut, the navigate/refresh/links actions and its open state store; tab jumps go through `tab-store.ts`, never direct router calls.
- Keyboard access: every clickable row/card that opens a detail surface (run rows, memory tier cards, task names) is focusable and Enter/Space activatable.

## Work Guidance

- Add a new dashboard surface as `<name>-tab.tsx`, register it in `src/app/dashboard/page.tsx` tabs list AND `tab-store.ts` `DASHBOARD_TABS`, keep its queries local to the file.
- Extract only genuinely shared UI into `bits.tsx`; single-call-site fragments stay inline.
- Destructive actions exposed here (memory rollback, job toggles, dream runs, skill retire/restore) must confirm with the user first in the UI.
- Loading states are skeletons (`ui/skeleton`), never zeroed fake data; engine-down surfaces as the header's `role=alert` banner (query `isError`), not a toast.

## Verification

- Lint: `bun run lint` from the repo root (see `src/AGENTS.md`).
- Unit: `bun test src` — every tab has happy/empty/error + mutation suites; new surfaces ship with their own `__tests__/<name>-tab.test.tsx`.
- Browser check on `http://localhost:3000/dashboard` with the engine running: tab switches (also via `?tab=` and ⌘K), SSE updates arrive, no console errors.

## Child DOX Index

(none — flat component directory)
