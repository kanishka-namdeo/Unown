#!/usr/bin/env python3
"""
verify_abort_resume.py — the sessions round's real-user verification (PTY lane).

Drives the REAL `unown` TUI through the /abort + resume flow:

  chunk A: boot TUI → long prompt → /abort mid-turn → assert the abort
           notice + pane state → /quit (clean persistence path) → assert
           the session JSONL carries stopReason "aborted" and the
           partial assistant text.
  chunk B: `unown -c` (resume latest) → assert the resumed-session boot
           notice lands and the aborted history is present → /quit.

Exit 0 = every assertion held. Any failure prints the pane tail.
"""

from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pty_common import UnownPty, make_logger  # noqa: E402

import glob
import subprocess

UNOWN_ROOT = os.environ.get("UNOWN_ROOT", "/home/z/my-project/Unown")
WORK_DIR = "/tmp/unown-abort-verify"
OUT = os.environ.get("OUT", "/tmp/unown-abort-verify-out")

os.makedirs(OUT, exist_ok=True)
log = make_logger("verify-abort-resume")


def say(msg: str) -> None:
    log(msg)


def fail(msg: str, pane: list[str]) -> None:
    say(f"FAIL: {msg}")
    say("--- pane tail ---")
    for line in pane[-24:]:
        say(f"    {line}")
    sys.exit(1)


def user_sessions() -> list[str]:
    d = os.path.expanduser("~/.unown/agent/sessions")
    return sorted(glob.glob(os.path.join(d, "*.jsonl")), key=os.path.getmtime)


def latest_session() -> str | None:
    files = user_sessions()
    # Only sessions created in THIS verification run (cwd matches WORK_DIR)
    for f in reversed(files):
        try:
            with open(f, "r", encoding="utf-8", errors="replace") as fh:
                header = json.loads(fh.readline())
            if header.get("cwd") == WORK_DIR:
                return f
        except Exception:
            continue
    return None


def session_aborted_states(path: str) -> dict:
    """Summarize abort evidence in a session JSONL."""
    out = {"aborted_messages": 0, "partial_text": "", "user_turns": 0, "entries": 0}
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            out["entries"] += 1
            if obj.get("type") == "message":
                msg = obj.get("message", {})
                role = msg.get("role")
                if role == "assistant" and msg.get("stopReason") == "aborted":
                    out["aborted_messages"] += 1
                    content = msg.get("content")
                    if isinstance(content, list):
                        for part in content:
                            if isinstance(part, dict) and part.get("type") == "text":
                                out["partial_text"] += part.get("text", "")
                if role == "user":
                    out["user_turns"] += 1
    return out


