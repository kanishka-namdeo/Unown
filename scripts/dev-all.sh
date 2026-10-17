#!/usr/bin/env bash
# dev-all.sh — boot the full Unown stack under a single supervisor process.
#
# The sandbox auto dev-server runs `bun run dev`; this script makes that one
# command bring up llm-bridge (:3031), the self-learning engine (:3030) and
# the Next.js dashboard (:3000) together, so the whole stack lives and dies
# with the supervised dev process.
#
# NOTE: POSIX-only (bash) — dev-only convenience. The supported cross-platform
# lifecycle is `bun run agent:start` / `bun run agent:stop`
# (scripts/start.ts / scripts/stop.ts, which run on Windows/macOS/Linux).
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT_DIR="$(pwd)"

# Load .env if present (KEY=VALUE lines, no quoting tricks).
if [ -f .env ]; then
        set -a
        # shellcheck disable=SC1091
        . ./.env
        set +a
fi

mkdir -p .run

BRIDGE_PORT="${BRIDGE_PORT:-3031}"
ENGINE_PORT="${PI_AGENT_PORT:-3030}"

# ---------------------------------------------------------------- dependencies
# First boot under a fresh supervisor: install + build if missing.
if [ ! -d node_modules ] || [ ! -f node_modules/.install-ok ]; then
        echo "▶ [deps] installing dashboard dependencies…"
        bun install && touch node_modules/.install-ok
fi
if [ ! -f pi-repo/node_modules/.install-ok ] || [ ! -d pi-repo/packages/coding-agent/dist ]; then
        echo "▶ [deps] installing + building pi-repo engine…"
        (cd pi-repo && bun install && touch node_modules/.install-ok && bun run build:offline)
fi

# ------------------------------------------------------------------- services
# The bridge may already be healthy (restarted supervisor / earlier boot) —
# reuse it instead of dying with EADDRINUSE.
if curl -sf "http://127.0.0.1:${BRIDGE_PORT}/health" >/dev/null 2>&1; then
        echo "• llm-bridge already healthy on :${BRIDGE_PORT} — reusing it"
else
        echo "▶ starting llm-bridge on :${BRIDGE_PORT}"
        (
                cd mini-services/llm-bridge
                exec bun index.ts
        ) > .run/bridge.log 2>&1 &
fi

if curl -sf "http://127.0.0.1:${ENGINE_PORT}/api/overview" >/dev/null 2>&1; then
        echo "• self-learning engine already healthy on :${ENGINE_PORT} — reusing it"
else
        echo "▶ starting self-learning engine on :${ENGINE_PORT}"
        (
                cd mini-services/agent-service
                exec bun index.ts
        ) > .run/engine.log 2>&1 &
fi

# ------------------------------------------------------------------ dashboard
# Foreground: the dashboard stays attached to this supervised process.
echo "▶ starting dashboard (next dev :3000)"
exec bunx next dev -p 3000 2>&1 | tee dev.log
