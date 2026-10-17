#!/usr/bin/env bash
# Unown stopper — halts the dashboard, engine and llm-bridge started by
# scripts/start.ts (falls back to pattern matching if pidfiles are stale).
#
# Thin POSIX wrapper: the implementation is scripts/stop.ts (cross-platform
# bun TypeScript — same commands on Windows/macOS/Linux). `exec bun` keeps
# exit codes and streamed output identical. NOTE (changed from the old .sh):
# stop now exits non-zero when nothing was running.
exec bun "$(dirname "$0")/stop.ts" "$@"
