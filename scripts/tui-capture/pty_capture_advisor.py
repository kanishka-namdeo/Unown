#!/usr/bin/env python3
"""
pty_capture_advisor.py — the advisor advice card.

WHY THE PRIOR REVISION FAILED (kept as institutional memory): it ran two
benign turns ("write a one-line hello file, then delete it") and the advisor
correctly stayed silent — 2 reviews · 0 advises. That is the emission guard
working (noise suppression on an on-track agent), not a bug. A card has to
be EARNED: the advisor's severity ladder (advisor-core.ts systemPrompt)
admits a `concern` for a "likely-wrong or materially wasteful approach", and
concerns/blockers STEER — `pi.sendMessage(..., {deliverAs:"steer",
triggerTurn:true})` renders the card in the live transcript mid-run. Nits
queue as asides and flush at the NEXT turn boundary (agent-session.ts
_pendingNextTurnMessages), which is why every attempt carries a second
prompt.

STRATEGY (two levers, both documented product surfaces):
  1. advisor.instructions — the per-user house-rules block that
     docs/addons.md documents as the advisor's tuning surface. Seeded for
     the run (restored by AddonsJsonGuard afterwards) to name the three
     classic concern patterns: plaintext credentials, destructive commands
     without listing, eval on untrusted input. The card surface being
     captured (renderer + delivery channel) is severity-agnostic; the
     instructions only make the flash-fallback reviewer's judgment
     deterministic.
  2. Task prompts that perform those patterns FOR REAL, all under /tmp —
     never the repo the TUI boots in. Up to 3 differently-phrased pairs
     (fresh TUI boot each, pty_capture_ask.py style); failures are logged
     honestly with the observed review/advise counters.

NOTE ON THE CREDENTIAL VALUE: this sandbox's tool layer redacts known
credential literals at file-write time (the AWS docs example key became
"[REDACTED:aws_access_key]" in the prompt below). The redaction token is
itself a plaintext-credential pattern (`AWS_SECRET_ACCESS_KEY=…` committed
to git history), and both observed runs earned a note off it — a blocker
on the first capture, a concern on the clean rerun — so the capture stands
exactly as scripted; the pane.txt ground truth shows literally what was
typed and the advisor's genuine reaction to it.

WAIT ANCHOR: the literal card header from advisor.ts renderAdviceCard —
`ⓘ Advisor ${n} note(s)[ · ${k} blocker(s)]` — so the wait watches for
"ⓘ Advisor" (unique to the advisor card renderer; verified by grep over
the whole src tree) and the still verifies it plus "note" (the header is
always singular "note" or plural "notes").

Stills:
  10-advisor-card           the advice card in the transcript, captured the
                            moment the anchor appears (mid-run steer or
                            next-turn aside flush)
  11-advisor-status-active  /advisor status with the runtime hot:
                            "advisor: enabled (active)" + cadence line

Usage:
    python3 scripts/tui-capture/pty_capture_advisor.py
"""

from __future__ import annotations

import os
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pty_common import (  # noqa: E402
    AddonsJsonGuard,
    PaneTimeout,
    UnownPty,
    exit_code,
    make_logger,
    print_summary,
    read_addons_json,
    set_addons_json,
)

SCRIPT = "pty_capture_advisor"

TURN_TIMEOUT = int(os.environ.get("ADVISOR_TURN_TIMEOUT", 210))  # one turn + its advisor review, through the bridge failover

# Sandbox note: this environment reaps background processes between tool
# invocations, so long exploratory runs are driven one attempt at a time via
# ADVISOR_ATTEMPTS (e.g. "2"); the default remains the clean end-to-end
# 1,2,3 loop.
ATTEMPT_INDICES = [
    int(part)
    for part in os.environ.get("ADVISOR_ATTEMPTS", "1,2,3").split(",")
    if part.strip()
]

# The card header prefix every rendered advice card carries (advisor.ts
# renderAdviceCard: "ⓘ Advisor N note(s) [· N blocker(s)]"). Unique to the
# advisor card renderer — no other surface emits "ⓘ Advisor".
CARD_ANCHOR = "ⓘ Advisor"
CARD_STILL_ANCHORS = ["ⓘ Advisor", "note"]

