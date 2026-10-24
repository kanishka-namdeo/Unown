# Landing page (src/)

## Purpose

The marketing landing page: a single Next.js 16 App Router route served at `/` and auto-deployed to Vercel on every push to `main`. Since the web dashboard was retired (D7), this is the ONLY app surface in `src/` — one page, its stylesheets, the landing components, one vendored UI primitive, and one utility with its test. Mission control is not here: it is the `unown dashboard` TUI (pi-tui stack, `pi-repo/packages/self-learning/src/dashboard/`); the engine it talks to is documented in `docs/detached-engine-architecture.md`.

## Ownership

- Owns: `src/app/` (the route, layout, `robots.ts`, `sitemap.ts`, the two stylesheets, `__tests__/`), `src/test-dom-setup.ts`, `src/types/bun-test.d.ts`, `src/lib/` (`utils.ts` + test — no child doc needed) and this doc.
- Children own: `src/components/landing/` (every band of the page — its own contract doc is the authority).
- `src/components/ui/` is down to ONE vendored shadcn/ui primitive — `accordion.tsx`, the FAQ's disclosure. Treat as generated code; do not hand-edit, regenerate via the shadcn CLI instead.

## Local Contracts

- `src/app/page.tsx` is **composition only** — every section lives in `src/components/landing/`, which owns its own contract doc (bands, palette usage, honesty rules, generated data files). Section order in `page.tsx` is the page's argument; `NAV_LINKS` in `shell.tsx` mirrors the anchors.
- `src/app/layout.tsx` loads the five fonts (Geist + Geist Mono for body, Press Start 2P / Pixelify Sans / VT323 for the retro chrome), owns the theme bootstrap (inline `THEME_INIT` replaying `localStorage.unown-theme` before paint) and the metadata: canonical `/`, robots with `max-image-preview:large` / `max-snippet:-1`, exactly ONE `og:image` with width/height (crawlers reliably use the first), twitter `summary_large_image`.
- `src/app/robots.ts` serves `/robots.txt` by Next convention (one rule group + Sitemap line derived from `SITE`); `src/app/sitemap.ts` serves `/sitemap.xml` with exactly one URL whose `lastModified` is the newest CUT release date from the generated `CHANGELOG_STOPS` — never `new Date()`, never `[Unreleased]`. A static `public/robots.txt` and the convention route must not both exist.
- The landing palette (`canvas`, `panel`, `panel-2`, `line`, `line-bright`, `ink`, `dim`, `faint`, `gold`, `gold-soft`, `amber`, `poke` + the five section hues `gold|aqua|magma|leaf|psychic` each with a `-field`) lives in the **non-inline** `@theme` block of `src/app/globals.css` — that is what lets the cascade repaint tokens at runtime. It carries the dark scheme as the `:root` default plus TWO light blocks that must stay identical (`prefers-color-scheme` and `[data-theme="light"]`); only the three font tokens are `@theme inline`. Theming is a `data-theme` attribute on `<html>`, **not** a `.dark` class — never add `dark:` variants to landing markup. Every `--color-*` literal sits on the GBA 5-bit grid (`floor(255·v/31)`).
- `tailwind.config.ts` is deliberately absent: Tailwind CSS 4 is configured through the CSS. Do not reintroduce a JS config file.
- Styling: Tailwind CSS 4 conventions, `cn()` from `src/lib/utils.ts` (the one runtime helper), `lucide-react` icons, `framer-motion` motion, `fuse.js` for the dex search. The page is a static marketing surface whose only network call is the wrapped star-count fetch (`star-count.tsx`, ISR `revalidate: 3600`, silent fallback — it must never fail a build).
- Root `package.json` owns commands: `bun run dev` (landing dev server on :3000), `bun run build`, `bun run start`, `bun run lint`, `bun run typecheck`, `bun run test:unit`, `bun run test:coverage`, the `check:*` gates and `audit:landing`. `agent:start`/`agent:stop` are NOT this tree's business — see `scripts/AGENTS.md`.
- `src/types/bun-test.d.ts` — ambient `bun-types` loader so `tsc --noEmit` resolves `bun:test` imports; `src/test-dom-setup.ts` — the happy-dom global registrator the root `bunfig.toml` preloads for `bun test src`.

## Work Guidance

- Run the dev server with `bun run dev`; it is the LANDING PAGE only.
- The page's own rules — bands, hues, the no-fabrication argument, generated data files, motion and a11y contracts — live in `src/components/landing/AGENTS.md`; read it before touching anything in that folder. The research record behind the page's design is `docs/landing-research.md`.
- The stills the showcase frames (`public/landing/tui/dashboard/stills/*.png`) are real `unown dashboard` PTY captures. Never re-create them with a browser screenshot script; regenerate via the `scripts/tui-capture/` lane.
- Keep the three generated-data surfaces out of hand edits: `changelog-data.ts`, `benchmarks-data.ts`, `engine-data.ts` are written by their `scripts/landing_*.mjs` generators.
- Match the existing shape: one band per file in `src/components/landing/`, shared primitives in `shell.tsx`, effects in `effects.tsx`.

## Verification

- `bun run lint` and `bun run typecheck` — must be clean; CI enforces both plus `bun test src` (the unit count moves with every pin, so it is not restated here) and the changed-line coverage gate (>= 80% of touched `src/` lines).
- `bun run build` — exit 0; `/` must prerender, and the standalone server must answer 200 on `/` (CI's build job does this smoke on a scratch port).
- The e2e lane is landing-scoped (`e2e/`): axe-core a11y in both motion states, the scroll budget, the dex video decode gate and the SEO surface.
- Landing work additionally requires a visual pass against a production build, a reduced-motion pass, and the palette gates — see `src/components/landing/AGENTS.md` (Verification) and `scripts/AGENTS.md`.
- After any push to `main`, `bun scripts/verify-deploy.mjs` asserts the live Vercel deployment.

## Child DOX Index

- `src/components/landing/AGENTS.md` — the marketing page: bands, the Unown script and lexicon, generated data, media assets, honesty rules, motion and a11y contracts
