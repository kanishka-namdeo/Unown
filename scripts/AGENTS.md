# Scripts (scripts/)

## Purpose

Two kinds of content live here: (1) the project's bootstrap/lifecycle scripts wired into root `package.json` (`agent:install` / `agent:start` / `agent:stop`), and (2) verification artifacts from the sessions that configured the Dashscope endpoint and hardened the sandbox — probes, captured search results, and dashboard screenshots kept as evidence. A third group is the README asset pipeline that regenerates the repo's brand + screenshot assets into `.github/assets/`.

## Ownership

- Owns: `install.sh`, `start.sh`, `stop.sh` (product scripts), the verification artifacts (`probe_*.py`, `test_bridge.py`, `search_*.json`, `modelsdev.json`, `dash_*.png`), the README asset pipeline (`scripts/brand/` HTML sources, `shots_capture.mjs`, `brand_render.mjs`, `mermaid_check.mjs`, `vlm_review.mjs`, `curate_assets.mjs`), the landing-page verification gates (`gba_palette_check.mjs`, `landing_shots.mjs`, `contrast_audit.mjs`, `theme_toggle_check.mjs`, `landing_og_shots.mjs`), and the CI gate scripts (`check_coverage.mjs`, `coverage-exempt.txt`, `check_docs.mjs`).
- Sandbox-template artifacts also parked here (NOT part of Unown): `init-fullstack.sh`, `dev-all.sh`, `scaffold.tar` — installed by the hosting sandbox, tracked only for provenance.

## Local Contracts

