#!/usr/bin/env bash
# Unown linker — puts `unown` on your PATH via a shim that always executes
# THIS checkout's bin/unown with bun (the supported global-install path).
#
# Thin POSIX wrapper: the implementation is scripts/link.ts (cross-platform
# bun TypeScript — same commands on Windows/macOS/Linux; on Windows it writes
# unown.cmd + unown.ps1 shims and updates the user PATH). `exec bun` keeps
# exit codes and streamed output identical.
exec bun "$(dirname "$0")/link.ts" "$@"
