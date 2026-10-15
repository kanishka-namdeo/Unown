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

# Bootstrap .env from the template so the stack has something to load (the
# template itself contains no secrets — BRIDGE_UPSTREAM_KEY stays empty).
if [ ! -f .env ]; then
        cp .env.example .env
        echo "✓ created .env from .env.example"
fi

# Put `unown` on PATH (shim → this checkout). Opt out with UNOWN_NO_LINK=1.
if [ "${UNOWN_NO_LINK:-}" = "1" ]; then
        echo "· UNOWN_NO_LINK=1 — skipping the PATH link (run scripts/link.sh anytime)"
else
        bash scripts/link.sh || echo "· PATH link failed (not fatal) — run scripts/link.sh manually"
fi

UPSTREAM_KEY_SET=0
if grep -q '^BRIDGE_UPSTREAM_KEY=..*' .env 2>/dev/null; then
        UPSTREAM_KEY_SET=1
fi

cat <<EOF

✓ Install complete.

Next steps:
  1. Configure your model credentials:
EOF
if [ "$UPSTREAM_KEY_SET" = "1" ]; then
        cat <<'EOF'
     ✓ BRIDGE_UPSTREAM_KEY is already set in .env
EOF
else
        cat <<'EOF'
     ✗ REQUIRED: set BRIDGE_UPSTREAM_KEY in .env — without it every chat
       fails with 401 (the bridge forwards requests to the upstream
       provider: Dashscope, OpenAI, OpenRouter, vLLM, …).
       Prefer a different provider entirely? Skip the stack and run:
           unown setup --provider openai --api-key sk-... --model gpt-4o
EOF
fi
cat <<'EOF'

  2. Start the stack:
       bun run agent:start        # llm-bridge :3031 + engine :3030 + dashboard :3000

  3. Verify & use the agent:
       unown doctor              # end-to-end diagnostics (should be green)
       cd ~/code/my-project && unown    # a coding agent in YOUR project

  Docs: README.md (Quickstart) · docs/ (usage, providers, skills, memory,
  troubleshooting) · unown --help
EOF