- `install.sh` — one-time bootstrap: root `bun install` → `pi-repo` `bun install` → `pi-repo` `bun run build:offline` (offline skips the ai package's network model-data hydration) → copies `.env.example` → `.env` when missing (template carries no secrets) → runs `link.sh` unless `UNOWN_NO_LINK=1` → prints next steps that flag a missing `BRIDGE_UPSTREAM_KEY` as REQUIRED (chats fail with 401 without it).
- `link.sh` — puts `unown` on PATH: writes a shim (`exec bun <repo>/bin/unown "$@"`) into the first writable dir of `UNOWN_BIN_DIR`, `~/.local/bin`, `~/bin`, `/usr/local/bin`, warns when the dir is not on PATH. A shim (not `bun install -g .`) is the supported global-install path: it keeps the vendored pi-repo workspace resolution and subagent spawning intact (`process.argv[1]` stays the repo copy). Run via `bun run agent:link`; re-run after moving the repo.
- `start.sh` — loads root `.env` (`set -a`), starts llm-bridge (:3031), engine (:3030), dashboard (:3000) as background processes with pidfiles in `.run/`; after the health wait it reads the bridge `/health` payload and prints a loud warning when `upstreamKeyIsSet` is false or the upstream probe is unhealthy.
- `stop.sh` — halts by pidfile, falls back to pattern matching when stale.
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
- CI gate scripts contract (both run as plain `node`, zero dependencies, and both are `ci.yml` jobs — keep them dependency-free so the gate cannot rot when a package breaks):
  - `check_coverage.mjs` — the changed-line coverage gate. `node scripts/check_coverage.mjs --run [<git-base>]` spawns `bun test src --coverage` ITSELF and analyses the capture; passing a report file instead of `--run` analyses an existing one. It must keep doing the spawn rather than reading a redirected file: bun's shell has neither `>` nor `tee` on Windows, PowerShell's `>` writes UTF-16, and PowerShell's `Select-Object` masks exit codes. Invariants that must survive edits: (a) a red suite fails the gate; (b) an unparseable report or missing test summary is a HARD failure, never a silent pass; (c) a file with no row in the coverage table counts as 0% covered, not 100% (that inversion is how a gate becomes decorative); (d) an unresolvable git base warns and exits 0 rather than failing an unrelated push. Threshold lives in the script (`THRESHOLD = 80`, the "changed code >= 80% line" rule from `docs/testing-strategy.md` §9); exemptions live in `coverage-exempt.txt`, one path per line with a same-line justification, and every exemption is printed in the log. The script also writes `coverage.txt` (gitignored).
  - `check_docs.mjs` — `node scripts/check_docs.mjs docs/*.md` makes `docs/AGENTS.md`'s Verification rules runnable: relative `.md` targets exist, in-page anchors match a heading slug under GitHub's rule (lowercase, punctuation dropped, EACH space -> one hyphen), and cross-file anchors resolve. Its heading scan MUST split on `/\r?\n/` — this corpus is CRLF and `.` does not match `\r`, so a `\n` split silently matches nothing and reports every anchor as broken. `AGENTS.md` is exempt from the anchor and link-corruption heuristics (it quotes the artifacts: the bare `emory](` string and example labels like `[Inspecting memory](#inspecting-memory)`), but its file links are still checked. First line must stay a `//` comment: some node builds (this workspace's included) refuse to parse a module whose first byte is `#`.
- README asset pipeline contract (the brand HTML SOURCES are tracked in `scripts/brand/`; rendered intermediates and screenshot captures go to gitignored `download/brand/` + `download/shots/`; final outputs are tracked in `.github/assets/`):
  - `shots_capture.mjs` — dashboard screenshots via headless chromium. Browses the PRODUCTION dashboard behind the Caddy gateway (`SHOTS_BASE_URL=http://127.0.0.1:81 SHOTS_NO_PROXY=1 bun scripts/shots_capture.mjs --video`) so relative `/api?XTransformPort=3030` calls — including the SSE stream — route to the engine same-origin (dev mode breaks on the gateway's HMR websocket; the `engineProxy` browser-layer replay is the dev-mode fallback). Hides transient toasts/dev chrome, triggers the non-LLM `note-sync` + `sandbox-gc` router jobs after SSE connects so the Live Activity feed shows real events (disable with `SHOTS_NO_TRIGGER=1`), never clicks LLM-spending buttons. Requires the scratch playwright install in `download/.pwtools/` + chromium in `~/.cache/ms-playwright/`.
  - `brand_render.mjs` — renders the tracked sources `scripts/brand/{banner,social}.html` (Geist / Geist Mono via Google Fonts, needs network) into gitignored `download/brand/`: `banner.png` (3232x840, 1616x420 @ dsf 2) and `social@2x.png` (2560x1280, 1280x640 @ dsf 2). Sources are in git on purpose — the PNGs under `.github/assets/` have to stay regenerable from a clean checkout, and `download/` is not.
  - `scripts/brand/*.html` — the Gen 3 re-skin of the README identity. Both files carry a header comment naming the palette and the 5-bit rule; every colour channel in them (hex and `rgb()` alike, alpha excluded) must be one of the 32 values `floor(255*v/31)` admits, matching `src/app/globals.css`. `scripts/gba_palette_check.mjs` gates the CSS only, so these two files are self-policed — re-check them by hand after any edit. Content is frozen: mark, `unown`, the tagline, and the five capability strings.
  - `mermaid_check.mjs` — parses + locally renders the two README Mermaid diagrams (mermaid@11, default theme, exactly GitHub's rendering path); the diagram sources in this file and in `README.md` MUST stay byte-identical.
  - `vlm_review.mjs` — design QA loop: sends images to the local bridge (`qwen3.7-plus`, thinking off) for terse PASS/FIX critiques.
  - `curate_assets.mjs` — stages the final set: banner, logo.svg (mirrored from `public/logo.svg`, keep the two byte-identical), social-preview.png (downscaled to exactly 1280x640, must stay <1 MB for GitHub), tour.gif (ffmpeg from the tour webm, 720px/9fps/palette), and top-crops of the tall full-page tab shots. Every step SKIPS a missing source instead of throwing, so a checkout with the brand HTML but no `download/shots/` still stages the brand pair without touching the tracked dashboard crops.
  - Refresh order: rebuild dashboard (`bun run build` + `bun run start`) → shots_capture → ffmpeg GIF → curate_assets. Verify README image references still resolve afterwards. Brand-only refresh (no dashboard needed): `bun scripts/brand_render.mjs` → `bun scripts/curate_assets.mjs`, then LOOK at the regenerated `banner.png` / `social-preview.png` and at an 880px-wide downscale — the banner's contract is that it reads at GitHub's rendered width.

## Work Guidance

- Run product scripts only via their npm aliases (`bun run agent:install|start|stop`) so cwd + `.env` loading behave as designed.
- Keep scripts `set -euo pipefail` + `cd "$(dirname "$0")/.."` like the existing ones.

## Verification

- `bash -n scripts/*.sh` (syntax) — cheap gate before committing script changes.
- `node scripts/check_docs.mjs docs/*.md` — link/anchor gate (also a CI job).
- `node scripts/check_coverage.mjs --run` — changed-line coverage gate (also a CI
  job; needs a resolvable git base, so pass one explicitly when running locally
  against a branch whose diff is non-empty).
- `bun run agent:stop && bun run agent:start` round trip: all three services healthy (see mini-services doc for endpoints).

## Child DOX Index

(none — flat directory)
