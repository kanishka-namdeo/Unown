#!/usr/bin/env python3
"""test-a1-continue — the H-21 paired A/B on frozen synthetic sessions.

The gate design (registry row H-21): "paired A/B on replayed frozen
sessions with the signature present vs absent; graders = loop-burn
turns + tree-change-per-chunk + tokens." This file is the
DETERMINISTIC half of that gate — the generator-level A/B:

  A (signature present, k=3 trailing refusals)  -> the brief CARRIES
     the V-40 SPLIT-WRITE law, with the counted k.
  B (clean tail)                                -> NO injection (zero
     overhead — the SHOULD-NOT law).
  C (k=1 — a single refusal, not the loop)      -> NO injection (the
     fire threshold is k>=2).

The LIVE half (a genuine capped chunk whose tail carries the signature
-> the continuation lands without the loop-burn, turns-to-done
measured) accrues on the round's dispatches; the promotion judges both.

Run: python3 scripts/a1/test-a1-continue.py  (exit 0 = all green)
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))  # scripts/ — import a1-continue
sys.path.insert(0, str(HERE.parent))  # ensure scripts/ on the path

import importlib.util as _ilu
_spec = _ilu.spec_from_file_location("a1_continue", HERE.parent / "a1-continue.py")
ac = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(ac)

REFUSAL = (
    'Tool call "write" was not executed: the response hit the output '
    'token limit, so its arguments may be truncated. Re-issue the tool '
    'call with complete arguments.'
)
CLEAN_RESULT = "1 pass\n0 fail"


def msg(role, content, **extra):
    d = {"type": "message", "message": {"role": role, "content": content}}
    d["message"].update(extra)
    return json.dumps(d)


def tool_result(text):
    return msg("toolResult", [{"type": "text", "text": text}],
               toolCallId="call_x", toolName="write", isError=True)


def assistant_text(text):
    return msg("assistant", [{"type": "text", "text": text}])


def user_brief(text):
    return msg("user", [{"type": "text", "text": text}])


def write_session(path: Path, results):
    lines = [user_brief("TICKET X — do the thing")]
    for r in results:
        lines.append(assistant_text("issuing the write"))
        lines.append(tool_result(r))
    path.write_text("\n".join(lines) + "\n")


class TestTailRefusalRun(unittest.TestCase):
    def test_clean_tail(self):
        self.assertEqual(ac.tail_refusal_run([CLEAN_RESULT, CLEAN_RESULT]), 0)

    def test_single_refusal_below_threshold(self):
        self.assertEqual(ac.tail_refusal_run([CLEAN_RESULT, REFUSAL]), 1)

    def test_three_trailing(self):
        self.assertEqual(ac.tail_refusal_run([CLEAN_RESULT, REFUSAL, REFUSAL, REFUSAL]), 3)

    def test_all_refusals(self):
        self.assertEqual(ac.tail_refusal_run([REFUSAL, REFUSAL]), 2)

    def test_mid_session_refusals_do_not_fire(self):
        # refusals followed by a clean result = NOT a tail run (the loop
        # was already escaped; the pin would be noise).
        self.assertEqual(ac.tail_refusal_run([REFUSAL, REFUSAL, CLEAN_RESULT]), 0)


class TestBriefInjection(unittest.TestCase):
    """The full-path A/B: envelope log + session file -> the brief."""

    def _generate(self, results) -> str:
        with tempfile.TemporaryDirectory() as td:
            tdp = Path(td)
            # find_session searches <UNOWN_HOME>/agent/sessions/
            sess_dir = tdp / "agent" / "sessions"
            sess_dir.mkdir(parents=True)
            sess = sess_dir / "2026-01-01T00-00-00-000Z_deadbeef-0000-0000-0000-000000000000.jsonl"
            write_session(sess, results)
            env_log = tdp / "envelope.json"
            env_log.write_text(json.dumps({
                "name": "x-chunk1", "cwd": str(tdp),
                "cmd": ["unown", "-p", "TICKET X — do the thing"],
                "envelope": {
                    "session_id": "deadbeef-0000-0000-0000-000000000000",
                    "num_turns": 8, "subtype": "success", "capped": True,
                },
            }))
            # Run the generator with A1_HOME pointed at the temp dir (the
            # brief lands in <A1_HOME>/logs/) — no dispatch (--exec off).
            import os
            import subprocess
            env = dict(os.environ, A1_HOME=str(tdp / "a1"),
                       UNOWN_HOME=str(tdp))
            (tdp / "a1").mkdir()
            (tdp / "a1" / "logs").mkdir()
            r = subprocess.run(
                [sys.executable, str(HERE.parent / "a1-continue.py"),
                 "--log", str(env_log), "--chunk-budget", "8"],
                capture_output=True, text=True, env=env,
            )
            self.assertEqual(r.returncode, 0, r.stderr)
            briefs = sorted((tdp / "a1" / "logs").glob("*-continue.md"))
            self.assertTrue(briefs, "no continuation brief generated")
            return briefs[-1].read_text()

    def test_A_signature_present_injects(self):
        brief = self._generate([CLEAN_RESULT, REFUSAL, REFUSAL, REFUSAL])
        self.assertIn("SPLIT-WRITE LAW", brief)
        self.assertIn("k=3" if False else "3 consecutive output-limit refusals", brief)
        self.assertIn("NEVER re-issue the same", brief)

    def test_B_clean_tail_no_injection(self):
        brief = self._generate([CLEAN_RESULT, CLEAN_RESULT])
        self.assertNotIn("SPLIT-WRITE LAW", brief)

    def test_C_single_refusal_no_injection(self):
        brief = self._generate([CLEAN_RESULT, REFUSAL])
        self.assertNotIn("SPLIT-WRITE LAW", brief)


if __name__ == "__main__":
    unittest.main(verbosity=2)
