#!/usr/bin/env bash
# Unown launcher — starts the llm-bridge (:3031), the self-learning engine
# (:3030) and the dashboard (:3000), each as a background process managed
# through pidfiles in .run/.
#
# Thin POSIX wrapper: the implementation is scripts/start.ts (cross-platform
# bun TypeScript — same commands on Windows/macOS/Linux). `exec bun` keeps
# exit codes and streamed output identical.
exec bun "$(dirname "$0")/start.ts" "$@"
