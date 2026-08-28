#!/usr/bin/env bash
# iterate.sh — Unown's self-improvement orchestrator.
# Loop: run evals -> mine failures -> propose bounded fix -> validate gate.
# PASS  => change is left applied; review & commit it.
# FAIL/none => loop continues until max-iterations.
#
# Usage: ./iterate.sh [--offline] [--max-iterations N] [--tag TAG]
set -euo pipefail

cd "$(dirname "$0")"

OFFLINE=""
MAX_ITER=3
TAG="loop-$(date +%Y%m%d-%H%M%S)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --offline) OFFLINE="--offline"; shift ;;
    --max-iterations) MAX_ITER="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    *) echo "unknown arg $1"; exit 1 ;;
  esac
done

echo "== Unown iterate loop starting (tag=$TAG max=$MAX_ITER offline=${OFFLINE:-no}) =="

for i in $(seq 1 "$MAX_ITER"); do
  echo ""
  echo "---- iteration $i/$MAX_ITER ----"

  echo "[1/4] running evals"
  # exit code 1 just means some evals failed; that's the loop's fuel.
  python3 run_evals.py --tag "$TAG-iter$i" $OFFLINE || true

  echo "[2/4] mining failures"
  python3 mine_failures.py --run "$TAG-iter$i" || true

  CLUSTER=$(python3 - <<'PY'
import json, pathlib
p = pathlib.Path("weaknesses.json")
if p.is_file():
    data = json.loads(p.read_text())
    clusters = data.get("clusters", [])
    if clusters:
        print(max(clusters, key=lambda c: c["count"])["id"])
PY
)

  if [[ -z "${CLUSTER}" ]]; then
    echo "No weaknesses found — harness stable. Done."
    exit 0
  fi

  echo "[3/4] proposing bounded fix for cluster $CLUSTER"
  python3 propose_fix.py --cluster "$CLUSTER" || true

  PROPOSAL=$(ls -t proposals/*.md | head -n1)
  if grep -q "UNIFIED DIFF GOES HERE" "$PROPOSAL" && [[ -z "$OFFLINE" ]]; then
    echo "Proposal is an unfilled template — no AI writer available. Stopping with artifacts."
    exit 3
  fi

  echo "[4/4] validating $PROPOSAL"
  set +e
  python3 validate_fix.py --proposal "$PROPOSAL" $OFFLINE
  GATE=$?
  set -e

  case "$GATE" in
    0) echo "Gate PASSED — harness v$((i+1)) ready. Review the diff and commit."; exit 0 ;;
    *) echo "Gate verdict $GATE — looping." ;;
  esac
done

echo "Exhausted $MAX_ITER iterations without a passing fix. Artifacts kept under runs/, proposals/, verdicts/."
exit 1
