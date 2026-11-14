#!/usr/bin/env python3
"""verify_plan_mode_matrix.py — the plan-mode × TUI combination matrix lane.

Round 1 (2026-11-09): phases p1 / boot / gate — the entry/exit keyboard
matrix, the --plan boot notice parity, the approval-gate navigation set, the
stay-loop contract and the approve→execute→todo-discipline loop.

Round 2 (2026-11-10, the expansion): the cells round 1 never drove —

  diag        the unknown-flag CLI guard exits loudly with guidance (no TUI)
  v2          the V2 kill switch (UNOWN_PLAN_MODE_V3=0) keyboard matrix,
              /plan show + /plan open no-plan answers, the V2 wordings
  narrow      80x24 and 60x20 terminals: /plan ON + show + off restore
  options     the approval OPTIONS matrix (live): digit quick-select (and
              digit-5 inertness), option 3's in-TUI editor round + re-score
              re-ask, the 6-round editor cap notice, Ctrl+C cancel → the
              stay contract, option 4 feedback → revise → re-offer, option 2
              (approve each edit) → Permission mode: default → execution
              WITH the per-edit ask census (the 2026-11-10 seedSessionAsk
              fix) → Plan complete + todo discipline
  plan-model  the live --plan-model split: boot diagnostics clean, the footer
              rides the sibling, gate + execution on the sibling, planning
              turns counted by model in the session transcript, and the
              unknown-model warning
  budget      --max-turns feeds the plan-turn budget (receipt with the
              computed cap), and UNOWN_PLAN_TURN_BUDGET=0 arms + exits clean

The deterministic phases (p1, boot, diag, v2, narrow) need no model turns.
The live phases (gate, options, plan-model, budget) drive REAL model turns
through the configured provider; the metered upstream can stretch a full V3
planning pass, so the gate timeout is MATRIX_GATE_TIMEOUT-overridable.

The rounds' receipts: docs/plan-mode-tui-combo-round-session.md (round 1),
docs/plan-mode-tui-combo-2-round-session.md (round 2).
Usage:
  python3 scripts/tui-capture/verify_plan_mode_matrix.py            # deterministic
  python3 scripts/tui-capture/verify_plan_mode_matrix.py --live     # everything
  python3 scripts/tui-capture/verify_plan_mode_matrix.py --phases p1,v2
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

V3_ON = "Plan mode ON (V3 orchestrator)"
V2_ON = "Plan mode ON — read-only exploration"
PLAN_OFF = "Plan mode OFF — full tool access restored"
GATE_TITLE = "Plan ready — "
GATE_OPTS = [
    "Execute — auto-accept edits",
    "Execute — approve each edit",
    "Edit the plan",
    "Keep planning (send feedback)",
]
EDITOR_TITLE = "Edit the plan:"
CAP_NOTICE = "Plan editor rounds capped at 6"
FEEDBACK_INPUT = "What should change?"
NO_PLAN_YET = "No plan yet in this session."
NO_PLAN_FILE = "No plan file yet — enter plan mode and draft one first."
ASK_MARKER = "unown permissions:"
MODE_DEFAULT_NOTICE = "Permission mode: default"
PLAN_MODEL_UNKNOWN = "not found — staying on"
PLAN_COMPLETE = "Plan complete"

# The phases in canonical order. The first three are round 1's; the rest are
# the round 2 expansion (options is split into three bounded sub-lanes).
PHASES = ["p1", "boot", "diag", "v2", "narrow", "gate",
          "options-a", "options-b", "options-c", "options",
          "plan-model", "budget"]
LIVE_PHASES = {"gate", "options", "options-a", "options-b", "options-c", "plan-model", "budget"}

_results: list[tuple[str, str, bool]] = []


def note(log, phase, name, ok, extra=""):
    _results.append((phase, name, ok))
    log(f"[STEP] {'PASS' if ok else 'FAIL'}  {name}  {extra}")


def gate_open(s) -> bool:
    return GATE_TITLE in s.pane_text()


def clear_gates(s, rounds=6) -> bool:
    """Esc any open approval gates until the editor is back."""
    for _ in range(rounds):
        s.pump(0.4)
        if GATE_TITLE not in s.pane_text():
            return True
        s.key("Esc")
        s.pump(0.6)
    return GATE_TITLE not in s.pane_text()


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


def latest_session(since: float | None = None) -> str:
    """The newest session file — optionally bounded to files written AFTER a
    phase started (the review hardening: an unattributed read could score a
    PREVIOUS phase's session when the current spawn died before writing
    one, silently greening a census step it never measured)."""
    files = glob.glob(os.path.expanduser("~/.unown/agent/sessions/*.jsonl"))
    if since is not None:
        files = [f for f in files if os.path.getmtime(f) >= since - 5]
    if not files:
        return ""
    return max(files, key=os.path.getmtime)


def plan_phase_turns(path: str):
    """(planning, executing) assistant turns — split at the approval marker."""
    planning = executing = 0
    approved = False
    try:
        for line in open(path, encoding="utf-8", errors="replace"):
            try:
                m = json.loads(line)
            except Exception:
                continue
            if "User has approved" in json.dumps(m):
                approved = True
            msg = m.get("message") if isinstance(m.get("message"), dict) else None
            if msg and msg.get("role") == "assistant":
                if approved:
                    executing += 1
                else:
                    planning += 1
    except OSError:
        pass
    return planning, executing


def todo_census(path: str):
    """(seeds, creates, updates) over the session's unown-todo-state events."""
    seeds = creates = updates = 0
    try:
        for line in open(path, encoding="utf-8", errors="replace"):
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
    except OSError:
        pass
    return seeds, creates, updates


