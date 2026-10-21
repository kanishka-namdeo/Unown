#!/bin/bash
# Foreground-pipeline hang repro with full instrumentation.
# Runs the exact failing shapes in a background wrapper that logs everything,
# so we get diagnostics even if the Bash tool times out.
cd /home/z/my-project/unown
OUT=/tmp/foreground-hang.log
: > $OUT
log() { echo "[$(date +%H:%M:%S)] $*" >> $OUT; }

run_shape() {
  local name="$1"; shift
  log "=== SHAPE $name START ==="
  local T0=$(date +%s)
  "$@" >> $OUT 2>&1 &
  local PIPEPID=$!
  # watch for up to 150s
  for w in $(seq 1 150); do
    sleep 1
    if ! kill -0 $PIPEPID 2>/dev/null; then break; fi
  done
  local T1=$(date +%s)
  if kill -0 $PIPEPID 2>/dev/null; then
    log "SHAPE $name: PIPELINE STILL ALIVE after 150s — HANG CONFIRMED"
    # snapshot process tree around it
    {
      echo "--- ps tree ---"
      ps -eo pid,ppid,stat,comm,args | grep -E "unown|head|tail|timeout|bun" | grep -v grep
      echo "--- bun proc fds ---"
      for p in $(pgrep -f "bin/unown"); do
        echo "PID $p:"; ls -la /proc/$p/fd 2>/dev/null | head -15
        cat /proc/$p/status 2>/dev/null | grep -E "State|Threads"
      done
    } >> $OUT 2>&1
    # cleanup
    pkill -9 -f "bin/unown -p" 2>/dev/null
    kill -9 $PIPEPID 2>/dev/null
  else
    log "SHAPE $name: completed in $((T1-T0))s"
  fi
  log "=== SHAPE $name END ==="
}

# Shape 1: --no-session + head
run_shape "1-no-session-head" bash -c 'timeout 70 bun bin/unown -p "say hi" --no-session 2>&1 | head -5; echo "shape1_rc=$?"'
# Shape 2: time + timeout + tail
run_shape "2-time-timeout-tail" bash -c 'time (timeout 100 bun bin/unown -p "Reply with exactly one word: PONG" 2>&1 | tail -6); echo "shape2_rc=$?"'
log "ALL DONE"
cat $OUT
