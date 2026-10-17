#!/bin/bash
# bwrap profile verification — every isolation property the engine relies on.
#
# Repo-relative (M4): runs from any checkout path (developer machine, CI runner
# home). Resolution mirrors src/bwrap.ts resolveBwrapPath:
#   $UNOWN_BWRAP (if executable) -> vendored native/bin/bwrap -> `bwrap` on PATH
#
# Environment constraints discovered (kernel 5.10.134 container):
#   - unprivileged userns + mount ns + net ns + ipc ns: AVAILABLE
#   - fresh procfs in nested pidns: BLOCKED (EPERM) -> no --unshare-pid
#     => residual: host processes visible; uid-1001 signals to other z
#        processes are possible (mitigated by hook deny-rules)
#   - whole-root ro-bind carries child mounts; --proc/--dev/--tmpfs override them
set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -n "${UNOWN_BWRAP:-}" ] && [ -x "${UNOWN_BWRAP}" ]; then
        BWRAP="${UNOWN_BWRAP}"
elif [ -x "$REPO_ROOT/pi-repo/packages/self-learning/native/bin/bwrap" ]; then
        BWRAP="$REPO_ROOT/pi-repo/packages/self-learning/native/bin/bwrap"
else
        BWRAP="$(command -v bwrap || true)"
fi
if [ -z "${BWRAP:-}" ] || [ ! -x "$BWRAP" ]; then
        echo "bwrap not found (tried \$UNOWN_BWRAP, the vendored native/bin/bwrap, then PATH)" >&2
        exit 1
fi
echo "bwrap: $BWRAP"

# Early canary: unprivileged userns must work or EVERY check below fails with
# a misleading exit=1. Ubuntu 24.04+ (and GH's ubuntu-latest images) ship
# apparmor_restrict_unprivileged_userns=1 which blocks bwrap outright:
#   sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
if ! "$BWRAP" --unshare-user --ro-bind / / --dev /dev /bin/true 2>/tmp/bwrap-userns.err; then
        echo "✗ bwrap cannot create an unprivileged user namespace on this host:" >&2
        sed 's/^/    /' /tmp/bwrap-userns.err >&2
        echo "  fix: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0" >&2
        echo "  (CI does this in a pre-step; developer machines usually have it at 0)" >&2
        exit 1
fi

# Host facts captured OUTSIDE the sandbox (bwrap replaces /home, HOME and the
# runtime paths, so the checks below must reference the host's real values).
# The home-invisibility check assumes $HOME sits under /home (true on GH
# runners: /home/runner) — the bwrap profile tmpfs-mounts /home.
REAL_HOME="${HOME:-/root}"

