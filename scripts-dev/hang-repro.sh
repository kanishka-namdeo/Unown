#!/bin/bash
# Hang repro harness: distinguishes "LLM slow" from "process won't exit".
# Uses file redirection (no pipe); records time-to-output and time-to-exit.
cd /home/z/my-project/unown
RESULTS=/tmp/hang-repro.txt
: > $RESULTS
for i in $(seq 1 ${1:-6}); do
  LOG=/tmp/hr$i.log
  rm -f $LOG
  T0=$(date +%s.%N)
  nohup bun bin/unown -p "Reply PONG" > $LOG 2>&1 &
  BP=$!
  TOUT=""
  TEX=""
  for w in $(seq 1 240); do
    sleep 0.5
    if [ -z "$TOUT" ] && grep -q "PONG" $LOG 2>/dev/null; then
      TOUT=$(date +%s.%N)
    fi
    if ! kill -0 $BP 2>/dev/null; then
      TEX=$(date +%s.%N)
      break
    fi
  done
  if [ -z "$TEX" ]; then
    ST="HANG_NO_EXIT"
    if [ -z "$TOUT" ]; then ST="HANG_NO_OUTPUT"; fi
    KIDS=$(ps --ppid $BP -o pid=,comm= 2>/dev/null | tr '\n' ';')
    echo "run $i: $ST kids=[$KIDS] out_at=${TOUT:-never}" >> $RESULTS
    kill -9 $BP 2>/dev/null
  else
    if [ -z "$TOUT" ]; then TOUT=$TEX; fi
    TOOK=$(echo "$TEX - $T0" | bc)
    echo "run $i: EXIT_OK total=${TOOK}s" >> $RESULTS
  fi
done
cat $RESULTS
