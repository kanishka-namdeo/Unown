#!/usr/bin/env bash
# pipeline-d.sh — the final capture round: s20 (the skill shipped for real),
# s17 (Tab-into-content fix), s16 (SESSIONS anchor for the insights toast),
# s21 (three-endpoint objective so the mid-work beat is visible), s13
# (collateral re-run after a tmux kill-server mistake).
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
export LD_LIBRARY_PATH="$HOME/.local/opt/tmux-root/usr/lib/x86_64-linux-gnu"
REPO="${UNOWN_ROOT:-/home/z/my-project/Unown}"
cd "$REPO"

RESULTS=/tmp/pipeline-d-results.txt
: > "$RESULTS"

for entry in \
  "s20-skills none" \
  "s17-harness none" \
  "s16-parity-round none" \
  "s21-goals default" \
  "s13-websearch default"; do
  set -- $entry
  SPEC=$1; PREP=$2
  echo "──────── pipeline-d: $SPEC (prep $PREP) ────────"
  if bash scripts/tui-capture/run_lane.sh "$SPEC" "$PREP" > "/tmp/lane-d-$SPEC.log" 2>&1; then
    echo "PASS $SPEC" >> "$RESULTS"
    echo "✓ $SPEC"
  else
    echo "FAIL $SPEC" >> "$RESULTS"
    echo "✗ $SPEC — log: /tmp/lane-d-$SPEC.log"
    grep -E "Error:|GATE|DUPLIC" "/tmp/lane-d-$SPEC.log" | head -5
  fi
done
echo "──────── pipeline-d done ────────"
cat "$RESULTS"