# Runtimes: prefer locations that survive the private-/home tmpfs (anything
# under /home is invisible inside the sandbox). If a runtime only exists under
# /home (e.g. GH runners install bun to /home/runner/.bun), the corresponding
# checks SKIP with an INFO instead of failing — the engine has exactly the
# same constraint on such hosts (its sandboxed children cannot see $HOME
# tools either).
pick_bin() { for p in "$@"; do [ -n "${p:-}" ] && [ -x "$p" ] && { printf '%s\n' "$p"; return 0; }; done; return 1; }
hidden_by_tmpfs() { case "$1" in /home/*) return 0 ;; *) return 1 ;; esac; }
BUN_BIN="$(pick_bin /usr/local/bin/bun /usr/bin/bun "$(command -v bun || true)" || true)"
NODE_BIN="$(pick_bin /usr/bin/node /usr/local/bin/node "$(command -v node || true)" || true)"
PY_BIN="$(pick_bin /usr/bin/python3 /usr/local/bin/python3 "$(command -v python3 || true)" || true)"

SMOKE_ROOT="$(mktemp -d /tmp/bwrap-smoke.XXXXXX)"
WS="$SMOKE_ROOT/ws"
mkdir -p "$WS"
trap 'rm -rf "$SMOKE_ROOT"' EXIT

run() {
        "$BWRAP" \
                --ro-bind / / \
                --proc /proc \
                --dev /dev \
                --tmpfs /home \
                --tmpfs /run \
                --tmpfs /tmp \
                --tmpfs /var/tmp \
                --bind "$WS" "$WS" \
                --chdir "$WS" \
                --unshare-net \
                --unshare-ipc \
                --die-with-parent \
                --new-session \
                --cap-drop ALL \
                --setenv HOME /tmp/home \
                --setenv TMPDIR /tmp \
                -- "$@"
}

pass=0; fail=0; skip=0
check() { # <name> <want-exit-0> <cmd...>
        local name="$1" want="$2"; shift 2
        if run "$@" >/dev/null 2>&1; then got=0; else got=1; fi
        if [ "$got" = "$want" ]; then echo "PASS $name"; pass=$((pass+1)); else echo "FAIL $name (exit=$got want=$want)"; fail=$((fail+1)); fi
}
runtime() { # <label> <bin> — report SKIP for runtimes the sandbox cannot see
        local label="$1" bin="$2"
        if [ -n "$bin" ] && ! hidden_by_tmpfs "$bin"; then return 0; fi
        echo "SKIP $label checks (no binary visible inside the sandbox: ${bin:-none found})"
        skip=$((skip+1))
        return 1
}

# --- filesystem isolation ---------------------------------------------------
check "fs: basic exec" 0 /bin/sh -c 'echo hello'
check "fs: write inside workspace" 0 /bin/sh -c 'echo data > "$PWD/out.txt" && cat "$PWD/out.txt"'
check "fs: read /etc (ro)" 0 /bin/sh -c 'grep -q root /etc/passwd'
check "fs: write /etc blocked" 1 /bin/sh -c 'echo x > /etc/evil'
check "fs: write /usr blocked" 1 /bin/sh -c 'echo x > /usr/evil'
check "fs: write /sys blocked" 1 /bin/sh -c 'echo x > /sys/evil'
check "fs: home invisible" 1 /bin/sh -c "ls '$REAL_HOME'"
check "fs: repo invisible" 1 /bin/sh -c "ls '$REPO_ROOT'"
check "fs: secrets unreadable" 1 /bin/sh -c "cat '$REPO_ROOT/.env'"
check "fs: engine db invisible" 1 /bin/sh -c "ls '$REPO_ROOT/db'"
check "fs: /proc mounted" 0 /bin/sh -c 'ls /proc/self/comm >/dev/null'
check "fs: /dev/null works" 0 /bin/sh -c 'echo x > /dev/null'
check "fs: /tmp writable" 0 /bin/sh -c 'echo x > /tmp/f && cat /tmp/f'
check "fs: /var/tmp writable" 0 /bin/sh -c 'echo x > /var/tmp/f && cat /var/tmp/f'
# Traversal from the workspace towards the repo (relative if realpath can
# compute it, absolute otherwise — the tmpfs masking blocks both alike).
REL_REPO="$(realpath --relative-to="$WS" "$REPO_ROOT" 2>/dev/null || printf '%s' "$REPO_ROOT")"
check "fs: traversal escape blocked" 1 /bin/sh -c "cat '$REL_REPO/.env'"

cat > "$WS/esc.sh" <<EOF
#!/bin/sh
ln -sf / ./esc-link 2>/dev/null || exit 1
cat "./esc-link$REPO_ROOT/.env" && exit 0
exit 1
EOF
check "fs: symlink escape blocked" 1 /bin/sh ./esc.sh

# --- network isolation -------------------------------------------------------
check "net: DNS blocked" 1 /bin/sh -c 'getent hosts deb.debian.org'
if runtime "net: python3" "$PY_BIN"; then
        check "net: TCP blocked" 0 "$PY_BIN" -c 'import socket
try:
        socket.create_connection(("deb.debian.org", 80), 3)
except Exception:
        raise SystemExit(0)
raise SystemExit(1)'
        check "net: localhost bridge unreachable" 0 "$PY_BIN" -c 'import socket
try:
        socket.create_connection(("127.0.0.1", 3031), 2)
except Exception:
        raise SystemExit(0)
raise SystemExit(1)'
fi

# --- runtimes usable inside --------------------------------------------------
if runtime "rt: bun" "$BUN_BIN"; then
        check "rt: bun works" 0 "$BUN_BIN" -e 'console.log("bun ok"); process.exit(0)'
        check "rt: bun writes workspace" 0 "$BUN_BIN" -e 'await Bun.write("bun-out.txt", "written"); process.exit(await Bun.file("bun-out.txt").text() === "written" ? 0 : 1)'
        check "rt: bun HOME is tmpfs" 0 "$BUN_BIN" -e 'process.exit(process.env.HOME === "/tmp/home" ? 0 : 1)'
        check "rt: bun can mkdir HOME" 0 "$BUN_BIN" -e 'await Bun.$`mkdir -p ${process.env.HOME}`.quiet(); process.exit(0)'
fi
if runtime "rt: node" "$NODE_BIN"; then
        check "rt: node works" 0 "$NODE_BIN" -e 'console.log("node ok")'
fi
if runtime "rt: python3" "$PY_BIN"; then
        check "rt: python3 works" 0 "$PY_BIN" -c 'print("py ok")'
fi

# --- known residuals (kernel blocks pidns here) ------------------------------
sleep 30 &
HOSTPID=$!
if run -- /bin/sh -c "kill -0 $HOSTPID" 2>/dev/null; then
        echo "INFO residual: cross-process signals possible (no pidns on this kernel) - mitigated by hook deny-rules"
else
        echo "INFO residual: cross-process signals blocked"
fi
kill "$HOSTPID" 2>/dev/null
echo "INFO residual: /sys visible read-only (whole-root ro-bind); /proc shows host pids"

echo ""
echo "RESULT: $pass passed, $fail failed, $skip skipped"
exit $((fail > 0))