def assistant_turns(path: str):
    """(total, by_model) over the session's assistant messages."""
    total = 0
    by_model: dict[str, int] = {}
    try:
        for line in open(path, encoding="utf-8", errors="replace"):
            try:
                m = json.loads(line)
            except Exception:
                continue
            msg = m.get("message") if isinstance(m.get("message"), dict) else None
            if msg is None and m.get("role") == "assistant":
                msg = m
            if not isinstance(msg, dict) or msg.get("role") != "assistant":
                continue
            total += 1
            model = str(msg.get("model") or m.get("model") or "(unset)")
            by_model[model] = by_model.get(model, 0) + 1
    except OSError:
        pass
    return total, by_model


def answer_asks_until(s, log, anchors, timeout=420.0, desc="anchors"):
    """Pump until every anchor is visible, answering ask dialogs on the way.

    The 2026-11-10 seedSessionAsk fix makes "Execute — approve each edit"
    prompt per edit/write — each dialog is answered with digit 1 (Allow
    once; the ask selector numbers its three options). A dialog is counted
    only after the previous one left the pane (no double census). Returns
    (pane_text, asks_seen).
    """
    deadline = time.time() + timeout
    asks = 0
    armed = True
    while time.time() < deadline:
        s.pump(0.35)
        pane = s.pane_text()
        if ASK_MARKER in pane or "matched ask rule" in pane:
            if armed:
                asks += 1
                log(f"ask dialog #{asks} observed — answering digit 1 (Allow once)")
                s._send_drained(b"1")
                time.sleep(0.7)
                armed = False
            continue
        armed = True
        if all(a in pane for a in anchors):
            return pane, asks
    raise pc.PaneTimeout(f"timeout ({timeout:.0f}s) waiting for {desc!r} (asks seen: {asks})")


# ---------------------------------------------------------------------------
# Phase p1 — the entry/exit keyboard matrix (deterministic)
# ---------------------------------------------------------------------------

def phase_p1(log, cwd) -> bool:
    steps: list[tuple[str, bool]] = []

    def check(name, ok, extra=""):
        steps.append((name, ok))
        note(log, "p1", name, ok, extra)

    s = pc.UnownPty(log, cwd=cwd)
    try:
        s.wait_ready()
        pc.dismiss_first_flights(s, log)
        s.wait_idle(15)

        def key_seq(name, data, anchors, timeout=20):
            try:
                s._send_drained(data)
                s.wait_for(anchors, mode="any", timeout=timeout, desc=name)
                check(name, True)
            except pc.PaneTimeout:
                check(name, False, s.pane_text()[-200:])

        key_seq("shift+tab: default → acceptEdits", SHIFT_TAB, ["Permission mode: acceptEdits"])
        key_seq("shift+tab: acceptEdits → plan", SHIFT_TAB, [V3_ON])
        s.still("m1-plan-via-shift-tab", ["PLAN"])
        key_seq("shift+tab: plan → default", SHIFT_TAB, [PLAN_OFF])
        key_seq("ctrl+alt+p ON", CTRL_ALT_P, [V3_ON])
        key_seq("ctrl+alt+p OFF", CTRL_ALT_P, [PLAN_OFF])
        try:
            s.type_prompt("/plan")
            s.wait_for([V3_ON], timeout=20)
            check("/plan (bare toggle ON)", True)
        except pc.PaneTimeout:
            check("/plan (bare toggle ON)", False)
        try:
            s.type_prompt("/plan off")
            s.wait_for([PLAN_OFF], timeout=20)
            check("/plan off", True)
        except pc.PaneTimeout:
            check("/plan off", False)
        try:
            s.type_prompt("/plan show")
            s.pump(1.2)
            # The concrete no-plan anchor (the review hardening: the old
            # `"plan" in pane` check could never fail — the echoed command
            # itself satisfies it). The v2/narrow lanes always used this.
            check("/plan show answers", NO_PLAN_YET in s.pane_text())
        except Exception:
            check("/plan show answers", False)
        try:
            s.type_prompt("/plan add a matrix helper")
            s.wait_for([V3_ON], timeout=20)
            check("/plan <description> seeds the objective", True)
            s.still("m2-plan-seeded", ["PLAN"])
            s.type_prompt("/plan off")
            s.wait_for([PLAN_OFF], timeout=20)
        except pc.PaneTimeout:
            check("/plan <description> seeds the objective", False)
    finally:
        s.close()
    return all(ok for _, ok in steps)


