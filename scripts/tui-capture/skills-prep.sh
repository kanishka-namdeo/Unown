#!/usr/bin/env bash
# skills-prep.sh — drive the REAL self-improvement loop until the engine
# ships a skill, so the s20 dashboard capture shows true shipped-skill rows:
#   1. POST /api/tasks/mint  (curriculum variant — the suite is saturated:
#      every seeded task passes, so the harness has nothing to learn; the
#      mint authors a STRICTLY harder variant, LLM-written + validated)
#   2. POST /api/tasks/<new>/run — if the model fails it, the failure is
#      real learning material
#   3. POST /api/tasks/<failing>/run again — the harness cycle on a failing
#      task: baseline fails -> mine the transcript for the preventing rule
#      -> re-run against patched memory -> ship the rule as a skill
# Loop bounded: max 3 mint+run rounds or 45 minutes, whichever first.
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
REPO="${UNOWN_ROOT:-/home/z/my-project/Unown}"
cd "$REPO"
TOKEN=$(cat data/self-learning/engine.token)
API="http://127.0.0.1:3030"
AUTH="Authorization: Bearer $TOKEN"
LOG=/tmp/skills-prep.log

api() { curl -s -H "$AUTH" "$@"; }
engine_free() { ! api "$API/api/overview" | grep -q '"busy":true'; }

echo "$(date +%H:%M:%S) skills-prep: starting" | tee -a "$LOG"
DEADLINE=$(( $(date +%s) + 5400 ))
ATTEMPTS=0

while [ "$(date +%s)" -lt "$DEADLINE" ] && [ "$ATTEMPTS" -lt 3 ]; do
  SKILLS=$(api "$API/api/skills" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('skills',[])))")
  if [ "$SKILLS" -gt 0 ]; then
    echo "$(date +%H:%M:%S) SKILL SHIPPED ($SKILLS skills) — prep done" | tee -a "$LOG"
    exit 0
  fi

  # mint (engine must be free)
  for _ in $(seq 1 60); do engine_free && break; sleep 20; done
  echo "$(date +%H:%M:%S) minting (attempt $((ATTEMPTS+1)))…" | tee -a "$LOG"
  MINT=$(api -X POST "$API/api/tasks/mint")
  echo "  mint: $(echo "$MINT" | head -c 220)" | tee -a "$LOG"
  NEWID=$(echo "$MINT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('outcome',{}).get('taskId') or d.get('taskId') or '')" 2>/dev/null)
  [ -z "$NEWID" ] && { echo "  no task id — mint skipped/errored"; ATTEMPTS=$((ATTEMPTS+1)); sleep 30; continue; }

  # run it (this is the harness cycle: run -> verify -> maybe mine+ship)
  for _ in $(seq 1 30); do engine_free && break; sleep 20; done
  echo "$(date +%H:%M:%S) running $NEWID…" | tee -a "$LOG"
  RUN=$(api -X POST "$API/api/tasks/$NEWID/run")
  echo "  run: $(echo "$RUN" | head -c 220)" | tee -a "$LOG"
  ATTEMPTS=$((ATTEMPTS+1))

  # wait for the cycle to land
  for _ in $(seq 1 90); do
    engine_free && break
    sleep 20
  done
  CYCLES=$(api "$API/api/cycles" | python3 -c "import json,sys; c=json.load(sys.stdin)['cycles']; print(len(c), '|', c[0].get('status') if c else 'none')")
  echo "$(date +%H:%M:%S) cycles now: $CYCLES" | tee -a "$LOG"
done

SKILLS=$(api "$API/api/skills" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('skills',[])))")
echo "$(date +%H:%M:%S) skills-prep finished: $SKILLS skills" | tee -a "$LOG"
[ "$SKILLS" -gt 0 ] && exit 0 || exit 1
