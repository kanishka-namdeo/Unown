#!/usr/bin/env python3
"""
verify_dacapo_cp5.py — the Da capo round CP5's real-user verification
(PTY lane, pane-truth discipline per docs/tui-capture-workflow.md).

Drives the REAL `unown` TUI in FULLSCREEN against the real stack (bridge +
engine on :3031/:3030, Agnes upstream) and asserts the CP5 contract as a
user sees it:

  chunk A (the fullscreen boot contract): with tuiMode=fullscreen, the
           process writes the REAL DECSET enables — the alternate screen
           (?1049h), SGR mouse (?1006h) and focus reporting (?1004h) —
           checked against the raw byte stream (never printed; the pane
           asserts carry the visible side).
  chunk B (R8 click-to-send): while a turn streams, a queued prompt renders
           the pending strip WITH the click affordance; an SGR mouse click
           (press + release) on the "click here to send" row sends the
           queue immediately, exactly as the key does — the strip drains.
  chunk C (R16 refocus recap): with UNOWN_RECAP_IDLE_MINUTES fractional,
           after >= 3 real turns a blur + wait + refocus renders the dim
           "back after N min · N turns · last: ..." status line — no model
           call (the deterministic fork).
  chunk D (the kill switch): UNOWN_RECAP_IDLE_MINUTES=0 suppresses the
           refocus line under the same conditions.

Exit 0 = every assertion held. Any failure prints the pane tail.
Stills + pane dumps land in OUT (default /tmp/unown-cp5-verify-out).
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pty_common import UNOWN_ROOT, UnownPty, dismiss_first_flights, make_logger  # noqa: E402

OUT = os.environ.get("OUT", "/tmp/unown-cp5-verify-out")
os.makedirs(OUT, exist_ok=True)
log = make_logger("verify-dacapo-cp5")

SETTINGS = os.path.expanduser("~/.unown/agent/settings.json")


def say(msg: str) -> None:
    log(msg)


def fail(msg: str, pane: list) -> None:
    say(f"FAIL: {msg}")
    say("--- pane tail ---")
    for line in pane[-30:]:
        say(f"    {line}")
    sys.exit(1)


class RecordingPty(UnownPty):
    """UnownPty that also keeps the raw byte stream (for the DECSET checks)."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.raw = bytearray()
        original_feed = self.stream.feed

        def feed_and_record(data):
            self.raw.extend(data)
            return original_feed(data)

        self.stream.feed = feed_and_record


def write_fullscreen_settings() -> None:
    config: dict = {}
    if os.path.exists(SETTINGS):
        with open(SETTINGS, "r", encoding="utf-8") as f:
            config = json.load(f)
    config["tuiMode"] = "fullscreen"
    os.makedirs(os.path.dirname(SETTINGS), exist_ok=True)
    with open(SETTINGS, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)


def boot(extra_env: dict | None = None, settle_s: float = 8.0) -> RecordingPty:
    session = RecordingPty(say, cwd=UNOWN_ROOT, env_extra=extra_env)
    session.pump(4)
    # A fresh-ish home rides several boot flights: the pre-TUI provider gate,
    # the first-flights catalog, and the multi-page tour (Context/Skills/...).
    # Esc through all of them until the ready footer anchor shows.
    from pty_common import answer_first_run_gate

    answer_first_run_gate(session, say)
    dismiss_first_flights(session, say)
    deadline = time.time() + 90
    while time.time() < deadline:
        session.pump(1.0)
        if "? help" in session.pane_text():
            break
        session.key("Esc", delay=0.3)
    session.wait_ready(timeout=60)
    session.pump(settle_s)
    session.wait_idle(timeout=40, stable_for=2.0)
    return session


def run_turn(session: RecordingPty, anchor_word: str) -> None:
    session.type_prompt(f"reply with the single word: {anchor_word}", cps=30)
    try:
        session.wait_for([anchor_word], timeout=150, desc=f"the answer ({anchor_word})")
    except Exception as exc:
        say(f"turn: answer wait soft-failed ({exc}) — continuing on pane truth")
    session.wait_idle(timeout=90, stable_for=2.5)


def find_row(pane: list, needle: str) -> int | None:
    for idx, line in enumerate(pane):
        if needle in line:
            return idx
    return None


