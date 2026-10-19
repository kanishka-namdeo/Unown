#!/usr/bin/env bash
# Thin POSIX wrapper — the single source of truth is build-artifacts.ts.
set -euo pipefail
exec bun "$(dirname "$0")/build-artifacts.ts" "$@"
