#!/usr/bin/env bash
# pipeline-a.sh — the 2026-10-24 session-lane capture round, sequential
# (shared port block + shared fixture). Continues past a failed lane so one
# bad anchor never sinks the round; each lane's verdict lands in the log.
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
export LD_LIBRARY_PATH="$HOME/.local/opt/tmux-root/usr/lib/x86_64-linux-gnu"
REPO="${UNOWN_ROOT:-/home/z/my-project/Unown}"
cd "$REPO"

RESULTS=/tmp/pipeline-a-results.txt
: > "$RESULTS"

for entry in \
  "s1-hero-bugfix s1-hero-bugfix" \
  "s13-websearch default" \
  "s14-mcp s14-mcp" \
  "s15-lsp default" \
  "s21-goals default" \
  "s22-split-view default" \
  "s16-parity-round none"; do
  set -- $entry
  SPEC=$1; PREP=$2
  echo "──────── pipeline-a: $SPEC (prep $PREP) ────────"
  if bash scripts/tui-capture/run_lane.sh "$SPEC" "$PREP" > "/tmp/lane-$SPEC.log" 2>&1; then
    echo "PASS $SPEC" >> "$RESULTS"
    echo "✓ $SPEC"
  else
    echo "FAIL $SPEC" >> "$RESULTS"
    echo "✗ $SPEC — log: /tmp/lane-$SPEC.log"
    grep -E "Error:|GATE|DUPLIC" "/tmp/lane-$SPEC.log" | head -5
  fi
done
echo "──────── pipeline-a done ────────"
cat "$RESULTS"
