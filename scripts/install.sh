#!/usr/bin/env bash
# Unown installer — bootstraps the self-improving coding agent.
#
# Thin POSIX wrapper: the implementation is scripts/install.ts (cross-platform
# bun TypeScript — same commands on Windows/macOS/Linux). `exec bun` keeps
# exit codes and streamed output identical; macOS/Linux/WSL keep this entry.
exec bun "$(dirname "$0")/install.ts" "$@"
