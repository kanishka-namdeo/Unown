#!/bin/bash
# M1 live validation: watch the engine for N minutes. Success criteria:
# 1. No runaway dream loop (dream-check fires at most once per 10-min window)
# 2. Budget respected (<= 10 engine LLM calls/hour with the tight validation env)
# 3. No stuck jobs (busyMs resets; watchdog cuts anything > 5 min)
# 4. Engine API stays responsive
cd /home/z/my-project/unown
OUT=/tmp/m1-live-monitor.jsonl
: > $OUT
MINUTES=${1:-15}
END=$(( $(date +%s) + MINUTES * 60 ))
while [ $(date +%s) -lt $END ]; do
  TS=$(date +%s)
  O=$(curl -s -m 3 localhost:3030/api/overview 2>/dev/null)
  if [ -z "$O" ]; then
    echo "{\"ts\":$TS,\"engine\":\"DOWN\"}" >> $OUT
  else
    echo "$O" | python3 -c "
import sys, json
d = json.load(sys.stdin)
r = d.get('router', {})
g = d.get('governor', {})
print(json.dumps({
  'ts': $TS,
  'busy': r.get('busy'),
  'busyMs': r.get('busyMs'),
  'job': r.get('activeJob'),
  'dreams': d['kpis']['dreams'],
  'runs': d['kpis']['totalRuns'],
  'callsHour': g.get('budget', {}).get('callsHour'),
  'tokensHour': g.get('budget', {}).get('tokensHour'),
  'overBudget': g.get('budget', {}).get('overBudget'),
  'breakerOpen': g.get('breaker', {}).get('open'),
}))" >> $OUT 2>/dev/null || echo "{\"ts\":$TS,\"parse\":\"FAIL\"}" >> $OUT
  fi
  sleep 30
done
echo "{\"ts\":$(date +%s),\"monitor\":\"DONE\"}" >> $OUT
