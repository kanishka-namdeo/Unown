#!/usr/bin/env bash
# Unown installer — bootstraps the self-improving coding agent.
#
# Installs dashboard dependencies, then installs and builds the pi coding
# agent monorepo (pi-repo) whose compiled output the self-learning runner
# drives. Run once after cloning.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v bun >/dev/null 2>&1 || {
        echo "✗ bun is required. Install it from https://bun.sh"
        exit 1
}

echo "▶ [1/3] Installing dashboard dependencies (bun install)…"
bun install

echo "▶ [2/3] Installing pi-mono engine dependencies (pi-repo/bun install)…"
(cd pi-repo && bun install)

echo "▶ [3/3] Building the pi coding agent (pi-repo/bun run build:offline)…"
# build:offline = same as build, but skips the ai package's network-dependent
# model-data hydration step; the self-learning runner only needs the compiled
# packages (coding-agent, ai, agent, …).
(cd pi-repo && bun run build:offline)

cat <<'EOF'

✓ Install complete.

  Next steps:
    bun run agent:start     # start llm-bridge + engine + dashboard
    open http://localhost:3000

  Configure any environment variables in .env first (see .env.example):
    PI_BRIDGE_URL, PI_AGENT_PORT, BRIDGE_PORT, BRIDGE_API_KEY,
    PI_MODEL_ID, NEXT_PUBLIC_AGENT_API_BASE, …

EOF
