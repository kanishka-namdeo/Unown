#!/usr/bin/env python3
"""
verify_footer_quiet.py — the Footer Quiet round's real-user verification
(PTY lane, pane-truth discipline per docs/tui-capture-workflow.md).

Drives the REAL `unown` TUI against the real stack (bridge + engine on
:3031/:3030, Agnes upstream) and asserts the round's contract as a user
sees it:

  chunk A (quiet idle, engine UP): the footer is TWO rows at rest — one
           merged status line (cwd (branch) · ctx meter · chips · model) and
           the hint line; NO separate location row; NO ambient chip lines
           (memory:/mcp: healthy states are silent).
  chunk B (a real turn): the busy hint swap (esc interrupt), and the turn
           chip after the answer carries turn/ttft/~$ ONLY — no ctx %, no
           in/out rollup (the dedup), no cached totals.
  chunk C (attention paints): a fresh boot against a DEAD engine URL paints
           `memory: down` on the attention row (below the status row, above
           the hints) — failures are never silent.
  chunk D (the kill switch): UNOWN_FOOTER_CLASSIC=1 restores the pre-round
           four-row footer with the ambient `memory: up` line and the
           location row.

Exit 0 = every assertion held. Any failure prints the pane tail.
Stills + pane dumps land in OUT (default /tmp/unown-footer-verify-out).
"""

from __future__ import annotations

import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pty_common import UNOWN_ROOT, UnownPty, dismiss_first_flights, make_logger  # noqa: E402

OUT = os.environ.get("OUT", "/tmp/unown-footer-verify-out")
os.makedirs(OUT, exist_ok=True)
log = make_logger("verify-footer-quiet")

# A port nothing listens on: instant connection-refused → engine `down`.
DEAD_ENGINE_URL = "http://127.0.0.1:9"


def say(msg: str) -> None:
    log(msg)


def fail(msg: str, pane: list) -> None:
    say(f"FAIL: {msg}")
    say("--- pane tail ---")
    for line in pane[-30:]:
        say(f"    {line}")
    sys.exit(1)


def footer_rows(pane: list) -> list:
    """The trailing non-empty rows of the pane (the bottom dock, pane-truth)."""
    rows = [l for l in pane if l.strip()]
    return rows


def boot(extra_env: dict | None = None, settle_s: float = 14.0) -> UnownPty:
    session = UnownPty(say, cwd=UNOWN_ROOT, env_extra=extra_env)
    session.wait_ready(timeout=120)
    session.pump(2)
    dismiss_first_flights(session, say)
    session.pump(settle_s)  # engine probe cadence + fast re-probes land here
    session.wait_idle(timeout=40, stable_for=2.0)
    return session