# ---------------------------------------------------------------------------
# Phase boot — the --plan boot lane's entry notice parity (deterministic)
# ---------------------------------------------------------------------------

def phase_boot(log, cwd) -> bool:
    steps: list[tuple[str, bool]] = []

    def check(name, ok, extra=""):
        steps.append((name, ok))
        note(log, "boot", name, ok, extra)

    s = pc.UnownPty(log, cwd=cwd, extra_args=["--plan"])
    try:
        s.wait_ready()
        pc.dismiss_first_flights(s, log)
        s.pump(2.5)
        pane = s.pane_text()
        check("--plan boot: PLAN chip + entry notice", V3_ON in pane and "PLAN" in pane)
        s.still("m3-plan-boot", [V3_ON])
        s.type_prompt("/plan off")
        s.wait_for([PLAN_OFF], timeout=20)
    finally:
        s.close()
    return all(ok for _, ok in steps)


# ---------------------------------------------------------------------------
# Phase diag — the unknown-flag CLI guard (deterministic, no TUI)
# ---------------------------------------------------------------------------

def phase_diag(log, cwd) -> bool:
    steps: list[tuple[str, bool]] = []

    def check(name, ok, extra=""):
        steps.append((name, ok))
        note(log, "diag", name, ok, extra)

    s = pc.UnownPty(log, cwd=cwd, extra_args=["--nope-not-a-flag"])
    try:
        # The guard exits BEFORE the TUI takes the screen: pump until the
        # process dies, then read the pane + the exit status. (The round 2
        # lane's first cut waited for "TUI ready" here and timed out 240 s
        # later — the guard never renders a TUI at all.)
        deadline = time.time() + 90
        while time.time() < deadline and not s.dead:
            s.pump(0.5)
        pane = s.pane_text()
        try:
            s.child.close()
            status = s.child.exitstatus
        except Exception:
            status = None
        ok = "unknown flag --nope-not-a-flag" in pane and "unown --help" in pane and status == 2
        check("unknown flag: the CLI guard exits loudly with guidance", ok,
              f"(exit status {status})")
        s.still("m16-diag-unknown-flag", ["unknown flag"])
    finally:
        s.close()
    return all(ok for _, ok in steps)


# ---------------------------------------------------------------------------
# Phase v2 — the V2 kill switch's keyboard matrix (deterministic)
# ---------------------------------------------------------------------------

def phase_v2(log, cwd) -> bool:
    steps: list[tuple[str, bool]] = []

    def check(name, ok, extra=""):
        steps.append((name, ok))
        note(log, "v2", name, ok, extra)

    s = pc.UnownPty(log, cwd=cwd, env_extra={"UNOWN_PLAN_MODE_V3": "0"})
    try:
        s.wait_ready()
        pc.dismiss_first_flights(s, log)
        s.wait_idle(15)

        def key_seq(name, data, anchors, timeout=20):
            try:
                s._send_drained(data)
                s.wait_for(anchors, mode="any", timeout=timeout, desc=name)
                check(name, True)
            except pc.PaneTimeout:
                check(name, False, s.pane_text()[-200:])

        key_seq("v2 shift+tab: default → acceptEdits", SHIFT_TAB, ["Permission mode: acceptEdits"])
        key_seq("v2 shift+tab: acceptEdits → plan", SHIFT_TAB, [V2_ON])
        s.still("m7-v2-plan-via-shift-tab", [V2_ON])
        try:
            s.type_prompt("/plan show")
            s.pump(1.2)
            check("v2 /plan show answers (no-plan anchor)", NO_PLAN_YET in s.pane_text())
        except Exception:
            check("v2 /plan show answers (no-plan anchor)", False)
        try:
            s.type_prompt("/plan open")
            s.pump(1.2)
            check("v2 /plan open answers (no-plan-file anchor)", NO_PLAN_FILE in s.pane_text())
        except Exception:
            check("v2 /plan open answers (no-plan-file anchor)", False)
        key_seq("v2 shift+tab: plan → default", SHIFT_TAB, [PLAN_OFF])
        key_seq("v2 ctrl+alt+p ON (V2 wording)", CTRL_ALT_P, [V2_ON])
        key_seq("v2 ctrl+alt+p OFF", CTRL_ALT_P, [PLAN_OFF])
    finally:
        s.close()
    return all(ok for _, ok in steps)