def main() -> int:
    results: list[tuple[str, bool]] = []
    workdir = "/tmp/unown-cp5-verify-out"
    backup = None
    if os.path.exists(SETTINGS):
        backup = os.path.join(workdir, "settings-backup.json")
        shutil.copy2(SETTINGS, backup)

    try:
        # ---------------- chunk A+B: fullscreen boot + click-to-send ----------------
        say("A+B: booting fullscreen…")
        write_fullscreen_settings()
        ab = boot()
        try:
            raw = bytes(ab.raw)
            # The DECSET enables — compared against real bytes, verdicts only.
            ok_a1 = b"\x1b[?1049h" in raw
            say(f"A1 the alternate screen is entered (?1049h written): {'OK' if ok_a1 else 'FAIL'}")
            results.append(("A1 alt-screen enable", ok_a1))
            ok_a2 = b"\x1b[?1006h" in raw
            say(f"A2 SGR mouse reporting enabled (?1006h written): {'OK' if ok_a2 else 'FAIL'}")
            results.append(("A2 SGR mouse enable", ok_a2))
            ok_a3 = b"\x1b[?1004h" in raw
            say(f"A3 focus reporting enabled (?1004h written): {'OK' if ok_a3 else 'FAIL'}")
            results.append(("A3 focus-reporting enable", ok_a3))
            if not (ok_a1 and ok_a2 and ok_a3):
                fail("A: a fullscreen enable sequence is missing from the byte stream", ab.pane())

            # B: a long-streaming turn, a queued prompt mid-stream, then the click.
            # agnes-3.0-flash is fast (300 words ≈ 1.5 s) — use a 900-word
            # generation and submit the second prompt as one fast write so its
            # Enter lands while the first turn still streams (→ it queues).
            say("B: streaming a long turn, then queueing a prompt mid-stream…")
            ab.type_prompt("write a vivid 900-word story about a lighthouse keeper, no headings", cps=60)
            time.sleep(1.2)  # the turn is streaming now
            ab.send("after the story output the marker word finished on its own line", delay=0.1)
            ab.send("\r", delay=0.4)
            try:
                ab.wait_for(["to send now", "click here to send"], timeout=40, desc="the send-now strip")
                ok_b1 = True
            except Exception:
                ok_b1 = False
            pane_b = ab.pane()
            say(f"B1 the queued prompt renders the send-now strip: {'OK' if ok_b1 else 'FAIL'}")
            results.append(("B1 send-now strip renders", ok_b1))
            if not ok_b1:
                fail("B: the send-now strip never appeared", pane_b)

            row = find_row(pane_b, "click here to send")
            if row is None:
                fail("B: the click affordance row was not found in the pane", pane_b)
            say(f"   clicking row {row} (press+release)…")
            ab.still("dacapo-cp5-send-now-strip", ["to send now", "click here to send"])
            ab.send(f"\x1b[<0;6;{row + 1}M", delay=0.12)
            ab.send(f"\x1b[<0;6;{row + 1}m", delay=0.12)
            time.sleep(1.0)
            ab.pump(3)

            ok_b2 = find_row(ab.pane(), "click here to send") is None
            say(f"B2 the click drained the queue (the strip is gone): {'OK' if ok_b2 else 'FAIL'}")
            results.append(("B2 click sends the queue", ok_b2))
            if not ok_b2:
                fail("B: the strip survived the click", ab.pane())
            try:
                ab.wait_for(["finished"], timeout=150, desc="the queued content in the final answer")
                ok_b3 = True
            except Exception:
                ok_b3 = False
            say(f"B3 the queued prompt rode the send (finished appears): {'OK' if ok_b3 else 'FAIL'}")
            results.append(("B3 queued content delivered", ok_b3))
            ab.wait_idle(timeout=90, stable_for=2.0)
        finally:
            ab.close()

        # ---------------- chunk C: the refocus recap ----------------
        say("C: the refocus recap (fractional idle threshold)…")
        c = boot(extra_env={"UNOWN_RECAP_IDLE_MINUTES": "0.04"})  # ~2.4 s
        try:
            run_turn(c, "alpha")
            run_turn(c, "bravo")
            run_turn(c, "charlie")
            say("   blurring the terminal (FOCUS_OUT), waiting 3 s, refocusing…")
            c.send("\x1b[O", delay=0.3)
            time.sleep(3.0)
            c.send("\x1b[I", delay=0.3)
            time.sleep(1.0)
            c.pump(2)
            pane_c = c.pane()
            text_c = "\n".join(pane_c)
            c.still("dacapo-cp5-refocus-recap", ["back after"])
            ok_c1 = "back after" in text_c
            say(f"C1 the refocus line renders: {'OK' if ok_c1 else 'FAIL'}")
            results.append(("C1 refocus line renders", ok_c1))
            ok_c2 = "turns this session" in text_c
            say(f"C2 the line carries the turn count: {'OK' if ok_c2 else 'FAIL'}")
            results.append(("C2 turn count in the line", ok_c2))
            ok_c3 = "last:" in text_c
            say(f"C3 the line carries the last-reply preview: {'OK' if ok_c3 else 'FAIL'}")
            results.append(("C3 last-reply preview", ok_c3))
            if not (ok_c1 and ok_c2 and ok_c3):
                fail("C: the refocus recap line is wrong or missing", pane_c)
        finally:
            c.close()

        # ---------------- chunk D: the kill switch ----------------
        say("D: the kill switch (UNOWN_RECAP_IDLE_MINUTES=0)…")
        d = boot(extra_env={"UNOWN_RECAP_IDLE_MINUTES": "0"})
        try:
            run_turn(d, "delta")
            run_turn(d, "echo")
            run_turn(d, "foxtrot")
            d.send("\x1b[O", delay=0.3)
            time.sleep(3.0)
            d.send("\x1b[I", delay=0.3)
            time.sleep(1.5)
            d.pump(2)
            text_d = "\n".join(d.pane())
            ok_d1 = "back after" not in text_d
            say(f"D1 the kill switch suppresses the refocus line: {'OK' if ok_d1 else 'FAIL'}")
            results.append(("D1 kill switch holds", ok_d1))
            if not ok_d1:
                fail("D: the refocus line rendered despite the kill switch", d.pane())
        finally:
            d.close()

    finally:
        if backup and os.path.exists(backup):
            shutil.copy2(backup, SETTINGS)
            say("settings.json restored from backup")

    say("")
    say("=== CP5 PTY lane summary ===")
    passed = sum(1 for _, ok in results if ok)
    for name, ok in results:
        say(f"  {'PASS' if ok else 'FAIL'}  {name}")
    say(f"{passed}/{len(results)} assertions held")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
