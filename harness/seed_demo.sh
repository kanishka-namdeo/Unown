#!/usr/bin/env bash
# seed_demo.sh — offline, keyless end-to-end demo of Unown's whole loop.
#
# The repo intentionally ships one stale fact in docs/RUNBOOK.md ("Dream
# archive" points at memory/dream-archive/ instead of dreams/consolidated/).
# This script:
#   1. runs evals OFFLINE against knowledge surfaces   -> t003 FAILS
#   2. mines failures into weakness clusters           -> w001
#   3. generates an AI-proposal skeleton               -> proposals/<ts>.md
#   4. validates a bundled known-good patch            -> gate PASS, applied
#
# Afterwards: `git diff docs/RUNBOOK.md` shows exactly what v2 changed.
set -euo pipefail
cd "$(dirname "$0")"

echo "== Unown self-improvement demo (offline) =="

./run_evals.py --tag demo-baseline --offline || true
python3 mine_failures.py --run demo-baseline

python3 propose_fix.py --cluster w001 || echo "(proposal template kept for reference)"

cat > proposals/demo-t003-known-good.md <<'PROPOSAL'
# Proposal: fix seeded stale-fact failure in Dream archive section

- generated-by: seed_demo.sh (bundled known-good patch)
- cluster source: weaknesses.json w001 (category: dreaming)

## Evidence

- t003-dream-output-path answered from stale RUNBOOK bullet.
- Real consolidation path is dreams/consolidated/ per dreams/dream.py.

## Expected effect

- flips: t003-dream-output-path to pass because RUNBOOK now names the true
  output directory.

## Diff

```diff
__PATCH__
```

## Regression risk

- none expected; guarded by t001/t002/t004/t005 remaining in suite.
PROPOSAL

python3 - <<'PY'
import pathlib
patch = pathlib.Path("patches/demo-t003.diff").read_text().rstrip("\n")
p = pathlib.Path("proposals/demo-t003-known-good.md")
p.write_text(p.read_text().replace("__PATCH__", patch))
print("known-good proposal staged")
PY

echo ""
echo "-- validation gate --"
python3 validate_fix.py --proposal proposals/demo-t003-known-good.md --offline || GATE=$?

if [[ "${GATE:-0}" -eq 0 ]]; then
  echo ""
  echo "DEMO COMPLETE: v2 promoted."
  echo "See what changed:    git diff docs/RUNBOOK.md"
  echo "Gate artifacts:      verdicts/, runs/demo-baseline/"
else
  echo "Demo gate did not pass (exit ${GATE}). Inspect harness/verdicts/."
fi
