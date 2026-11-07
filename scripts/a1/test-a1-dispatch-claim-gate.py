#!/usr/bin/env python3
"""test-a1-dispatch-claim-gate.py — the H-26 claim-gate's deterministic
paired test suite (the V-6 fix's GATE measure).

Hermetic by construction: every case builds a throwaway git repo with a
LOCAL bare 'origin' remote, commits synthetic claim/close events with
controlled committer dates, and drives claim_gate() directly via an
importlib load of a1-dispatch.py — no network, no engine, no spend.

The paired A/B law (the h24-gate precedent): run this file against the
ORIGINAL gate (git stash / the pre-fix commit) and case B + E go RED
(the closed-ticket false refusal, the L-6 live catch); against the FIXED
gate all cases go GREEN. Both arms are receipted, never just asserted.

Usage:
  python3 scripts/a1/test-a1-dispatch-claim-gate.py [--dispatch-path PATH]
    --dispatch-path overrides which a1-dispatch.py is loaded (the A/B arm:
    pass the pre-fix copy for the BEFORE run).
"""
import argparse
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone


def load_gate(path: str):
    spec = importlib.util.spec_from_file_location("a1_dispatch_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.claim_gate


def run_git(cwd: str, *args: str, env_extra: dict | None = None) -> None:
    env = {**os.environ, **(env_extra or {})}
    subprocess.run(["git", *args], cwd=cwd, env=env, check=True,
                   capture_output=True, timeout=30)


def make_fixture(tmp: str, name: str, events: list[tuple[int, str]]) -> str:
    """A clone whose local origin/main carries `events` — (minutes_ago,
    subject) committed in list order with controlled committer dates (the
    gate reads %cI). List order = commit order = git-log order: git log
    walks the parent chain (topology), NOT dates — so events MUST be
    listed oldest-commit-first, exactly as a real queue's history grows
    (a claim lands, then its close, each with its own wall-clock date)."""
    bare = os.path.join(tmp, f"{name}-origin.git")
    work = os.path.join(tmp, f"{name}-work")
    os.makedirs(bare, exist_ok=True)
    run_git(bare, "init", "--bare", "-b", "main")
    run_git(tmp, "clone", bare, work)
    for i, (minutes_ago, subject) in enumerate(events):
        when = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
                ).strftime("%Y-%m-%dT%H:%M:%S+00:00")
        stamp = {"GIT_COMMITTER_DATE": when, "GIT_AUTHOR_DATE": when}
        run_git(work, "commit", "--allow-empty", "-m", subject,
                "--date", when, env_extra=stamp)
    run_git(work, "push", "origin", "HEAD:main")
    return work


CASES = [
    # (name, events, ticket, expected_rc, what-it-pins)
    ("A-refuse-active-claim",
     [(10, "round: X-1 CLAIMED (ACTIVE) by this lineage")],
     "X-1", 7, "a fresh claim inside the window refuses (the gate's core job)"),
    ("B-proceed-closed",
     [(30, "round: X-1 CLAIMED (ACTIVE) by this lineage"),
      (10, "round: X-1 CLOSED — the deliverable, session 0123")],
     "X-1", 0, "THE BUG CASE: claim->close in the normal order proceeds"),
    ("C-proceed-expired-claim",
     [(50, "round: X-1 CLAIMED (ACTIVE) by this lineage")],
     "X-1", 0, "a claim past the 45-min window expires (V-9)"),
    ("D-refuse-reclaim-after-close",
     [(40, "round: X-1 CLAIMED (ACTIVE) by this lineage"),
      (20, "round: X-1 CLOSED — done"),
      (5,  "round: X-1 CLAIMED (ACTIVE) — reopened for the refinement chunk")],
     "X-1", 7, "a re-claim NEWER than the close is ACTIVE again"),
    ("E-proceed-closed-old",
     [(80, "round: X-1 CLAIMED (ACTIVE) by this lineage"),
      (60, "round: X-1 CLOSED")],
     "X-1", 0, "an old closed pair proceeds (window-independent)"),
    ("F-refuse-fresh-claim-over-old-close",
     [(70, "round: X-2 CLOSED — an earlier round of the same id"),
      (10, "round: X-2 CLAIMED (ACTIVE) — the sibling lane")],
     "X-2", 7, "the newest event decides: a fresh claim over an old close refuses"),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dispatch-path",
                    default=os.path.join(os.path.dirname(__file__), "a1-dispatch.py"))
    args = ap.parse_args()

    claim_gate = load_gate(args.dispatch_path)
    tmp = tempfile.mkdtemp(prefix="h26-gate-")
    passed = failed = 0
    try:
        for name, events, ticket, expected, what in CASES:
            work = make_fixture(tmp, name, events)
            brief = f"TICKET {ticket} the brief body names the ticket"
            rc = claim_gate(work, brief, expiry_min=45, own_claim=False)
            ok = rc == expected
            passed += ok
            failed += (not ok)
            print(f"{'PASS' if ok else 'FAIL'}  {name}: rc={rc} expected={expected}"
                  f" — {what}")
        # case D2: the no-ticket zero-overhead path never fetches
        plain = os.path.join(tmp, "no-remote")
        os.makedirs(plain, exist_ok=True)
        run_git(plain, "init", "-b", "main")
        rc = claim_gate(plain, "a brief with no ticket token", 45, False)
        ok = rc == 0
        passed += ok
        failed += (not ok)
        print(f"{'PASS' if ok else 'FAIL'}  G0-no-ticket-no-fetch: rc={rc} expected=0"
              f" — zero overhead by design (a repo with no origin still proceeds)")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"\n{passed} pass / {failed} fail"
          + ("  — the gate's state machine holds" if failed == 0 else
             "  — RED: the closed-ticket false-refusal class is LIVE"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
