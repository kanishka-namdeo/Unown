#!/usr/bin/env bash
# run_lane.sh — one TUI-capture lane, end to end: fixture prep → driver →
# assemble (mp4/webm/gif) → the three audit gates (pane-truth stills, frame
# scan, VLM video samples) → the md5 distinctness check that would have
# caught the shipped duplicate-poster defect.
#
# Usage:  bash scripts/tui-capture/run_lane.sh <spec-name> [prep-case]
#   e.g.  bash scripts/tui-capture/run_lane.sh s5-review s5-review
#         bash scripts/tui-capture/run_lane.sh s13-websearch default
set -uo pipefail
REPO="${UNOWN_ROOT:-/home/z/my-project/Unown}"
SPEC="$1"
PREP="${2:-default}"
LANE="${SPEC#s*-}"   # s13-websearch -> websearch (spec name inside the file)
LANE="$(node -e "console.log(require('$REPO/scripts/tui-capture/scenarios/$SPEC.js').name)")"
OUT="${OUT_ROOT:-/home/z/my-project/download/unown-tui-captures}"
LOG="/tmp/cap-$LANE.log"

cd "$REPO"
echo "════ lane $LANE (spec $SPEC, prep '$PREP') ════"

# 1. fixture prep (skip with prep-case 'none' for repo lanes)
if [ "$PREP" != "none" ]; then
  bash scripts/tui-capture/prep_demo.sh "$PREP" > /tmp/prep-$LANE.log 2>&1 || { echo "PREP FAILED"; tail -5 /tmp/prep-$LANE.log; exit 1; }
fi

# 1b. a lane re-run starts from a clean output dir — renamed or dropped
# stills from an older run otherwise linger in stills/ and fail the audit
# with "no pane dump found" (the dump lives in THIS run's capture.log).
rm -rf "$OUT/$LANE"

# 2. the capture (time-boxed; the driver saves everything on SIGTERM)
timeout 575 node scripts/tui-capture/driver.js "scripts/tui-capture/scenarios/$SPEC.js" > "$LOG" 2>&1
CAP=$?
grep -E "still →|stopped|Error:" "$LOG" | tail -12
if [ $CAP -ne 0 ]; then echo "════ CAPTURE FAILED (exit $CAP) — see $LOG"; exit 1; fi

# 3. stills must exist
N_STILLS=$(ls "$OUT/$LANE/stills/"*.png 2>/dev/null | wc -l)
echo "stills: $N_STILLS"
[ "$N_STILLS" -eq 0 ] && { echo "NO STILLS"; exit 1; }

# 4. assemble the three formats
python3 scripts/tui-capture/assemble.py "$LANE" > /tmp/asm-$LANE.log 2>&1 || { echo "ASSEMBLE FAILED"; tail -5 /tmp/asm-$LANE.log; exit 1; }
tail -3 /tmp/asm-$LANE.log

# 5. audit gates
FAIL=0
python3 scripts/tui-capture/audit_stills.py "$LANE" 2>&1 | tail -2 || FAIL=1
python3 scripts/tui-capture/scan_frames.py "$LANE" 2>&1 | tail -1 || FAIL=1
python3 scripts/tui-capture/audit_video.py "$LANE" 4 2>&1 | tail -2 || FAIL=1

# 6. distinctness: no two stills in this lane may be byte-identical
DUPES=$(md5sum "$OUT/$LANE/stills/"*.png | awk '{print $1}' | sort | uniq -d | wc -l)
if [ "$DUPES" -gt 0 ]; then
  echo "DUPLICATE STILLS within lane ($DUPES):"
  md5sum "$OUT/$LANE/stills/"*.png | sort | awk 'seen[$1]++{print "  dup:", $2}'
  FAIL=1
fi

echo "════ lane $LANE $([ $FAIL -eq 0 ] && echo '✓ ALL GATES GREEN' || echo '✗ GATE FAILURE') ════"
exit $FAIL
