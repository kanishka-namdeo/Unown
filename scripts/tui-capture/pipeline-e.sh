#!/usr/bin/env bash
# pipeline-e.sh — the last three captures under the quiet engine (learning
# jobs budget-throttled so /btw's background-lane call answers promptly):
# s16 (parity round), s21 (goals, state-anchored rewrite), s19 (routines
# re-capture — the history now carries a real succeeded run).
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
export LD_LIBRARY_PATH="$HOME/.local/opt/tmux-root/usr/lib/x86_64-linux-gnu"
REPO="${UNOWN_ROOT:-/home/z/my-project/Unown}"
cd "$REPO"
RESULTS=/tmp/pipeline-e-results.txt
: > "$RESULTS"
for entry in "s16-parity-round none" "s21-goals default" "s19-routines none"; do
  set -- $entry
  SPEC=$1; PREP=$2
  echo "──────── pipeline-e: $SPEC ────────"
  if bash scripts/tui-capture/run_lane.sh "$SPEC" "$PREP" > "/tmp/lane-e-$SPEC.log" 2>&1; then
    echo "PASS $SPEC" >> "$RESULTS"; echo "✓ $SPEC"
  else
    echo "FAIL $SPEC" >> "$RESULTS"; echo "✗ $SPEC — log: /tmp/lane-e-$SPEC.log"
    grep -E "Error:|GATE|DUPLIC" "/tmp/lane-e-$SPEC.log" | head -5
  fi
done
echo "──────── pipeline-e done ────────"
cat "$RESULTS"
