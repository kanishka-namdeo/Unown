# Scripts (scripts/)

## Purpose

The cross-platform lifecycle scripts (install/start/stop/link), the release builders, the CI gate and generator scripts, the landing-page visual verification lanes, the brand-asset pipeline, and the TUI capture harness that produces the landing page's media.

## Ownership

- Owns: everything directly in `scripts/` (the `.ts` lifecycle scripts + their thin POSIX `.sh` wrappers, the `.mjs` gates/generators, `scripts/lib.ts`, `scripts/brand/`, `scripts/vendor/`, `scripts/searxng-test/`), the `scripts/tui-capture/` harness (including its `fixtures/`), and this doc.
- The dev-only debug tools in `scripts-dev/` are milestone forensics, not product paths — no CI wiring, not owned here.
- `scripts/tui-capture/fixtures/api-server/AGENTS.md` is a TEST FIXTURE (a sample project the capture harness drives), not part of the repo's DOX tree.

## Local Contracts

**Lifecycle (cross-platform bun TypeScript — identical on Windows/macOS/Linux; the `.sh` twins are thin POSIX wrappers):**

- `install.ts` (`agent:install`) — 7 steps: verify bun >= 1.4; `bun install --frozen-lockfile` at root + `pi-repo/`; hydrate gitignored pi model data (network fetch); `bun run build:offline` in pi-repo; bootstrap `.env` from `.env.example` + symlink it into both mini-services; run `link.ts` unless `UNOWN_NO_LINK=1`; install the always-on engine service via `bun bin/unown engine install --auto` (the CLI owns the gates — CI, `UNOWN_ENGINE_AUTOSTART=0`, `UNOWN_NO_ENGINE_SERVICE=1`, a recorded `engine uninstall` — and the step is NON-FATAL: an installer must succeed without a service manager). `UNOWN_INSTALL_CONTEXT=update` re-runs it as the update path, which is also how an update restarts a service-owned engine onto the new build.
- `start.ts` (`agent:start`) — starts bridge :3031 and engine :3030 as detached children surviving parent exit (Windows uses `cmd /c start /b` + netstat pid resolution); reuses already-healthy services; drain-aware port waits; health-waits <= 65s. Pidfiles in `.run/`.
- `stop.ts` (`agent:stop`) — SIGTERM (POSIX) / `taskkill /F /T` (Windows) via pidfiles, with port-based fallbacks scoped to THIS checkout only. Exit 0 if something stopped, 1 if nothing ran.
- `link.ts` (`agent:link`) — puts `unown` on PATH (POSIX `~/.local/bin`-first; Windows `%USERPROFILE%\.local\bin` + user PATH via PowerShell, never `setx`); records `~/.unown/install.json` (mode "checkout"). This is the supported global-install path; `bun install -g .` does NOT work with the vendored workspace layout.
- `lib.ts` — shared helpers (`resolveBun()`, `loadEnvFile()`, `probeHttpOk()` where 401/403 = a tokened engine is present, ASCII glyphs on win32).
- `bwrap_smoke.sh` — 25-check bubblewrap profile verification; `verify_sandbox.mjs` — engine-level sandbox verification against a scratch tmpdir (never the live engine).
- `xplat.mjs` — the cross-platform test driver: the steering wheel over the `xplat.yml` dispatch workflow (dispatch/status/watch/logs/artifacts/cancel/rerun/runs/local/scenarios). Zero dependencies (node >= 20 or bun), resolves auth from `XPLAT_GITHUB_TOKEN` > `GITHUB_TOKEN` > the PAT in the git remote, mints a correlation `run_id` per dispatch (the API returns 204 with no body — the driver finds its own run by run-name segment match), and exits with the verdict contract (0 green / 1 red / 2 cancelled / 3 infra / 4 usage / 5 auth). `local --scenario <s>` runs the scenario's steps on this machine (the fast inner loop). The manual is `docs/xplat-testing.md`; the pure logic is pinned by `scripts/xplat.test.mjs`. Scenario or `--os` changes move the driver, the workflow inputs, the pinning suite AND the docs page in the same change (four-place contract, like the platform ids).

**Release builders:**

