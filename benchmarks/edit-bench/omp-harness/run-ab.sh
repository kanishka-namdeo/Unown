#!/bin/bash
# run-ab.sh — launch one omp edit-benchmark run detached (survives tool call).
# usage: run-ab.sh <model> <variant> [extra flags...]
set -u
MODEL="$1"; VARIANT="$2"; shift 2
ROOT=/home/z/my-project/probes/omp-edit-bench
ADAPTER="$ROOT/packages/metaharness/adapters/edit"
OUT="$ROOT/omp-results/${MODEL}_${VARIANT}.json"
LOG="$ROOT/omp-results/${MODEL}_${VARIANT}.log"
cd "$ADAPTER" || exit 1
PI_CODING_AGENT_DIR=/home/z/my-project/probes/omp-agent \
exec bun cli.ts --model "zai-bridge/${MODEL}" \
  --edit-variant "$VARIANT" \
  --thinking off \
  --timeout 300000 --connection-timeout 60000 \
  --max-turns 30 --max-attempts 1 --runs 1 \
  --task-concurrency 4 --max-tasks 0 \
  --quiet --output "$OUT" "$@" > "$LOG" 2>&1 < /dev/null
