#!/usr/bin/env bash
# pipeline-b.sh — re-run round for the five lanes whose first cut failed on
# now-understood races (see worklog Task 5): s1 (post-idle stills), s13
# (forced tool call), s14 (dice/roll rendering anchor), s21 (two-endpoint
# objective), s16 (300s /btw background-lane window). s16 runs LAST so the
# engine's dream queue drains through the other lanes' interactive traffic
# first.
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
export LD_LIBRARY_PATH="$HOME/.local/opt/tmux-root/usr/lib/x86_64-linux-gnu"
REPO="${UNOWN_ROOT:-/home/z/my-project/Unown}"
cd "$REPO"

RESULTS=/tmp/pipeline-b-results.txt
: > "$RESULTS"

for entry in \
  "s1-hero-bugfix s1-hero-bugfix" \
  "s13-websearch default" \
  "s14-mcp s14-mcp" \
  "s21-goals default" \
  "s16-parity-round none"; do
  set -- $entry
  SPEC=$1; PREP=$2
  echo "──────── pipeline-b: $SPEC (prep $PREP) ────────"
  if bash scripts/tui-capture/run_lane.sh "$SPEC" "$PREP" > "/tmp/lane-b-$SPEC.log" 2>&1; then
    echo "PASS $SPEC" >> "$RESULTS"
    echo "✓ $SPEC"
  else
    echo "FAIL $SPEC" >> "$RESULTS"
    echo "✗ $SPEC — log: /tmp/lane-b-$SPEC.log"
    grep -E "Error:|GATE|DUPLIC" "/tmp/lane-b-$SPEC.log" | head -5
  fi
done
echo "──────── pipeline-b done ────────"
cat "$RESULTS"
