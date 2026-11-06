#!/usr/bin/env python3
"""dispatch-bg — the detached-process daemonizer (the V-1/V-2 cure class).

Runs a command detached (reparented to PID 1) with stdin CLOSED
(os.close(0) + /dev/null), stdout/stderr appended to a log file, and a
pidfile under .a1/pids/. The stack lane (`dispatch-bg.py stack`) is the
bring-up cure for `bun run agent:start` (bridge :3031 + engine :3030):
long-lived processes must not ride the operator harness's own pipes.

Subcommands:
  run   --name N --cwd DIR [--log FILE] -- CMD...
  stack --cwd DIR [--name stack]        (== run bun run agent:start)
  stop  --name N [--port PORT]           (SIGTERM the process group)
  status [--name N]                      (pidfile + /proc + health probes)

Env overrides: A1_HOME (default /home/z/my-project/.a1), BUN_BIN,
UNOWN_BIN. Binary resolution follows the H-8 env-overridable law.
"""
import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

A1 = Path(os.environ.get("A1_HOME", "/home/z/my-project/.a1"))
LOGS = A1 / "logs"
PIDS = A1 / "pids"

STACK_PORTS = {"bridge": 3031, "engine": 3030}


def resolve_bin(name: str, env_var: str) -> str:
    b = os.environ.get(env_var)
    if b and os.path.exists(b):
        return b
    w = shutil.which(name)
    if w:
        return w
    for cand in (f"/home/z/.bun/bin/{name}", f"/home/z/.local/bin/{name}",
                 f"/usr/local/bin/{name}", f"/home/z/.npm-global/bin/{name}"):
        if os.path.exists(cand):
            return cand
    raise SystemExit(f"dispatch-bg: cannot resolve binary '{name}' (set {env_var})")


def _health(port: int, path: str, timeout: float = 2.0) -> str:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=timeout) as r:
            return f"{r.status}"
    except Exception as e:  # noqa: BLE001
        return f"DOWN ({type(e).__name__})"


def run_detached(name: str, cwd: str, cmd: list, log: str | None) -> int:
    LOGS.mkdir(parents=True, exist_ok=True)
    PIDS.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    log = log or str(LOGS / f"{name}-{ts}.log")
    pidfile = PIDS / f"{name}.pid"
    if pidfile.exists():
        try:
            old = int(pidfile.read_text().strip() or 0)
        except ValueError:
            old = 0
        if old and Path(f"/proc/{old}").exists():
            raise SystemExit(f"dispatch-bg: '{name}' already running (pid {old}); stop it first")
    pidfile.write_text("")

    pid = os.fork()
    if pid == 0:
        # child: new session + process group (no controlling terminal),
        # stdin closed per the V-1 law, stdio -> log, then exec.
        try:
            os.setsid()
            os.close(0)
            fd = os.open(os.devnull, os.O_RDONLY)
            os.dup2(fd, 0)
            lf = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
            os.dup2(lf, 1)
            os.dup2(lf, 2)
            if lf > 2:
                os.close(lf)
            os.chdir(cwd)
            env = dict(os.environ)
            env["PATH"] = "/home/z/.bun/bin:/home/z/.local/bin:" + env.get("PATH", "")
            os.execvpe(cmd[0], cmd, env)
        except Exception:
            os._exit(127)
    # parent: the child is its own pgid leader; write pidfile + header
    pidfile.write_text(str(pid))
    with open(log, "a") as f:
        f.write(f"\n===== dispatch-bg {ts} name={name} pid={pid} cwd={cwd}\n===== cmd: {' '.join(cmd)}\n")
    print(f"dispatch-bg: started '{name}' pid={pid} log={log}")
    return 0


