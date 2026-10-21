#!/bin/bash
# Detachment benchmark harness — architectural metrics, before/after.
# Measures: CLI boot footprint (DB handles opened?), engine idle RSS/CPU,
# stack startup time, note-delivery latency, engine recovery after crash,
# CLI cold-start wall time. Run: ./scripts-dev/arch-bench.sh <before|after>
set -u
PHASE="${1:-before}"
R="/tmp/arch-bench-$PHASE"
mkdir -p "$R"
cd /home/z/my-project/unown
log() { echo "$1" >> "$R/results.txt"; }
: > "$R/results.txt"
log "=== arch-bench $PHASE — $(date -Iseconds) ==="

# 1) CLI cold-start: does the terminal agent open the ENGINE DB? how long?
for i in 1 2 3; do
  T0=$(date +%s%N)
  OUT=$(timeout 60 bun bin/unown -p "Reply exactly: OK" 2>/dev/null | head -1)
  T1=$(date +%s%N)
  MS=$(( (T1-T0)/1000000 ))
  log "cli_cold_start_ms[$i]: $MS out:[$OUT]"
done
# DB-handle probe: run CLI and, while alive, count selflearning.db fds.
(timeout 60 bun bin/unown -p "Reply exactly: OK" > "$R/dbprobe.out" 2>&1 &) 
sleep 6
FD_COUNT=0
for p in $(pgrep -f "bin/unown -p"); do
  N=$(ls -la /proc/$p/fd 2>/dev/null | grep -c selflearning || true)
  FD_COUNT=$((FD_COUNT+N))
done
log "cli_opens_engine_db_fds: $FD_COUNT (0 = properly detached)"

# 2) Engine idle footprint
EPID=$(cat .run/engine.pid 2>/dev/null)
if [ -n "$EPID" ] && kill -0 "$EPID" 2>/dev/null; then
  RSS=$(ps -o rss= -p "$EPID" | tr -d ' ')
  CPU=$(ps -o %cpu= -p "$EPID" | tr -d ' ')
  log "engine_idle_rss_kb: $RSS"
  log "engine_idle_cpu_pct: $CPU"
  FDs=$(ls /proc/$EPID/fd 2>/dev/null | wc -l)
  log "engine_fd_count: $FDs"
else
  log "engine_idle: NOT RUNNING"
fi

# 3) Note delivery latency (CLI session shutdown → engine notes count)
BEFORE_NOTES=$(curl -s localhost:3030/api/overview | python3 -c "import sys,json;print(json.load(sys.stdin)['kpis']['notes']['total'])" 2>/dev/null || echo "?")
timeout 60 bun bin/unown -p "benchmark note delivery latency test $(date +%s)" > /dev/null 2>&1
for w in $(seq 1 20); do
  sleep 0.5
  AFTER_NOTES=$(curl -s localhost:3030/api/overview | python3 -c "import sys,json;print(json.load(sys.stdin)['kpis']['notes']['total'])" 2>/dev/null || echo "?")
  if [ "$AFTER_NOTES" != "$BEFORE_NOTES" ] && [ "$AFTER_NOTES" != "?" ]; then break; fi
done
log "note_delivery: before=$BEFORE_NOTES after=$AFTER_NOTES"

# 4) Engine crash recovery: SIGKILL engine, measure time to detect+restart
EPID=$(cat .run/engine.pid 2>/dev/null)
if [ -n "$EPID" ] && kill -0 "$EPID" 2>/dev/null; then
  T0=$(date +%s%N)
  kill -9 "$EPID"
  # attempt restart via the standard script
  (bun scripts/start.ts >> "$R/restart.log" 2>&1 &)
  for w in $(seq 1 120); do
    sleep 1
    if curl -s -m 2 localhost:3030/api/overview > /dev/null 2>&1; then break; fi
  done
  T1=$(date +%s%N)
  log "engine_crash_recovery_ms: $(( (T1-T0)/1000000 ))"
  # orphaned runs should be marked errored at boot (recoverOrphans)
  sleep 2
  ORPHANS=$(curl -s localhost:3030/api/runs | python3 -c "
import sys,json
runs=json.load(sys.stdin)['runs']
print(sum(1 for r in runs if r['status']=='running'))")
  log "runs_stuck_running_after_recovery: $ORPHANS"
else
  log "engine_crash_recovery: SKIPPED (engine not running)"
fi

# 5) Bridge health
log "bridge: $(curl -s -m 3 localhost:3031/health | head -c 200)"
log "=== done $(date -Iseconds) ==="
cat "$R/results.txt"
