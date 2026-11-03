#!/usr/bin/env python3
"""
verify_plan_retrospective.py — the C6 lane: drive the V3 plan_retrospective
close-out on an executed plan, through the real TUI, in a real PTY.

Why this lane exists: `plan_retrospective` is execution-mode-guarded (it
refuses unless the session is executing an approved plan with steps) and
print mode is plan-read-only by design (docs/plan-mode-v3.md non-goals), so a
plan close-out cannot ride `unown -p`. When a plan's steps executed across
MANY ticket sessions (the Coda round's C1–C5), no single session carries the
post-approval state — so this lane crafts a session file carrying it (the
todo-overlay lane's proven crafting pattern): `unown-plan-mode` entry with
enabled:false + executing:true + planFile pointing at the REAL plan artifact
+ steps parsed from the plan file itself (all completed). The live session
then calls plan_retrospective with an operator-authored body read from a
receipt file; the tool merges `## Retrospective` into the plan file
surgically and delivers the close-out note to the engine.

Exit 0 = the merge landed in the plan file with the body verbatim and the
original plan sections intact. Stills + pane dumps land in OUT_DIR; the
crafted session file is kept beside them as provenance.

Usage:
  UNOWN_ROOT=/path/to/repo python3 scripts/tui-capture/verify_plan_retrospective.py \
      --plan  benchmarks/plan-mode/results/run-2026-11-02-pt5/pt-5-plan.md \
      --body  <operator file with the retrospective body, V3 grammar> \
      --body-in-repo .unown/receipts/<name>.md \
      [--seed "the plan's objective line"]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pty_common as pc  # noqa: E402


def parse_steps_from_plan(path: str) -> list:
    """Extract the `N. text` rows under '## Steps' — the plan file is the
    single source of truth for step ids/texts; the crafted entry never
    hand-copies them."""
    steps: list = []
    in_steps = False
    with open(path, encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if s.startswith("## "):
                in_steps = s.lower().startswith("## steps")
                continue
            if not in_steps:
                continue
            m = re.match(r"^(\d+)\.\s+(.*)$", s)
            if m:
                steps.append(
                    {"step": int(m.group(1)), "text": m.group(2).strip(), "completed": True}
                )
    return steps


def craft_plan_session(path: str, plan_file_abs: str, steps: list, seed: str, cwd: str) -> str:
    """Write a session .jsonl whose `unown-plan-mode` entry restores the
    post-approval state (approvePlanExecution's exact field values:
    enabled:false, executing:true, planFile at the real artifact)."""
    sid = str(uuid.uuid4())
    now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    lines = [
        json.dumps({"type": "session", "version": 3, "id": sid, "timestamp": now, "cwd": cwd})
    ]
    lines.append(
        json.dumps(
            {
                "type": "custom",
                "customType": "unown-plan-mode",
                "data": {
                    "enabled": False,
                    "executing": True,
                    "steps": steps,
                    "toolsBeforePlanMode": None,
                    "seed": seed,
                    "planFile": plan_file_abs,
                    "planModelId": None,
                    "sessionModelBeforePlan": None,
                },
                "id": f"plan-{sid[:8]}",
                "parentId": None,
                "timestamp": now,
            }
        )
    )
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return sid


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("--plan", required=True, help="path to the executed plan file (repo-relative ok)")
    ap.add_argument("--body", required=True, help="operator file with the retrospective body (V3 grammar, no header)")
    ap.add_argument("--body-in-repo", required=True, help="repo-relative path where the session reads --body")
    ap.add_argument("--seed", default="plan close-out", help="the plan seed recorded in the crafted entry")
    args = ap.parse_args()

    log = pc.make_logger("verify_plan_retrospective")
    repo = os.path.abspath(pc.UNOWN_ROOT)
    plan_abs = os.path.abspath(os.path.join(repo, args.plan)) if not os.path.isabs(args.plan) else os.path.abspath(args.plan)
    if not os.path.isfile(plan_abs):
        log(f"FATAL: plan file not found: {plan_abs}")
        return 2
    steps = parse_steps_from_plan(plan_abs)
    if not steps:
        log("FATAL: no steps parsed from the plan file (is there a '## Steps' section?)")
        return 2
    with open(args.body, encoding="utf-8") as f:
        body = f.read().strip()
    if "- outcome:" not in body:
        log("FATAL: the body does not look like V3 retrospective grammar (no '- outcome:' line)")
        return 2

    out_root = os.environ.get("OUT", "/home/z/my-project/download/unown-c6-retrospective")
    os.makedirs(out_root, exist_ok=True)
    pc.OUT_DIR = os.path.join(out_root, "stills")
    session_path = os.path.join(out_root, "crafted-plan-session.jsonl")
    sid = craft_plan_session(session_path, plan_abs, steps, args.seed, repo)
    log(f"crafted session {sid}: {len(steps)} completed steps, planFile={plan_abs}")

    stills = []
    s = pc.UnownPty(log, cwd=repo, extra_args=["--resume", session_path])
    try:
        pc.dismiss_first_flights(s, log)
        # Resumed boot: the startup block may be off-pane — wait for the pane
        # to settle instead (spinner churn keeps it changing until live).
        s.wait_idle(timeout=90, stable_for=2.0)
        stills.append(s.still("01-boot-resumed", ["unown"], mode="any"))

        # 1. Prove the restored state through the real read-only surface.
        s.type_prompt("/plan show")
        try:
            s.wait_for(["executing"], timeout=30, desc="plan show: executing state")
            stills.append(s.still("02-plan-show", ["executing"]))
        except pc.PaneTimeout:
            log("WARN: /plan show did not show 'executing' on the pane — continuing (the file gate is authoritative)")
        s.pump(1.0)

        # 2. The close-out instruction (short; the body is read from the file
        #    so nothing long rides the PTY).
        instruction = (
            "The approved plan finished executing across this round's tickets - every step is "
            "delivered and verified. Close the plan-mode V3 loop now: read the retrospective body "
            f"from the file {args.body_in_repo} in this repo, then call plan_retrospective ONCE "
            "with EXACTLY that file's content, verbatim - no added header, no code fences, no "
            "rewording. Then reply with one short sentence confirming the merge. Change nothing else."
        )
        s.type_prompt(instruction)
        # The turn: read file -> tool call (merge + engine note) -> reply.
        # Spinner churn keeps the pane changing until the turn settles.
        s.wait_idle(timeout=300, stable_for=3.0)
        try:
            s.wait_for(["Retrospective", "retrospective"], timeout=45, mode="any", desc="merge confirmation on pane")
        except pc.PaneTimeout:
            log("WARN: no merge confirmation visible on the pane — the file gate is authoritative")
        stills.append(s.still("03-after-closeout", []))

        # 3. Quit through the real path (session persistence + note delivery).
        s.type_prompt("/quit")
        s.pump(3.0)
    finally:
        s.close()

    # 4. THE GATE: the plan file carries the merged section, body verbatim,
    #    original sections intact (the surgical-merge contract).
    with open(plan_abs, encoding="utf-8") as f:
        merged = f.read()
    body_lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
    checks = {
        "has_retrospective_header": "## Retrospective" in merged,
        "outcome_line_landed": "- outcome: delivered" in merged,
        "body_landed_verbatim": all(ln in merged for ln in body_lines),
        "original_sections_intact": ("## Steps" in merged and "## Verification" in merged),
        "single_retrospective_section": merged.count("## Retrospective") == 1,
    }
    for k, v in checks.items():
        log(f"gate {k}: {'OK' if v else 'FAIL'}")
    for r in stills:
        log(f"still {r.name}: anchors={'OK' if r.ok else 'n/a'} variance={r.variance:.1f} -> {r.png}")
    ok = all(checks.values())
    print(f"\nverify_plan_retrospective: {'PASS' if ok else 'FAIL'} (stills + provenance: {out_root})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
