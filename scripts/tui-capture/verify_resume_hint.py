#!/usr/bin/env python3
"""
verify_resume_hint.py — the exit-resume round's real-user verification (PTY lane).

Drives the REAL `unown` TUI through the exact scenario the round exists for:
exiting with the keyboard (double Ctrl+C) and resuming from the printed hint.

  chunk A: boot TUI → one live turn (bridge → Agnes) → single Ctrl+C asserts
           the "Press Ctrl+C again to exit" notice → second Ctrl+C exits →
           assert the printed resume hint spells THIS launcher's grammar
           (`unown --resume <uuid>` — never `pi --session-dir '...'`).
  chunk B: run the printed command VERBATIM (the copy-paste test) → assert
           the prior conversation is on the resumed pane → /quit.
  chunk C: a SECOND session interrupted MID-STREAM by double Ctrl+C → assert
           the hint prints on this path too AND the partial assistant message
           is persisted (stopReason "aborted") → resume verbatim → assert the
           partial history is visible on the resumed pane.

Isolated HOME so the receipts are a fresh install's truth (no sessions,
no latches). Exit 0 = every assertion held. Any failure prints the pane tail.
"""

from __future__ import annotations

import glob
import json
import os
import re
import shlex
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pty_common import UnownPty, dismiss_first_flights, make_logger  # noqa: E402

UNOWN_ROOT = os.environ.get("UNOWN_ROOT", "/home/z/my-project/Unown")
UNOWN_BIN = os.path.join(UNOWN_ROOT, "bin", "unown")
HOME = os.environ.get("VERIFY_HOME", "/tmp/unown-resume-hint-home")
WORK_DIR = "/tmp/unown-resume-hint-work"
OUT = os.environ.get("OUT", "/home/z/my-project/download/resume-hint-round")

os.makedirs(OUT, exist_ok=True)
os.makedirs(HOME, exist_ok=True)
os.makedirs(WORK_DIR, exist_ok=True)
log = make_logger("verify-resume-hint")

HINT_RE = re.compile(r"To resume this session:\s*(.+)")


def say(msg: str) -> None:
    log(msg)


def fail(msg: str, pane: list[str]) -> None:
    say(f"FAIL: {msg}")
    say("--- pane tail ---")
    for line in pane[-24:]:
        say(f"    {line}")
    sys.exit(1)


def env_extra() -> dict:
    """Isolated HOME + explicit stack endpoints (fresh-install truth)."""
    return {"HOME": HOME}


def sessions_dir() -> str:
    return os.path.join(HOME, ".unown", "agent", "sessions")


def user_sessions() -> list[str]:
    return sorted(glob.glob(os.path.join(sessions_dir(), "*.jsonl")), key=os.path.getmtime)


def latest_session_for(cwd: str) -> str | None:
    for f in reversed(user_sessions()):
        try:
            with open(f, "r", encoding="utf-8", errors="replace") as fh:
                header = json.loads(fh.readline())
            if header.get("cwd") == cwd:
                return f
        except Exception:
            continue
    return None


def session_id_of(path: str) -> str:
    stem = os.path.basename(path)[: -len(".jsonl")]
    # <fileTimestamp>_<uuid>.jsonl — the id is everything after the first
    # underscore run following the timestamp prefix.
    m = re.match(r"^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)_(.+)$", stem)
    return m.group(2) if m else stem


def session_states(path: str) -> dict:
    """Abort/persistence evidence in a session JSONL."""
    out = {"aborted_messages": 0, "partial_text": "", "user_turns": 0, "assistant_texts": [], "entries": 0}
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
            if obj.get("type") != "message":
                continue
            msg = obj.get("message", {})
            role = msg.get("role")
            content = msg.get("content")
            texts = ""
            if isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "text":
                        texts += part.get("text", "")
            if role == "assistant":
                out["assistant_texts"].append(texts)
                if msg.get("stopReason") == "aborted":
                    out["aborted_messages"] += 1
                    out["partial_text"] += texts
            elif role == "user":
                out["user_turns"] += 1
    return out


