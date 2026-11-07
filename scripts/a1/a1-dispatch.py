#!/usr/bin/env python3
"""a1-dispatch — the H-11 stdin-guarded A2 dispatch helper (operator lane).

Every A2 dispatch rides this tool. Laws encoded:

- V-1  stdin guard: the child's stdin is DEVNULL (a -p run that inherits
       a pipe slurps it and never exits).
- V-16 brief-via-file: pass --brief-file PATH and the harness argv never
       carries the brief text (a pattern-kill cannot match the cmdline).
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


# H-26: the pre-dispatch claim gate. The ledger-arbiter law mechanized at
# the ONLY point it saves engine turns: BEFORE a duplicate dispatch burns
# them. A ticket's claim state is read from the git log (the claim
# protocol's own medium): '<ticket> CLAIMED (ACTIVE)' commits vs
# '<ticket> CLOSED' commits. A CLAIM not followed by a CLOSE, younger than
# the expiry window, refuses the dispatch (exit 7, CLAIM-CONFLICT) unless
# the operator explicitly owns it (--own-claim, for the claiming lineage's
# own chunk chain).
TICKET_RE = re.compile(r"\bTICKET\s+([A-Z]-\d+)\b")
CLAIM_RE = re.compile(r"\b([A-Z]-\d+)\s+CLAIMED\s*\(ACTIVE\)")
CLOSE_RE = re.compile(r"\b([A-Z]-\d+)\s+CLOSED\b")


def claim_gate(cwd: str, brief: str, expiry_min: int, own_claim: bool) -> int:
    """H-26: returns 0 to proceed, 7 to refuse (CLAIM-CONFLICT).
    Zero overhead by design: no ticket in the brief -> immediate 0."""
    m = TICKET_RE.search(brief)
    if not m:
        return 0
    ticket = m.group(1)
    if own_claim:
        print(f"a1-dispatch: H-26 claim gate — ticket {ticket} claimed by THIS lineage (--own-claim); proceed")
        return 0
    try:
        subprocess.run(["git", "fetch", "origin", "--quiet"], cwd=cwd,
                       capture_output=True, timeout=60)
        log = subprocess.run(["git", "log", "--format=%cI %s", "origin/main", "-80"],
                             cwd=cwd, capture_output=True, text=True, timeout=30)
        lines = log.stdout.splitlines()
    except Exception as e:  # noqa: BLE001
        # The gate is best-effort on transport errors: a fetch failure must
        # not brick dispatches (the offline lane still works) — but it is
        # NAMED, never silent.
        print(f"a1-dispatch: H-26 claim gate — transport error ({type(e).__name__}); "
              "proceeding WITHOUT the claim check (best-effort law)")
        return 0
    last_claim_ts = None
    closed_after_claim = False
    for line in lines:  # newest first
        ts, _, subject = line.partition(" ")
        if CLOSE_RE.search(subject):
            closed = CLOSE_RE.search(subject).group(1)
            if closed == ticket and last_claim_ts is not None:
                closed_after_claim = True
                break
        cm = CLAIM_RE.search(subject)
        if cm and cm.group(1) == ticket and last_claim_ts is None:
            last_claim_ts = ts
    if last_claim_ts is None or closed_after_claim:
        return 0  # no active claim — zero overhead, proceed
    # An ACTIVE claim exists. Check age vs the expiry window.
    try:
        from datetime import datetime, timezone as _tz
        claimed = datetime.fromisoformat(last_claim_ts)
        age_min = (datetime.now(_tz.utc) - claimed).total_seconds() / 60
    except Exception:  # noqa: BLE001
        age_min = 0.0
    if age_min > expiry_min:
        print(f"a1-dispatch: H-26 claim gate — ticket {ticket}'s ACTIVE claim is "
              f"{age_min:.0f} min old (> {expiry_min} expiry): EXPIRED per the V-9 window; proceed")
        return 0
    print(f"a1-dispatch: CLAIM-CONFLICT (H-26, exit 7) — ticket {ticket} carries an "
          f"ACTIVE claim ({age_min:.0f} min old, within the {expiry_min}-min window) "
          "on origin/main. Per the ledger-arbiter law: first landing governs — "
          "stand down, or pass --own-claim if THIS lineage made that claim.")
    return 7


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--name", required=True, help="ticket/chunk name, e.g. c4-chunk1")
    ap.add_argument("--cwd", required=True, help="working dir for the dispatch")
    ap.add_argument("--max-turns", type=int, default=8)
    ap.add_argument("--timeout", type=int, default=2400)
    ap.add_argument("--resume", default=None, help="session id to resume")
    ap.add_argument("--model", default=None)
    ap.add_argument("--home", default="/home/z/my-project/unown-home")
    ap.add_argument("--brief-file", default=None,
                    help="read the brief from this file instead of argv (the V-16 deep cure: "
                         "no pattern A2 can run matches the harness cmdline)")
    ap.add_argument("--claim-expiry", type=int, default=45,
                    help="H-26: minutes an ACTIVE claim binds before expiry (default 45)")
    ap.add_argument("--own-claim", action="store_true",
                    help="H-26: this lineage made the ticket's ACTIVE claim (the chunk-chain "
                         "exception); skip the claim gate")
    ap.add_argument("--dry-run", action="store_true",
                    help="print the resolved command + the gate verdicts and exit 0 WITHOUT "
                         "dispatching (the gate-test lane — the accidental-spend cure, "
                         "receipted 2026-11-07: two gate tests burned 16 real turns)")
    ap.add_argument("brief", nargs="?", default=None)
    args = ap.parse_args()

    # V-16 deep cure: the brief rides a FILE, never argv, whenever the
    # operator passes --brief-file. The harness cmdline then carries only
    # the file PATH — a pattern-kill can no longer match the brief text.
    if args.brief_file:
        try:
            args.brief = Path(args.brief_file).read_text()
        except OSError as e:
            print(f"a1-dispatch: cannot read --brief-file {args.brief_file}: {e}")
            return 1
    if not args.brief or not args.brief.strip():
        print("a1-dispatch: no brief (pass a positional brief or --brief-file PATH)")
        return 1

    # V-39 sanitizer
    hits = KILL_RE.findall(args.brief)
    if hits:
        print(f"a1-dispatch: GUARD-KILL — brief carries literal kill-command text {hits}; "
              "rephrase the intent instead (V-39 law)")
        return 4
    if "`" in args.brief:
        print("a1-dispatch: WARN — brief carries raw backticks (V-11 law: escape before "
              "embedding in template literals)")
    # V-13 fix 3 (the pkill -f self-kill class): if the brief names
    # processes/ports at all, the model may later try to clean up strays
    # with pattern-based process kills — and this dispatch process's OWN
    # argv carries the brief verbatim, so pkill -f <pattern> kills the
    # session (three receipted deaths, F-5). Auto-append the port-scoped
    # cleanup law whenever the brief is process-adjacent.
    PROC_ADJ_RE = re.compile(r"\b(serve|server|daemon|port|boot|shutdown|cleanup|stop)\b", re.I)
    CLEANUP_LAW = (
        "\n\nPROCESS-CLEANUP LAW (binding): to stop or clean up any stray server "
        "process, find its pid by PORT (ss -ltnp, then kill the numeric pid) — "
        "NEVER kill processes by name pattern (no pattern-kill tools): your own "
        "dispatch process's "
        "command line carries this brief verbatim, and a pattern match will "
        "terminate your own session mid-run (receipted three times this round)."
    )
    if PROC_ADJ_RE.search(args.brief) and "PROCESS-CLEANUP LAW" not in args.brief:
        args.brief = args.brief + CLEANUP_LAW
        print("a1-dispatch: process-adjacent brief — PROCESS-CLEANUP LAW appended (V-13)")

    # V-38 pin ride-along
    # H-26: the pre-dispatch claim gate (before any engine spend).
    rc_claim = claim_gate(args.cwd, args.brief, args.claim_expiry, args.own_claim)
    if rc_claim != 0:
        return rc_claim

    pin = str(A1 / "scripts" / "v38-pin.py")
    r = subprocess.run([sys.executable, pin], capture_output=True, text=True)
    if "verified OK" not in r.stdout:
        print(f"a1-dispatch: v38-pin FAILED — aborting\n{r.stdout}\n{r.stderr}")
        return 1

    unown = resolve_bin("unown", "UNOWN_BIN")
    if args.dry_run:
        print(f"a1-dispatch: DRY-RUN — gates passed, command resolved, NO dispatch:")
        print(f"  unown -p <brief {len(args.brief)} chars> --output-format json "
              f"--max-turns {args.max_turns} --resume {args.resume or '-'} "
              f"--model {args.model or '(default)'} --cwd {args.cwd}")
        return 0
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
