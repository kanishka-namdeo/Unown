#!/usr/bin/env python3
"""a1-continue — the H-12 chunk-continuation brief generator (operator lane).

Rebuilt 2026-11-07 by the twenty-sixth lineage per the Rondo closeout
mandate ("the next round's first act: rebuild the H-12 generator from the
registry row — the row IS the spec — and COMMIT it in-repo at
scripts/a1-continue.py, then re-run the H-12 promotion gate on the
retained artifact"). Registry row: docs/a1-augmentation-registry.md H-12.

What it does (the spec, encoded):

- reads the dispatch envelope log (a1-dispatch.py's capture JSON)
- locates the session file by id (searches UNOWN_HOME, ~/.unown and the
  dispatch cwd's .unown/sessions)
- parses the state: the original brief verbatim, the tool census, the
  files written, the commands already run, the last settled assistant
  words
- applies the V-11 backtick-escape law to every carried fragment
- injects the operator's --pin set per the V-15 law (a chunk that died
  pre-test must re-land with the pin set, not just the state)
- computes the V-5(a) raised cap (prior session turns + chunk budget —
  --max-turns is CUMULATIVE across a resumed session)
- emits the continuation brief and (with --exec) runs it through
  a1-dispatch.py --resume <id>

Exit codes: 0 ok · 1 usage/parse failure.
"""
import argparse
import glob
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

A1 = Path(os.environ.get("A1_HOME", "/home/z/my-project/.a1"))
LOGS = A1 / "logs"


def esc(fragment: str) -> str:
    """V-11 law: never carry raw backticks into a continuation brief."""
    return fragment.replace("`", "'")


def find_session(session_id: str, cwd: str) -> Path | None:
    roots = []
    uh = os.environ.get("UNOWN_HOME", "/home/z/my-project/unown-home")
    roots.append(os.path.join(uh, "agent", "sessions"))
    roots.append(os.path.expanduser("~/.unown/agent/sessions"))
    roots.append(os.path.join(cwd, ".unown", "sessions"))
    for root in roots:
        for hit in glob.glob(os.path.join(root, f"*{session_id}*.jsonl")):
            return Path(hit)
    return None