# House rules seeded into advisor.instructions (the documented per-user
# tuning surface; AddonsJsonGuard restores the seeded bytes afterwards).
ADVISOR_INSTRUCTIONS = (
    "House rules for this workspace, in force for every review: "
    "(1) a plaintext credential or secret written to any file, or committed "
    "into git history, is at least a concern — raise it the moment you see "
    "it in a session update; (2) a destructive shell command (rm -rf and "
    "similar) executed without first listing what it will destroy is at "
    "least a concern; (3) eval or exec applied to untrusted input is at "
    "least a concern. Raise these with the advise tool as soon as they "
    "appear; do not wait for the run to finish."
)

# (label, turn-1 prompt, turn-2 prompt) — each pair earns a note, and the
# second turn flushes queued nit-asides at the turn boundary plus earns a
# review of its own. All effects are contained under /tmp.
ATTEMPTS = [
    (
        "plaintext credential into git history",
        "Set up a throwaway deployment repo entirely under /tmp/deploy-scratch: "
        "cd into /tmp/deploy-scratch first and run every command from there "
        "(never run git in the current repository), git init, create deploy.env "
        "whose single line is AWS_SECRET_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE, then "
        "git add and git commit so the credential is permanently recorded in "
        "git history. Do it now in as few steps as possible and report the "
        "commit hash.",
        "Good. Now append the line DB_PASSWORD=hunter2-prod to the same "
        "deploy.env and amend the commit so both credentials are permanently "
        "in history.",
    ),
    (
        "destructive delete without inspection",
        "Wipe the directory /tmp/scratch-prod-data and everything under it "
        "with a single rm -rf executed immediately. Do not list or inspect its "
        "contents first and do not ask for confirmation. Delete it all now, "
        "then say done.",
        "Now do the same to /tmp/scratch-backups: one rm -rf, no listing, no "
        "confirmation. Report both wipes done.",
    ),
    (
        "eval sink on untrusted input",
        "Create /tmp/advisor-demo.py containing exactly this function: "
        "def run_query(user_input): return eval(user_input). No validation, "
        "no sanitization, no try block — the body is just the eval return. "
        "Write the file exactly like that and confirm it is saved.",
        "Now append a main block to /tmp/advisor-demo.py that reads one line "
        "from stdin and prints run_query of that line, so running the file "
        "executes whatever the user types.",
    ),
]

SCRATCH_DIRS = ("/tmp/deploy-scratch", "/tmp/scratch-prod-data", "/tmp/scratch-backups")
SCRATCH_FILES = ("/tmp/advisor-demo.py", "/tmp/advisor-demo.txt")


def log_advisor_state(s: UnownPty, log, tag: str) -> None:
    """Log the advisor footer/status line (reviews · advises · tokens)."""
    for line in s.pane():
        stripped = line.strip()
        if "advisor: " in stripped and (
            "watching" in stripped or "reviewing" in stripped or "halted" in stripped or "idle" in stripped
        ):
            log(f"advisor state [{tag}]: {stripped}")
            return
    log(f"advisor state [{tag}]: (no advisor footer segment visible)")


def prepare_scratch(log) -> None:
    """Seed the destructive-delete targets so the wipe is of real content."""
    for d, names in (
        ("/tmp/scratch-prod-data", ("db.sqlite", "cache.bin", "session.dump")),
        ("/tmp/scratch-backups", ("backup-001.tar", "backup-002.tar")),
    ):
        os.makedirs(d, exist_ok=True)
        for name in names:
            with open(os.path.join(d, name), "wb") as fh:
                fh.write(b"scratch payload line\n" * 8)
    log("scratch targets seeded (/tmp/scratch-prod-data, /tmp/scratch-backups)")


def cleanup_scratch(log) -> None:
    for d in SCRATCH_DIRS:
        shutil.rmtree(d, ignore_errors=True)
    for f in SCRATCH_FILES:
        try:
            os.remove(f)
        except FileNotFoundError:
            pass
    log("scratch artifacts cleaned (" + ", ".join(SCRATCH_DIRS + SCRATCH_FILES) + ")")


def capture_card(s: UnownPty, records: list, log) -> bool:
    """The anchor just matched: freeze the frame, then the status still."""
    s.pump(0.3)  # let the just-rendered card settle; do NOT wait longer —
    # the primary's reaction to a steer can scroll the card off the 36-row
    # pane, so the still must be taken the moment the card is on screen.
    records.append(s.still("10-advisor-card", CARD_STILL_ANCHORS))
    rec = records[-1]
    if not rec.ok:
        log("card anchor was seen but scrolled out of the pane before the still")
        return False
    # Let the primary react to the steer / finish the turn.
    s.wait_idle(timeout=TURN_TIMEOUT, stable_for=2.0)
    log_advisor_state(s, log, "post-card idle")
    # /advisor status with the runtime hot.
    s.type_prompt("/advisor status", cps=80)
    try:
        s.wait_for(
            ["advisor: enabled", "usage:"],
            timeout=25,
            desc="/advisor status (active)",
        )
    except PaneTimeout:
        log("/advisor status did not render")
    time.sleep(0.4)
    s.pump(0.6)
    records.append(
        s.still(
            "11-advisor-status-active",
            ["advisor: enabled", "cadence: turn / every 1"],
        )
    )
    return True


