#!/bin/bash
# launch.sh — the nocturne round's session launcher (the gallery F0/F2 contract:
# headless run, stdin </dev/null, stdio to files, envelope polled from the log).
#
# Usage:
#   launch.sh new    <name> <prompt-file> [max-turns]
#   launch.sh resume <name> <prompt-file> <session-id> [max-turns]
#
# Detaches via setsid so the session survives the caller's shell exit.
# Writes benchmarks/nocturne-round/sessions/<name>-envelope.json when done.
set -u
cd "$(dirname "$0")/../../.." || exit 1
export PATH="$HOME/.bun/bin:/home/z/.local/bin:$PATH"
MODE="${1:?mode: new|resume}"
NAME="${2:?session name}"
PROMPT_FILE="${3:?prompt file}"
SID=""
MAXTURNS="40"
if [ "$MODE" = "new" ]; then
  MAXTURNS="${4:-40}"
else
  SID="${4:?session id}"
  MAXTURNS="${5:-40}"
fi
DIR="benchmarks/nocturne-round/sessions"
PROMPT="$(cat "$PROMPT_FILE")"

if [ "$MODE" = "new" ]; then
  CMD=(unown -p "$PROMPT" --max-turns "$MAXTURNS" --output-format json)
else
  CMD=(unown --resume "$SID" -p "$PROMPT" --max-turns "$MAXTURNS" --output-format json)
fi

setsid nohup "${CMD[@]}" < /dev/null > "$DIR/${NAME}-envelope.json" 2> "$DIR/${NAME}-stderr.txt" &
PID=$!
echo "$PID" > "$DIR/${NAME}.pid"
echo "launched $NAME (pid $PID, mode $MODE, max-turns $MAXTURNS)"
