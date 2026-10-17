# Scripts (scripts/)

## Purpose

Two kinds of content live here: (1) the project's bootstrap/lifecycle scripts wired into root `package.json` (`agent:install` / `agent:start` / `agent:stop` / `agent:link`), and (2) verification artifacts from the sessions that configured the Dashscope endpoint and hardened the sandbox — probes, captured search results, and dashboard screenshots kept as evidence. A third group is the README asset pipeline that regenerates the repo's brand + screenshot assets into `.github/assets/`.

The lifecycle scripts are cross-platform bun TypeScript (`install.ts`, `link.ts`, `start.ts`, `stop.ts`, `serve-dashboard.ts`, shared `lib.ts`) — the same commands on Windows/macOS/Linux. The old `.sh` files remain as thin POSIX wrappers (`exec bun scripts/<name>.ts "$@"`) for muscle memory; the `.ts` files are the single source of truth. `dev-all.sh` is POSIX-only (dev convenience; header says so).

## Ownership

- Owns: the lifecycle scripts (`install.ts`, `link.ts`, `start.ts`, `stop.ts`, `serve-dashboard.ts`, `lib.ts` + their `.sh` wrappers; `dev-all.sh` POSIX-only), the verification artifacts (`probe_*.py`, `test_bridge.py`, `search_*.json`, `modelsdev.json`, `dash_*.png`), the README asset pipeline (`scripts/brand/` HTML sources, `shots_capture.mjs`, `brand_render.mjs`, `mermaid_check.mjs`, `vlm_review.mjs`, `curate_assets.mjs`), and the landing-page verification gates (`gba_palette_check.mjs`, `landing_shots.mjs`, `contrast_audit.mjs`, `theme_toggle_check.mjs`, `landing_og_shots.mjs`).
- Sandbox-template artifacts also parked here (NOT part of Unown): `init-fullstack.sh`, `scaffold.tar` — installed by the hosting sandbox, tracked only for provenance.

## Local Contracts