# ---------------------------------------------------------------------------
# Phase narrow — 80x24 and 60x20 terminals (deterministic)
# ---------------------------------------------------------------------------

def _narrow_lane(log, steps, check, cwd, cols, rows, tag) -> None:
    s = pc.UnownPty(log, cwd=cwd, cols=cols, rows=rows)
    try:
        # The hints row degrades by dropping whole trailing segments at
        # narrow widths — at 60x20 it is gone entirely (the prior round's
        # pane receipt: only the status line + "memory:" row survive), so
        # the lane waits on an ANY-of set that covers every width: the
        # startup block's last section (wide panes), the hints row's lead
        # token (80-col), or the always-rendered memory footer row (60-col).
        s.wait_for(["? help", "── Themes ──", "memory: "], mode="any",
                   timeout=240, desc="TUI ready")
        pc.dismiss_first_flights(s, log)
        s.wait_idle(15)
        try:
            s.type_prompt("/plan")
            s.wait_for([V3_ON], timeout=20)
            pane = s.pane_text()
            check(f"{tag}: /plan ON — notice + PLAN chip", V3_ON in pane and "PLAN" in pane)
            s.still(f"m8-narrow-{tag}-plan", [V3_ON])
        except pc.PaneTimeout:
            check(f"{tag}: /plan ON — notice + PLAN chip", False)
        try:
            s.type_prompt("/plan show")
            s.pump(1.2)
            check(f"{tag}: /plan show answers (no-plan anchor)", NO_PLAN_YET in s.pane_text())
        except Exception:
            check(f"{tag}: /plan show answers (no-plan anchor)", False)
        try:
            s.type_prompt("/plan off")
            s.wait_for([PLAN_OFF], timeout=20)
            check(f"{tag}: /plan off restores", True)
        except pc.PaneTimeout:
            check(f"{tag}: /plan off restores", False)
    finally:
        s.close()


def phase_narrow(log, cwd) -> bool:
    steps: list[tuple[str, bool]] = []

    def check(name, ok, extra=""):
        steps.append((name, ok))
        note(log, "narrow", name, ok, extra)

    _narrow_lane(log, steps, check, cwd, cols=80, rows=24, tag="80x24")
    _narrow_lane(log, steps, check, cwd, cols=60, rows=20, tag="60x20")
    return all(ok for _, ok in steps)


# ---------------------------------------------------------------------------
# Phase gate — the approval-gate navigation matrix + stay-loop (live)
# ---------------------------------------------------------------------------