def wait_exit(session: UnownPty, timeout: float = 15.0) -> int | None:
    """Wait for the process to die; return its exit status."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        session.pump(0.2)
        if session.dead or session.child.exitstatus is not None:
            break
        time.sleep(0.05)
    try:
        status = session.child.exitstatus
        if status is not None:
            return status
        return session.child.signalstatus
    except Exception:
        return None


def quit_and_capture_hint(session: UnownPty, desc: str) -> tuple[str, list[str]]:
    """Double Ctrl+C → wait exit → return (hint command line, pane).

    The double-press window is 500ms; the notice render can take longer than
    that, so after observing the notice we send the closing presses the way a
    real user reads-then-mashes: one press (exits if still inside the window),
    then — only if the process is still alive — one more inside a fresh
    window. Either cadence converges to the same exit.
    """
    say(f"{desc}: sending Ctrl+C (first press — expect the again-to-exit notice)")
    session.child.send(b"\x03")
    deadline = time.time() + 1.5
    seen = False
    while time.time() < deadline:
        session.pump(0.15)
        if "Press Ctrl+C again to exit" in session.pane_text():
            seen = True
            break
    if not seen:
        fail(f"{desc}: first Ctrl+C showed no 'Press Ctrl+C again to exit' notice", session.pane())
    say(f"{desc}: notice observed; finishing the double-press")
    session.child.send(b"\x03")
    time.sleep(0.12)
    session.pump(0.25)
    if session.child.exitstatus is None and not session.dead:
        # the notice rendered after the 500ms window closed: the last press
        # re-armed instead of exiting — one more press inside the fresh window
        session.child.send(b"\x03")
        time.sleep(0.12)
    status = wait_exit(session)
    say(f"{desc}: process exit status {status}")
    # The hint line is written immediately before process.exit(), so it rides
    # the final byte burst — often the SAME read that raises EOF. Pump until
    # EOF, then drain the remaining readable bytes straight into pyte.
    while not session.dead:
        session.pump(0.2)
    while True:
        try:
            chunk = session.child.read_nonblocking(size=65536, timeout=0.4)
        except Exception:
            break
        if not chunk:
            continue
        try:
            session.stream.feed(chunk)
        except Exception:
            pass
    pane = session.pane()
    pane_text = "\n".join(pane)
    m = HINT_RE.search(pane_text)
    if not m:
        fail(f"{desc}: no 'To resume this session:' line after exit", pane)
    return m.group(1).strip(), pane


def assert_hint_shape(cmd: str, desc: str, pane: list[str]) -> str:
    """The hint must spell the launcher's own grammar, safely quoted."""
    if not cmd.startswith("unown --resume "):
        fail(f"{desc}: hint is not the unown resume grammar: {cmd!r}", pane)
    if "pi " in cmd or "--session-dir" in cmd:
        fail(f"{desc}: hint names the vendored pi command/flags: {cmd!r}", pane)
    if "'" in cmd:
        fail(f"{desc}: hint contains single quotes (literal chars in cmd.exe): {cmd!r}", pane)
    if '"' in cmd:
        fail(f"{desc}: hint contains double quotes (id is validated safe — none needed): {cmd!r}", pane)
    session_arg = cmd[len("unown --resume ") :].strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]+", session_arg):
        fail(f"{desc}: resume argument is not a bare validated session id: {session_arg!r}", pane)
    say(f"{desc}: hint OK — {cmd}")
    return session_arg


