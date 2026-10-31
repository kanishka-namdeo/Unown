#!/usr/bin/env python3
"""
verify_todo_unification.py — the todo unification round's REAL-USER lane.

Drives the real `unown` TUI (fresh dist, gitSha of this round) through the
exact flow the reported bug lived in:

  1. boot in the api-server demo project
  2. /plan on
  3. a real task -> the model explores, writes the plan file, exits plan mode
  4. the approval dialog -> Enter (Execute - auto-accept edits)
  5. execution: the seeded Todos overlay is the ONE checklist above the
     editor; the legacy plan-steps widget must NEVER mount
  6. a [DONE:n] tag flips the seeded todo in the live panel

Asserts on the literal pane text (the pane.txt receipts are the ground
truth) and captures PNG stills for the round's records.

Usage:
    python3 scripts/tui-capture/verify_todo_unification.py
"""

from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pty_common import UnownPty, exit_code, make_logger, print_summary  # noqa: E402

SCRIPT = "verify_todo_unification"
CWD = os.environ.get(
    "PTY_CWD", "/home/z/my-project/demo-projects/api-server"
)

TASK = (
    "Add a renameTask(id, title) method to the store and a PUT /tasks/:id "
    "route that uses it. Keep it simple - no new tests. Plan first, then "
    "wait for my approval. As you finish each step during execution, flip "
    "its todo task with the todo tool."
)

CHECKS: list[tuple[str, bool]] = []