def cmd_stop(args) -> int:
    pidfile = PIDS / f"{args.name}.pid"
    # the stack lane: the supervisor (start.ts) exits after spawning
    # bridge+engine children, so prefer the official agent:stop first.
    if args.name == "stack":
        bun = resolve_bin("bun", "BUN_BIN")
        cwd = args.cwd or "/home/z/my-project/unown"
        subprocess.run([bun, "run", "agent:stop"], cwd=cwd, check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.5)
    if not pidfile.exists():
        print(f"dispatch-bg: no pidfile for '{args.name}'")
    else:
        try:
            pid = int(pidfile.read_text().strip() or 0)
        except ValueError:
            pid = 0
        if pid and Path(f"/proc/{pid}").exists():
            try:
                pgid = os.getpgid(pid)
                os.killpg(pgid, signal.SIGTERM)
                print(f"dispatch-bg: SIGTERM -> pgid {pgid} ('{args.name}')")
            except ProcessLookupError:
                pass
            for _ in range(40):
                if not Path(f"/proc/{pid}").exists():
                    break
                time.sleep(0.25)
            else:
                try:
                    os.killpg(os.getpgid(pid), signal.SIGKILL)
                    print(f"dispatch-bg: SIGKILL fallback -> '{args.name}'")
                except ProcessLookupError:
                    pass
        elif pid:
            # stale leader: children may still hold the old pgid
            try:
                os.killpg(pid, signal.SIGTERM)
                print(f"dispatch-bg: SIGTERM -> stale pgid {pid}")
            except ProcessLookupError:
                pass
        pidfile.unlink(missing_ok=True)
    # port sweep for children that escaped the group
    if args.name == "stack":
        subprocess.run(["pkill", "-TERM", "-f", "llm-bridge"], check=False)
        subprocess.run(["pkill", "-TERM", "-f", "agent-service"], check=False)
        time.sleep(1.0)
    for svc, port in STACK_PORTS.items():
        st = _health(port, "/health" if svc == "bridge" else "/api/overview")
        print(f"dispatch-bg: post-stop {svc} :{port} -> {st}")
    return 0


def cmd_status(args) -> int:
    names = [args.name] if args.name else [p.stem for p in PIDS.glob("*.pid")]
    any_up = False
    for name in names:
        pidfile = PIDS / f"{name}.pid"
        if not pidfile.exists():
            print(f"{name}: no pidfile")
            continue
        try:
            pid = int(pidfile.read_text().strip() or 0)
        except ValueError:
            pid = 0
        up = bool(pid) and Path(f"/proc/{pid}").exists()
        print(f"{name}: pid={pid} {'UP' if up else 'DOWN'}")
        any_up = any_up or up
    for svc, port in STACK_PORTS.items():
        st = _health(port, "/health" if svc == "bridge" else "/api/overview")
        print(f"health {svc} :{port} -> {st}")
        any_up = any_up or not st.startswith("DOWN")
    return 0 if any_up else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_run = sub.add_parser("run")
    p_run.add_argument("--name", required=True)
    p_run.add_argument("--cwd", required=True)
    p_run.add_argument("--log")
    p_run.add_argument("rest", nargs=argparse.REMAINDER)
    p_stack = sub.add_parser("stack")
    p_stack.add_argument("--cwd", required=True)
    p_stack.add_argument("--name", default="stack")
    p_stack.add_argument("--log")
    p_stop = sub.add_parser("stop")
    p_stop.add_argument("--name", required=True)
    p_stop.add_argument("--cwd", default="/home/z/my-project/unown")
    p_st = sub.add_parser("status")
    p_st.add_argument("--name")
    args = ap.parse_args()

    if args.cmd == "run":
        rest = [a for a in args.rest if a != "--"]
        if not rest:
            raise SystemExit("dispatch-bg run: no command given")
        return run_detached(args.name, args.cwd, rest, args.log)
    if args.cmd == "stack":
        bun = resolve_bin("bun", "BUN_BIN")
        return run_detached(args.name, args.cwd, [bun, "run", "agent:start"], args.log)
    if args.cmd == "stop":
        return cmd_stop(args)
    if args.cmd == "status":
        return cmd_status(args)
    return 1


if __name__ == "__main__":
    sys.exit(main())
