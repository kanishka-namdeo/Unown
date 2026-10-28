#!/usr/bin/env python3
"""
pty_round_session.py — the live-round session driver (PTY lane), chunked.

Drives the real `unown` TUI through a long working round (a build / review /
QA session), one CHUNK per invocation:

  - A chunk boots the TUI (fresh or --resume), types the round's prompt,
    rides the long turns with SOFT pane anchors (the s25 lessons: anchors
    ride tool-row chrome, never prose; every wait is soft; the closing
    still always fires), and closes the session through the REAL /quit path
    before the chunk budget expires — so the session file, note delivery
    and receipts all run their real persistence flow at a CONTROLLED
    moment, never mid-write.
  - Why chunks: hosts of this class reap every process between tool calls
    (measured: setsid + ppid-1 orphans die at call teardown; the engine and
    bridge survive only because start.ts daemonized them before the call
    ended). A 15–40 min build turn cannot live inside one 10-minute call —
    the previous round's record calls this "killed early by the host
    sandbox"; the honest answer is a controlled chunk: budget expires →
    closing still → /quit → exit; the ORCHESTRATOR then resumes with
    RESUME="-c" and a "continue" prompt in the next chunk until the
    summary reports done == "completed".

All the s25 discipline applies inside a chunk: soft waits bounded by the
remaining budget, anchors on chrome, deadline never kills a pane wait.

Env knobs:
  ROUND_NAME     required slug (output dir + log names); e.g. s1-build
  SESSION_CWD    required directory the TUI runs in (the round's project)
  PROMPT_FILE    required path to the prompt text (typed with the
                 Esc-before-Enter protocol; avoid '@' '!' '/' inside the
                 body — the s25 rule; a leading '/command' is fine)
  RESUME         optional resume mode before the prompt: "-c" or
                 "--resume <id|name|path>" (split on spaces)
  EXTRA_ARGS     optional extra CLI args before the prompt (e.g. --plan)
  PLAN_APPROVE   "1" = the prompt asks for a plan; wait for the "Plan
                 ready (" overlay, capture it, Enter to execute (the s2
                 protocol; soft — a model that ships no overlay degrades
                 to the plain one-prompt flow)
  BUDGET_S       chunk budget in seconds (default 520; the driver closes
                 at budget - 15s so /quit + the closing still never race
                 the wall clock)
  OUT_ROOT       output root (default /home/z/my-project/download/unown-round-captures)

Outputs under $OUT_ROOT/$ROUND_NAME/:
  stills/NN-<beat>.png + .pane.txt  ordered across ALL chunks (counter.json
                                    is the running still index — never two
                                    stills with the same number)
  capture.log                       running log (appends across chunks)
  status.json                       heartbeat (phase, paneBytes, chunk)
  summary.json                      per-chunk machine-readable record

Per-chunk exit code: 0 = the chunk closed cleanly (done is one of
"completed" | "budget" — both are orchestration successes); 1 = the driver
itself failed before producing anything (a real failure).
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pty_common import UnownPty, dismiss_first_flights, print_summary  # noqa: E402

import pexpect  # noqa: E402

ROUND_NAME = os.environ["ROUND_NAME"]
SESSION_CWD = os.environ["SESSION_CWD"]
PROMPT_FILE = os.environ["PROMPT_FILE"]
RESUME = os.environ.get("RESUME", "").strip()
EXTRA_ARGS = os.environ.get("EXTRA_ARGS", "").strip()
PLAN_APPROVE = os.environ.get("PLAN_APPROVE", "").strip() == "1"
BUDGET_S = float(os.environ.get("BUDGET_S", "520"))
OUT_ROOT = Path(os.environ.get("OUT_ROOT", "/home/z/my-project/download/unown-round-captures"))
OUT_DIR = OUT_ROOT / ROUND_NAME
STILLS = OUT_DIR / "stills"

STATUS = OUT_DIR / "status.json"
SUMMARY = OUT_DIR / "summary.json"
COUNTER = OUT_DIR / "counter.json"

# The chunk's absolute deadline: spawn time + budget, minus a 15s closing
# reserve (the closing still + /quit + the child's EOF wait must fit inside
# the call, never past the wall clock).
STARTED_AT = time.time()
DEADLINE = STARTED_AT + max(60.0, BUDGET_S) - 15.0


def remaining() -> float:
    return max(0.0, DEADLINE - time.time())


STATE = {
    "phase": "starting",
    "chunkStartedAt": STARTED_AT,
    "paneBytes": 0,
    "stills": [],
    "softMisses": [],
    "done": None,  # None | "completed" | "budget" | "crashed"
    "error": None,
}


def heartbeat(phase=None, done=None, error=None):
    if phase:
        STATE["phase"] = phase
    if done:
        STATE["done"] = done
    if error:
        STATE["error"] = error
    STATE["paneBytes"] = getattr(session, "raw_bytes", 0) if "session" in globals() else 0
    tmp = STATUS.with_suffix(".tmp")
    tmp.write_text(json.dumps(STATE, indent=2) + "\n")
    tmp.replace(STATUS)


def log(msg: str):
    stamp = time.strftime("%H:%M:%S")
    line = f"[{stamp}] {msg}"
    print(line, flush=True)
    with open(OUT_DIR / "capture.log", "a", encoding="utf-8") as f:
        f.write(line + "\n")


OUT_DIR.mkdir(parents=True, exist_ok=True)
STILLS.mkdir(parents=True, exist_ok=True)
os.environ["OUT"] = str(STILLS)
import pty_common  # noqa: E402

pty_common.OUT_DIR = STILLS

log(
    f"=== round chunk {ROUND_NAME} === cwd={SESSION_CWD} "
    f"resume={RESUME!r} extra={EXTRA_ARGS!r} plan_approve={PLAN_APPROVE} budget={BUDGET_S:.0f}s"
)


def next_still_number() -> int:
    """Running still index across ALL chunks (counter.json persists it)."""
    n = 1
    if COUNTER.exists():
        try:
            n = int(json.loads(COUNTER.read_text()).get("next", 1))
        except Exception:
            n = 1
    COUNTER.write_text(json.dumps({"next": n + 1}) + "\n")
    return n


args = []
if RESUME:
    args.extend(RESUME.split())
if EXTRA_ARGS:
    args.extend(EXTRA_ARGS.split())

prompt_text = Path(PROMPT_FILE).read_text(encoding="utf-8").strip()
log(f"prompt ({len(prompt_text)} chars) loaded from {PROMPT_FILE}")

session = UnownPty(log, cwd=SESSION_CWD, extra_args=args)
records = []


def soft_wait(anchors, mode, timeout, beat, label):
    """s25 discipline: soft wait — miss logs + captures as-is, never kills.
    Every wait is bounded by the chunk budget: a miss hands the story to the
    next beat instead of stacking wait budgets past the closing reserve."""
    if remaining() <= 5:
        log(f"budget reached — skipping beat {beat} ({label})")
        STATE["softMisses"].append(beat)
        return False
    timeout = min(timeout, remaining())
    heartbeat(phase=f"waiting:{beat}")
    try:
        session.wait_for(anchors, mode=mode, timeout=timeout, desc=label)
        return True
    except Exception:
        log(f"soft wait missed: {label} — continuing (pane as-is)")
        STATE["softMisses"].append(beat)
        return False


def still(name_hint, anchors, mode="all"):
    """Numbered still (global counter) — name carries the beat, the file the order."""
    n = next_still_number()
    name = f"{n:02d}-{name_hint}"
    heartbeat(phase=f"still:{name}")
    rec = session.still(name, anchors, mode=mode)
    STATE["stills"].append(name)
    records.append(rec)
    heartbeat()
    return rec


def close_clean(reason: str):
    """The controlled chunk close: closing still → /quit → EOF. The session
    file, receipts and note delivery all run their real persistence path at
    a moment WE chose — never mid-write at the reaper's whim."""
    heartbeat(phase="closing")
    session.pump(1.0)
    still(f"chunk-{reason}", ["unown"], mode="any")
    heartbeat(phase="quit")
    session.type_prompt("/quit", cps=60)
    try:
        session.child.expect(pexpect.EOF, timeout=15)
        session.dead = True
    except Exception:
        pass
    log(f"session closed cleanly ({reason}; pane bytes: {session.raw_bytes})")


