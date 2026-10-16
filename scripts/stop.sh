#!/usr/bin/env bash
# Unown stopper — halts the dashboard, engine and llm-bridge started by
# scripts/start.sh (falls back to pattern matching if pidfiles are stale).
set -uo pipefail
cd "$(dirname "$0")/.."

stop_service() { # <name>
        local name="$1"
        if [ -f ".run/$name.pid" ]; then
                local pid
                pid="$(cat ".run/$name.pid")"
                if kill -0 "$pid" 2>/dev/null; then
                        kill "$pid" 2>/dev/null || true
                        echo "▶ $name stopped (pid $pid)"
                else
                        echo "• $name pidfile stale (pid $pid)"
                fi
                rm -f ".run/$name.pid"
        else
                echo "• $name not running (no pidfile)"
        fi
}

stop_service dashboard
stop_service engine
stop_service bridge
stop_service zai-upstream

# Fallback: catch strays spawned by `next dev` (pipelines, tee'd logs) or bun
# hot reloads.
pkill -f "next dev" 2>/dev/null && echo "▶ stray next dev stopped" || true
pkill -f "tee dev.log" 2>/dev/null && echo "▶ stray dev log tee stopped" || true

# bun service processes share the cmdline "bun --hot index.ts", so match them
# by working directory instead of command line.
for pid in $(pgrep -f "bun.*index\.ts" 2>/dev/null); do
        cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
        case "$cwd" in
        */mini-services/agent-service | */mini-services/llm-bridge | */mini-services/zai-upstream)
                kill "$pid" 2>/dev/null && echo "▶ stray bun service stopped (pid $pid, cwd $cwd)"
                ;;
        esac
done
exit 0
