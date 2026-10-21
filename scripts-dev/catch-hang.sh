#!/bin/bash
# Catch a post-answer hang live: run a session, wait for the answer to land in
# the file, then inspect the still-alive process (fds, wchan, children).
cd /home/z/my-project/unown
OUT=/tmp/catch-hang.out
ERR=/tmp/catch-hang.err
rm -f $OUT $ERR
nohup bun bin/unown -p "Reply exactly: CAUGHT" > $OUT 2> $ERR &
BP=$!
for w in $(seq 1 60); do
  sleep 1
  if grep -q "CAUGHT" $OUT 2>/dev/null; then
    echo "answer landed after ${w}s — process alive? (kill -0)"
    if kill -0 $BP 2>/dev/null; then
      echo "HANG CAUGHT: process still alive with answer delivered (pid $BP)"
      echo "=== process state ==="
      ps -o pid,stat,wchan:25,etime -p $BP
      echo "=== fds ==="
      ls -la /proc/$BP/fd 2>/dev/null | grep -vE "pipe|null|/dev/" | tail -20
      echo "=== all fd targets ==="
      for f in /proc/$BP/fd/*; do echo "$f -> $(readlink $f)"; done 2>/dev/null | head -25
      echo "=== children ==="
      ps --ppid $BP -o pid,comm,args 2>/dev/null
      echo "=== threads ==="
      grep Threads /proc/$BP/status 2>/dev/null
      # let it sit for the 300s default stall watchdog? No — kill it for the next iteration
      sleep 3
      kill -9 $BP 2>/dev/null
      exit 0
    else
      echo "process exited cleanly after answer (${w}s) — no hang this time"
      exit 1
    fi
  fi
  if ! kill -0 $BP 2>/dev/null; then
    echo "process exited WITHOUT answer after ${w}s (err: $(head -c 100 $ERR))"
    exit 2
  fi
done
echo "no answer within 60s (err: $(head -c 150 $ERR))"
kill -9 $BP 2>/dev/null
exit 3