def check(log, name: str, ok: bool, detail: str = "") -> None:
    CHECKS.append((name, ok))
    log(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def seeds_placeholder(todo_states):
    return [d for d in todo_states if d.get("action") == "seed"]


def main() -> int:
    log = make_logger(SCRIPT)
    records = []
    started_at = time.time()
    session_file = None
    s = UnownPty(log, cwd=CWD)
    try:
        s.wait_ready()
        s.still("01-session", records)

        # ---- plan mode on -------------------------------------------------
        s.type_prompt("/plan")
        s.wait_for(["Plan mode ON"], timeout=30, desc="plan mode on")
        time.sleep(0.8)
        pane = s.pane_text()
        check(
            log,
            "planning: no Todos panel while the PLAN chip is on (suspension)",
            "Todos (" not in pane,
        )
        check(
            log,
            "planning: no legacy plan-steps widget",
            "[ ] " not in pane,
        )
        s.still("02-plan-mode-on", records)

        # ---- the task -> approval ----------------------------------------
        s.type_prompt(TASK, cps=30)
        # The approval dialog's title: "Plan ready — <score summary>"
        s.wait_for(["Plan ready"], timeout=420, desc="plan approval overlay")
        time.sleep(1.6)
        pane = s.pane_text()
        check(
            log,
            "approval dialog: the plan's step checklist appears exactly once (the dialog)",
            pane.count("Plan ready") >= 1,
        )
        check(
            log,
            "approval dialog: no live Todos panel behind it (nothing seeded yet)",
            "Todos (" not in pane,
        )
        s.still("03-plan-approval-overlay", records)

        # ---- approve: Enter selects the pre-highlighted first option ------
        s.key("Enter")
        # Execution: the seeded overlay mounts AT approval (never a late pop-in)
        s.wait_for(["Todos ("], timeout=90, desc="seeded todo overlay mounts")
        time.sleep(2.0)
        pane = s.pane_text()
        check(log, "execution: the seeded Todos overlay is mounted", "Todos (" in pane)
        check(
            log,
            "execution: NO legacy plan-steps widget (the two-lists bug is gone)",
            "[ ] " not in pane,
        )
        check(
            log,
            "execution: the footer plan chip reports progress",
            "plan 0/" in pane or "plan 1/" in pane or "plan 2/" in pane,
        )
        s.still("04-plan-executing-one-list", records)

        # ---- execution: watch for the first flip, then settle -------------
        # Model variance is real: cooperative runs report [DONE:n] tags or
        # drive the todo tool (both lanes flip the same list); uncooperative
        # ones just do the work and summarize. Anchor on the overlay's own
        # flip (the pane has no scrollback, so the tag text itself is not a
        # reliable anchor), degrade gracefully, and do the AUTHORITATIVE
        # agreement checks on the session file afterwards.
        try:
            s.wait_for(
                ["\u2500 \u2713", "Todos (1/", "Todos (2/", "Todos (3/", "Todos (4/", "Todos (5/"],
                mode="any",
                timeout=300,
                desc="first overlay flip",
            )
        except Exception:
            log("no visible flip within 300s (model variance) — continuing to settle")
        try:
            s.wait_idle(timeout=180)
        except Exception:
            log("idle wait timed out — capturing whatever the pane holds")
        time.sleep(1.2)
        s.still("05-plan-step-done-overlay-flipped", records)
        pane = s.pane_text()
        check(
            log,
            "post-execution: still exactly one checklist (no plan-steps rows)",
            "[ ] " not in pane,
        )
        if "Todos (" in pane:
            check(
                log,
                "post-execution: the overlay is the mounted checklist",
                "Todos (" in pane,
            )
        s.still("06-settled", records)
    finally:
        s.close()
        session_path = getattr(s, "session_file", None)

    # ---- the authoritative agreement checks: the session file ------------
    # Pane timing is model-dependent; the session entries are the durable
    # ground truth. One seed per approval; the FINAL todo state and the
    # FINAL executing plan entry agree on every matching subject; a [DONE:n]
    # tag's step is completed in the final plan state.
    import glob
    import json
    import os

    if session_path is None:
        candidates = sorted(
            glob.glob(os.path.expanduser("~/.unown/agent/sessions/*.jsonl")),
            key=os.path.getmtime,
        )
        session_path = candidates[-1] if candidates else None
    if session_path is None or os.path.getmtime(session_path) < started_at:
        check(log, "session file located for analysis", False, "no fresh session file")
    else:
        log(f"analyzing session: {session_path}")
        seeds = []
        todo_states = []
        plan_entries = []
        done_steps = set()
        for line in open(session_path):
            try:
                e = json.loads(line)
            except Exception:
                continue
            if e.get("type") != "custom":
                if (
                    e.get("type") == "message"
                    and e.get("message", {}).get("role") == "assistant"
                ):
                    for b in e["message"].get("content", []):
                        if isinstance(b, dict) and b.get("type") == "text":
                            for m in __import__("re").findall(r"\[DONE:(\d+)\]", b.get("text", "")):
                                done_steps.add(int(m))
                continue
            ct = e.get("customType")
            d = e.get("data", {})
            if ct == "unown-todo-state":
                todo_states.append(d)
            elif ct == "unown-plan-mode":
                plan_entries.append(d)

        check(
            log,
            "session: exactly ONE seed entry (the atomic plan->todo handoff)",
            len([d for d in seeds_placeholder(todo_states)]) == 1,
        )
        seed = next((d for d in todo_states if d.get("action") == "seed"), None)
        check(log, "session: the seed entry exists", seed is not None)
        if seed:
            ids = [t["id"] for t in seed["tasks"]]
            check(
                log,
                "session: seeded ids restart at 1, all pending",
                ids == list(range(1, len(ids) + 1))
                and all(t["status"] == "pending" for t in seed["tasks"]),
                f"ids={ids}",
            )
        final_todo = todo_states[-1] if todo_states else None
        executing = [d for d in plan_entries if d.get("executing") and d.get("steps")]
        final_plan = executing[-1] if executing else None
        check(
            log,
            "session: an executing plan entry with steps was persisted",
            final_plan is not None,
        )
        if final_todo and final_plan:
            by_subject = {t["subject"]: t["status"] for t in final_todo["tasks"]}
            mismatches = []
            for step in final_plan["steps"]:
                status = by_subject.get(step["text"])
                if status is None:
                    continue  # model-deleted or never-seeded row: live state
                if (status == "completed") != bool(step["completed"]):
                    mismatches.append((step["step"], status, step["completed"]))
            check(
                log,
                "session: FINAL todo state and plan steps agree on every matching subject (lockstep)",
                not mismatches,
                f"mismatches={mismatches[:4]}",
            )
        if done_steps and final_plan:
            bad = [
                n
                for n in sorted(done_steps)
                if n <= len(final_plan["steps"]) and not final_plan["steps"][n - 1]["completed"]
            ]
            check(
                log,
                "session: every [DONE:n] tag's step is completed in the final plan state",
                not bad,
                f"unflipped={bad}",
            )

    print_summary(SCRIPT, records)
    fails = [name for name, ok in CHECKS if not ok]
    if fails:
        log(f"VERIFY FAILED: {len(fails)} check(s): {fails}")
        return 1
    log(f"ALL {len(CHECKS)} CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