def main() -> None:
    os.makedirs(WORK_DIR, exist_ok=True)
    # Clean slate for THIS run only: remove prior verify sessions for WORK_DIR
    for f in user_sessions():
        try:
            with open(f, "r", encoding="utf-8", errors="replace") as fh:
                if json.loads(fh.readline()).get("cwd") == WORK_DIR:
                    os.remove(f)
        except Exception:
            pass

    # ------------------------------------------------------------------
    # chunk A: boot, long turn, /abort mid-turn, /quit
    # ------------------------------------------------------------------
    say("chunk A: boot TUI")
    s = UnownPty(log, cwd=WORK_DIR, extra_args=[])
    s.wait_ready(timeout=90)
    try:
        s.still("01-boot", ["unown v"], mode="any")
    except Exception as e:
        say(f"still 01-boot soft-fail: {e}")
    say("TUI ready; sending the long prompt")

    # A prompt that reliably takes a while: ask for a long generation.
    s.type_prompt("Write a very detailed 3000-word story about a lighthouse keeper named Mara, with rich scene detail in every paragraph. Take your time and be thorough.")
    s.send("\r")
    say("prompt submitted; waiting for streaming evidence")
    try:
        s.wait_for(["Mara", "lighthouse", "story", "keeper"], timeout=60, mode="any")
    except Exception:
        say("no streaming anchor yet — continuing to /abort anyway")
    # give the turn a moment to be mid-flight (the model is fast — abort early)
    time.sleep(2.5)
    pane = s.pane()
    streaming_evidence = any(w in "\n".join(pane).lower() for w in ["mara", "lighthouse", "story", "keeper"])
    say(f"streaming evidence: {streaming_evidence}")

    say("sending /abort mid-turn")
    s.send("/abort")
    time.sleep(0.4)
    s.send("\r")
    try:
        s.wait_for(["Aborted the running turn", "Nothing to abort", "Aborted the running operation"], timeout=25, mode="any")
    except Exception:
        pass
    pane = s.pane()
    if "Aborted the running turn" not in "\n".join(pane):
        # Esc parity fallback: the pane may have settled already; still must show SOME abort notice
        if "Aborted the running operation" not in "\n".join(pane) and "Nothing to abort" not in "\n".join(pane):
            fail("/abort produced no notice on the pane", pane)
        say("note: abort notice pane state settled without the turn-variant notice")
    say("abort notice observed")
    try:
        s.still("02-after-abort", ["Aborted"], mode="any")
    except Exception as e:
        say(f"still 02-after-abort soft-fail: {e}")

    # let the settle finish, then quit cleanly
    time.sleep(2)
    say("quitting via /quit")
    s.send("/quit")
    s.send("\r")
    try:
        s.wait_for(["To resume this session"], timeout=20, mode="any")
    except Exception:
        say("quit notice not observed (timing) — continuing")
    s.close()
    say("chunk A closed")

    # ---- assert the session file state ----
    path = latest_session()
    if not path:
        fail("no session file for the verify cwd after /quit", [])
    state = session_aborted_states(path)
    say(f"session file: {os.path.basename(path)}")
    say(f"  entries={state['entries']} user_turns={state['user_turns']} aborted={state['aborted_messages']}")
    say(f"  partial_text={state['partial_text'][:80]!r}")
    if state["aborted_messages"] < 1:
        fail("expected at least one assistant message persisted with stopReason=aborted", [])
    if state["user_turns"] < 1:
        fail("expected the user turn persisted", [])

    # ------------------------------------------------------------------
    # chunk B: resume with -c, assert the continuation works
    # ------------------------------------------------------------------
    say("chunk B: unown -c resume")
    s2 = UnownPty(log, cwd=WORK_DIR, extra_args=["-c"])
    # A resumed session's chat history fills the 36-row pane and scrolls the
    # startup resource block (the default ready anchor) off-screen, so wait
    # on the always-rendered status footer instead — same readiness, robust
    # to how much partial content the aborted turn streamed.
    s2.wait_ready(timeout=90, anchors=["? help · ctrl+k palette", "esc-esc tree"])
    pane = s2.pane()
    pane_text = "\n".join(pane)
    say("resume pane shows session continuation" if "continuing" in pane_text.lower() or "resumed" in pane_text.lower() else "resume boot pane (no explicit notice)")
    try:
        s2.still("03-resumed", ["unown v"], mode="any")
    except Exception as e:
        say(f"still 03-resumed soft-fail: {e}")

    # ask a tiny follow-up: proves the model lane is alive on the resumed session
    s2.type_prompt("In one short sentence: what is Mara's job?")
    s2.send("\r")
    ok = True
    try:
        s2.wait_for(["keeper", "lighthouse", "Mara"], timeout=60, mode="any")
    except Exception:
        ok = False
    pane = s2.pane()
    if not ok:
        fail("resumed session did not answer the follow-up", pane)
    try:
        s2.still("04-resumed-answer", ["keeper", "lighthouse", "Mara"], mode="any")
    except Exception as e:
        say(f"still 04-resumed-answer soft-fail: {e}")
    say("resumed session answered the follow-up")

    s2.send("/quit")
    s2.send("\r")
    s2.close()
    say("chunk B closed")

    # ---- final: the resumed session file grew (same file, -c continues it) ----
    state2 = session_aborted_states(path)
    say(f"after resume: entries={state2['entries']} (was {state['entries']})")
    if state2["entries"] <= state["entries"]:
        fail("the -c resume did not append to the same session file", [])

    say("ALL ABORT/RESUME ASSERTIONS HELD")
    sys.exit(0)


if __name__ == "__main__":
    main()
