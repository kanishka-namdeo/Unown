#!/usr/bin/env python3
"""M5 live E2E driver — the monitoring/delivery policies against the REAL
engine + bridge + Agnes upstream.

Steps:
  1. A local HTTP receiver (the --deliver target) on an ephemeral port.
  2. `unown routines create` with --deliver + active-hours (a window that
     excludes now) + a second routine with --idle-only.
  3. An INTERACTIVE request through the bridge (no lane marker — the
     terminal-agent shape) to arm lastInteractiveAt presence.
  4. Wait for two engine ticks (the 20s poll): the active-hours routine
     records outside_active_hours skips; the idle-only routine records
     yielded_to_foreground skips while presence is fresh.
  5. `unown routines run` the delivery routine (manual runs bypass the
     gates BY DESIGN) → the receiver must get the documented JSON payload
     and the run row must record delivered=sent.
  6. Cleanup.
"""
import json
import subprocess
import sys
import time
import urllib.request

UNOWN = "unown"
ENGINE = "http://127.0.0.1:3030"
BRIDGE = "http://127.0.0.1:3031"
TOKEN = open("/home/z/my-project/unown/data/self-learning/engine.token").read().strip()

received = []

def serve():
    import socketserver, http.server
    class H(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            n = int(self.headers.get("content-length", 0))
            received.append(json.loads(self.rfile.read(n)))
            self.send_response(200)
            self.end_headers()
        def log_message(self, *a):
            pass
    srv = socketserver.TCPServer(("127.0.0.1", 0), H)
    port = srv.server_address[1]
    import threading
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, port

def sh(*args, timeout=90):
    r = subprocess.run([UNOWN, *args], capture_output=True, text=True, timeout=timeout)
    return r.returncode, r.stdout + r.stderr

def api(method, path, body=None):
    req = urllib.request.Request(f"{ENGINE}{path}", method=method)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    if body is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(body).encode()
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)

def main():
    ok = True
    srv, port = serve()
    # 1) an active-hours window that excludes NOW (fresh skip, no misfire).
    import datetime
    now = datetime.datetime.now()
    start_h, end_h = (now.hour + 2) % 24, (now.hour + 10) % 24
    window = f"{start_h:02d}:00-{end_h:02d}:00"

    rc, out = sh("routines", "create", "--title", "M5 deliver e2e",
                 "--prompt", "Report the single word DELIVERED and stop.",
                 "--every", "1m", "--deliver", f"http://127.0.0.1:{port}/hook",
                 "--workspace", "/tmp/ralph-demo")
    deliver_id = next((t.strip('(")') for t in out.split() if t.startswith("auto-")), None)
    print(("PASS" if rc == 0 and deliver_id else "FAIL") + f" create deliver routine ({deliver_id})")
    ok &= bool(rc == 0 and deliver_id)

    rc, out = sh("routines", "create", "--title", "M5 hours e2e",
                 "--prompt", "x", "--every", "1m", "--active-hours", window,
                 "--workspace", "/tmp/ralph-demo")
    hours_id = next((t.strip('(")') for t in out.split() if t.startswith("auto-")), None)
    print(("PASS" if rc == 0 and hours_id else "FAIL") + f" create active-hours routine ({hours_id})")
    ok &= bool(rc == 0 and hours_id)

    rc, out = sh("routines", "create", "--title", "M5 idle e2e",
                 "--prompt", "x", "--every", "1m", "--idle-only",
                 "--workspace", "/tmp/ralph-demo")
    idle_id = next((t.strip('(")') for t in out.split() if t.startswith("auto-")), None)
    print(("PASS" if rc == 0 and idle_id else "FAIL") + f" create idle-only routine ({idle_id})")
    ok &= bool(rc == 0 and idle_id)

    try:
        # 2) interactive presence: a bridge chat with NO lane marker (the human shape).
        req = urllib.request.Request(f"{BRIDGE}/v1/chat/completions", method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", "Bearer none")  # not bridge-background → interactive
        req.data = json.dumps({"model": "agnes-3.0-flash", "messages": [{"role": "user", "content": "Reply with exactly: PRESENT"}], "max_tokens": 8}).encode()
        with urllib.request.urlopen(req, timeout=60) as r:
            body = json.load(r)
        presence = body["choices"][0]["message"]["content"]
        h = json.load(urllib.request.urlopen(f"{BRIDGE}/health", timeout=5))
        li = h["lanes"].get("lastInteractiveAt")
        armed = isinstance(li, (int, float)) and time.time() - li < 60
        print(("PASS" if armed and "PRESENT" in presence else "FAIL") + f" interactive presence armed (lastInteractiveAt age {time.time() - (li or 0):.1f}s)")
        ok &= armed

        # 3) two engine ticks (20s poll): both gates record their skips.
        print("… waiting 75s for two ticks …")
        time.sleep(75)
        hours_runs = api("GET", f"/api/automations/{hours_id}/runs?limit=10")["runs"]
        hours_skips = [r for r in hours_runs if r.get("error") == "outside_active_hours"]
        print(("PASS" if hours_skips else "FAIL") + f" active-hours gate: {len(hours_skips)} outside_active_hours skip(s) recorded")
        ok &= bool(hours_skips)
        idle_runs = api("GET", f"/api/automations/{idle_id}/runs?limit=10")["runs"]
        idle_skips = [r for r in idle_runs if r.get("error") == "yielded_to_foreground"]
        print(("PASS" if idle_skips else "FAIL") + f" idle-only gate: {len(idle_skips)} yielded_to_foreground skip(s) recorded while a human was present")
        ok &= bool(idle_skips)

        # 4) delivery: manual run-now (manual bypasses the gates by design).
        rc, out = sh("routines", "run", deliver_id)
        print(("PASS" if rc == 0 else "FAIL") + " run-now accepted")
        ok &= rc == 0
        deadline = time.time() + 120
        delivered_run = None
        while time.time() < deadline:
            runs = api("GET", f"/api/automations/{deliver_id}/runs?limit=10")["runs"]
            for r in runs:
                if r.get("status") in ("succeeded", "failed") and r.get("trigger_kind") == "manual":
                    delivered_run = r
                    break
            if delivered_run and delivered_run.get("ended_at"):
                break
            time.sleep(5)
        got_payload = any(p.get("type") == "unown.routine.finished" and p.get("routineId") == deliver_id for p in received)
        row_ok = delivered_run is not None and delivered_run.get("delivered") == "sent"
        print(("PASS" if got_payload and row_ok else "FAIL") + f" delivery: receiver saw payload={got_payload}, row delivered={delivered_run.get('delivered') if delivered_run else 'no-run'}")
        ok &= got_payload and row_ok
        if received:
            p = received[-1]
            keys = sorted(k for k in p if k != "output")
            print(f"  payload fields: {keys}")
    finally:
        for rid in (deliver_id, hours_id, idle_id):
            if rid:
                sh("routines", "delete", rid)
        srv.shutdown()
    print("M5-E2E:", "ALL PASS" if ok else "FAILURES")
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main())
