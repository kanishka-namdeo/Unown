#!/bin/bash
# poll.sh — wait for a launched nocturne session to finish.
# Usage: poll.sh <name> [max-seconds]   (default 540; exits 0 running, 1 done)
set -u
cd "$(dirname "$0")/../../.." || exit 1
DIR="benchmarks/website-excellence-round/sessions"
NAME="${1:?session name}"
MAXS="${2:-540}"
PIDF="$DIR/${NAME}.pid"
[ -f "$PIDF" ] || { echo "no pidfile for $NAME"; exit 2; }
PID="$(cat "$PIDF")"
WAITED=0
while [ "$WAITED" -lt "$MAXS" ]; do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "DONE: $NAME exited after ${WAITED}s"
    if [ -s "$DIR/${NAME}-envelope.json" ]; then
      python3 - "$DIR/${NAME}-envelope.json" <<'EOF'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    u = d.get("usage", {})
    print(f"  subtype: {d.get('subtype')} | turns: {d.get('num_turns')} | capped: {d.get('capped')}")
    print(f"  tokens: {u.get('input_tokens')} / {u.get('output_tokens')} | wall: {round(d.get('duration_ms',0)/1000)}s")
    r = (d.get("result") or "")[:300]
    if r: print(f"  result: {r}")
except Exception as e:
    print(f"  envelope parse issue: {e}")
EOF
    else
      echo "  (envelope empty — session was killed or crashed; see stderr)"
    fi
    exit 1
  fi
  sleep 10
  WAITED=$((WAITED + 10))
done
echo "RUNNING: $NAME still alive after ${MAXS}s (pid $PID)"
exit 0
