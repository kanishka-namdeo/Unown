#!/bin/bash
# Catch the post-answer hang on a TOOL-USING session (the acme-api CRLF bugfix shape).
# Usage: bash catch-hang-tool.sh [timeout_wait_seconds]
cd /home/z/my-project/unown
WAIT=${1:-150}
PROJ=/home/z/scratch/acme-api
OUT=/tmp/catch-hang-tool.out
ERR=/tmp/catch-hang-tool.err
rm -f $OUT $ERR

# Reset the project to the broken state (idempotent scratch fixture)
python3 - <<'PYEOF'
open('/home/z/scratch/acme-api/src/dedupe.ts','w').write('''// Remove duplicate rows from a CSV string.
// Rows are separated by \n, fields by commas.
export function dedupeRows(csv: string): string {
  const lines = csv.split("\n");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out.join("\n");
}
''')
PYEOF

nohup bun bin/unown -p "The CRLF test in test/dedupe.test.ts is failing. Fix the bug in src/dedupe.ts so both tests pass, then run the tests to verify." > $OUT 2> $ERR &
BP=$!
echo "bg pid $BP, waiting up to ${WAIT}s for answer..."
T0=$(date +%s)
for w in $(seq 1 $WAIT); do
  sleep 1
  if rg -q "修复|Fixed|fixed|pass" $OUT 2>/dev/null; then
    if kill -0 $BP 2>/dev/null; then
      echo "=== HANG CAUGHT at ${w}s (answer delivered, process alive) ==="
      echo "--- ps ---"; ps -o pid,ppid,stat,wchan:20,etime,comm -p $BP
      echo "--- children ---"; ps --ppid $BP -o pid,ppid,stat,comm,args 2>/dev/null
      echo "--- grandchildren (any bun/bun-test) ---"; ps -eo pid,ppid,stat,comm | rg -i "bun|sh" | rg -v "rg|engine|3031|3030" | head -10
      echo "--- fd targets ---"; for f in /proc/$BP/fd/*; do echo "$f -> $(readlink $f)"; done 2>/dev/null | rg -v "pipe:|/dev/null" | head -25
      echo "--- socket states ---"; for f in /proc/$BP/fd/*; do t=$(readlink $f 2>/dev/null); [[ $t == socket:* ]] && echo "$f $t"; done | head -15
      echo "--- threads ---"; rg Threads /proc/$BP/status
      echo "--- timers? sample /proc/PID/task count ---"; ls /proc/$BP/task | wc -l
      # Wait a bit more to see if it self-resolves
      for w2 in $(seq 1 30); do sleep 1; kill -0 $BP 2>/dev/null || { echo "self-resolved at +${w2}s"; exit 0; }; done
      echo "still alive after +30s — CONFIRMED HANG. Sending SIGTERM to test signal path..."
      kill -TERM $BP 2>/dev/null; sleep 3
      kill -0 $BP 2>/dev/null && { echo "SIGTERM did NOT work — sending SIGKILL"; kill -9 $BP; } || echo "SIGTERM exited cleanly"
      exit 0
    else
      echo "clean exit after answer (${w}s) — no hang"
      exit 1
    fi
  fi
  if ! kill -0 $BP 2>/dev/null; then
    echo "process exited WITHOUT answer after ${w}s (err: $(head -c 200 $ERR))"
    exit 2
  fi
done
echo "no answer within ${WAIT}s (out: $(head -c 100 $OUT) err: $(head -c 200 $ERR))"
kill -9 $BP 2>/dev/null
exit 3
