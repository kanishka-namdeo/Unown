#!/usr/bin/env python3
"""a1-dispatch — the H-11 stdin-guarded A2 dispatch helper (operator lane).

Every A2 dispatch rides this tool. Laws encoded:

- V-1  stdin guard: the child's stdin is DEVNULL (a -p run that inherits
       a pipe slurps it and never exits).
- V-38 pin ride-along: v38-pin.py runs first; a dispatch never leaves
       home with maxTokens=65536 seeded.
- V-39 brief sanitizer: briefs never carry literal kill-command text
       (the prompt-guard silent-kill class -> GUARD-KILL, exit 4).
- V-11 preamble-stop watch: subtype success with a near-empty result
       text is flagged (read the RESULT TEXT, not just the subtype).
- V-12 cap gate: read `capped` FIRST, then subtype (a capped run is a
       chunk boundary, not a failure -> exit 5, feed a1-continue.py).
- V-5  --max-turns is cumulative across a resumed session; the caller
       (or a1-continue.py) computes the raised cap.
- H-8  binary resolution is env-overridable (UNOWN_BIN).
- Envelope capture: the LAST {"type":"result"} JSON line of clean stdout
       (cap notices ride stderr — never parse stderr).

Exit codes: 0 success · 2 subtype-fail · 3 parse-fail · 4 GUARD-KILL ·
5 capped (continuation needed) · 6 timeout · 1 other.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

A1 = Path(os.environ.get("A1_HOME", "/home/z/my-project/.a1"))
LOGS = A1 / "logs"

# V-39: the prompt-guard class. NEVER brief these literally — describe
# the intent ("terminate the stray process by name") instead.
KILL_RE = re.compile(r"\b(pkill|killall|kill\s+-9|kill\s+-15|kill\s+-TERM|kill\s+\$\$|kill\s+%1)\b", re.I)


def resolve_bin(name: str, env_var: str) -> str:
    b = os.environ.get(env_var)
    if b and os.path.exists(b):
        return b
    w = shutil.which(name)
    if w:
        return w
    for cand in (f"/home/z/.local/bin/{name}", f"/home/z/.bun/bin/{name}",
                 f"/usr/local/bin/{name}"):
        if os.path.exists(cand):
            return cand
    raise SystemExit(f"a1-dispatch: cannot resolve '{name}' (set {env_var})")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--name", required=True, help="ticket/chunk name, e.g. c4-chunk1")
    ap.add_argument("--cwd", required=True, help="working dir for the dispatch")
    ap.add_argument("--max-turns", type=int, default=8)
    ap.add_argument("--timeout", type=int, default=2400)
    ap.add_argument("--resume", default=None, help="session id to resume")
    ap.add_argument("--model", default=None)
    ap.add_argument("--home", default="/home/z/my-project/unown-home")
    ap.add_argument("brief")
    args = ap.parse_args()

    # V-39 sanitizer
    hits = KILL_RE.findall(args.brief)
    if hits:
        print(f"a1-dispatch: GUARD-KILL — brief carries literal kill-command text {hits}; "
              "rephrase the intent instead (V-39 law)")
        return 4
    if "`" in args.brief:
        print("a1-dispatch: WARN — brief carries raw backticks (V-11 law: escape before "
              "embedding in template literals)")

    # V-38 pin ride-along
    pin = str(A1 / "scripts" / "v38-pin.py")
    r = subprocess.run([sys.executable, pin], capture_output=True, text=True)
    if "verified OK" not in r.stdout:
        print(f"a1-dispatch: v38-pin FAILED — aborting\n{r.stdout}\n{r.stderr}")
        return 1

    unown = resolve_bin("unown", "UNOWN_BIN")
    cmd = [unown]
    if args.resume:
        cmd += ["--resume", args.resume]
    cmd += ["-p", args.brief, "--output-format", "json"]
    if args.max_turns > 0:
        cmd += ["--max-turns", str(args.max_turns)]
    if args.model:
        cmd += ["--model", args.model]

    env = dict(os.environ)
    env["PATH"] = "/home/z/.bun/bin:/home/z/.local/bin:" + env.get("PATH", "")
    env.setdefault("UNOWN_HOME", args.home)

    LOGS.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    logbase = LOGS / f"{ts}-{args.name}"
    t0 = time.time()
    timed_out = False
    try:
        proc = subprocess.run(cmd, cwd=args.cwd, env=env,
                              stdin=subprocess.DEVNULL,
                              capture_output=True, text=True, timeout=args.timeout)
        rc, out, err = proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired as e:
        rc = 124
        out = e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or "")
        err = e.stderr.decode() if isinstance(e.stderr, bytes) else (e.stderr or "")
        timed_out = True

    envelope = None
    for line in reversed([l for l in out.splitlines() if l.strip()]):
        try:
            d = json.loads(line)
            if d.get("type") == "result":
                envelope = d
                break
        except Exception:
            continue

    meta = {
        "name": args.name, "ts": ts, "cmd": cmd, "cwd": args.cwd,
        "returncode": rc, "timed_out": timed_out, "wall_s": round(time.time() - t0, 1),
        "brief": args.brief, "envelope": envelope,
    }
    logbase.with_suffix(".json").write_text(json.dumps(meta, indent=2))
    logbase.with_suffix(".stdout").write_text(out)
    logbase.with_suffix(".stderr").write_text(err)

    usage = (envelope or {}).get("usage", {})
    print(f"a1-dispatch: {args.name} rc={rc} log={logbase}.json")
    if timed_out:
        print(f"a1-dispatch: TIMEOUT after {args.timeout}s (exit 6) — session may still be "
              "resumable; check the envelope stdout for the session id")
        return 6
    if envelope is None:
        print(f"a1-dispatch: PARSE-FAIL — no result envelope on stdout (exit 3); "
              f"stderr head: {err[:300]!r}")
        return 3

    subtype = envelope.get("subtype")
    capped = bool(envelope.get("capped", False))
    result_text = envelope.get("result") or ""
    sid = envelope.get("session_id")
    turns = envelope.get("num_turns")
    dur = envelope.get("duration_ms")
    print(f"a1-dispatch: session={sid} subtype={subtype} capped={capped} turns={turns} "
          f"dur={dur}ms in={usage.get('input_tokens')} out={usage.get('output_tokens')}")
    print(f"a1-dispatch: result[:200]: {result_text[:200]!r}")
    if capped:
        print("a1-dispatch: CAPPED (exit 5) — chunk boundary; generate the continuation "
              "with a1-continue.py")
        return 5
    if subtype != "success":
        print(f"a1-dispatch: SUBTYPE-FAIL {subtype} (exit 2)")
        return 2
    if len(result_text.strip()) < 40:
        print("a1-dispatch: WARN V-11 preamble-stop suspicion — success subtype but "
              "near-empty result; READ the result text and the session before accepting")
    return 0


if __name__ == "__main__":
    sys.exit(main())