def phase_gate(log, cwd) -> bool:
    steps: list[tuple[str, bool]] = []
    started = time.time()

    def check(name, ok, extra=""):
        steps.append((name, ok))
        note(log, "gate", name, ok, extra)

    s = pc.UnownPty(log, cwd=cwd)
    try:
        s.wait_ready()
        pc.dismiss_first_flights(s, log)
        s.wait_idle(15)

        s.type_prompt("/plan add a matrix helper function with a test")
        s.wait_for([V3_ON], timeout=30)
        s.wait_idle(15)
        s.pump(0.5)

        # A metered upstream (~20 RPM) can stretch a full V3 planning pass
        # (audit + specialists) well past 5 minutes under throttling.
        gate_timeout = float(os.environ.get("MATRIX_GATE_TIMEOUT", "480"))
        try:
            s.wait_for([GATE_TITLE], timeout=gate_timeout, desc="approval gate")
            check("gate opens after planning", True)
        except pc.PaneTimeout:
            check("gate opens after planning", False, s.pane_text()[-300:])
            return all(ok for _, ok in steps)
        pane = s.pane_text()
        check("gate renders the 4 documented options", all(opt in pane for opt in GATE_OPTS))
        check("initial selection is option 1", "→ 1. " in pane)
        s.still("m4-gate", [GATE_TITLE])

        def nav(name, data, marker):
            if not gate_open(s):
                check(name, False, "(gate closed)")
                return
            s._send_drained(data)
            s.pump(0.6)
            check(name, marker in s.pane_text())

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
            if GATE_TITLE in s.pane_text():
                reoffered = True
                break
        check("stay-loop: no re-offer until the user speaks again", not reoffered)
        s.still("m5-after-stay", ["plan"])
        clear_gates(s)

        # --- the user re-arms with a message; approve; execute ---
        s.type_prompt("the plan is fine — offer it for approval again")
        # Two separately-labeled waits: a PaneTimeout on the SECOND wait is an
        # execution timeout, not a re-arm failure (the 2026-11-14 plan-visibility
        # round caught the except branch mislabeling a slow execution as a
        # failed re-arm — the gate HAD re-armed and the todos were already
        # flipping).
        try:
            s.wait_for([GATE_TITLE], timeout=240, desc="re-offer after user message")
        except pc.PaneTimeout:
            check("user message re-arms the gate", False, s.pane_text()[-300:])
        else:
            check("user message re-arms the gate", True)
            s.key("Enter")
            try:
                s.wait_for([PLAN_COMPLETE], timeout=420, desc="execution complete")
            except pc.PaneTimeout:
                check("approve → execute → Plan complete", False, s.pane_text()[-300:])
            else:
                check("approve → execute → Plan complete", True)
                s.still("m6-complete", [PLAN_COMPLETE])

        # --- the seeded-todo discipline (the 2026-11-09 instruction fix) ---
        session = latest_session(since=started)
        seeds, creates, updates = todo_census(session)
        check(f"todo discipline (seeds={seeds} creates={creates} updates={updates})",
              session != "" and seeds >= 1 and creates == 0)
    finally:
        s.close()
    return all(ok for _, ok in steps)


# ---------------------------------------------------------------------------
# Phases options-a/b/c — the approval OPTIONS matrix (live), split into three
# bounded sub-lanes: the sandbox's tool-call window (~10 min) cannot hold the
# whole matrix in one process (a specialist-spawning planning pass alone can
# run minutes), so each sub-lane re-plans on a FRESH scratch project and owns
# one slice of the dialog state machine. `--phases options` runs all three.
# ---------------------------------------------------------------------------

def _open_gate(log, cwd, objective):
    """Spawn a session, seed the objective, wait for the approval gate.

    Returns the live session (caller closes it) or None when the gate never
    opened (the caller notes the failure itself).
    """
    gate_timeout = float(os.environ.get("MATRIX_GATE_TIMEOUT", "480"))
    s = pc.UnownPty(log, cwd=cwd)
    s.wait_ready()
    pc.dismiss_first_flights(s, log)
    s.wait_idle(15)
    s.type_prompt(f"/plan add {objective}")
    s.wait_for([V3_ON], timeout=30)
    try:
        s.wait_for([GATE_TITLE], timeout=gate_timeout, desc="approval gate")
        return s
    except pc.PaneTimeout:
        return s  # caller checks the pane and notes the failure


