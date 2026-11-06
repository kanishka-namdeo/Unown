#!/usr/bin/env bash
# battery.sh — the gate-lane receipt runner (the V-31 law: battery claims
# are valid only for the FINAL tree; V-3: no tree writes while it runs).
#
# Usage: battery.sh [--quick] [lanes...]
#   --quick   skip the e2e lanes (fast pre-flight)
#   lanes     named subset, e.g. battery.sh typecheck lint
set -o pipefail

REPO="${UNOWN_REPO:-/home/z/my-project/unown}"
export PATH="/home/z/.bun/bin:/home/z/.local/bin:$PATH"
cd "$REPO" || exit 1

QUICK=0
if [[ "${1:-}" == "--quick" ]]; then QUICK=1; shift; fi
WANTED=()
if (( $# > 0 )); then W=("$@"); WANTED=("${W[@]}"); fi

ALL_LANES=(typecheck lint test:unit check:docs check:changelog check:blog check:benchmarks check:claims ostinato:e2e chaconne:test chaconne:e2e)
E2E_LANES=(ostinato:e2e chaconne:e2e)

run_lane() {
  local lane="$1"
  local t0=$SECONDS
  case "$lane" in
    typecheck)        bun run typecheck ;;
    lint)             bun run lint ;;
    test:unit)        bun run test:unit ;;
    check:docs)       bun run check:docs ;;
    check:changelog)  bun run check:changelog ;;
    check:blog)       bun run check:blog ;;
    check:benchmarks) bun run check:benchmarks ;;
    check:claims)     bun run check:claims ;;
    ostinato:e2e)     bun run ostinato:e2e ;;
    chaconne:test)    bun run chaconne:test ;;
    chaconne:e2e)     bun run chaconne:e2e ;;
    *) echo "unknown lane: $lane"; return 2 ;;
  esac
}

PASS_LIST=""
FAIL_LIST=""
for lane in "${ALL_LANES[@]}"; do
  # lane selection: explicit list, or all (minus e2e when --quick)
  if (( ${#WANTED[@]} > 0 )); then
    skip=1
    for w in "${WANTED[@]}"; do [[ "$w" == "$lane" ]] && skip=0; done
    (( skip )) && continue
  else
    if [[ $QUICK -eq 1 ]]; then
      skip=0
      for e in "${E2E_LANES[@]}"; do [[ "$e" == "$lane" ]] && skip=1; done
      (( skip )) && continue
    fi
  fi
  echo ""
  echo "===== LANE: $lane ====="
  if run_lane "$lane" > "/tmp/battery-$lane.log" 2>&1; then
    PASS_LIST="$PASS_LIST $lane"
    tail -n 2 "/tmp/battery-$lane.log" | sed 's/^/  | /'
    echo "  -> PASS"
  else
    FAIL_LIST="$FAIL_LIST $lane"
    tail -n 15 "/tmp/battery-$lane.log" | sed 's/^/  | /'
    echo "  -> FAIL"
  fi
done

echo ""
echo "===== BATTERY SUMMARY ====="
for lane in $PASS_LIST; do echo "  PASS  $lane"; done
for lane in $FAIL_LIST; do echo "  FAIL  $lane  (log: /tmp/battery-$lane.log)"; done
if [[ -z "$FAIL_LIST" ]]; then echo "ALL GREEN"; else echo "RED LANES:$(echo "$FAIL_LIST" | wc -w)"; exit 1; fi