- `build-artifacts.ts` (`release:artifacts`) — builds the six per-OS CLI archives (darwin/linux/windows × arm64/x64) with ONE host via `bun build --compile --target=` (entry = `boot.ts` + `image-resize-worker.js`, define `__UNOWN_VERSION__`); each archive carries `unown[.exe]`, `VERSION`, `LICENSE`, per-OS `INSTALL.txt`; writes `version.txt` + `sha256sums.txt`; enforces `MIN_BINARY_BYTES = 20 MiB` (no-op-stub guard) and archive magic bytes; 30 mem0 optional-import `--external`s. Refuses non-X.Y.Z versions. `--dry-run` prints the 6-target plan (the release workflow's plan gate asserts exactly that output).
- `release-manifest.ts` — builds/verifies the unsigned update manifest `release.json` (schema 1: version, releasedAt, severity from CHANGELOG "### Security", per-platform assets with exact size + SHA-256). `--check [--require-all]` verifies local payload; `--feed <base>` downloads the live feed and re-verifies every archive.
- Both builders are pinned by `node --test` suites (`build-artifacts.test.mjs`, `release-manifest.test.mjs`) — a target added/removed must move all four assertions (builder test, verify-job plan check, local payload check, publish-job asset check).

**CI gates and generators (the `--check` forms are the CI jobs; the bare form regenerates):**

- `check_docs.mjs` (`check:docs`) — every relative link and `#anchor` in `docs/*.md` resolves (GitHub slug rules; AGENTS.md exempt from anchors). Split on `/\r?\n/` — the corpus is CRLF.
- `check_coverage.mjs` (`test:coverage`) — changed-line coverage gate: >= 80% of touched `src/` lines executed; a file with no coverage row = 0%, never 100%; exemptions require same-line justification in `coverage-exempt.txt`.
- `check_instruction_chars.mjs` — invisible-Unicode lint over every file the agent loads as behavior (AGENTS.md / SKILL.md / CLAUDE.md at any depth, `.unown/**`, hooks configs): seven rules (bidi controls/isolates, zero-width, soft-hyphen, invisible operators, unicode-tag emoji backdoor, variation-selector runs). Never echoes raw invisible chars; allowlist in `instruction-chars-allowlist.txt` is fail-closed (unknown rule = config error). Every AGENTS.md edit must pass it.
- `landing_changelog.mjs` / `landing_benchmarks.mjs` / `landing_claims.mjs` — regenerate the three landing data files (`changelog-data.ts`, `benchmarks-data.ts`, `engine-data.ts`); `check:changelog`/`check:benchmarks`/`check:claims` gate drift. Benchmarks canonical run = per model, newest `rerun-*` receipt wins, else base; missing figure = `null`, never a guess. Claims gate is one-directional (page implies source).
- `landing_blog.mjs` (`check:blog`) — the blog generator: `content/blog/*.md` -> generated `src/components/blog/blog-data.ts` + the static RSS `public/feed.xml`. The one landing generator with a dependency (`marked`, dev-only); everything else is node builtins. Validates the frontmatter subset grammar loudly (unknown keys, band violations, non-dated slugs, dead media paths all fail the run), derives reading time, sorts date-desc/slug-asc, and writes the feed with entity escaping. Pinned by `scripts/landing_blog.test.mjs`.
- `gba_palette_check.mjs` — the landing palette gate (GBA 5-bit grid, dual-declared identical light scheme, AA contrast, no hand-picked hexes in components).
- `check_theme.mjs` — TUI theme schema (51 color tokens, every var resolves).
- `mermaid_check.mjs` — README mermaid blocks parse under the vendored sha-pinned mermaid 11.16.1 and dual-render byte-identical; `check_overflow.mjs` — brand HTML overflow gate.
- `landing_og_shots.mjs` — regenerates the tracked `public/landing/landing-{hero,full,mobile}.png` against a production build (asserts `--color-canvas === #102039` first).
- `landing_audit.mjs` (`audit:landing`) — scroll/text density; `--budget` enforces <= 13 viewports / <= 3,200 words / <= 3vh per band.
- `landing_shots.mjs` / `contrast_audit.mjs` / `theme_toggle_check.mjs` — visual verification against a production build (both schemes, reduced motion, mobile; WCAG AA on every visible text node; the real toggle).
- `verify-deploy.mjs` — the live-deployment gate over `https://unown-nine.vercel.app` (routes incl. `/blog` + `/feed.xml`, SEO surface, signature content, the blog + feed); runs after any push to `main`, and automatically from `.github/workflows/deploy-verify.yml` (on CI completion, daily on a schedule, on dispatch). Plain node, zero deps — which is why that lane needs no install.
- `agnes_review.mjs` (`review:vlm`) — VLM design critique through the Agnes lane; a reviewer's aid, not a gate.
- `design_critic.mjs` (`critic:design`) — the Website Excellence Round's receipted critique driver: any route of the production build (or a local HTML file) at desktop+mobile, the objective audit (WCAG contrast, type-scale census, 4px-grid conformance, heading order, alts, overflow), cold-load FCP/LCP/CLS/TBT, and the strict-JSON 7-axis VLM critique — one committed receipt per run under `benchmarks/website-excellence-round/critiques/`; `--enforce` turns a rubric fail into exit 1. `design_critic_calibration.html` is its known-bad judge-calibration fixture (must score well below a real page on every axis). The rubric contract is `benchmarks/website-excellence-round/rubric.md` — the script's `RUBRIC` and that doc move in the same change.
- `websearch-live.mjs` / `webcache-bench.mjs` — live provider verification and web-cache perf receipts (outputs under `benchmarks/`).

**Brand assets:** `scripts/brand/*.html` are the tracked sources; `brand_render.mjs` renders them to gitignored `download/brand/`; `curate_assets.mjs` stages the final set into `.github/assets/` (every step SKIPS when its source is absent rather than clobbering a tracked asset). `creature_sprites.mjs` / `creature_atlas.mjs` / `creature_kit.mjs` / `creature_crops.mjs` — the deterministic pixel-art pipeline behind `public/landing/creatures/` (authored code, no AI generation, no network, no credentials — the script is the art). `vendor-provider-marks.mjs` regenerates the provider marks from pinned CC0 Simple Icons.

**TUI capture lane (`scripts/tui-capture/`):** drives the real `unown` TUI/CLI through scenarios (`scenarios/*.js` driven by `driver.js`), records full-frame PNG stills and frame sequences assembled into MP4/WebM/GIF — these become the landing page's `public/landing/tui/**` assets. The PTY lane (`pty_*.py`, dependency-light: pty + pyte + PIL) drives the same real TUI without tmux/ttyd/Chromium; `pty_round_session.py` is its LONG-round driver (budgeted chunks that close through the real /quit path before the wall clock — hosts that reap processes between calls get -c resume chains; see its module docstring) — the commerce round's build/review/QA sessions ran on it. Both lanes dismiss the first-flights onboarding catalog before typing (it eats keystrokes; a stray `x` latches never-again persistently): `dismiss_first_flights()` in `pty_common.py`, `Session.dismissFirstFlights()` in `driver.js`. `scripts/landing_demo_poster.mjs` shoots the live-demo band's posters — every app in the gallery in one pass, output paths mirroring `live-demo-data.ts`'s declared poster paths (committed assets never move). Audited by `audit_stills.py` (pane-truth + pixel + VLM gates), `scan_frames.py`, `audit_video.py`. The dashboard README in `public/landing/tui/dashboard/` states the rule: the directory is the curation of audited output, not the source of truth — a bad frame is re-captured, never edited. The workflow contract is `docs/tui-capture-workflow.md`.

## Work Guidance

- Any workflow `run:` step executes under `bash --noprofile --norc -eo pipefail`: a `x=$(cmd | …)` assignment aborts with status 0 when cmd dies, and a bare `A && B` trips `set -e` when A is false — run the producer as its own statement and wrap probes in `if`. (Measured on bash 5.2.21; the release workflow was rewritten to this rule after a gate passed silently.)
- A palette or landing visual change regenerates the OG shots in the same change; a creature/atlas change regenerates sprites and re-runs the sprite gates.
- A release-artifact change (target, entry, define, archive format, manifest contract) moves `build-artifacts.ts` + `release-manifest.ts` + both test files + the release workflow's asset lists + `docs/install.md` + the `INSTALL.txt` text — all in the same change.

## Verification

- `node --test scripts/build-artifacts.test.mjs scripts/release-manifest.test.mjs` (the release plan gates); `node --test scripts/check_instruction_chars.test.mjs` (the scanner itself); `node --test scripts/xplat.test.mjs` (the driver's pure logic: remote parsing, matrix resolution, exit codes, dispatch correlation, the local-lane subset contract).
- `node scripts/xplat.mjs local --scenario core` after any driver/workflow change — the local lane must stay green end to end; `node scripts/xplat.mjs dispatch --scenario smoke --watch` proves the remote lane (correlation, receipts, verdict exit code) after workflow-input changes.
- `bun run check:docs` / `check:changelog` / `check:blog` / `check:benchmarks` / `check:claims` — all green after any docs/landing/benchmarks/blog change.
- `bash scripts/bwrap_smoke.sh` + `bun scripts/verify_sandbox.mjs` (Linux sandbox legs) before committing sandbox changes.
- CI runs: lint-shell (`bash -n scripts/*.sh public/*.sh`), the docs/palette/theme/instruction-chars/coverage jobs, and the 3-OS build-test matrix through the real installer.

## Child DOX Index

- `scripts/tui-capture/` has no AGENTS.md — its contract is `docs/tui-capture-workflow.md` plus its own README; the fixtures are test data, not DOX.