def phase_options_a(log, cwd) -> bool:
    """The gate + digit quick-select + the editor rounds + the 6-round cap."""
    steps: list[tuple[str, bool]] = []

    def check(name, ok, extra=""):
        steps.append((name, ok))
        note(log, "options-a", name, ok, extra)

    s = _open_gate(log, scratch_dir(), "a tiny clamp helper with a test")
    try:
        if GATE_TITLE not in s.pane_text():
            check("options: gate opens after planning", False, s.pane_text()[-300:])
            return all(ok for _, ok in steps)
        check("options: gate opens after planning", True)
        s.still("m9-options-gate", [GATE_TITLE])

        # --- digit quick-select: 5 (beyond the 4 options) is inert ---
        s._send_drained(b"5")
        s.pump(0.6)
        check("digit 5 (beyond 4 options) is inert", "→ 1. " in s.pane_text())

        # --- option 3: the in-TUI plan editor round ---
        s._send_drained(b"3")
        try:
            s.wait_for([EDITOR_TITLE], timeout=30, desc="plan editor")
            check("option 3 opens the in-TUI plan editor", True)
            # submit unchanged (Enter) → re-score → the gate re-asks
            s.key("Enter")
            pane = s.wait_for([GATE_TITLE], timeout=60, desc="re-ask after edit")
            check("edited plan re-scores and re-asks", GATE_TITLE in pane)
            s.still("m10-edit-round", [GATE_TITLE])
        except pc.PaneTimeout:
            check("option 3 opens the in-TUI plan editor", False, s.pane_text()[-300:])

        # --- the 6-round editor cap notice ---
        cap_seen = False
        for i in range(5):  # rounds 2..6 (the first round already happened)
            if GATE_TITLE not in s.pane_text():
                cap_seen = "Plan editor rounds capped" in s.pane_text()
                break
            s._send_drained(b"3")
            try:
                s.wait_for([EDITOR_TITLE], timeout=30, desc=f"editor round {i + 2}")
                s.key("Enter")
                s.wait_for([GATE_TITLE, CAP_NOTICE], mode="any", timeout=60, desc=f"re-ask {i + 2}")
            except pc.PaneTimeout:
                break
            if CAP_NOTICE in s.pane_text():
                cap_seen = True
                break
        s.pump(1.0)
        cap_seen = cap_seen or CAP_NOTICE in s.pane_text()
        check("the 6th editor round surfaces the cap notice", cap_seen)
        s.still("m11-cap-notice", [CAP_NOTICE], mode="any")
    finally:
        s.close()
    return all(ok for _, ok in steps)


def phase_options_b(log, cwd) -> bool:
    """Ctrl+C cancel → stayed, and option 4 feedback → revise → re-offer."""
    steps: list[tuple[str, bool]] = []

    def check(name, ok, extra=""):
        steps.append((name, ok))
        note(log, "options-b", name, ok, extra)

    s = _open_gate(log, scratch_dir(), "a tiny sign helper with a test")
    try:
        if GATE_TITLE not in s.pane_text():
            check("options-b: gate opens after planning", False, s.pane_text()[-300:])
            return all(ok for _, ok in steps)
        check("options-b: gate opens after planning", True)

        # --- Ctrl+C cancels the gate → stayed (no re-offer) ---
        try:
            s.key("CtrlC")
            deadline = time.time() + 30
            reoffered = False
            while time.time() < deadline:
                s.pump(0.5)
                if GATE_TITLE in s.pane_text():
                    reoffered = True
                    break
            check("Ctrl+C cancels the gate → stayed (no re-offer)", not reoffered)
        except Exception:
            check("Ctrl+C cancels the gate → stayed (no re-offer)", False)
        clear_gates(s)

        # --- option 4 with feedback: rejected → revise → re-offer ---
        s.type_prompt("offer the plan for approval again")
        try:
            s.wait_for([GATE_TITLE], timeout=300, desc="re-arm for feedback lane")
            s._send_drained(b"4")
            s.wait_for([FEEDBACK_INPUT], timeout=30, desc="feedback input")
            for ch in "please make the verification step run the tests last":
                s.send(ch, delay=0.03)
            s.pump(0.4)
            s.key("Enter")
            s.wait_for([GATE_TITLE], timeout=360, desc="re-offer after revision")
            check("option 4 with feedback: rejected → revise → re-offer", True)
            s.still("m12-feedback-rearm", [GATE_TITLE])
        except pc.PaneTimeout:
            check("option 4 with feedback: rejected → revise → re-offer", False, s.pane_text()[-300:])
    finally:
        s.close()
    return all(ok for _, ok in steps)


def phase_options_c(log, cwd) -> bool:
    """Option 2 (approve each edit): the mode switch, the per-edit ask census
    (the 2026-11-10 seedSessionAsk fix's live lane), Plan complete, todos."""
    steps: list[tuple[str, bool]] = []
    started = time.time()

    def check(name, ok, extra=""):
        steps.append((name, ok))
        note(log, "options-c", name, ok, extra)

    s = _open_gate(log, scratch_dir(), "a tiny clamp helper with a test")
    try:
        if GATE_TITLE not in s.pane_text():
            check("options-c: gate opens after planning", False, s.pane_text()[-300:])
            return all(ok for _, ok in steps)
        check("options-c: gate opens after planning", True)

        # --- option 2: approve each edit (the 2026-11-10 fix's live lane) ---
        s._send_drained(b"2")
        try:
            s.wait_for([MODE_DEFAULT_NOTICE], timeout=60, desc="Permission mode: default")
            check("option 2 approval switches Permission mode: default", True)
        except pc.PaneTimeout:
            check("option 2 approval switches Permission mode: default", False, s.pane_text()[-300:])

        # execution with the per-edit ask census (seedSessionAsk live lane)
        try:
            pane, asks = answer_asks_until(s, log, [PLAN_COMPLETE], timeout=480, desc="Plan complete")
            check(f"ask-dialog census during execution (seen={asks}; per-edit approval fires", asks >= 1)
            check("option 2 execution reaches Plan complete", PLAN_COMPLETE in pane)
            s.still("m13-approve-manual", [PLAN_COMPLETE], mode="any")
        except pc.PaneTimeout as exc:
            check(f"ask-dialog census during execution ({exc}; per-edit approval fires", False)
            check("option 2 execution reaches Plan complete", False)

        session = latest_session(since=started)
        seeds, creates, updates = todo_census(session)
        check(f"todo discipline (seeds={seeds} creates={creates} updates={updates})",
              session != "" and seeds >= 1 and creates == 0)
    finally:
        s.close()
    return all(ok for _, ok in steps)


