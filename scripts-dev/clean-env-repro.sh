#!/bin/bash
# Clean-environment repro: each shape runs under setsid with output ONLY to files.
# If shapes complete promptly here, the "hang" was a shell-session artifact.
cd /home/z/my-project/unown
R=/tmp/clean-repro
mkdir -p $R
: > $R/summary.txt

shape() {
  local name="$1"; local script="$2"
  local T0=$(date +%s)
  setsid bash -c "$script" > $R/$name.out 2> $R/$name.err < /dev/null &
  local SID=$!
  for w in $(seq 1 90); do
    sleep 1
    if ! kill -0 $SID 2>/dev/null; then break; fi
  done
  local T1=$(date +%s)
  if kill -0 $SID 2>/dev/null; then
    echo "$name: HANG >90s" >> $R/summary.txt
    echo "  live procs in session:" >> $R/summary.txt
    ps -eo pid,pgid,sid,stat,comm,args | grep -E "unown|head|tail" | grep -v grep >> $R/summary.txt
    # kill the whole session
    kill -9 -$SID 2>/dev/null
  else
    echo "$name: completed in $((T1-T0))s out=[$(head -c 40 $R/$name.out | tr '\n' ' ')]" >> $R/summary.txt
  fi
}

shape s1 'timeout 70 bun /home/z/my-project/unown/bin/unown -p "say hi" --no-session 2>&1 | head -5'
shape s2 'time (timeout 100 bun /home/z/my-project/unown/bin/unown -p "Reply with exactly one word: PONG" 2>&1 | tail -6)'
shape s3 'timeout -k 5 60 bun /home/z/my-project/unown/bin/unown -p "Reply PONG" 2>&1 | tail -3 > /tmp/clean-repro/s3.redirect.log'
echo "DONE $(date +%H:%M:%S)" >> $R/summary.txt
