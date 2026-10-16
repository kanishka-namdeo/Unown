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

# zai-upstream shim: a local OpenAI-compatible endpoint backed by the
# sandbox's z-ai-web-dev-sdk gateway. Only started when the bridge is pointed
# at it (BRIDGE_UPSTREAM_URL=http://127.0.0.1:3032/v1) — a real provider
# (Dashscope, OpenAI, ...) needs no shim.
if [[ "${BRIDGE_UPSTREAM_URL:-}" == *"127.0.0.1:3032"* ]]; then
        if curl -sf "http://127.0.0.1:${ZAI_UPSTREAM_PORT:-3032}/v1/models" >/dev/null 2>&1; then
                echo "• zai-upstream already healthy on :${ZAI_UPSTREAM_PORT:-3032} — reusing it"
        else
                start_service zai-upstream mini-services/zai-upstream bun index.ts
        fi
fi

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

# Honest key/upstream reporting: /health only counts as "ok" for the chat path
# when the upstream key is set and the upstream actually answers.
HEALTH_JSON="$(curl -s "http://127.0.0.1:${BRIDGE_PORT:-3031}/health" 2>/dev/null || true)"
if echo "$HEALTH_JSON" | grep -q '"upstreamKeyIsSet":false'; then
        echo "  ⚠ BRIDGE_UPSTREAM_KEY is not set in .env — every chat will fail with 401."
        echo "    fix: edit .env, set BRIDGE_UPSTREAM_KEY=<your upstream key>, then: bun run agent:stop && bun run agent:start"
elif echo "$HEALTH_JSON" | grep -q '"upstream":{"ok":false'; then
        echo "  ⚠ The bridge reached the upstream but the upstream is unhealthy —"
        echo "    check BRIDGE_UPSTREAM_URL / BRIDGE_UPSTREAM_KEY in .env."
fi

echo "  Logs: .run/bridge.log, .run/engine.log, .run/dashboard.log"
echo "  Stop: bun run agent:stop"