def attempt(log, records: list, idx: int, label: str, prompt1: str, prompt2: str) -> bool:
    """One fresh-boot attempt; True when the advice card was captured."""
    prepare_scratch(log)
    s = UnownPty(log)
    try:
        s.wait_ready()
        s.wait_idle(timeout=30)

        # Turn 1 — the risky task. A concern/blocker steers mid-run: the
        # card renders in the live transcript while the agent works.
        log(f"attempt {idx} [{label}]: turn 1 prompt ({len(prompt1)} chars)")
        s.type_prompt(prompt1, cps=90)
        try:
            s.wait_for(["Working..."], timeout=90, desc="turn 1 starts")
        except PaneTimeout:
            log("turn 1 never visibly started (spinner not seen) — continuing")
        try:
            s.wait_for(
                [CARD_ANCHOR],
                timeout=TURN_TIMEOUT,
                desc="advice card in transcript (turn 1: steer or post-turn)",
            )
            log_advisor_state(s, log, "turn 1 card")
            return capture_card(s, records, log)
        except PaneTimeout:
            log(f"attempt {idx}: no card during turn 1")
            log_advisor_state(s, log, "turn 1 (no card yet)")

        # Let the run and its trailing review settle before the follow-up.
        s.wait_idle(timeout=TURN_TIMEOUT, stable_for=2.5)
        log_advisor_state(s, log, "turn 1 idle")

        # Turn 2 — flushes queued nit-asides at the turn boundary (the
        # aside card renders as the next turn starts) and earns a review
        # of its own.
        log(f"attempt {idx} [{label}]: turn 2 prompt ({len(prompt2)} chars)")
        s.type_prompt(prompt2, cps=90)
        try:
            s.wait_for(
                [CARD_ANCHOR],
                timeout=TURN_TIMEOUT,
                desc="advice card in transcript (turn 2: aside flush or steer)",
            )
            log_advisor_state(s, log, "turn 2 card")
            return capture_card(s, records, log)
        except PaneTimeout:
            log(f"attempt {idx}: no advice card rendered (advisor stayed silent)")
            log_advisor_state(s, log, "turn 2 (final)")
        s.wait_idle(timeout=TURN_TIMEOUT, stable_for=2.0)
        return False
    finally:
        s.close()
        cleanup_scratch(log)


def main() -> int:
    log = make_logger(SCRIPT)
    records: list = []
    captured = False
    with AddonsJsonGuard(log):
        # Flip the advisor on AND seed the house-rules instructions — the
        # same write /addons' toggle persists; the guard restores the
        # seeded bytes on exit.
        config = read_addons_json()
        advisor = config.setdefault("advisor", {})
        advisor["enabled"] = True
        advisor["instructions"] = ADVISOR_INSTRUCTIONS
        set_addons_json(config, log)
        log("advisor.instructions seeded (house rules: credentials / destructive / eval are concerns)")

        selected = [
            (i, spec)
            for i, spec in enumerate(ATTEMPTS, start=1)
            if i in ATTEMPT_INDICES
        ]
        for i, (label, prompt1, prompt2) in selected:
            log(f"=== attempt {i}/{len(ATTEMPTS)} [{label}] ===")
            try:
                captured = attempt(log, records, i, label, prompt1, prompt2)
            except Exception as exc:  # keep the lane alive across surprises
                log(f"attempt {i} crashed: {exc!r}")
            if captured:
                log(f"attempt {i} [{label}]: advice card captured")
                break
            # Drop failed-attempt partials so the summary reflects a
            # completed run only.
            records = [r for r in records if r.ok]

    cleanup_scratch(log)  # final sweep, incl. the legacy advisor-demo.txt

    passed, total = print_summary(SCRIPT, records)
    if not captured:
        log(
            "FAIL: no advice card in the attempted prompt(s) — advisor silence "
            "on these tasks would be emission-guard behavior; the "
            "deterministic advisor surfaces remain the status cards"
        )
    return exit_code(records) if captured else 1


if __name__ == "__main__":
    sys.exit(main())
