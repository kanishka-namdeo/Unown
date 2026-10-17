# Dashboard (src/)

## Purpose

The mission-control dashboard: a single-page Next.js 16 App Router client that visualizes and drives the self-learning engine — 7 tabs (Overview, Learning Lab, Memory, Dreams, Hooks, Console, Router) fed by live SSE from `:3030`.

## Ownership

- Owns: `src/app/` (routes + layout), `src/hooks/`, and this doc.
- Children own: `src/components/landing/` (the marketing page at `/`), `src/components/dashboard/` (tab UI surfaces) and `src/lib/` (engine client + types + state) — see Child DOX Index.
- `src/components/ui/` is vendored shadcn/ui primitives — treat as generated code; do not hand-edit, regenerate via the shadcn CLI instead.

## Local Contracts

- Entry composition lives in `src/app/dashboard/page.tsx` (`DashboardProviders` + `Header` + the seven `*-tab.tsx` surfaces in a shadcn `Tabs`). Adding a tab = new component in `src/components/dashboard/`, registered in `src/app/dashboard/page.tsx`.
- `src/app/page.tsx` is the marketing landing page, not the dashboard, and it is **composition only** — every section lives in `src/components/landing/`, which owns its own contract doc. It imports `src/app/landing.css` for its stylesheet and the retro Game Boy Advance / Generation III palette (declared in `globals.css`, see below), which ships in two schemes: a dark Hoenn screen (default) and a light Kanto-daylight screen (via `prefers-color-scheme`, overridable by the nav toggle).
- The two pages deliberately look different: the dashboard keeps the cool zinc tokens because it is an application, and only the marketing page is retro (Game Boy Advance, Pokémon Generation III). Do not unify them.
- All engine data flows through `src/lib/agent-api.ts` (REST + SSE) and `src/lib/agent-types.ts` (schema types mirroring the engine's API). Components never fetch engines directly.
- Deployment modes (DIRECT vs GATEWAY) and all fetch/SSE URL handling live in `src/lib/agent-api.ts` — see `src/lib/AGENTS.md`; never hardcode engine URLs elsewhere.
- `src/lib/db.ts` + root `prisma/schema.prisma` are legacy scaffold (User/Post models, unused). Do not build features on them; live data comes from the engine API. Keep `db:*` scripts working (Prisma client contract: `src/lib/AGENTS.md`).
- Styling: Tailwind CSS 4 + shadcn/ui conventions (`cn()` from `src/lib/utils.ts`), `lucide-react` icons, `framer-motion` motion, charts via `recharts`.
- The landing palette (`bg-canvas`, `bg-panel`, `text-ink`, `text-dim`, `border-line`, the accents `text-gold` / `text-gold-soft`, and the five section hues `gold|aqua|magma|leaf|psychic`, each with a `-field`) lives in `src/app/globals.css`, not in `landing.css` — Tailwind only resolves `@theme` in the file that pulls in `tailwindcss`. The tokens sit in a **non-inline** `@theme` block — Tailwind emits `var(--color-…)` for it, which is what lets the cascade repaint them at runtime — carrying the dark scheme as the `:root` default plus TWO light blocks that must stay identical (the `prefers-color-scheme` one and `[data-theme="light"]`); only the three font tokens are `@theme inline`. Theming is a `data-theme` attribute on `<html>` (plus `prefers-color-scheme` for the auto default), **not** a `.dark` class — never add `dark:` variants to landing markup. The dashboard does not use these tokens.
- State: server state via `@tanstack/react-query` (see `providers.tsx`); cross-tab client state via zustand (`agent-store.ts`).
- Root `package.json` owns commands: `bun run dev` (port 3000), `bun run build`, `bun run start`, `bun run lint`, `bun run typecheck`, `bun run test:unit` (`bun test src`).
- `src/types/bun-test.d.ts` — ambient `bun-types` loader so `tsc --noEmit` resolves the `bun:test` imports of the in-tree `*.test.ts` files (the `@types/bun` shim package is deliberately not a dependency).

## Work Guidance

- Run the dev dashboard with `bun run dev` (logs tee to root `dev.log`); it expects the engine on `:3030` for live data.
- Match the existing file naming: tab surfaces `*-tab.tsx`, shared fragments in `bits.tsx`, detail views `run-detail.tsx`.
- Type every engine payload through `agent-types.ts` — no `any` against API responses.
- Keep tabs self-contained: each `*-tab.tsx` owns its query hooks and render; shared pieces graduate to `bits.tsx`.

## Verification

- `bun run lint` (eslint + eslint-config-next) — must be clean; CI (`.github/workflows/ci.yml`) enforces lint, `bun run typecheck` and `bun test src` on push/PR.
- Dashboard responds 200 on `http://localhost:3000/dashboard` with live KPIs and no console errors when the engine is up (and `/` returns the landing page).
- Keep `bun run build` passing; landing-page/Vercel deployment rules live in root `AGENTS.md`.
- Landing-page work additionally requires a visual pass against a production build and a reduced-motion pass — see `src/components/landing/AGENTS.md`. Any landing palette edit additionally keeps `bun scripts/gba_palette_check.mjs` green (no server needed — `scripts/AGENTS.md`).

## Child DOX Index

- `src/components/landing/AGENTS.md` — the marketing page: the Unown script, the lexicon, sections, effects and the motion rules
- `src/components/dashboard/AGENTS.md` — the 7-tab UI surfaces and shared fragments
- `src/lib/AGENTS.md` — engine API client, types, state, SSE
