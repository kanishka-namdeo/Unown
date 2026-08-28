#!/usr/bin/env bash
# Unown launcher — starts the llm-bridge (:3031), the self-learning engine
# (:3030) and the dashboard (:3000), each as a background process managed
# through pidfiles in .run/.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .run
ROOT_DIR="$(pwd)"

# Load .env if present (KEY=VALUE lines, no quoting tricks).
if [ -f .env ]; then
        set -a
        # shellcheck disable=SC1091
        . ./.env
        set +a
fi

start_service() { # <name> <cwd> <command…>
        local name="$1"
        local cwd="$2"
        shift 2
        if [ -f ".run/$name.pid" ] && kill -0 "$(cat ".run/$name.pid")" 2>/dev/null; then
                echo "• $name already running (pid $(cat ".run/$name.pid"))"
                return
        fi
        (
                cd "$cwd"
                nohup "$@" >"$ROOT_DIR/.run/$name.log" 2>&1 &
                echo $! >"$ROOT_DIR/.run/$name.pid"
        )
        echo "▶ $name started (pid $(cat ".run/$name.pid"))"
}

# The bridge may already be healthy (started by another supervisor / earlier
# run) — reuse it instead of dying with EADDRINUSE.
if curl -sf "http://127.0.0.1:${BRIDGE_PORT:-3031}/health" >/dev/null 2>&1; then
        echo "• bridge already healthy on :${BRIDGE_PORT:-3031} — reusing it"
else
        start_service bridge mini-services/llm-bridge bun index.ts
fi
start_service engine mini-services/agent-service bun index.ts
start_service dashboard . bun run dev

echo "· waiting for services to come up…"
for i in $(seq 1 60); do
        bridge_ok=0
        engine_ok=0
        dash_ok=0
        curl -sf http://127.0.0.1:${BRIDGE_PORT:-3031}/health >/dev/null 2>&1 && bridge_ok=1
        curl -sf http://127.0.0.1:${PI_AGENT_PORT:-3030}/api/overview >/dev/null 2>&1 && engine_ok=1
        curl -sf -o /dev/null http://127.0.0.1:3000 >/dev/null 2>&1 && dash_ok=1
        [ "$bridge_ok" = 1 ] && [ "$engine_ok" = 1 ] && [ "$dash_ok" = 1 ] && break
        sleep 1
done

echo ""
echo "✓ Unown is up."
echo "    Dashboard      http://localhost:3000"
echo "    Engine API     http://127.0.0.1:${PI_AGENT_PORT:-3030}/api/overview"
echo "    LLM bridge     http://127.0.0.1:${BRIDGE_PORT:-3031}/health"
echo ""
echo "  Logs: .run/bridge.log, .run/engine.log, .run/dashboard.log"
echo "  Stop: bun run agent:stop"
