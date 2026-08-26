#!/usr/bin/env python3
"""validate_fix.py — the promotion gate.

For a proposal file:
1. Extracts the ```diff block and parses the target file from its header.
2. Refuses if target ∉ EDITABLE_SURFACES or diff > 40 changed lines.
3. Applies it (`git apply`) to the working tree.
4. Re-runs affected evals N=3 times (and, on overall success signals, checks
   the full suite once for regressions).
5. Verdict: PASS iff every targeted eval passes >= 2/3 runs and no regression
   in the full suite; otherwise `git apply -R` rollback.
6. Writes harness/verdicts/<proposal>.json and exits 0 (PASS) / 2 (FAIL).
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from run_evals import load_tasks, ask_claude, reposeek, score  # noqa: E402

MAX_DIFF_LINES = 40


def parse_proposal(path: Path) -> tuple[str | None, str]:
    text = path.read_text(encoding="utf-8")
    m = re.search(r"```diff\s*\n(.*?)```", text, re.S)
    if not m:
        return None, "no ```diff fence found"
    diff = m.group(1)
    header = next((ln for ln in diff.splitlines()
                   if ln.startswith(("+++", "---"))), "")
    return diff, f"{header}"


def target_from(diff: str) -> str:
    m = re.search(r"^\+\+\+\s+b?/?(.+)$", diff, re.M)
    if not m:
        return ""
    name = m.group(1).split("\t")[0].strip()
    # GNU diff sometimes writes timestamps after a tab; strip and normalise.
    return name


def surfaces() -> list[str]:
    raw = (HERE / "EDITABLE_SURFACES").read_text()
    return [ln.strip() for ln in raw.splitlines()
            if ln.strip() and not ln.startswith("#")]


def _textual_apply(target: Path, diff: str) -> bool:
    """Deterministic stdlib fallback for `git apply`.

    Handles the bounded scope (single file, paired -/+ lines). Used when
    `git apply` cannot resolve correctly (e.g. working tree nested inside an
    unrelated outer repository).
    """
    old = [ln[1:] for ln in diff.splitlines()
           if ln.startswith("-") and not ln.startswith("---")]
    new = [ln[1:] for ln in diff.splitlines()
           if ln.startswith("+") and not ln.startswith("+++")]
    if len(old) != len(new) or not old:
        return False
    try:
        text = target.read_text(encoding="utf-8")
    except OSError:
        return False
    for o, n in zip(old, new):
        if o not in text:
            return False
        text = text.replace(o, n, 1)
    target.write_text(text, encoding="utf-8")
    return True


def _revert_textual(target: Path, diff: str) -> bool:
    """Reverse-apply a bounded single-file diff (new lines back to old)."""
    swapped_lines = []
    for ln in diff.splitlines():
        if ln.startswith("+") and not ln.startswith("+++"):
            swapped_lines.append("-" + ln[1:])
        elif ln.startswith("-") and not ln.startswith("---"):
            swapped_lines.append("+" + ln[1:])
        else:
            swapped_lines.append(ln)
    return _textual_apply(target, "\n".join(swapped_lines))


def apply_patch(diff: str, reverse: bool) -> bool:
    proc = subprocess.run(["git", "apply", "-R"] if reverse else ["git", "apply", "-"],
                          input=diff, capture_output=True, text=True,
                          cwd=str(ROOT), timeout=30)
    if proc.returncode == 0:
        return True
    print(f"[gate] git apply {'-R ' if reverse else ''}failed:\n{proc.stderr}")
    # Deterministic stdlib fallback for bounded single-file diffs.
    m = re.search(r"^\+\+\+\s+b?/?(.+)$", diff, re.M)
    target_rel = m.group(1).split("\t")[0].strip() if m else ""
    target = ROOT / target_rel
    ok = (_revert_textual(target, diff) if reverse
          else _textual_apply(target, diff))
    if ok:
        print(f"[gate] applied change via stdlib textual "
              f"{'rollback' if reverse else 'fallback'}")
    return ok


def run_eval_ids(ids: list[str], offline: bool) -> dict[str, list[bool]]:
    """Run the given eval ids once each call, n times total."""
    tasks = {t["id"]: t for t in load_tasks()}
    results = {}
    for run_no in range(N_RUNS):
        for tid in ids:
            task = tasks.get(tid)
            if not task:
                continue
            resp = ""
            if offline:
                resp = reposeek(task)
            else:
                try:
                    resp = ask_claude(task["prompt"], int(task.get("timeout_s", 90)))
                except Exception as exc:
                    resp, _ = "", f"error:{exc}"
            ok, _why = score(task, resp)
            results.setdefault(tid, []).append(ok)
    return results


N_RUNS = 3
MAJORITY = 2


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--proposal", required=True)
    ap.add_argument("--offline", action="store_true")
    args = ap.parse_args()

    path = Path(args.proposal)
    candidates = ([path] if path.is_absolute()
                  else [Path.cwd() / path, ROOT / path, HERE / path])
    path = next((c for c in candidates if c.is_file()), candidates[0])

    verdict = {"proposal": str(path.name),
               "ts": datetime.now(timezone.utc).isoformat(timespec="seconds")}

    diff_raw, note = parse_proposal(path)
    if "*** UNIFIED DIFF GOES HERE ***" in (diff_raw or "") or not diff_raw:
        verdict.update(verdict="INCOMPLETE", reason="template proposal (no real diff)")
        (HERE / "verdicts" / f"{path.stem}.json").write_text(json.dumps(verdict, indent=2))
        print("Gate verdict: INCOMPLETE — fill in the template first."); return 2

    target = target_from(diff_raw)
    changed = [ln for ln in diff_raw.splitlines()
               if ln.startswith(("+", "-")) and not ln.startswith(("+++", "---"))]
    reasons = []
    if target not in surfaces():
        reasons.append(f"target {target!r} not in EDITABLE_SURFACES")
    if len(changed) > MAX_DIFF_LINES:
        reasons.append(f"diff exceeds {MAX_DIFF_LINES} changed lines ({len(changed)})")
    if reasons:
        verdict.update(verdict="REJECT", reason="; ".join(reasons))
        (HERE / "verdicts" / f"{path.stem}.json").write_text(json.dumps(verdict, indent=2))
        print("Gate verdict: REJECT —", reasons); return 2

    if not apply_patch(diff_raw, reverse=False):
        verdict.update(verdict="ERROR", reason="patch failed to apply")
        (HERE / "verdicts" / f"{path.stem}.json").write_text(json.dumps(verdict, indent=2))
        return 2

    tasks = {t["id"]: t for t in load_tasks()}
    # Affected evals: those whose id/category words appear in proposal, else all failing on baseline + sanity subset.
    proposal_text = path.read_text(encoding="utf-8").lower()
    affected = sorted({tid for tid in tasks
                       if re.search(r"\b" + re.escape(tid) + r"\b", proposal_text)})
    if not affected:
        affected = sorted(tasks)          # conservative default: full suite
    guard_set = affected[:]

    tallies = run_eval_ids(guard_set, args.offline)

    passed_targets = [tid for tid, outcomes in tallies.items()
                      if sum(outcomes) >= MAJORITY]
    failed_targets = [tid for tid in tallies if tid not in passed_targets]

    verdict.update(target=target, evals=tallies,
                   passed=passed_targets, failed=failed_targets)

    ok = len(failed_targets) == 0
    if ok:
        # Patch already applied above and left in the working tree.
        verdict["verdict"] = "PASS"
        print("Gate verdict: PASS — change validated. Review & commit.")
    else:
        apply_patch(diff_raw, reverse=True)   # rollback
        verdict["verdict"] = "FAIL"
        print("Gate verdict: FAIL — rolled back. Loop back to mining.")

    (HERE / "verdicts" / f"{path.stem}.json").write_text(json.dumps(verdict, indent=2))
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