def phase_options(log, cwd) -> bool:
    """The umbrella: all three options sub-lanes in sequence."""
    ok = True
    for runner in (phase_options_a, phase_options_b, phase_options_c):
        ok = runner(log, cwd) and ok
    return ok


# ---------------------------------------------------------------------------
# Phase plan-model — the live --plan-model split (live)
# ---------------------------------------------------------------------------

def phase_plan_model(log, cwd) -> bool:
    steps: list[tuple[str, bool]] = []
    started = time.time()

    def check(name, ok, extra=""):
        steps.append((name, ok))
        note(log, "plan-model", name, ok, extra)

    sibling = os.environ.get("MATRIX_PLAN_MODEL", "agnes-2.5-flash")
    gate_timeout = float(os.environ.get("MATRIX_GATE_TIMEOUT", "480"))

    s = pc.UnownPty(log, cwd=cwd, extra_args=["--plan", "--plan-model", sibling])
    try:
        s.wait_ready()
        pc.dismiss_first_flights(s, log)
        s.pump(1.5)
        pane = s.pane_text()
        check("--plan-model boot: no Unknown-option diagnostic", "Unknown option" not in pane)
        check("--plan-model boot: footer rides the sibling", sibling in pane)
        s.still("m14-plan-model-footer", [sibling])

        s.type_prompt("add a tiny clamp helper to app.py with a test")
        try:
            s.wait_for([GATE_TITLE], timeout=gate_timeout, desc="gate on the sibling")
            check("plan-model: gate opens on the sibling", True)
            s.key("Enter")  # option 1 — auto-accept
            s.wait_for([PLAN_COMPLETE], timeout=420, desc="execution complete")
            check("plan-model: approve → execute → Plan complete", True)
        except pc.PaneTimeout:
            check("plan-model: gate opens on the sibling", False, s.pane_text()[-300:])
            check("plan-model: approve → execute → Plan complete", False)

        total, by_model = assistant_turns(latest_session(since=started))
        sibling_turns = sum(n for m, n in by_model.items() if sibling in m)
        check(f"planning turns on the sibling ({sibling_turns}/{total} total assistant turns)",
              sibling_turns >= 3 and total > sibling_turns)
    finally:
        s.close()

    # --- the unknown-model warning (a separate boot; fast exit) ---
    s2 = pc.UnownPty(log, cwd=cwd, extra_args=["--plan", "--plan-model", "agnes-no-such-model"])
    try:
        s2.wait_ready()
        pc.dismiss_first_flights(s2, log)
        s2.pump(1.5)
        pane = s2.pane_text()
        check("unknown --plan-model warns in the TUI", PLAN_MODEL_UNKNOWN in pane)
        s2.still("m15-plan-model-unknown", [PLAN_MODEL_UNKNOWN])
    finally:
        s2.close()
    return all(ok for _, ok in steps)


# ---------------------------------------------------------------------------
# Phase budget — --max-turns feeds the plan-turn budget (live)
# ---------------------------------------------------------------------------

