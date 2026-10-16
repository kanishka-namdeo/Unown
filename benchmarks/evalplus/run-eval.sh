#!/usr/bin/env bash
# Official evalplus evaluation pipeline for one model.
#
#   ./run-eval.sh <model-id>
#
# Assumes results/<model>/samples.jsonl exists (164 lines, from gen-samples.mjs).
# Steps (all official evalplus CLI, no patches):
#   1. evalplus.sanitize  -> results/<model>/samples-sanitized.jsonl
#      (official post-processing; receipts in samples.jsonl stay untouched)
#   2. evalplus.evaluate on the sanitized file  -> samples-sanitized_eval_results.json
#      (headline numbers: HumanEval+ pass@1 + base HumanEval pass@1)
#   3. evalplus.evaluate on the raw file         -> samples_eval_results.json
#      (robustness check: fence-stripped model output, no sanitize pass)
#
# NB: use long flag names with `=` (fire misparses some short flags like -i
# into **model_kwargs, which silently triggers the local codegen path).
#
# Output filenames use evalplus-master convention (<name>.eval_results.json);
# --output_file pins them explicitly (legacy _eval_results.json also cleaned).
set -euo pipefail
MODEL="${1:?usage: run-eval.sh <model-id>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PYBIN="${PYBIN:-/home/z/.venv/bin/python}"
export HUMANEVAL_OVERRIDE_PATH="$HERE/dataset/HumanEvalPlus-v0.1.10.jsonl"

cd "$HERE"
D="results/$MODEL"
[ -f "$D/samples.jsonl" ] || { echo "missing $D/samples.jsonl (run gen-samples.mjs first)"; exit 1; }

# stale results would make the evaluator load-previous or prompt interactively
rm -f "$D/samples-sanitized.jsonl" \
      "$D/samples-sanitized.eval_results.json" "$D/samples-sanitized_eval_results.json" \
      "$D/samples.eval_results.json" "$D/samples_eval_results.json"

echo "[run-eval] $MODEL: sanitize (official evalplus.sanitize)"
"$PYBIN" -m evalplus.sanitize "$D/samples.jsonl" --mbpp_version=default | tail -3

echo "[run-eval] $MODEL: evaluate sanitized (official protocol -> headline)"
"$PYBIN" -m evalplus.evaluate humaneval --samples="$D/samples-sanitized.jsonl" \
    --parallel=2 --i_just_wanna_run=True --output_file="$D/samples-sanitized.eval_results.json"

echo "[run-eval] $MODEL: evaluate raw extraction (robustness check)"
"$PYBIN" -m evalplus.evaluate humaneval --samples="$D/samples.jsonl" \
    --parallel=2 --i_just_wanna_run=True --output_file="$D/samples.eval_results.json"

echo "[run-eval] $MODEL done:"
ls -la "$D"
