# Landing page (src/)

## Purpose

The marketing landing page: a single Next.js 16 App Router route served at `/` and auto-deployed to Vercel on every push to `main`. Since the web dashboard was retired (D7), this is the ONLY app surface in `src/` — one page, its stylesheet, the landing components, one vendored UI primitive, and one utility with its test. Mission control is not here: it is the `unown dashboard` TUI (built on pi-tui, living in `pi-repo/packages/self-learning/src/dashboard/`); the engine it talks to is documented in `docs/detached-engine-architecture.md`.

## Ownership

- Owns: `src/app/` (the route + layout + the two stylesheets), `src/test-dom-setup.ts`, `src/types/bun-test.d.ts` and this doc. (`src/hooks/` and the dashboard trees it served were removed with the web dashboard — D7.)
- Children own: `src/components/landing/` (every band of the page — its own contract doc is the authority). `src/lib/` (`utils.ts` + test) has no child doc — it is covered by this file.
- `src/components/ui/` is down to ONE vendored shadcn/ui primitive — `accordion.tsx`, the FAQ's disclosure. Treat as generated code; do not hand-edit, regenerate via the shadcn CLI instead. (The other 47 primitives, the Toaster mount and `use-toast` left with the web dashboard.)

## Local Contracts

- `src/app/page.tsx` is **composition only** — every section lives in `src/components/landing/`, which owns its own contract doc (bands, palette usage, honesty rules, the generated data files). Section order in `page.tsx` is the page's argument; `NAV_LINKS` in `shell.tsx` mirrors the anchors.
- `src/app/layout.tsx` loads the five fonts (Geist + Geist Mono for body, Press Start 2P / Pixelify Sans / VT323 for the retro chrome), owns the theme bootstrap and the OpenGraph metadata. Its OG image set names the tracked `public/landing/landing-hero.png` screenshot AND `/landing/tui/dashboard/stills/01-overview.png` (a real TUI still — that file belongs to the `scripts/tui-capture/` lane, not to a landing screenshot script); `landing-full.png` / `landing-mobile.png` are tracked screenshots the same script keeps current but the metadata does not name. There is no providers wrapper anymore: the Toaster mount and `DashboardProviders` left with the dashboard; the page wraps itself in `LandingMotion` (reduced-motion handling) inside `page.tsx`.
- The landing palette (`bg-canvas`, `bg-panel`, `text-ink`, `text-dim`, `border-line`, the accents `text-gold` / `text-gold-soft`, and the five section hues `gold|aqua|magma|leaf|psychic`, each with a `-field`) lives in `src/app/globals.css`, not in `landing.css` — Tailwind only resolves `@theme` in the file that pulls in `tailwindcss`. The tokens sit in a **non-inline** `@theme` block — Tailwind emits `var(--color-…)` for it, which is what lets the cascade repaint them at runtime — carrying the dark scheme as the `:root` default plus TWO light blocks that must stay identical (the `prefers-color-scheme` one and `[data-theme="light"]`); only the three font tokens are `@theme inline`. Theming is a `data-theme` attribute on `<html>` (plus `prefers-color-scheme` for the auto default), **not** a `.dark` class — never add `dark:` variants to landing markup.
- `tailwind.config.ts` is deliberately absent: Tailwind CSS 4 is configured through the CSS (`@import "tailwindcss"` + `@theme` in `globals.css`). Do not reintroduce a JS config file.
- Styling: Tailwind CSS 4 conventions, `cn()` from `src/lib/utils.ts` (clsx + tailwind-merge — the one runtime helper), `lucide-react` icons, `framer-motion` motion, `fuse.js` for the dex's search. No charting, no react-query, no zustand — those left with the dashboard; the page is a static marketing surface whose only network call is the wrapped star-count fetch.
- Root `package.json` owns commands: `bun run dev` (landing dev server on :3000), `bun run build`, `bun run start` (`next start`), `bun run lint`, `bun run typecheck`, `bun run test:unit` (`bun test src`), `bun run test:coverage`, the `check:changelog` / `check:benchmarks` / `check:claims` / `check:docs` gates and `audit:landing`. `agent:start`/`agent:stop` (bridge + engine) are NOT this tree's business — see `scripts/AGENTS.md`.
- `src/types/bun-test.d.ts` — ambient `bun-types` loader so `tsc --noEmit` resolves the `bun:test` imports of the in-tree `*.test.ts` files (the `@types/bun` shim package is deliberately not a dependency).
- `src/test-dom-setup.ts` — the happy-dom global registrator the root `bunfig.toml` preloads for `bun test src`.

## Work Guidance

- Run the dev server with `bun run dev`; it is the LANDING PAGE (no engine, no dashboard — nothing else is served from this tree anymore).
- The page's own rules — bands, hues, the no-fabrication argument, generated data files, motion and a11y contracts — live in `src/components/landing/AGENTS.md`; read it before touching anything in that folder. The research record behind the page's design decisions is `docs/landing-research.md`.
- The stills the showcase frames (`public/landing/tui/dashboard/stills/*.png`) are real `unown dashboard` PTY captures. Never re-create them with a browser screenshot script; regenerate via the `scripts/tui-capture/` lane.
- Keep the two generated-data surfaces out of hand edits: `changelog-data.ts`, `benchmarks-data.ts` and `engine-data.ts` are written by their `scripts/landing_*.mjs` generators (see `scripts/AGENTS.md`).
- Match the existing shape: one band per file in `src/components/landing/`, shared primitives in `shell.tsx`, effects in `effects.tsx`. There is no `bits.tsx` / `*-tab.tsx` layer anymore — that was the dashboard's.

## Verification

- `bun run lint` (eslint + eslint-config-next) — must be clean; CI (`.github/workflows/ci.yml`) enforces lint (`Lint (landing)`), `bun run typecheck` (`Typecheck (landing)`), `bun test src` (`Unit tests (landing)` — the count moves with every pin, so it is not restated here) and the changed-line coverage gate on push/PR.
- `bun run build` — exit 0; `/` must prerender, and the standalone server must answer 200 on `/` (CI's `Production build (landing)` job does exactly this smoke on a scratch port).
- The e2e lane is landing-scoped: `e2e/a11y.spec.ts` (axe-core WCAG 2.0/2.1 A+AA, two motion passes) + `e2e/landing-budget.spec.ts` — 3 tests, run by CI's `E2E + a11y (landing)` job.
- Landing work additionally requires a visual pass against a production build, a reduced-motion pass, and the palette gates — see `src/components/landing/AGENTS.md` (Verification) and `scripts/AGENTS.md`.
- Vercel deployment rules live in root `AGENTS.md`; `bun scripts/verify-deploy.mjs` asserts the live deployment after any push to `main`.

## Child DOX Index

- `src/components/landing/AGENTS.md` — the marketing page: the Unown script, the lexicon, bands, effects, the honesty/generation rules and the motion contracts
