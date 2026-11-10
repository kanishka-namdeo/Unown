#!/usr/bin/env python3
"""verify_approve_each_edit_resume.py — the 2026-11-10 round 2's review
hardening, live: the manual approval posture (seedSessionAsk) must survive a
session resume.

A crash/exit mid-execution after "Execute — approve each edit" used to
restore the plan's execution on resume WITHOUT the per-edit ask rules —
the zero-dialog defect the round measured, silently re-opened by the
resume. The fix: the unown-plan-mode session entry carries approvalMode
and the restore path re-seeds.

The lane: approve a tiny plan with option 2, answer the FIRST per-edit ask
(Allow once), kill the process mid-execution, resume with `unown -c`, then
read /permissions — the resumed session must show the seeded ask rules
("N ask rule(s) seeded (per-edit approval active)"), and the next edit
must prompt again (the census continues). Exit 0 only when both hold.

Usage: PATH=<bun> python3 scripts/tui-capture/verify_approve_each_edit_resume.py
"""
from __future__ import annotations

import os
import sys
import tempfile
import time

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _SCRIPT_DIR)
import pty_common as pc  # noqa: E402

GATE_TITLE = "Plan ready — "
ASK_MARKER = "unown permissions:"
SEEDED_RENDER = "ask rule(s) seeded (per-edit approval active)"
MODE_DEFAULT = "Permission mode: default"

results: list[tuple[str, bool]] = []


def note(log, name, ok, extra=""):
    results.append((name, ok))
    log(f"[STEP] {'PASS' if ok else 'FAIL'}  {name}  {extra}")


def main() -> int:
    log = pc.make_logger("verify-approve-each-edit-resume")
    cwd = os.environ.get("PTY_CWD") or tempfile.mkdtemp(prefix="unown-resume-ask-")
    os.makedirs(cwd, exist_ok=True)
    app = os.path.join(cwd, "app.py")
    if not os.path.exists(app):
        with open(app, "w") as f:
            f.write("def add(a, b):\n    return a + b\n")
    gate_timeout = float(os.environ.get("MATRIX_GATE_TIMEOUT", "480"))

    # ---- phase A: approve with option 2, answer one ask, kill mid-execution
    s = pc.UnownPty(log, cwd=cwd)
    session_file = ""
    asks_before_kill = 0
    completed_in_a = False
    import glob as _glob
    before = set(_glob.glob(os.path.expanduser("~/.unown/agent/sessions/*.jsonl")))
    try:
        s.wait_ready()
        pc.dismiss_first_flights(s, log)
        s.wait_idle(15)
        s.type_prompt("/plan add a tiny clamp helper with a test")
        s.wait_for(["Plan mode ON (V3 orchestrator)"], timeout=30)
        s.wait_for([GATE_TITLE], timeout=gate_timeout, desc="approval gate")

        s._send_drained(b"2")
        s.wait_for([MODE_DEFAULT], timeout=60, desc="Permission mode: default")
        # answer the first per-edit ask (Allow once), then kill MID-execution:
        # the moment one dialog is answered, let the entry settle (~4 s) and
        # break — waiting longer races the plan COMPLETING (the last persisted
        # entry would then be the completion state, and the resume correctly
        # restores a non-executing session with no posture to re-seed).
        deadline = time.time() + 120
        armed = True
        while time.time() < deadline:
            s.pump(0.35)
            pane = s.pane_text()
            if ASK_MARKER in pane or "matched ask rule" in pane:
                if armed:
                    asks_before_kill += 1
                    log(f"ask dialog #{asks_before_kill} observed — answering digit 1 (Allow once)")
                    s._send_drained(b"1")
                    time.sleep(0.7)
                    armed = False
                continue
            armed = True
            if asks_before_kill >= 1:
                # let the approval + the post-edit entries settle, then kill
                s.pump(3.0)
                break
            if "Plan complete" in pane:
                completed_in_a = True
                break
        after = set(_glob.glob(os.path.expanduser("~/.unown/agent/sessions/*.jsonl")))
        new_files = sorted(f for f in after - before)
        session_file = new_files[-1] if new_files else ""
        note(log, f"option 2 arms the per-edit posture (asks seen: {asks_before_kill})",
             asks_before_kill >= 1)
        # kill MID-execution: terminate without any graceful shutdown dance
        try:
            s.child.terminate(force=True)
        except Exception:
            pass
    finally:
        try:
            s.close()
        except Exception:
            pass

    if not session_file:
        log("FATAL: no session file identified — cannot resume")
        note(log, "the session file was found", False)
        _summarize(log)
        return 1
    note(log, "the session file was found", True)

    # ---- phase B: resume — the posture must survive
    s2 = pc.UnownPty(log, cwd=cwd, extra_args=["-c"])
    asks_after_resume = 0
    try:
        s2.wait_ready(timeout=240, anchors=["? help", "esc-esc tree"])
        pc.dismiss_first_flights(s2, log)
        s2.pump(1.0)
        # the rendered permission status is the direct receipt of the re-seed
        s2.type_prompt("/permissions")
        s2.pump(1.5)
        pane = s2.pane_text()
        # /permissions opens the manager — the status view is 'status'
        if "Permissions" in pane and "session:" not in pane:
            s2.type_prompt("status")
            s2.pump(1.5)
            pane = s2.pane_text()
        note(log, "the resumed session reports the seeded ask rules (the posture survived)",
             SEEDED_RENDER in pane)
        s2.still("r1-resume-permissions", [SEEDED_RENDER], mode="any")

        # The census, made deterministic-ish: a DIRECT trivial edit instruction
        # forces an edit/write call in the resumed session — with the re-seeded
        # rules it MUST prompt. (Watching the plan's own continuation proved
        # model-dependent: the resumed model may legitimately re-plan instead
        # of mutating files, which made the census vacuous, not wrong.)
        s2.type_prompt("add a trailing comment line to the end of app.py")
        deadline = time.time() + 180
        armed = True
        prompted = False
        while time.time() < deadline:
            s2.pump(0.35)
            pane = s2.pane_text()
            if ASK_MARKER in pane or "matched ask rule" in pane:
                if armed:
                    asks_after_resume += 1
                    prompted = True
                    log(f"resumed ask dialog #{asks_after_resume} observed — answering digit 1 (Allow once)")
                    s2.still("r2-resume-ask-fires", [ASK_MARKER], mode="any")  # while it is on the pane
                    s2._send_drained(b"1")
                    time.sleep(0.7)
                    armed = False
                continue
            armed = True
            if prompted and ASK_MARKER not in pane:
                break  # answered; the edit proceeds
        note(log, f"the resumed session prompts on a direct edit (asks: {asks_after_resume})",
             prompted)
    finally:
        s2.close()
    _summarize(log)
    return 0 if all(ok for _, ok in results) else 1


def _summarize(log):
    log("=== SUMMARY ===")
    failed = [n for n, ok in results if not ok]
    for n, ok in results:
        log(f"  {'PASS' if ok else 'FAIL'}  {n}")
    log(f"{'ALL GREEN' if not failed else 'FAILURES: ' + '; '.join(failed)}")


if __name__ == "__main__":
    sys.exit(main())