def phase_budget(log, cwd) -> bool:
    steps: list[tuple[str, bool]] = []
    started = time.time()

    def check(name, ok, extra=""):
        steps.append((name, ok))
        note(log, "budget", name, ok, extra)

    gate_timeout = float(os.environ.get("MATRIX_GATE_TIMEOUT", "480"))

    s = pc.UnownPty(log, cwd=cwd, extra_args=["--plan", "--max-turns", "8"])
    try:
        s.wait_ready()
        pc.dismiss_first_flights(s, log)
        s.pump(1.5)
        check("--max-turns boot: no Unknown-option diagnostic", "Unknown option" not in s.pane_text())

        s.type_prompt("add a tiny clamp helper to app.py with a test")
        try:
            s.wait_for([GATE_TITLE], timeout=gate_timeout, desc="gate under the budget")
            check("budget lane: gate opens (the cap did not wedge planning)", True)
            s.key("Enter")
            s.wait_for([PLAN_COMPLETE], timeout=420, desc="execution complete")
            check("budget lane: approve → execute → Plan complete", True)
        except pc.PaneTimeout:
            check("budget lane: gate opens (the cap did not wedge planning)", False, s.pane_text()[-300:])
            check("budget lane: approve → execute → Plan complete", False)

        # The honest receipt (the review hardening: the budget is a SOFT
        # pressure — planning may legitimately exceed it while specialists
        # run — so the assertion is the sanity BAND, not the cap: planning
        # turns ≥ 1 (planning actually ran) and ≤ 20 (a dead budget with a
        # runaway model is caught), with the split printed as the receipt.
        session = latest_session(since=started)
        planning, executing = plan_phase_turns(session)
        budget = max(3, (8 * 6) // 10)  # max(3, floor(0.6 × 8)) = 4
        check(f"budget receipt: {planning} planning + {executing} executing turns "
              f"under --max-turns 8 (budget = max(3, floor(0.6 × 8)) = {budget}, soft)",
              session != "" and 1 <= planning <= 20)
    finally:
        s.close()

    # --- UNOWN_PLAN_TURN_BUDGET=0: the pressure disabled, arms + exits clean ---
    s2 = pc.UnownPty(log, cwd=cwd, extra_args=["--plan"],
                     env_extra={"UNOWN_PLAN_TURN_BUDGET": "0"})
    try:
        s2.wait_ready()
        pc.dismiss_first_flights(s2, log)
        s2.pump(1.5)
        check("budget=0 boot: no Unknown-option diagnostic", "Unknown option" not in s2.pane_text())
        check("budget=0 lane: plan mode arms and exits cleanly", V3_ON in s2.pane_text())
        s2.type_prompt("/plan off")
        s2.wait_for([PLAN_OFF], timeout=20)
    finally:
        s2.close()
    return all(ok for _, ok in steps)


# ---------------------------------------------------------------------------

RUNNERS = {
    "p1": phase_p1,
    "boot": phase_boot,
    "diag": phase_diag,
    "v2": phase_v2,
    "narrow": phase_narrow,
    "gate": phase_gate,
    "options-a": phase_options_a,
    "options-b": phase_options_b,
    "options-c": phase_options_c,
    "options": phase_options,
    "plan-model": phase_plan_model,
    "budget": phase_budget,
}


def main() -> int:
    log = pc.make_logger("verify-plan-mode-matrix")
    live = "--live" in sys.argv
    selected = None
    for i, arg in enumerate(sys.argv):
        if arg == "--phases" and i + 1 < len(sys.argv):
            selected = [p.strip() for p in sys.argv[i + 1].split(",") if p.strip()]
    if selected is None:
        selected = [p for p in PHASES if live or p not in LIVE_PHASES]
    # The review hardening: `options` is an explicit umbrella selector — the
    # DEFAULT live run must not execute the three sub-lanes AND the umbrella
    # (six specialist-spawning planning passes on a metered upstream instead
    # of three). Selecting both explicitly still honors the operator's hand.
    if selected == [p for p in PHASES if live or p not in LIVE_PHASES] and "options" in selected:
        selected = [p for p in selected if p != "options"]
    unknown = [p for p in selected if p not in RUNNERS]
    if unknown:
        log(f"unknown phases: {unknown} (valid: {PHASES})")
        return 2

    cwd = scratch_dir()
    log(f"matrix cwd: {cwd} (override with PTY_CWD); phases: {selected}")
    for phase in selected:
        log(f"--- phase {phase} (cwd={cwd}) ---")
        try:
            RUNNERS[phase](log, cwd)
        except Exception as exc:  # a phase crash is a phase failure, not a lane crash
            note(log, phase, f"phase {phase} crashed", False, repr(exc))

    log("=== SUMMARY ===")
    failed = []
    for phase, name, ok in _results:
        log(f"  {'PASS' if ok else 'FAIL'}  {name}")
        if not ok:
            failed.append(name)
    log(f"{'ALL GREEN' if not failed else 'FAILURES: ' + '; '.join(failed)}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
