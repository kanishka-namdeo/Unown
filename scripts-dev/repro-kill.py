#!/usr/bin/env python3
"""Repro: TUI session, SIGKILL the engine, capture the pane + any crash."""
import os, sys, signal, subprocess, time, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts", "tui-capture"))
import pty_common as P

P.UNOWN_ROOT = "/home/z/my-project/unown"
P.UNOWN_BIN = os.path.join(P.UNOWN_ROOT, "bin", "unown")

def engine_pid():
    tok = ""
    try:
        with open(os.path.join(P.UNOWN_ROOT, "data", "self-learning", "engine.token")) as f:
            tok = f.read().strip()
    except Exception:
        pass
    hdr = ["-H", f"Authorization: Bearer {tok}"] if tok else []
    r = subprocess.run(["curl", "-s", "-m", "2", *hdr, "http://127.0.0.1:3030/api/overview"], capture_output=True, text=True)
    if r.returncode != 0 or '"ok":true' not in r.stdout:
        return None
    return json.loads(r.stdout).get("pid")

log = lambda msg: print(f"[pty] {msg}", flush=True)
tui = P.UnownPty(log, cwd=P.UNOWN_ROOT, env_extra={"PI_ENGINE_PROBE_INTERVAL_MS": "5000"})
tui.wait_ready(90)
print("TUI up", flush=True)
tui.wait_for(["memory: up"], timeout=30, desc="footer up")
print("footer up OK", flush=True)
pid = engine_pid()
print(f"killing engine pid={pid}", flush=True)
os.kill(pid, signal.SIGKILL)
deadline = time.time() + 25
last = ""
while time.time() < deadline:
    pane = "\n".join(tui.pane())
    if pane != last:
        print(f"--- pane change at t+{25 - (deadline - time.time()):.1f}s ---", flush=True)
        print(pane[-1200:], flush=True)
        last = pane
    time.sleep(0.5)
print("proc poll:", tui.proc.poll(), flush=True)
print("=== last pane tail ===")
print("\n".join(tui.pane())[-2000:])
try:
    tui.close()
except Exception:
    pass
