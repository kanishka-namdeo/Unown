#!/usr/bin/env python3
"""verify_plan_mode_matrix.py — the 2026-11-09 plan-mode × TUI round's lane.

Drives the REAL unown TUI through the plan-mode combination matrix and exits
0 only when every surface holds. Two phases:

Phase 1 (default — no model turns, deterministic):
  the entry/exit keyboard matrix — Shift+Tab's full cycle (default →
  acceptEdits → plan → default), Ctrl+Alt+P toggle, /plan bare, /plan off,
  /plan show, /plan <description>, and the --plan boot notice parity lane.

Phase 2 (--live, real model turns through the configured provider):
  the approval-gate combination matrix — the four options render, the full
  navigation set (Down/Up, j/k, Home/End, PageUp/PageDown), Esc-dismiss →
  the stay-loop contract (no re-offer while the user has not spoken again),
  the user re-arms with a message, approve via Enter, execution completes
  with "Plan complete", and the seeded-todo discipline (no duplicate
  creates) is verified against the session transcript.

The 2026-11-09 round's receipts live in docs/plan-mode-tui-combo-round-session.md.
Usage:
  python3 scripts/tui-capture/verify_plan_mode_matrix.py          # phase 1
  python3 scripts/tui-capture/verify_plan_mode_matrix.py --live   # both phases
"""
from __future__ import annotations

import glob
import json
import os
import sys
import time

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _SCRIPT_DIR)
import pty_common as pc  # noqa: E402

SHIFT_TAB = b"\x1b[Z"
CTRL_ALT_P = b"\x1b\x10"
HOME = b"\x1b[H"
END = b"\x1b[F"
PGUP = b"\x1b[5~"
PGDN = b"\x1b[6~"

STEPS: list[tuple[str, bool]] = []


def note(log, name, ok, extra=""):
    STEPS.append((name, ok))
    log(f"[STEP] {'PASS' if ok else 'FAIL'}  {name}  {extra}")


def gate_open(s) -> bool:
    return "Plan ready — " in s.pane_text()


def clear_gates(s, rounds=6) -> bool:
    """Esc any open approval gates until the editor is back."""
    for _ in range(rounds):
        s.pump(0.4)
        if "Plan ready — " not in s.pane_text():
            return True
        s.key("Esc")
        s.pump(0.6)
    return "Plan ready — " not in s.pane_text()


def scratch_dir() -> str:
    """A tiny scratch project the matrix can plan against (never the repo)."""
    import tempfile

    d = os.environ.get("PTY_CWD") or os.path.join(tempfile.mkdtemp(prefix="unown-matrix-"))
    os.makedirs(d, exist_ok=True)
    app = os.path.join(d, "app.py")
    if not os.path.exists(app):
        with open(app, "w") as f:
            f.write("def add(a, b):\n    return a + b\n")
    return d


def phase1(log, cwd) -> bool:
    """Entry/exit keyboard matrix — no model turns required."""
    s = pc.UnownPty(log, cwd=cwd)
    try:
        s.wait_ready(timeout=90)
        pc.dismiss_first_flights(s, log)
        s.wait_idle(15)

        def key_seq(name, data, anchors, timeout=20):
            try:
                s._send_drained(data)
                s.wait_for(anchors, mode="any", timeout=timeout, desc=name)
                note(log, name, True)
            except pc.PaneTimeout:
                note(log, name, False, s.pane_text()[-200:])

        key_seq("shift+tab: default → acceptEdits", SHIFT_TAB, ["Permission mode: acceptEdits"])
        key_seq("shift+tab: acceptEdits → plan", SHIFT_TAB, ["Plan mode ON (V3 orchestrator)"])
        s.still("m1-plan-via-shift-tab", ["PLAN"])
        key_seq("shift+tab: plan → default", SHIFT_TAB, ["Plan mode OFF — full tool access restored"])
        key_seq("ctrl+alt+p ON", CTRL_ALT_P, ["Plan mode ON (V3 orchestrator)"])
        key_seq("ctrl+alt+p OFF", CTRL_ALT_P, ["Plan mode OFF — full tool access restored"])
        try:
            s.type_prompt("/plan")
            s.wait_for(["Plan mode ON (V3 orchestrator)"], timeout=20)
            note(log, "/plan (bare toggle ON)", True)
        except pc.PaneTimeout:
            note(log, "/plan (bare toggle ON)", False)
        try:
            s.type_prompt("/plan off")
            s.wait_for(["Plan mode OFF — full tool access restored"], timeout=20)
            note(log, "/plan off", True)
        except pc.PaneTimeout:
            note(log, "/plan off", False)
        try:
            s.type_prompt("/plan show")
            s.pump(1.2)
            note(log, "/plan show answers", "plan" in s.pane_text().lower())
        except Exception:
            note(log, "/plan show answers", False)
        try:
            s.type_prompt("/plan add a matrix helper")
            s.wait_for(["Plan mode ON (V3 orchestrator)"], timeout=20)
            note(log, "/plan <description> seeds the objective", True)
            s.still("m2-plan-seeded", ["PLAN"])
            s.type_prompt("/plan off")
            s.wait_for(["Plan mode OFF — full tool access restored"], timeout=20)
        except pc.PaneTimeout:
            note(log, "/plan <description> seeds the objective", False)
    finally:
        s.close()
    return all(ok for _, ok in STEPS)


