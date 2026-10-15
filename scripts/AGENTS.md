# Scripts (scripts/)

## Purpose

Two kinds of content live here: (1) the project's bootstrap/lifecycle scripts wired into root `package.json` (`agent:install` / `agent:start` / `agent:stop`), and (2) verification artifacts from the sessions that configured the Dashscope endpoint and hardened the sandbox — probes, captured search results, and dashboard screenshots kept as evidence. A third group is the README asset pipeline that regenerates the repo's brand + screenshot assets into `.github/assets/`.

## Ownership

- Owns: `install.sh`, `start.sh`, `stop.sh` (product scripts), the verification artifacts (`probe_*.py`, `test_bridge.py`, `search_*.json`, `modelsdev.json`, `dash_*.png`), and the README asset pipeline (`shots_capture.mjs`, `brand_render.mjs`, `mermaid_check.mjs`, `vlm_review.mjs`, `curate_assets.mjs`).
- Sandbox-template artifacts also parked here (NOT part of Unown): `init-fullstack.sh`, `dev-all.sh`, `scaffold.tar` — installed by the hosting sandbox, tracked only for provenance.

## Local Contracts

- `install.sh` — one-time bootstrap: root `bun install` → `pi-repo` `bun install` → `pi-repo` `bun run build:offline` (offline skips the ai package's network model-data hydration) → copies `.env.example` → `.env` when missing (template carries no secrets) → runs `link.sh` unless `UNOWN_NO_LINK=1` → prints next steps that flag a missing `BRIDGE_UPSTREAM_KEY` as REQUIRED (chats fail with 401 without it).
- `link.sh` — puts `unown` on PATH: writes a shim (`exec bun <repo>/bin/unown "$@"`) into the first writable dir of `UNOWN_BIN_DIR`, `~/.local/bin`, `~/bin`, `/usr/local/bin`, warns when the dir is not on PATH. A shim (not `bun install -g .`) is the supported global-install path: it keeps the vendored pi-repo workspace resolution and subagent spawning intact (`process.argv[1]` stays the repo copy). Run via `bun run agent:link`; re-run after moving the repo.
- `start.sh` — loads root `.env` (`set -a`), starts llm-bridge (:3031), engine (:3030), dashboard (:3000) as background processes with pidfiles in `.run/`; after the health wait it reads the bridge `/health` payload and prints a loud warning when `upstreamKeyIsSet` is false or the upstream probe is unhealthy.
- `stop.sh` — halts by pidfile, falls back to pattern matching when stale.
- Probe contract: probes hit the upstream endpoint directly or through the bridge and use `BRIDGE_UPSTREAM_KEY`-style env from the root `.env` — they must never hardcode keys.
- `search_*.json` / `modelsdev.json` are captured research data (model strengths comparison, models.dev snapshot) that justified the model assignment — treat as read-only evidence. `search_sb_*.json` are the sandbox-landscape research (bubblewrap/Claude Code/Codex/E2B/Daytona) that justified the OS-sandbox selection; `bubblewrap_*.deb` is the provenance package for the vendored `pi-repo/packages/self-learning/native/bin/bwrap` (see that package's `native/README.md`).
- Sandbox verification contract: `bwrap_smoke.sh` (profile-level isolation suite, 25 checks; invokes the vendored `pi-repo/packages/self-learning/native/bin/bwrap` directly) and `verify_sandbox.mjs` (engine-level integration suite, 12 checks) must both be fully green before committing changes to the OS sandbox or refreshing the vendored bwrap binary.
- Theme verification contract: `check_theme.mjs` validates the unown brand theme (`pi-repo/packages/self-learning/src/theme.ts`) against pi's theme schema (51 required color tokens, value formats, var resolution) — run it after any palette change.
- New ad-hoc verification scripts go here (not `/tmp`) when their results matter to the worklog; keep them re-runnable.
- README asset pipeline contract (sources live in gitignored `download/brand/` + `download/shots/`, outputs are tracked in `.github/assets/`):
  - `shots_capture.mjs` — dashboard screenshots via headless chromium. Browses the PRODUCTION dashboard behind the Caddy gateway (`SHOTS_BASE_URL=http://127.0.0.1:81 SHOTS_NO_PROXY=1 bun scripts/shots_capture.mjs --video`) so relative `/api?XTransformPort=3030` calls — including the SSE stream — route to the engine same-origin (dev mode breaks on the gateway's HMR websocket; the `engineProxy` browser-layer replay is the dev-mode fallback). Hides transient toasts/dev chrome, triggers the non-LLM `note-sync` + `sandbox-gc` router jobs after SSE connects so the Live Activity feed shows real events (disable with `SHOTS_NO_TRIGGER=1`), never clicks LLM-spending buttons. Requires the scratch playwright install in `download/.pwtools/` + chromium in `~/.cache/ms-playwright/`.
  - `brand_render.mjs` — renders `download/brand/{banner,social}.html` (Geist via Google Fonts) to `banner.png` (3232x840) and `social@2x.png` (2560x1280).
  - `mermaid_check.mjs` — parses + locally renders the two README Mermaid diagrams (mermaid@11, default theme, exactly GitHub's rendering path); the diagram sources in this file and in `README.md` MUST stay byte-identical.
  - `vlm_review.mjs` — design QA loop: sends images to the local bridge (`qwen3.7-plus`, thinking off) for terse PASS/FIX critiques.
  - `curate_assets.mjs` — stages the final set: banner, logo.svg, social-preview.png (downscaled to exactly 1280x640, must stay <1 MB for GitHub), tour.gif (ffmpeg from the tour webm, 720px/9fps/palette), and top-crops of the tall full-page tab shots.
  - Refresh order: rebuild dashboard (`bun run build` + `bun run start`) → shots_capture → ffmpeg GIF → curate_assets. Verify README image references still resolve afterwards.

## Work Guidance

- Run product scripts only via their npm aliases (`bun run agent:install|start|stop`) so cwd + `.env` loading behave as designed.
- Keep scripts `set -euo pipefail` + `cd "$(dirname "$0")/.."` like the existing ones.

## Verification

- `bash -n scripts/*.sh` (syntax) — cheap gate before committing script changes.
- `bun run agent:stop && bun run agent:start` round trip: all three services healthy (see mini-services doc for endpoints).

## Child DOX Index

(none — flat directory)