def main() -> int:
    results: list[tuple[str, bool]] = []

    # ---------------- chunk A: quiet idle, engine UP ----------------
    say("A: booting the quiet footer against the live stack…")
    a = boot()
    a_still = a.still("quiet-idle", ["ctx"], mode="any")
    pane_a = a.pane()
    rows = footer_rows(pane_a)

    # A1: the merged status row — cwd+branch AND meter AND model on ONE line.
    status_rows = [l for l in rows if "ctx" in l]
    if not status_rows:
        fail("A1: no status row carrying the ctx meter found", pane_a)
    status_row = status_rows[-1]
    ok_a1 = "(main)" in status_row and "agnes-3.0-flash" in status_row
    say(f"A1 merged status row (cwd+branch+meter+model on one line): {'OK' if ok_a1 else 'FAIL'} — {status_row!r}")
    results.append(("A1 merged status row", ok_a1))

    # A2: exactly two footer rows at rest (status + hints) — no location row.
    idx = pane_a.index(status_row)
    tail = [l for l in pane_a[idx:] if l.strip()]
    ok_a2 = len(tail) == 2 and any("? help" in l or "help" in l for l in tail[1:])
    say(f"A2 two footer rows at rest (status + hints): {'OK' if ok_a2 else 'FAIL'} — tail={tail}")
    results.append(("A2 two rows at rest", ok_a2))

    # A3: no ambient chip lines — a healthy engine is silent.
    text_a = "\n".join(pane_a)
    ok_a3 = "memory:" not in text_a and "mcp:" not in text_a and "lsp:" not in text_a
    say(f"A3 ambient chips silent at rest (no memory:/mcp:/lsp: lines): {'OK' if ok_a3 else 'FAIL'}")
    results.append(("A3 ambient silence", ok_a3))
    a.close()

    # ---------------- chunk B: a real turn ----------------
    say("B: sending a real prompt through the live bridge…")
    b = boot()
    b.type_prompt("reply with the single word: ready", cps=30)
    b.pump(1.5)
    b.still("quiet-busy", ["ctx"], mode="any")
    pane_busy = b.pane()
    busy_hint = any("interrupt" in l for l in pane_busy)
    say(f"B1 busy hint swap (esc interrupt while streaming): {'OK' if busy_hint else 'FAIL'}")
    results.append(("B1 busy hint swap", busy_hint))

    try:
        b.wait_for(["ready"], timeout=150, desc="the answer")
    except Exception as exc:  # soft: the dedup assertions still run on the pane
        say(f"B: answer wait soft-failed ({exc})")
    b.wait_idle(timeout=40, stable_for=2.5)
    b.still("quiet-after-turn", ["ctx"], mode="any")
    pane_b = b.pane()
    turn_rows = [l for l in pane_b if "turn " in l and ("ttft" in l or "$" in l)]
    ok_b2 = bool(turn_rows)
    if ok_b2:
        row = turn_rows[-1]
        # B2: the turn chip carries ONLY the per-turn dynamics + cost.
        dedup_ok = not re.search(r"\bin \d", row) and "cached" not in row and "ctx " not in row
        say(f"B2 turn chip deduplicated (turn/ttft/~$ only, no ctx/in/out/cached): {'OK' if dedup_ok else 'FAIL'} — {row!r}")
        results.append(("B2 turn chip dedup", dedup_ok))
    else:
        say("B2 FAIL: no turn chip row found after the turn")
        results.append(("B2 turn chip dedup", False))
    b.close()

    # ---------------- chunk C: attention paints (engine DOWN) ----------------
    say("C: booting against a dead engine URL — the failure must paint…")
    c = boot(extra_env={"UNOWN_ENGINE_URL": DEAD_ENGINE_URL}, settle_s=4.0)
    # The engine state machine lands `starting…` within ~1 s and transitions
    # to `down` after the spawn-kick re-probes (measured ~8 s live) — wait for
    # the settled attention state explicitly instead of sampling a settle.
    try:
        c.wait_for(["memory: down"], timeout=40, desc="the engine-down attention line")
    except Exception:
        pass  # the assertion below is the verdict
    c.still("quiet-attention-down", ["ctx"], mode="any")
    pane_c = c.pane()
    text_c = "\n".join(pane_c)
    ok_c1 = "memory: down" in text_c
    say(f"C1 engine failure paints on the attention row: {'OK' if ok_c1 else 'FAIL'}")
    results.append(("C1 attention paints on failure", ok_c1))
    if ok_c1:
        status_rows_c = [l for l in pane_c if "ctx" in l and "agnes" in l]
        mem_rows = [l for l in pane_c if "memory: down" in l]
        hint_rows = [l for l in pane_c if "? help" in l]
        if status_rows_c and mem_rows:
            i_status = pane_c.index(status_rows_c[-1])
            i_mem = pane_c.index(mem_rows[-1])
            ok_c2 = i_mem > i_status and (not hint_rows or pane_c.index(hint_rows[-1]) > i_mem)
            say(f"C2 attention row sits below the status row, above the hints: {'OK' if ok_c2 else 'FAIL'}")
            results.append(("C2 attention row order", ok_c2))
    c.close()

    # ---------------- chunk D: the kill switch ----------------
    say("D: booting with UNOWN_FOOTER_CLASSIC=1 (engine UP) — the legacy footer returns…")
    d = boot(extra_env={"UNOWN_FOOTER_CLASSIC": "1"}, settle_s=14.0)
    d.still("classic-idle", ["ctx"], mode="any")
    pane_d = d.pane()
    text_d = "\n".join(pane_d)
    status_rows_d = [l for l in pane_d if "ctx" in l]
    ok_d1 = bool(status_rows_d) and "(main)" not in status_rows_d[-1]  # classic: no merged location
    # the location row exists above the stats row
    if status_rows_d:
        i_stats = pane_d.index(status_rows_d[-1])
        loc_candidates = [l for l in pane_d[max(0, i_stats - 2) : i_stats] if l.strip() and "─" not in l]
        ok_d1 = ok_d1 and len(loc_candidates) > 0
    say(f"D1 classic: separate location row + stats row (four-row footer): {'OK' if ok_d1 else 'FAIL'}")
    results.append(("D1 classic layout restored", ok_d1))
    ok_d2 = "memory: up" in text_d
    say(f"D2 classic: the ambient engine line paints again: {'OK' if ok_d2 else 'FAIL'}")
    results.append(("D2 classic ambient chips", ok_d2))
    d.close()

    # ---------------- verdict ----------------
    say("")
    say("=== verdict ===")
    passed = 0
    for name, ok in results:
        say(f"  {'PASS' if ok else 'FAIL'}  {name}")
        passed += 1 if ok else 0
    say(f"{passed}/{len(results)} checks held")
    return 0 if passed == len(results) and results else 1


if __name__ == "__main__":
    sys.exit(main())
