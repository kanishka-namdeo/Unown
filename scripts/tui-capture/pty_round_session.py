#!/usr/bin/env python3
"""
pty_round_session.py — the live-round session driver (PTY lane).

Drives ONE real `unown` TUI working session (a build / review / QA round)
inside a plain pty, types the round's prompt like a user, waits through the
long turns with SOFT pane anchors (every lesson from the s25 lane's five
cuts applies: anchors ride tool-row chrome, never prose; every story wait
is soft — a miss logs and captures the pane as-is; the closing still always
fires), captures milestone stills + pane dumps, and closes the session with
/quit (so note delivery and session persistence run their real path).

Why: the tmux/ttyd/Chromium lane (driver.js) films 20-minute sessions
beautifully, but needs host binaries this class of machine often lacks.
Round sessions (the builder / review / QA rounds behind the landing page's
live-demo band) are LONG and unattended — this driver runs detached
(nohup), heartbeats a status.json every few seconds, and never leaves a
pane waiting on an anchor that can not come (soft waits + a hard deadline
that still captures the closing state).

Env knobs:
  ROUND_NAME     required slug (output subdir + log names); e.g. s1-build
  SESSION_CWD    required directory the TUI runs in (the round's project)
  PROMPT_FILE    required path to a text file with the prompt (typed with
                 the Esc-before-Enter protocol; avoid '@' '!' '/' in the
                 body — the s25 rule; a leading '/command' line is allowed
                 and typed the same way)
  RESUME         optional resume mode before the prompt: "-c" or
                 "--resume <id|name|path>" (split on spaces)
  EXTRA_ARGS     optional extra CLI args before the prompt (e.g. --plan)
  DEADLINE_S     overall hard deadline in seconds (default 1500 = 25 min;
                 on expiry: closing still, /quit, status done=timed_out)
  OUT_ROOT       output root (default /home/z/my-project/download/unown-round-captures)

Outputs under $OUT_ROOT/$ROUND_NAME/:
  stills/NN-<beat>.png + .pane.txt   milestone captures
  capture.log                        the running log (pane dumps per still)
  status.json                        heartbeat (phase, paneBytes, stills)
  summary.json                       final machine-readable record

Exit code: 0 = the run completed (beats may still have soft-missed);
1 = the driver itself failed before the session produced anything.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pty_common import UnownPty, dismiss_first_flights, print_summary, render_png  # noqa: E402

import pexpect  # noqa: E402

ROUND_NAME = os.environ["ROUND_NAME"]
SESSION_CWD = os.environ["SESSION_CWD"]
PROMPT_FILE = os.environ["PROMPT_FILE"]
RESUME = os.environ.get("RESUME", "").strip()
EXTRA_ARGS = os.environ.get("EXTRA_ARGS", "").strip()
DEADLINE_S = float(os.environ.get("DEADLINE_S", "1500"))
OUT_ROOT = Path(os.environ.get("OUT_ROOT", "/home/z/my-project/download/unown-round-captures"))
OUT_DIR = OUT_ROOT / ROUND_NAME
STILLS = OUT_DIR / "stills"

STATUS = OUT_DIR / "status.json"
SUMMARY = OUT_DIR / "summary.json"

STATE = {
    "phase": "starting",
    "startedAt": time.time(),
    "paneBytes": 0,
    "stills": [],
    "softMisses": [],
    "done": None,  # None | "completed" | "timed_out" | "crashed"
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
os.environ.setdefault("OUT", str(STILLS))
# pty_common reads OUT_DIR at import for its still()/logger paths — re-point
import pty_common  # noqa: E402

pty_common.OUT_DIR = STILLS

log(f"=== round session {ROUND_NAME} === cwd={SESSION_CWD} resume={RESUME!r} extra={EXTRA_ARGS!r}")

args = []
if RESUME:
    args.extend(RESUME.split())
if EXTRA_ARGS:
    args.extend(EXTRA_ARGS.split())

prompt_text = Path(PROMPT_FILE).read_text(encoding="utf-8").strip()
log(f"prompt ({len(prompt_text)} chars) loaded from {PROMPT_FILE}")

session = UnownPty(log, cwd=SESSION_CWD, extra_args=args)
records = []


DEADLINE = time.time() + DEADLINE_S  # absolute; every wait is bounded by it


def remaining():
    return max(0.0, DEADLINE - time.time())


def soft_wait(anchors, mode, timeout, beat, label):
    """s25 discipline: soft wait — miss logs + captures as-is, never kills.
    Every beat is bounded by the round deadline: a miss hands the story to
    the next beat instead of stacking wait budgets past the deadline."""
    if remaining() <= 5:
        log(f"deadline reached — skipping beat {beat} ({label})")
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


def still(name, anchors, mode="all"):
    heartbeat(phase=f"still:{name}")
    rec = session.still(name, anchors, mode=mode)
    STATE["stills"].append(name)
    records.append(rec)
    heartbeat()
    return rec


try:
    heartbeat(phase="boot")
    session.wait_ready(timeout=120)
    session.pump(1.0)
    still("01-boot", ["── Themes ──"])
    # The first-flights catalog eats keystrokes at boot (and a stray 'x'
    # latches never-again persistently) — dismiss it BEFORE typing anything.
    dismiss_first_flights(session, log)
    session.pump(0.5)

    # If resuming, the picker/restore path needs a beat to settle.
    if RESUME:
        session.pump(2.0)
        soft_wait(["restored", "resumed", "continue"], "any", 20, "resume", "resume marker")

    heartbeat(phase="prompt")
    session.type_prompt(prompt_text, cps=30)
    log("prompt submitted; the long turn starts")

    # Beat: the model's first visible reaction (todo plan or read rows).
    soft_wait(
        ["├─ ○", "└─ ○", "◐ in_progress", "● completed", "read ", "PRODUCT-BRIEF.md"],
        "any", 300, "plan", "todo rows or the brief read row",
    )
    session.pump(0.8)
    still("02-the-plan", ["Todos"], mode="any")

    # Beat: files being written (tool-row chrome, never prose).
    soft_wait(["•  write", "✓  write", "•  edit", "✓  edit"], "any", 420, "writing", "a write or edit row")
    session.pump(0.8)
    still("03-writing-the-app", ["write", "edit"], mode="any")

    # Beat: the suite runs and greens (two soft waits, like s25 cuts 4–5).
    soft_wait(["$ bun test", "Ran ", "pass)"], "any", 600, "tests", "bun test row or output")
    session.pump(0.8)
    still("04-tests-running", ["bun test", "Ran"], mode="any")
    soft_wait([" 0 fail", " 0 fail)"], "any", 240, "green", "green summary row")
    session.pump(0.8)
    still("05-suite-green", ["fail"], mode="any")

    # Beat: end-of-turn. Wait for the pane to settle with no spinner churn,
    # confirmed twice (idle, then 5s re-check that it is still idle).
    heartbeat(phase="waiting:end")
    deadline = max(time.time(), DEADLINE)  # never below now; beats may finish early
    settled_at = None
    while time.time() < deadline:
        session.wait_idle(timeout=30, stable_for=10)
        before = session.pane_text()
        session.pump(5.0)
        if session.pane_text() == before:
            settled_at = time.time()
            break
        log("idle re-check saw churn — still working")
    if settled_at is None:
        log("deadline reached before the turn settled — capturing closing state")
        STATE["done"] = "timed_out"
    else:
        STATE["done"] = "completed"
    session.pump(1.0)
    still("06-session-done", ["unown"], mode="any")

    # Close the session through the real path: /quit persists the session,
    # delivers notes, and tears down cleanly.
    heartbeat(phase="quit")
    session.type_prompt("/quit", cps=30)
    try:
        session.child.expect(pexpect.EOF, timeout=20)
        session.dead = True
    except Exception:
        pass
    log(f"session closed (pane bytes: {session.raw_bytes})")
except Exception as exc:
    STATE["done"] = "crashed"
    heartbeat(error=repr(exc))
    log(f"driver error: {exc!r}")
    try:
        still("99-error-state", ["unown"], mode="any")
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
    "seconds": round(time.time() - STATE["startedAt"], 1),
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
print_summary(f"{ROUND_NAME} (round session)", records)
heartbeat(phase="finished", done=STATE["done"])
sys.exit(0 if records else 1)