def phase1_boot(log, cwd) -> bool:
    """The --plan boot lane: the entry notice parity (2026-11-09 fix)."""
    s = pc.UnownPty(log, cwd=cwd, extra_args=["--plan"])
    try:
        s.wait_ready(timeout=90)
        pc.dismiss_first_flights(s, log)
        s.pump(2.5)
        pane = s.pane_text()
        note(log, "--plan boot: PLAN chip + entry notice",
             "PLAN" in pane and "Plan mode ON (V3 orchestrator)" in pane)
        s.still("m3-plan-boot", ["Plan mode ON"])
        s.type_prompt("/plan off")
        s.wait_for(["Plan mode OFF — full tool access restored"], timeout=20)
    finally:
        s.close()
    return all(ok for _, ok in STEPS)


def phase2(log, cwd) -> bool:
    """The approval-gate matrix + stay-loop + execution loop (live model)."""
    s = pc.UnownPty(log, cwd=cwd)
    try:
        s.wait_ready(timeout=90)
        pc.dismiss_first_flights(s, log)
        s.wait_idle(15)

        s.type_prompt("/plan add a matrix helper function with a test")
        s.wait_for(["Plan mode ON (V3 orchestrator)"], timeout=30)
        s.wait_idle(15)
        s.pump(0.5)

        # the gate timeout is env-overridable: a metered upstream (~20 RPM)
        # can stretch a full V3 planning pass (audit + specialists) well past
        # 5 minutes under throttling.
        gate_timeout = float(os.environ.get("MATRIX_GATE_TIMEOUT", "480"))
        try:
            s.wait_for(["Plan ready — "], timeout=gate_timeout, desc="approval gate")
            note(log, "gate opens after planning", True)
        except pc.PaneTimeout:
            note(log, "gate opens after planning", False, s.pane_text()[-300:])
            return False
        pane = s.pane_text()
        note(log, "gate renders the 4 documented options", all(
            opt in pane for opt in [
                "Execute — auto-accept edits",
                "Execute — approve each edit",
                "Edit the plan",
                "Keep planning (send feedback)",
            ]))
        note(log, "initial selection is option 1", "→ 1. " in pane)
        s.still("m4-gate", ["Plan ready — "])

        def nav(name, data, marker):
            if not gate_open(s):
                note(log, name, False, "(gate closed)")
                return
            s._send_drained(data)
            s.pump(0.5)
            note(log, name, marker in s.pane_text())

        nav("Down → 2", b"\x1b[B", "→ 2. ")
        nav("Down → 3", b"\x1b[B", "→ 3. ")
        nav("Down → 4", b"\x1b[B", "→ 4. ")
        nav("Up → 3", b"\x1b[A", "→ 3. ")
        nav("Home → 1", HOME, "→ 1. ")
        nav("End → 4", END, "→ 4. ")
        nav("PageUp → 1", PGUP, "→ 1. ")
        nav("PageDown → 4", PGDN, "→ 4. ")
        nav("k → 3", b"k", "→ 3. ")
        nav("j → 4", b"j", "→ 4. ")

        # --- the stay-loop contract: dismiss, then quiet ---
        s.key("Esc")
        deadline = time.time() + 40
        reoffered = False
        while time.time() < deadline:
            s.pump(0.5)
            if "Plan ready — " in s.pane_text():
                reoffered = True
                break
        note(log, "stay-loop: no re-offer until the user speaks again", not reoffered)
        s.still("m5-after-stay", ["plan"])
        clear_gates(s)

        # --- the user re-arms with a message; approve; execute ---
        s.type_prompt("the plan is fine — offer it for approval again")
        try:
            s.wait_for(["Plan ready — "], timeout=240, desc="re-offer after user message")
            note(log, "user message re-arms the gate", True)
            s.key("Enter")
            s.wait_for(["Plan complete"], timeout=420, desc="execution complete")
            note(log, "approve → execute → Plan complete", True)
            s.still("m6-complete", ["Plan complete"])
        except pc.PaneTimeout:
            note(log, "user message re-arms the gate", False, s.pane_text()[-300:])

        # --- the seeded-todo discipline (the 2026-11-09 instruction fix) ---
        latest = sorted(glob.glob(os.path.expanduser("~/.unown/agent/sessions/*.jsonl")))[-1]
        seeds = creates = updates = 0
        for line in open(latest):
            try:
                m = json.loads(line)
            except Exception:
                continue
            if m.get("type") == "custom" and m.get("customType") == "unown-todo-state":
                action = (m.get("data") or {}).get("action")
                if action == "seed":
                    seeds += 1
                elif action == "create":
                    creates += 1
                elif action == "update":
                    updates += 1
        note(log, f"todo discipline (seeds={seeds} creates={creates} updates={updates})",
             seeds >= 1 and creates == 0)
    finally:
        s.close()
    return all(ok for _, ok in STEPS)


def main() -> int:
    log = pc.make_logger("verify-plan-mode-matrix")
    live = "--live" in sys.argv
    cwd = scratch_dir()
    log(f"matrix cwd: {cwd} (override with PTY_CWD)")
    phase1(log, cwd)
    phase1_boot(log, cwd)
    if live:
        phase2(log, cwd)
    else:
        log("phase 2 (--live) skipped — pass --live for the approval-gate matrix")
    log("=== SUMMARY ===")
    for name, ok in STEPS:
        log(f"  {'PASS' if ok else 'FAIL'}  {name}")
    failed = [name for name, ok in STEPS if not ok]
    log(f"{'ALL GREEN' if not failed else 'FAILURES: ' + '; '.join(failed)}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
