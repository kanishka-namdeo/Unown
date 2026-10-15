#!/bin/bash
# bwrap profile verification — every isolation property the engine relies on.
#
# Environment constraints discovered (kernel 5.10.134 container):
#   - unprivileged userns + mount ns + net ns + ipc ns: AVAILABLE
#   - fresh procfs in nested pidns: BLOCKED (EPERM) -> no --unshare-pid
#     => residual: host processes visible; uid-1001 signals to other z
#        processes are possible (mitigated by hook deny-rules)
#   - whole-root ro-bind carries child mounts; --proc/--dev/--tmpfs override them
set -u
BWRAP=/home/z/my-project/scripts/bwrap-extract/usr/bin/bwrap
WS=/tmp/sbx/ws
rm -rf "$WS"; mkdir -p "$WS"

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

pass=0; fail=0
check() { # <name> <want-exit-0> <cmd...>
	local name="$1" want="$2"; shift 2
	if run "$@" >/dev/null 2>&1; then got=0; else got=1; fi
	if [ "$got" = "$want" ]; then echo "PASS $name"; pass=$((pass+1)); else echo "FAIL $name (exit=$got want=$want)"; fail=$((fail+1)); fi
}

# --- filesystem isolation ---------------------------------------------------
check "fs: basic exec" 0 /bin/sh -c 'echo hello'
check "fs: write inside workspace" 0 /bin/sh -c 'echo data > "$PWD/out.txt" && cat "$PWD/out.txt"'
check "fs: read /etc (ro)" 0 /bin/sh -c 'grep -q root /etc/passwd'
check "fs: write /etc blocked" 1 /bin/sh -c 'echo x > /etc/evil'
check "fs: write /usr blocked" 1 /bin/sh -c 'echo x > /usr/evil'
check "fs: write /sys blocked" 1 /bin/sh -c 'echo x > /sys/evil'
check "fs: home invisible" 1 /bin/sh -c 'ls /home/z'
check "fs: repo invisible" 1 /bin/sh -c 'ls /home/z/my-project'
check "fs: secrets unreadable" 1 /bin/sh -c 'cat /home/z/my-project/.env'
check "fs: engine db invisible" 1 /bin/sh -c 'ls /home/z/my-project/db'
check "fs: /proc mounted" 0 /bin/sh -c 'ls /proc/self/comm >/dev/null'
check "fs: /dev/null works" 0 /bin/sh -c 'echo x > /dev/null'
check "fs: /tmp writable" 0 /bin/sh -c 'echo x > /tmp/f && cat /tmp/f'
check "fs: /var/tmp writable" 0 /bin/sh -c 'echo x > /var/tmp/f && cat /var/tmp/f'
check "fs: traversal escape blocked" 1 /bin/sh -c 'cat ../../../../home/z/my-project/.env'

cat > "$WS/esc.sh" <<'EOF'
#!/bin/sh
ln -sf / ./esc-link 2>/dev/null || exit 1
cat ./esc-link/home/z/my-project/.env && exit 0
exit 1
EOF
check "fs: symlink escape blocked" 1 /bin/sh ./esc.sh

# --- network isolation -------------------------------------------------------
check "net: DNS blocked" 1 /bin/sh -c 'getent hosts deb.debian.org'
check "net: TCP blocked" 0 /usr/bin/python3 -c 'import socket
try:
	socket.create_connection(("deb.debian.org", 80), 3)
except Exception:
	raise SystemExit(0)
raise SystemExit(1)'
check "net: localhost bridge unreachable" 0 /usr/bin/python3 -c 'import socket
try:
	socket.create_connection(("127.0.0.1", 3031), 2)
except Exception:
	raise SystemExit(0)
raise SystemExit(1)'

# --- runtimes usable inside --------------------------------------------------
check "rt: bun works" 0 /usr/local/bin/bun -e 'console.log("bun ok"); process.exit(0)'
check "rt: node works" 0 /usr/bin/node -e 'console.log("node ok")'
check "rt: python3 works" 0 /usr/bin/python3 -c 'print("py ok")'
check "rt: bun writes workspace" 0 /usr/local/bin/bun -e 'await Bun.write("bun-out.txt", "written"); process.exit(await Bun.file("bun-out.txt").text() === "written" ? 0 : 1)'
check "rt: bun HOME is tmpfs" 0 /usr/local/bin/bun -e 'process.exit(process.env.HOME === "/tmp/home" ? 0 : 1)'
check "rt: bun can mkdir HOME" 0 /usr/local/bin/bun -e 'await Bun.$`mkdir -p ${process.env.HOME}`.quiet(); process.exit(0)'

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
echo "RESULT: $pass passed, $fail failed"
exit $((fail > 0))
