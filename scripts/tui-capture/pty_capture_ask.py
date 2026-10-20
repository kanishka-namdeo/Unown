#!/usr/bin/env python3
"""
pty_capture_ask.py — the ask_user_question dialog, END-TO-END.

Sends a chat prompt that makes the live model call the ask_user_question
tool (the bridge fails over to agnes-3.0-flash while the Dashscope primary
is quota-throttled — both serve this flow), then answers the tabbed dialog
through the PTY:

  01-ask-dialog-open     the dialog mounts: tab bar (□ unanswered), the
                         first question, option rows with the ❯ cursor,
                         the auto-appended "Type something." row, the
                         key-hint footer
  02-ask-question-2      after answering question 1 (Enter on the first
                         option): auto-advance + tab bar shows ■ answered
  03-ask-submit-review   the submit tab: "Review your answers" with the
                         answer summary and Submit / Cancel
  04-ask-submitted       after submit: the tool result envelope
                         ("User has answered your questions: …") lands in
                         the transcript, dialog gone
  05-ask-final           the model's closing turn after the answers (idle
                         frame — the whole story in one shot)

If the model refuses to call the tool, up to 3 differently-phrased prompts
are tried (fresh session each); failures are reported honestly.

Usage:
    python3 scripts/tui-capture/pty_capture_ask.py
"""

from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pty_common import (  # noqa: E402
    PaneTimeout,
    UnownPty,
    exit_code,
    make_logger,
    print_summary,
)
from pty_common import StillRecord  # noqa: E402

SCRIPT = "pty_capture_ask"

PROMPTS = [
    (
        "I want to set up my ice cream order before you do anything else. "
        "Use the ask_user_question tool RIGHT NOW to ask me exactly two questions in one call: "
        "question 1 asks which ice cream flavor I prefer, with options Vanilla, Chocolate and Strawberry; "
        "question 2 asks whether I want it in a cone or a cup, with options Cone and Cup. "
        "Ask me these questions; do not answer them yourself and do not do any other work first."
    ),
    (
        "Call the ask_user_question tool now with exactly two questions: "
        "one asks 'Which ice cream flavor do you prefer?' with options Vanilla, Chocolate, Strawberry, "
        "and one asks 'Cone or cup?' with options Cone, Cup. Nothing else, just ask."
    ),
    (
        "Use the ask_user_question tool to ask me two questions: my preferred ice cream flavor "
        "(options Vanilla, Chocolate, Strawberry) and whether I want a cone or a cup (options Cone, Cup). "
        "Ask immediately."
    ),
]

DIALOG_OPEN_TIMEOUT = 180  # model turn latency through the bridge failover


def attempt(log, records, prompt: str, idx: int) -> bool:
    """One fresh-session attempt; returns True when the dialog was driven to
    submission."""
    s = UnownPty(log)
    try:
        s.wait_ready()
        s.wait_idle(timeout=30)
        log(f"attempt {idx}: sending prompt ({len(prompt)} chars)")
        s.type_prompt(prompt, cps=90)

        # -- dialog opens --------------------------------------------------
        try:
            s.wait_for(
                ["Type something.", "Esc to cancel"],
                timeout=DIALOG_OPEN_TIMEOUT,
                desc="questionnaire dialog",
            )
        except PaneTimeout:
            tail = "\n".join(s.pane()[-14:])
            log(f"attempt {idx}: model did not open the dialog; pane tail:\n{tail}")
            return False

        time.sleep(0.5)
        s.pump(0.8)
        records.append(
            s.still(
                "01-ask-dialog-open",
                ["Type something.", "Esc to cancel", "Enter to select"],
            )
        )

        # -- answer question 1 (Enter on the highlighted first option) -----
        s.key("Enter")
        try:
            # Either a second question appears (tab bar marks q1 as ■
            # answered) or, if the model asked a single question, we may
            # already be able to reach the submit tab.
            s.wait_for(
                ["■", "Review your answers"],
                mode="any",
                timeout=15,
                desc="advance after first answer",
            )
        except PaneTimeout:
            log("attempt: no visible advance after Enter — capturing state")
        time.sleep(0.3)
        s.pump(0.6)
        records.append(s.still("02-ask-question-2", ["Type something."]))

        # -- reach the submit tab -------------------------------------------
        # If still on a question (the common two-question case), answer it;
        # auto-advance then lands on the submit tab.
        if "Review your answers" not in s.pane_text():
            s.key("Enter")
            try:
                s.wait_for(
                    ["Review your answers"],
                    timeout=15,
                    desc="submit tab",
                )
            except PaneTimeout:
                log("submit tab did not appear after second Enter")
        time.sleep(0.3)
        s.pump(0.6)
        records.append(
            s.still(
                "03-ask-submit-review",
                ["Review your answers", "Submit answers", "Cancel"],
            )
        )

        # -- submit -----------------------------------------------------------
        s.key("Enter")  # submitChoiceIndex 0 = "Submit answers"
        try:
            s.wait_for(
                ["User has answered your questions"],
                timeout=30,
                desc="tool result envelope",
            )
        except PaneTimeout:
            log("submit did not produce the result envelope")
        time.sleep(0.5)
        s.pump(0.8)
        records.append(
            s.still("04-ask-submitted", ["User has answered your questions"])
        )

        # -- the model's closing turn ----------------------------------------
        # NOTE: the transcript can scroll the boot header off the 36-row
        # pane, so anchor on the envelope + the restored editor box (»)
        # instead of the header.
        s.wait_idle(timeout=90)
        s.pump(0.8)
        records.append(
            s.still(
                "05-ask-final",
                ["User has answered your questions", "»"],
            )
        )
        return True
    finally:
        s.close()


def main() -> int:
    log = make_logger(SCRIPT)
    records: list = []
    done = False
    for i, prompt in enumerate(PROMPTS, start=1):
        log(f"=== attempt {i}/{len(PROMPTS)} ===")
        try:
            done = attempt(log, records, prompt, i)
        except Exception as exc:  # keep the lane alive across surprises
            log(f"attempt {i} crashed: {exc!r}")
        if done:
            log(f"attempt {i}: dialog captured end-to-end")
            break
        # Drop partial records from the failed attempt so the summary
        # reflects only a completed run.
        records = [r for r in records if r.ok]

    passed, total = print_summary(SCRIPT, records)
    if not done:
        log(
            "FAIL: the model never produced a submittable ask_user_question "
            "dialog in 3 attempts — partial captures only"
        )
    return 0 if done and all(r.ok for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())