try:
    heartbeat(phase="boot")
    if RESUME:
        # Resumed boots never print the startup resource block — they
        # restore straight into the interrupted session (chunk 2 taught
        # this the hard way: wait_ready burned 120s on "── Themes ──").
        # Wait for the restored session's own chrome instead: the todo
        # panel, the footer help line, the model chip.
        session.wait_for(
            ["Todos (", "? help · ctrl+k", "agnes-3.0-flash"],
            mode="any",
            timeout=120,
            desc="restored session chrome",
        )
        session.pump(1.0)
        dismiss_first_flights(session, log)  # no-op on restored sessions
        session.pump(0.5)
        if remaining() > 8:
            still("resumed", ["Todos", "├─"], mode="any")
    else:
        session.wait_ready(timeout=120)
        session.pump(1.0)
        dismiss_first_flights(session, log)
        session.pump(0.5)
        if remaining() > 8:
            still("boot", ["── Themes ──"])

    heartbeat(phase="prompt")
    session.type_prompt(prompt_text, cps=30)
    log("prompt submitted; the chunk's turn starts")

    # Optional plan approval (only meaningful while the plan overlay can
    # still appear — soft; a miss degrades to the plain flow).
    if PLAN_APPROVE:
        heartbeat(phase="waiting:plan-approval")
        try:
            session.wait_for(["Plan ready ("], mode="any", timeout=min(420.0, remaining()), desc="plan approval overlay")
            session.pump(1.2)
            still("plan-ready", ["Plan ready"], mode="any")
            session.key("Enter", delay=0.4)
            session.pump(2.0)
            # No confirmation wait: the Enter CONSUMES the overlay — waiting
            # afterwards for the overlay's own option text ("Execute the
            # plan") can only time out (60s burned learning this, chunk 1).
            # The next work beats confirm execution the honest way.
            log("plan approved (Enter on the pre-selected Execute option)")
        except Exception:
            log("soft wait missed: plan approval — continuing as a plain turn")
            STATE["softMisses"].append("plan-approval")

    # Work beats — all soft, all budget-bounded. A chunk that ends inside
    # any of them simply closes; the next chunk resumes mid-story.
    soft_wait(
        ["├─ ○", "└─ ○", "◐ in_progress", "● completed", "read ", "PRODUCT-BRIEF.md"],
        "any", 240, "plan", "todo rows or the brief read row",
    )
    if remaining() > 8:
        session.pump(0.8)
        still("the-plan", ["Todos", "○", "read"], mode="any")

    soft_wait(["•  write", "✓  write", "•  edit", "✓  edit"], "any", 200, "writing", "a write or edit row")
    if remaining() > 8:
        session.pump(0.8)
        still("writing-the-app", ["write", "edit"], mode="any")

    soft_wait(["$ bun test", "Ran ", "pass)"], "any", 200, "tests", "bun test row or output")
    if remaining() > 8:
        session.pump(0.8)
        still("tests-running", ["bun test", "Ran"], mode="any")
    soft_wait([" 0 fail", " 0 fail)"], "any", 90, "green", "green summary row")
    if remaining() > 8:
        session.pump(0.8)
        still("suite-green", ["fail"], mode="any")

    # End-of-turn settle: idle + 5s churn re-check, bounded by the budget.
    heartbeat(phase="waiting:end")
    settled = False
    while remaining() > 5:
        session.wait_idle(timeout=min(30.0, remaining()), stable_for=10)
        before = session.pane_text()
        session.pump(5.0)
        if session.pane_text() == before:
            settled = True
            break
        log("idle re-check saw churn — still working")
    if settled:
        STATE["done"] = "completed"
        log("turn settled — the round's turn is complete")
    else:
        STATE["done"] = "budget"
        log("chunk budget reached — closing for a resume chunk")
    close_clean("done" if settled else "budget")
except Exception as exc:
    STATE["done"] = "crashed"
    heartbeat(error=repr(exc))
    log(f"driver error: {exc!r}")
    try:
        still("error-state", ["unown"], mode="any")
        close_clean("error")
    except Exception:
        pass
finally:
    heartbeat(phase="closing")
    try:
        session.close()
    except Exception:
        pass

passed = sum(1 for r in records if r.ok)
summary = {
    "round": ROUND_NAME,
    "cwd": SESSION_CWD,
    "resume": RESUME or None,
    "done": STATE["done"],
    "seconds": round(time.time() - STARTED_AT, 1),
    "paneBytes": session.raw_bytes,
    "stills": [
        {"name": r.name, "ok": r.ok, "anchor": r.detail, "variance": round(r.variance, 2)}
        for r in records
    ],
    "softMisses": STATE["softMisses"],
    "passed": passed,
    "total": len(records),
}
SUMMARY.write_text(json.dumps(summary, indent=2) + "\n")
print_summary(f"{ROUND_NAME} (chunk)", records)
heartbeat(phase="finished", done=STATE["done"])
sys.exit(0 if records else 1)
