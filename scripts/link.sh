#!/usr/bin/env bash
# Unown linker — puts `unown` on your PATH.
#
# Creates a small shim in a bin directory (default ~/.local/bin) that always
# executes THIS checkout's bin/unown with bun. A shim (instead of a global
# package install) keeps subagent spawning, the vendored pi-repo workspace
# deps and `git pull` updates working with zero maintenance.
#
# Env:
#   UNOWN_BIN_DIR   target directory (default: first writable dir of
#                   ~/.local/bin, ~/bin, /usr/local/bin)
#   UNOWN_NO_LINK=1 (with install.sh) skips linking entirely
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_DIR="$(pwd)"
BIN_DIR="${UNOWN_BIN_DIR:-}"

if [ -z "$BIN_DIR" ]; then
        for candidate in "$HOME/.local/bin" "$HOME/bin" "/usr/local/bin"; do
                if mkdir -p "$candidate" 2>/dev/null && [ -w "$candidate" ]; then
                        BIN_DIR="$candidate"
                        break
                fi
        done
fi

if [ -z "$BIN_DIR" ]; then
        echo "✗ no writable bin directory found — re-run with: UNOWN_BIN_DIR=/your/path/dir bun run agent:link"
        exit 1
fi

BUN_BIN="$(command -v bun || true)"
if [ -z "$BUN_BIN" ]; then
        echo "✗ bun is required (https://bun.sh) — it must be on PATH when unown runs"
        exit 1
fi

SHIM="$BIN_DIR/unown"
cat >"$SHIM" <<EOF
#!/usr/bin/env bash
# unown shim — created by scripts/link.sh; re-run it after moving the repo.
exec "$BUN_BIN" "$REPO_DIR/bin/unown" "\$@"
EOF
chmod +x "$SHIM"

echo "✓ linked $SHIM → $REPO_DIR/bin/unown"

case ":$PATH:" in
*":$BIN_DIR:"*) ;;
*)
        echo "⚠ $BIN_DIR is not on your PATH."
        echo "  add this line to your shell profile, then restart the shell:"
        echo "      export PATH=\"$BIN_DIR:\$PATH\""
        ;;
esac

echo "  verify: unown doctor"
