#!/usr/bin/env bash
# vivace-round canary rig — the three calibration canaries, frozen + repeatable.
# Usage: bash benchmarks/vivace-round/run-canaries.sh [workdir]
#   workdir defaults to /tmp/vivace-canaries (wiped each run — the V-2 lesson:
#   fixtures are RESET per attempt; pin discipline, §3.2)
# Requires: unown on PATH, bridge+engine up (bun run agent:start), bun.
set -u
export PATH="$HOME/.bun/bin:/home/z/.local/bin:$PATH"
ROOT="$(cd "$(dirname "$0")" && pwd)"
WORK="${1:-/tmp/vivace-canaries}"
OUT="$ROOT/sessions"
mkdir -p "$OUT" "$WORK"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

pass=0; fail=0

# --- C1: trivial codegen + run (provider-chain + tool-use smoke) ----------
rm -rf "$WORK/c1" && mkdir -p "$WORK/c1" && cd "$WORK/c1"
unown -p "Create a file hello.py that prints the result of 2+2, run it with python3, and report the exact output you saw." \
  --output-format json < /dev/null > "$OUT/c1-envelope-$STAMP.json" 2> "$OUT/c1-stderr-$STAMP.txt"
rc=$?
if [ $rc -eq 0 ] && grep -q '"subtype":"success"' "$OUT/c1-envelope-$STAMP.json" && [ "$(python3 hello.py 2>/dev/null)" = "4" ]; then
  echo "C1 PASS (rc=0, hello.py output=4)"; pass=$((pass+1))
else
  echo "C1 FAIL (rc=$rc)"; fail=$((fail+1))
fi

# --- C2: test-fix loop (minimal diff + external verification) --------------
rm -rf "$WORK/c2" && mkdir -p "$WORK/c2" && cp "$ROOT/fixtures/c2/"* "$WORK/c2/" && cd "$WORK/c2"
unown -p "The file sum.test.ts is failing. Fix the code so all tests pass WITHOUT editing the test file. Quote the exact bun test output." \
  --output-format json < /dev/null > "$OUT/c2-envelope-$STAMP.json" 2> "$OUT/c2-stderr-$STAMP.txt"
rc=$?
if [ $rc -eq 0 ] && grep -q '"subtype":"success"' "$OUT/c2-envelope-$STAMP.json" && bun test 2>&1 | grep -q " 0 fail" && git diff --quiet --no-index "$ROOT/fixtures/c2/sum.test.ts" sum.test.ts; then
  echo "C2 PASS (rc=0, tests green, test file untouched)"; pass=$((pass+1))
else
  echo "C2 FAIL (rc=$rc)"; fail=$((fail+1))
fi

# --- C3: delegation + schema (task tool + --output-schema gate) ------------
# NOTE: content-correct but prose-wrapped answers exit 3 by design — that is
# the calibrated behavior class this canary measures (see validation-log V-3).
rm -rf "$WORK/c3" && mkdir -p "$WORK/c3" && cp "$ROOT/fixtures/c3/"* "$WORK/c3/" && cd "$WORK/c3"
unown -p "Use the task tool (subagent delegation) to count the TOTAL number of TODO comment lines across all .ts files in the current directory. Do not count them yourself - delegate the counting. Then report: total_todos, files_with_todos (filenames), delegated (true if the task tool was used)." \
  --output-format json --output-schema schema.json < /dev/null > "$OUT/c3-envelope-$STAMP.json" 2> "$OUT/c3-stderr-$STAMP.txt"
rc=$?
if [ $rc -eq 0 ] && grep -q '"schema_valid":true' "$OUT/c3-envelope-$STAMP.json"; then
  echo "C3 PASS (rc=0, schema valid)"; pass=$((pass+1))
elif [ $rc -eq 3 ]; then
  echo "C3 SCHEMA-FAIL (rc=3, prose-wrapped — the known V-3 class; counts still verifiable in result text)"; fail=$((fail+1))
else
  echo "C3 FAIL (rc=$rc)"; fail=$((fail+1))
fi

echo "---"
echo "canaries: $pass pass / $fail fail-or-known-class · stamp $STAMP"
exit 0