def parse_session(path: Path):
    original_brief = None
    census: dict[str, int] = {}
    files: list[str] = []
    commands: list[str] = []
    last_words = ""
    with open(path) as f:
        for line in f:
            try:
                d = json.loads(line)
            except Exception:
                continue
            if d.get("type") != "message":
                continue
            m = d.get("message", {})
            role = m.get("role")
            for c in m.get("content") or []:
                if not isinstance(c, dict):
                    continue
                if role == "user" and c.get("type") == "text" and original_brief is None:
                    txt = c.get("text", "")
                    # skip injected context blocks (they start with a tag line)
                    if txt.startswith("<"):
                        continue
                    original_brief = txt
                elif role == "assistant":
                    if c.get("type") == "toolCall":
                        name = c.get("name", "?")
                        census[name] = census.get(name, 0) + 1
                        args = c.get("arguments") or {}
                        p = args.get("path") or args.get("file_path") or args.get("filePath")
                        if p and name in ("write", "edit", "multi-edit", "multiedit", "apply"):
                            files.append(p)
                        cmd = args.get("command")
                        if cmd and name == "bash":
                            commands.append(cmd)
                    elif c.get("type") == "text" and c.get("text", "").strip():
                        last_words = c["text"]
    return original_brief, census, files, commands, last_words


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--log", required=True, help="a1-dispatch envelope JSON (the capped run)")
    ap.add_argument("--chunk-budget", type=int, default=8, help="turns for the continuation chunk")
    ap.add_argument("--pin", action="append", default=[], help="operator pin (V-15); repeatable")
    ap.add_argument("--exec", dest="run_it", action="store_true",
                    help="run the continuation dispatch via a1-dispatch.py")
    ap.add_argument("--timeout", type=int, default=2400)
    args = ap.parse_args()

    with open(args.log) as f:
        d = json.load(f)
    meta = d.get("meta", d)
    env = d.get("envelope") or {}
    session_id = env.get("session_id") or meta.get("session_id")
    prior_turns = env.get("num_turns") or meta.get("num_turns") or 0
    name = meta.get("name", "chunk")
    cwd = meta.get("cwd", os.getcwd())
    brief0 = meta.get("brief", "")
    # V-13 fix 1: the envelope log's OWN cmd carries the brief that started
    # the capped dispatch -- that is the operative "original brief" for a
    # multi-brief session (the session's first user message is stale by
    # chunk 2). Prefer it; fall back to meta.brief; the session's first
    # message is the last resort.
    cmd = d.get("cmd") or []
    if not cmd:
        cmd = meta.get("cmd") or []
    for i, part in enumerate(cmd):
        if part == "-p" and i + 1 < len(cmd):
            brief0 = cmd[i + 1]
            break

    if not session_id:
        print("a1-continue: no session_id in the envelope log")
        return 1
    sess = find_session(session_id, cwd)
    if sess is None:
        print(f"a1-continue: session file for {session_id} not found")
        return 1
    original_brief, census, files, commands, last_words = parse_session(sess)
    # V-13 fix 1 (cont.): the envelope's own brief (brief0) WINS -- in a
    # multi-brief session the first user message is the chunk-1 brief,
    # which misdirects the continuation (receipted: three lucky survivals,
    # one wrong-envelope generation).
    if brief0:
        original_brief = brief0
    else:
        original_brief = original_brief
    # V-13 fix 2: stale-envelope guard. If a NEWER envelope log exists for
    # the SAME session id, the operator fed an old one -- warn loudly (the
    # dispatch still generates; the operator decides). Envelope filenames
    # start with the dispatch UTC timestamp, so lexicographic newest wins.
    try:
        newest = None
        for jf in LOGS.glob("*.json"):
            try:
                jd = json.load(open(jf))
            except Exception:
                continue
            jenv = jd.get("envelope") or jd.get("meta", {})
            if (jenv.get("session_id") or jd.get("meta", {}).get("session_id")) == session_id:
                if newest is None or jf.name > newest.name:
                    newest = jf
        if newest is not None and str(Path(args.log).resolve()) != str(newest.resolve()):
            print(f"a1-continue: WARNING -- stale envelope: {newest.name} is the NEWEST envelope "
                  f"for session {session_id}; you passed {Path(args.log).name} (V-13 law: always "
                  f"continue from the session's latest capped envelope)")
    except Exception:
        pass

    raised_cap = int(prior_turns) + args.chunk_budget
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = LOGS / f"{ts}-{name}-continue.md"

    pins = "\n".join(f"- {esc(p)}" for p in args.pin) or "- (none — the original brief's checks stand)"
    state_files = "\n".join(f"- {esc(x)}" for x in dict.fromkeys(files)) or "- (none yet)"
    state_cmds = "\n".join(f"- {esc(x[:160])}" for x in commands[-10:]) or "- (none yet)"
    census_s = ", ".join(f"{k}×{v}" for k, v in sorted(census.items())) or "(no tools yet)"

    cont = f"""ROLE: you are RESUMING session {session_id} at a chunk boundary — the prior chunk hit its turn cap mid-task (a budget boundary, NOT an error; do not restart from scratch).

ALLOWED_INPUTS: the current directory only (same as the original brief).
FORBIDDEN_INPUTS: anything outside the current directory; no instruction-set writes; no commits unless the original brief says so.
OUTPUT_ARTIFACT: the original brief's artifact, completed.
HANDOFF_SCHEMA: final message = the original brief's handoff line, with evidence quoted.
EFFORT_BUDGET: {args.chunk_budget} turns for this chunk.
NON-OVERLAP: nothing beyond the original brief.

ORIGINAL BRIEF (verbatim, backticks escaped):
{esc(original_brief)}

STATE SO FAR (do not redo these):
Files written:
{state_files}
Commands already run (most recent 10, truncated):
{state_cmds}
Tool census: {esc(census_s)}

LAST SETTLED WORDS of the prior chunk (may be mid-thought):
\"\"\"{esc(last_words[:600])}\"\"\"

OPERATOR PINS (V-15 — these carry forward, verify against them before declaring Done):
{pins}

TASK: Continue exactly where the prior chunk stopped. Complete the ORIGINAL BRIEF's remaining work. Before declaring Done: re-run every check the original brief names (quote the output), confirm every acceptance item, and finish with the brief's handoff line. If you are genuinely blocked, say BLOCKED: <what you need> instead of padding."""

    out.write_text(cont)
    print(f"a1-continue: continuation brief written -> {out} ({len(cont)} chars)")
    print(f"a1-continue: prior turns={prior_turns} chunk budget={args.chunk_budget} raised cap={raised_cap} (V-5a: cumulative)")

    dispatch = str(A1 / "scripts" / "a1-dispatch.py")
    cmd = [sys.executable, dispatch, "--name", f"{name}-cont",
           "--cwd", cwd, "--resume", session_id,
           "--max-turns", str(raised_cap), "--timeout", str(args.timeout), cont]
    printable = " ".join(cmd[:9]) + " <brief-file>" if not args.run_it else " ".join(cmd)
    print(f"a1-continue: dispatch command ({'executing' if args.run_it else 'dry-run'}):")
    print(f"  python3 {dispatch} --name {name}-cont --cwd {cwd} --resume {session_id} "
          f"--max-turns {raised_cap} --timeout {args.timeout} \"$(cat {out})\"")
    if args.run_it:
        r = subprocess.run(cmd)
        return r.returncode
    return 0


if __name__ == "__main__":
    sys.exit(main())