- `install.ts` (wrapper: `install.sh`) — one-time bootstrap: verify bun ≥ 1.2 (per-OS install hint) → root `bun install` → `pi-repo` `bun install` → **auto-hydrate `pi-repo/packages/ai/src/providers/data` when it has zero `*.json`** (it is gitignored upstream — without this step fresh clones cannot `build:offline`; staleness is not detectable offline, a non-empty dir is trusted) → `pi-repo` `bun run build:offline` → copies `.env.example` → `.env` when missing (template carries no secrets) → runs `link.ts` unless `UNOWN_NO_LINK=1` (link failure is not fatal) → prints next steps that flag a missing `BRIDGE_UPSTREAM_KEY` as REQUIRED (chats fail with 401 without it). Step failures exit with the child's exit code.
- `link.ts` (wrapper: `link.sh`) — puts `unown` on PATH. POSIX: bash shim (`exec <bun> <repo>/bin/unown "$@"`, chmod 0755) in the first writable dir of `UNOWN_BIN_DIR`, `~/.local/bin`, `~/bin`, `/usr/local/bin`, warning with the exact profile line when the dir is not on PATH. Windows: `unown.cmd` + `unown.ps1` shims into `%USERPROFILE%\.local\bin`, user-PATH append via PowerShell `[Environment]::SetEnvironmentVariable(…,'User')` (never `setx` — 1024-char truncation), restart-terminal hint. A shim (not `bun install -g .`) is the supported global-install path: it keeps the vendored pi-repo workspace resolution and subagent spawning intact (`process.argv[1]` stays the repo copy). Run via `bun run agent:link`; re-run after moving the repo (idempotent — shims are overwritten cleanly).
- `start.ts` (wrapper: `start.sh`) — parses root `.env` (`set -a; . ./.env` semantics — bun does NOT read the repo-root `.env` from a mini-services cwd, so the launcher exports it into every child) and starts llm-bridge (:3031), engine (:3030), dashboard (:3000, via the `dev` package script) as detached processes (new session on POSIX, `detached+windowsHide` on Windows) that SURVIVE the launcher's exit; pidfiles in `.run/`, logs `.run/<name>.log`; reuses an already-healthy bridge/zai-upstream instead of dying with EADDRINUSE; zai-upstream only starts when `BRIDGE_UPSTREAM_URL` contains `127.0.0.1:3032`; health polling (fetch, ~60s) then reads the bridge `/health` payload and prints a loud warning when `upstreamKeyIsSet` is false or the upstream probe is unhealthy (plus an honest "still DOWN" line naming stragglers and their logs).
- `stop.ts` (wrapper: `stop.sh`) — halts by pidfile (SIGTERM on POSIX, `taskkill /F /T` tree-kill on Windows), then stray sweeps: `pkill -f "next dev"` / `tee dev.log` on POSIX, and the `/proc/$pid/cwd` bun-service sweep on Linux ONLY, scoped to THIS checkout (never kills another worktree's stack). **Exits 1 when nothing was running, 0 when it stopped something** (changed from the old .sh, which always exited 0 — chain round-trips with `;`, not `&&`).
- `serve-dashboard.ts` — the `start` package script: sets `NODE_ENV=production`, spawns `bun .next/standalone/server.js`, tees output to the console and `server.log`, forwards SIGINT/SIGTERM, propagates the exit code.
- `lib.ts` — shared helpers (bun resolution, `.env` parser, spawnSync runner, liveness probe, HTTP probes, per-OS console glyphs: ASCII on win32). Every lifecycle script imports it; keep it dependency-free (node: builtins only).
- Probe contract: probes hit the upstream endpoint directly or through the bridge and use `BRIDGE_UPSTREAM_KEY`-style env from the root `.env` — they must never hardcode keys.
- `search_*.json` / `modelsdev.json` are captured research data (model strengths comparison, models.dev snapshot) that justified the model assignment — treat as read-only evidence. `search_sb_*.json` are the sandbox-landscape research (bubblewrap/Claude Code/Codex/E2B/Daytona) that justified the OS-sandbox selection; `bubblewrap_*.deb` is the provenance package for the vendored `pi-repo/packages/self-learning/native/bin/bwrap` (see that package's `native/README.md`).
- Provider-mark contract: `vendor-provider-marks.mjs` regenerates
  `src/components/landing/provider-marks.tsx` from the CC0 SVGs in
  `download/providers/` (gitignored; refetch from the pinned Simple Icons CDN
  first). Labels live in the script, path data is lifted from the SVG — never
  hand-edit the generated component, and never hotlink the CDN at runtime.
- Deployment contract: `verify-deploy.mjs` asserts the **live** deployment, not
  the local build: `bun scripts/verify-deploy.mjs [url]` (defaults to the
  production alias, exits non-zero on failure). It checks the routes, that the
  served page is the page we wrote, that the no-JS safety net is present **and**
  not hoisted to `<head>`, that the accessibility regressions have not returned,
  that nothing cross-origin is loaded, and that the CSS bundle still carries the
  palette, grain, scroll motion and the reduced-motion block. Run it after any push
  to `main`: Vercel auto-deploys, and a green local build does not mean the deploy
  landed. Two traps it already handles, so do not reintroduce them — its CSS probes
  are whitespace-insensitive because the production bundle is minified, and it
  distinguishes `src=` subresources from `href=` hyperlinks. A Bulbapedia link in a
  sources list is the attribution rule working, not an asset leak.
- Landing verification contract (the palette + visual + contrast gate for
  `src/components/landing/`). `gba_palette_check.mjs` reads the CSS and needs
  neither browser nor server; the other three need the production standalone
  server, not the dev server, because that is what Vercel serves:
  - `gba_palette_check.mjs` — the palette's static gate: `bun scripts/gba_palette_check.mjs`
    from the repo root; reads `src/app/globals.css`, `src/app/landing.css` and
    `src/components/landing/`, exits non-zero. Six rules: every `--color-*` literal is one
    of the 32 values a 5-bit GBA channel holds (`floor(255*v/31)` — `#ffffff` legal,
    `#f8f8f8` not); the two light-scheme blocks (the `prefers-color-scheme` one and
    `[data-theme="light"]`) stay declaration-identical; every required token role exists and
    every `data-hue`/`data-tone` a component declares is implemented in the CSS; each text
    token clears AA 4.5:1 against all 43 surfaces per scheme (the three neutrals, the five
    section fields, and every `/10` tint chip composited over each field — gate each accent
    against EVERY field, not only its own); stale DMG / Super Game Boy vocabulary (`glow`,
    `sgb-*`, `--gb-scanline`, `.crt`) is gone; landing components hold **zero** hex
    literals. It recomputes the contrast table quoted in `globals.css` and the landing doc,
    so prose cannot drift from CSS. No browser or server means it is the only landing
    palette gate CI can run, and `ci.yml`'s `landing-palette` job runs it on every
    push and PR, so run it first.
  - `landing_shots.mjs` — photographs the page: derives its section plan from
    the DOM (a section you add is photographed without editing the script),
    shoots every top-level section **in both colour schemes** (dark names
    unprefixed, light `light-*`), plus a reduced-motion pass, and with
    `--mobile` a 390px pass, into `download/landing/`. Each scheme pass asserts
    `--color-canvas` resolved to that scheme's hex before shooting, so a
    "light" pass cannot silently photograph the dark palette. Exits non-zero
    on any console error. `LANDING_SHOTS_URL` overrides the base URL (default
    `http://localhost:3111`). Screenshots must be LOOKED at — a green run that
    nobody viewed is not a visual check.
  - `contrast_audit.mjs` — WCAG AA measured on the rendered page: **walks both
    colour schemes** (emulates `prefers-color-scheme` dark then light, asserting
    `--color-canvas` matched each scheme's expected hex), walks every visible
    text node, resolves its computed colour and the composited background
    actually behind it, and exits non-zero on any failure below 4.5:1 (3:1 for
    large text). Report lands in `download/landing/contrast_report.json`. Two
    traps it already handles, do not reintroduce them: colours must be
    normalised by painting a pixel and reading bytes (Chromium serialises
    computed colours as `lab()` and `fillStyle` readback as hex, so an `rgb()`
    regex matches nothing and the audit silently "passes" by scanning zero
    nodes), and the scratch canvas must be cleared before each paint or
    translucent colours composite over the previous sample.
  - `theme_toggle_check.mjs` — the nav theme switch's own gate (contrast_audit
    cannot cover it: it drives `prefers-color-scheme`, the toggle writes a
    `[data-theme]` attribute). Clicks through auto → daylight → dark → auto
    asserting the attribute, resolved `--color-canvas`, and
    `localStorage.unown-theme` agree at every step; checks a forced choice
    survives reload (the inline `<head>` bootstrap's job) and the `aria-label`
    announces state. Same `LANDING_SHOTS_URL` base URL; non-zero on failure.
  - `landing_og_shots.mjs` — regenerates the TRACKED OpenGraph images in
    `public/landing/` (`landing-hero.png`, `landing-full.png`,
    `landing-mobile.png`) that `layout.tsx` names. These are screenshots of the
    landing page, so they go stale the moment its palette moves. Runs against
    the production standalone server like the other three, asserts
    `--color-canvas` resolved to the dark scheme's hex before each shot (so it
    cannot silently re-bake a retired palette), scrolls the document so every
    reveal settles to its finished state, warns on horizontal overflow, and
    exits non-zero on a console error. It was previously the gitignored
    `download/capture_public_shots.mjs` while its outputs were tracked — i.e. a
    published asset with no committed generator.
- Sandbox verification contract: `bwrap_smoke.sh` (profile-level isolation suite, 25 checks; invokes the vendored `pi-repo/packages/self-learning/native/bin/bwrap` directly) and `verify_sandbox.mjs` (engine-level integration suite, 12 checks) must both be fully green before committing changes to the OS sandbox or refreshing the vendored bwrap binary.
- Theme verification contract: `check_theme.mjs` validates the unown brand theme (`pi-repo/packages/self-learning/src/theme.ts`) against pi's theme schema (51 required color tokens, value formats, var resolution) — run it after any palette change.
- New ad-hoc verification scripts go here (not `/tmp`) when their results matter to the worklog; keep them re-runnable.
- README asset pipeline contract (the brand HTML SOURCES are tracked in `scripts/brand/`; rendered intermediates and screenshot captures go to gitignored `download/brand/` + `download/shots/`; final outputs are tracked in `.github/assets/`):
  - `shots_capture.mjs` — dashboard screenshots via headless chromium. Browses the PRODUCTION dashboard behind the Caddy gateway (`SHOTS_BASE_URL=http://127.0.0.1:81 SHOTS_NO_PROXY=1 bun scripts/shots_capture.mjs --video`) so relative `/api?XTransformPort=3030` calls — including the SSE stream — route to the engine same-origin (dev mode breaks on the gateway's HMR websocket; the `engineProxy` browser-layer replay is the dev-mode fallback). Hides transient toasts/dev chrome, triggers the non-LLM `note-sync` + `sandbox-gc` router jobs after SSE connects so the Live Activity feed shows real events (disable with `SHOTS_NO_TRIGGER=1`), never clicks LLM-spending buttons. Requires the scratch playwright install in `download/.pwtools/` + chromium in `~/.cache/ms-playwright/`.
  - `brand_render.mjs` — renders the tracked sources `scripts/brand/{banner,social}.html` (Geist / Geist Mono via Google Fonts, needs network) into gitignored `download/brand/`: `banner.png` (3232x840, 1616x420 @ dsf 2) and `social@2x.png` (2560x1280, 1280x640 @ dsf 2). Sources are in git on purpose — the PNGs under `.github/assets/` have to stay regenerable from a clean checkout, and `download/` is not.
  - `scripts/brand/*.html` — the Gen 3 re-skin of the README identity. Both files carry a header comment naming the palette and the 5-bit rule; every colour channel in them (hex and `rgb()` alike, alpha excluded) must be one of the 32 values `floor(255*v/31)` admits, matching `src/app/globals.css`. `scripts/gba_palette_check.mjs` gates the CSS only, so these two files are self-policed — re-check them by hand after any edit. Content is frozen: mark, `unown`, the tagline, and the five capability strings.
  - `mermaid_check.mjs` — parses + locally renders the two README Mermaid diagrams (mermaid@11, default theme, exactly GitHub's rendering path); the diagram sources in this file and in `README.md` MUST stay byte-identical.
  - `vlm_review.mjs` — design QA loop: sends images to the local bridge (`qwen3.7-plus`, thinking off) for terse PASS/FIX critiques.
  - `curate_assets.mjs` — stages the final set: banner, logo.svg (mirrored from `public/logo.svg`, keep the two byte-identical), social-preview.png (downscaled to exactly 1280x640, must stay <1 MB for GitHub), tour.gif (ffmpeg from the tour webm, 720px/9fps/palette), and top-crops of the tall full-page tab shots. Every step SKIPS a missing source instead of throwing, so a checkout with the brand HTML but no `download/shots/` still stages the brand pair without touching the tracked dashboard crops.
  - Refresh order: rebuild dashboard (`bun run build` + `bun run start`) → shots_capture → ffmpeg GIF → curate_assets. Verify README image references still resolve afterwards. Brand-only refresh (no dashboard needed): `bun scripts/brand_render.mjs` → `bun scripts/curate_assets.mjs`, then LOOK at the regenerated `banner.png` / `social-preview.png` and at an 880px-wide downscale — the banner's contract is that it reads at GitHub's rendered width.

## Work Guidance

- Run product scripts only via their npm aliases (`bun run agent:install|start|stop|link`) so cwd + `.env` loading behave as designed. The commands are identical on Windows/macOS/Linux (bun runs the TS; the `.sh` twins are POSIX compat wrappers).
- Keep the TS lifecycle scripts runnable from any cwd (they resolve the repo root from `import.meta.dir`), dependency-free (node: builtins + `lib.ts` only), and label-free in `.cmd` files (goto + LF endings is a cmd parser trap).
- Keep bash wrappers thin: `exec bun "$(dirname "$0")/<name>.ts" "$@"` and nothing else.
- `set -euo pipefail` + `cd "$(dirname "$0")/.."` remains the pattern for any NEW standalone bash (POSIX-only) scripts.

## Verification

- `bash -n scripts/*.sh` (syntax — the wrappers must stay valid bash) — cheap gate before committing script changes.
- `bun scripts/install.ts` from a clean worktree must go green end-to-end (includes first-run model-data hydration).
- `bun run agent:stop; bun run agent:start` round trip: all three services healthy (see mini-services doc for endpoints). Use `;` — stop exits 1 when nothing was running.
- `bun scripts/link.ts` with `UNOWN_BIN_DIR=/tmp/x` then re-run: idempotent overwrite, PATH warning, executable shim.

## Child DOX Index

(none — flat directory)
