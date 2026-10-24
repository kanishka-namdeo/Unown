#!/usr/bin/env bash
# pipeline-c.sh — the engine dashboard lanes (ports 7626-7629, cwd REPO_ROOT,
# no fixture prep, no in-pane LLM turns): the Learning Lab against real
# cycles, the Router's job table, the Routines manager with the real
# morning-brief routine. Safe to run beside pipeline-a/b — no shared port,
# no shared fixture.
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
export LD_LIBRARY_PATH="$HOME/.local/opt/tmux-root/usr/lib/x86_64-linux-gnu"
REPO="${UNOWN_ROOT:-/home/z/my-project/Unown}"
cd "$REPO"

RESULTS=/tmp/pipeline-c-results.txt
: > "$RESULTS"

for entry in "s17-harness none" "s18-router none" "s19-routines none"; do
  set -- $entry
  SPEC=$1; PREP=$2
  echo "──────── pipeline-c: $SPEC ────────"
  if bash scripts/tui-capture/run_lane.sh "$SPEC" "$PREP" > "/tmp/lane-c-$SPEC.log" 2>&1; then
    echo "PASS $SPEC" >> "$RESULTS"
    echo "✓ $SPEC"
  else
    echo "FAIL $SPEC" >> "$RESULTS"
    echo "✗ $SPEC — log: /tmp/lane-c-$SPEC.log"
    grep -E "Error:|GATE|DUPLIC" "/tmp/lane-c-$SPEC.log" | head -5
  fi
done
echo "──────── pipeline-c done ────────"
cat "$RESULTS"