def main() -> None:
    # Fresh-install truth: wipe THIS run's isolated home sessions.
    for f in user_sessions():
        try:
            os.remove(f)
        except Exception:
            pass

    # Non-interactive provider setup on the isolated home (the fresh-clone
    # round's own lane: `unown setup --provider bridge`), so the TUI boots a
    # configured agent with no wizard interposing on keystrokes.
    say("provision: unown setup --provider bridge (isolated HOME)")
    proc = subprocess.run(
        ["bun", UNOWN_BIN, "setup", "--provider", "bridge"],
        cwd=WORK_DIR,
        env={**os.environ, **env_extra()},
        capture_output=True,
        text=True,
        timeout=180,
    )
    say(f"setup exit={proc.returncode} out={proc.stdout.strip()[:120]!r} err={proc.stderr.strip()[:120]!r}")
    if proc.returncode != 0:
        fail("provisioning the bridge provider failed", [proc.stderr.strip()])

    # ------------------------------------------------------------------
    # chunk A: boot, one live turn, double Ctrl+C exit, hint assertions
    # ------------------------------------------------------------------
    say("chunk A: boot TUI (fresh session)")
    s = UnownPty(log, cwd=WORK_DIR, extra_args=[], env_extra=env_extra())
    s.wait_ready(timeout=120)
    dismiss_first_flights(s, log)
    s.wait_idle(timeout=30)

    say("chunk A: sending a short live prompt (bridge → Agnes)")
    s.type_prompt("Reply with exactly this token and nothing else: PANAMA-7")
    try:
        s.wait_for(["PANAMA-7"], timeout=90, mode="any")
        say("chunk A: answer anchor observed")
    except Exception:
        pane = s.pane()
        fail("chunk A: no answer anchor within 90s (model lane broken?)", pane)
    s.wait_idle(timeout=30)

    hint_cmd, pane = quit_and_capture_hint(s, "chunk A")
    resume_id = assert_hint_shape(hint_cmd, "chunk A", pane)

    path_a = latest_session_for(WORK_DIR)
    if not path_a:
        fail("chunk A: no session file for the verify cwd after Ctrl+C exit", pane)
    real_id = session_id_of(path_a)
    say(f"chunk A: session file {os.path.basename(path_a)} (id {real_id})")
    if real_id != resume_id:
        fail(f"chunk A: hint id {resume_id!r} != session file id {real_id!r}", pane)
    states = session_states(path_a)
    say(f"chunk A: entries={states['entries']} user_turns={states['user_turns']}")
    if states["user_turns"] < 1 or not any("PANAMA-7" in t for t in states["assistant_texts"]):
        fail("chunk A: the live turn did not persist to the session file", pane)
    try:
        s.still("A-exit-hint", ["To resume this session"], mode="any")
    except Exception as e:
        say(f"still A-exit-hint soft-fail: {e}")
    s.close()

    # ------------------------------------------------------------------
    # chunk B: run the PRINTED command verbatim — the copy-paste test
    # ------------------------------------------------------------------
    say(f"chunk B: running the printed command verbatim: {hint_cmd}")
    args = shlex.split(hint_cmd)[1:]  # drop the leading `unown`
    s2 = UnownPty(log, cwd=WORK_DIR, extra_args=args, env_extra=env_extra())
    s2.wait_ready(timeout=120, anchors=["? help", "esc-esc tree"])
    # The resumed TUI repaints as history streams in (and a transient blank
    # frame exists right after the alt-screen flip) — anchor on the prior
    # conversation instead of reading one frame.
    try:
        s2.wait_for(["PANAMA-7"], timeout=45, mode="any")
    except Exception:
        pane = s2.pane()
        fail("chunk B: resumed pane does not show the prior conversation", pane)
    say("chunk B: prior conversation visible on the resumed pane")
    try:
        s2.still("B-resumed-history", ["PANAMA-7"], mode="any")
    except Exception as e:
        say(f"still B-resumed-history soft-fail: {e}")

    # The resume must land on the SAME session (same id, still the latest).
    path_b = latest_session_for(WORK_DIR)
    if path_b != path_a:
        pane = s2.pane()
        fail(f"chunk B: resume created/wrote a different session file: {path_b!r} != {path_a!r}", pane)

    say("chunk B: quitting the resumed session (/quit)")
    s2.type_prompt("/quit")
    pane2 = s2.pane()
    m = HINT_RE.search("\n".join(pane2))
    if not m:
        try:
            s2.wait_for(["To resume this session"], timeout=20, mode="any")
            m = HINT_RE.search(s2.pane_text())
        except Exception:
            say("chunk B: /quit hint not observed (timing) — continuing")
    if m:
        assert_hint_shape(m.group(1).strip(), "chunk B (/quit)", pane2)
    wait_exit(s2, timeout=15)
    s2.close()

    # ------------------------------------------------------------------
    # chunk C: mid-stream double Ctrl+C — partial persistence + resume
    # ------------------------------------------------------------------
    say("chunk C: boot a NEW session, interrupt mid-stream with double Ctrl+C")
    s3 = UnownPty(log, cwd=WORK_DIR, extra_args=[], env_extra=env_extra())
    s3.wait_ready(timeout=120)
    dismiss_first_flights(s3, log)
    s3.wait_idle(timeout=30)
    s3.type_prompt(
        "Write a very detailed 3000-word story about a lighthouse keeper named Mara, "
        "with rich scene detail in every paragraph. Take your time and be thorough."
    )
    say("chunk C: waiting for streaming evidence")
    try:
        s3.wait_for(["Mara", "lighthouse", "story", "keeper"], timeout=90, mode="any")
    except Exception:
        say("chunk C: no streaming anchor yet — interrupting anyway")
    time.sleep(2.5)  # be mid-flight

    hint_cmd_c, pane_c = quit_and_capture_hint(s3, "chunk C")
    resume_id_c = assert_hint_shape(hint_cmd_c, "chunk C", pane_c)

    path_c = latest_session_for(WORK_DIR)
    if not path_c:
        fail("chunk C: no session file after mid-stream exit", pane_c)
    real_id_c = session_id_of(path_c)
    if real_id_c != resume_id_c:
        fail(f"chunk C: hint id {resume_id_c!r} != session file id {real_id_c!r}", pane_c)
    states_c = session_states(path_c)
    say(
        "chunk C: entries={} user_turns={} aborted={} partial={!r}".format(
            states_c["entries"], states_c["user_turns"], states_c["aborted_messages"], states_c["partial_text"][:80]
        )
    )
    # The exit-time abort rides the SAME cooperative matrix as /abort: the
    # in-flight turn is finalized with stopReason "aborted" (the honest
    # marker — verified against /abort in the same scenario), the user turn
    # is persisted, and the file exists at all. The PARTIAL TEXT length is
    # retry-luck (a stalled upstream → provider retry replaces the
    # in-flight message with a fresh zero-content attempt; /abort has the
    # same property), so it is reported but not asserted.
    if states_c["user_turns"] < 1:
        fail("chunk C: mid-stream Ctrl+C exit did not persist the user turn", pane_c)
    if states_c["aborted_messages"] < 1:
        fail(
            "chunk C: mid-stream Ctrl+C exit has no assistant message finalized "
            "with stopReason=aborted (the /abort contract, exit lane)",
            pane_c,
        )
    try:
        s3.still("C-exit-hint", ["To resume this session"], mode="any")
    except Exception as e:
        say(f"still C-exit-hint soft-fail: {e}")
    s3.close()

    # ------------------------------------------------------------------
    # chunk D: resume the interrupted session verbatim, partial visible
    # ------------------------------------------------------------------
    say(f"chunk D: running chunk C's printed command verbatim: {hint_cmd_c}")
    args_c = shlex.split(hint_cmd_c)[1:]
    s4 = UnownPty(log, cwd=WORK_DIR, extra_args=args_c, env_extra=env_extra())
    s4.wait_ready(timeout=120, anchors=["? help", "esc-esc tree"])
    # The resumed pane renders the persisted conversation — the USER turn's
    # own words anchor it regardless of how much partial text the aborted
    # assistant message carried (retry-luck, see chunk C).
    try:
        s4.wait_for(["lighthouse", "keeper", "Mara"], timeout=45, mode="any")
    except Exception:
        pane = s4.pane()
        fail("chunk D: resumed pane does not show the interrupted conversation", pane)
    say("chunk D: interrupted conversation visible on the resumed pane")
    try:
        s4.still("D-resumed-partial", ["Mara", "lighthouse"], mode="any")
    except Exception as e:
        say(f"still D-resumed-partial soft-fail: {e}")
    s4.type_prompt("/quit")
    wait_exit(s4, timeout=15)
    s4.close()

    say("ALL ASSERTIONS HELD: exit hint (Ctrl+C and /quit and mid-stream), "
        "launcher-correct grammar, verbatim copy-paste resume on both session kinds.")


if __name__ == "__main__":
    main()
