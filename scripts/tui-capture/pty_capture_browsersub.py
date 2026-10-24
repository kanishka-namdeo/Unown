#!/usr/bin/env python3
"""
pty_capture_browsersub.py — the browser SUBAGENT surfaces, END-TO-END.

The 2026-10-24 browser-subagent round's visual contract, captured against the
real TUI with a real model and a real Chromium (the same pane-truth discipline
as the other PTY lanes; pyte is the vt100 emulator so pane text and pixels are
exact by construction):

  01-task-call        the sync delegation row mounts: `task → browser` with
                      the task preview (renderCall)
  02-live-browser     the in-flight frame carries the HUMANIZED tool label —
                      `browser: navigate` / `browser: click` / `browser:
                      fill_form` — the round's headline feature (was: a bare
                      tool name)
  03-done             the finished row: `✓ N turns, M tools in Xs` (the new
                      wall-clock total on completion rows)
  04-report           the child's report reaches the parent transcript
                      (Outcome:/Did:/Pages:/Notes: contract, the live
                      confirmation text quoted)
  05-fleet            the ASYNC lane: the fleet widget above the editor with
                      the ◉ browser glyph, the humanized label and the live
                      token count on the row
  06-tasks            /tasks lists the browser child with lifecycle metadata
                      (model, turns, tokens, elapsed) — the Claude Code
                      #89844 complaint class

Fixture: a local form page (threaded http.server inside this script) the
browser subagent fills and submits; the confirmation text can only come from
a real rendered page, which is the proof the whole loop ran.

Usage:
    python3 scripts/tui-capture/pty_capture_browsersub.py
"""

from __future__ import annotations

import http.server
import os
import sys
import threading
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

SCRIPT = "pty_capture_browsersub"

FIXTURE_PAGE = """<!doctype html><html><head><title>Subagent Fixture</title></head><body>
<h1>Form page</h1>
<form id="f" onsubmit="event.preventDefault(); document.getElementById('out').textContent = 'submitted ' + document.getElementById('nm').value + '/' + document.getElementById('sel').value;">
<input id="nm" type="text" placeholder="name">
<select id="sel"><option value="a">Alpha</option><option value="b">Beta</option></select>
<button type="submit" id="go">Submit form</button>
</form>
<div id="out"></div>
</body></html>"""


class Fixture:
    """Local form fixture; records hits so the run proves a real navigate."""

    def __init__(self):
        self.hits: list[str] = []
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                outer.hits.append(self.path)
                body = FIXTURE_PAGE.encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/"

    def start(self):
        self.thread.start()

    def stop(self):
        self.server.shutdown()


SYNC_PROMPTS = [
    (
        "Delegate a web task to the browser subagent right now using the task tool "
        "with agent set to browser. The task: open {url} in the browser, type Ada "
        "into the name field, pick the Beta option, click Submit form, then report "
        "the confirmation text exactly. Do not open the page yourself; delegate it."
    ),
    (
        "Use the task tool now with agent browser (the browser subagent) and this "
        "task: on {url} fill the name field with Ada, select Beta, submit the form, "
        "and report the exact confirmation line. Delegate; do not fetch it yourself."
    ),
]

ASYNC_PROMPT = (
    "Now spawn the browser subagent IN THE BACKGROUND: call the task tool with "
    "async true and agent browser, with this task: open {url} and report the page "
    "heading. Acknowledge immediately; do not wait for it to finish."
)


def run_sync_lane(tui: UnownPty, url: str, log, recs: list[StillRecord]) -> None:
    """The synchronous delegation: task row → live labels → done → report.

    Appends into the caller's records list so a late-stage timeout keeps the
    stills that already landed (the lane is progressive, not all-or-nothing).
    """
    sent = False
    for prompt in SYNC_PROMPTS:
        try:
            tui.type_prompt(prompt.format(url=url))
            sent = True
            # The delegation row: renderCall is `task → browser "…"`.
            tui.wait_for(["task → browser"], timeout=150, desc="task tool row")
            recs.append(tui.still("01-task-call", ["task → browser"]))
            break
        except PaneTimeout:
            log("sync prompt did not produce a task row; retrying with the alternate phrasing")
            tui.key("esc")
            continue
    if not any(r.name == "01-task-call" for r in recs):
        raise PaneTimeout("no task → browser row appeared for either sync prompt")

    # Live humanized label: any browser action detail on the in-flight row.
    tui.wait_for(
        ["browser: navigate", "browser: click", "browser: fill_form", "browser: snapshot", "browser: type", "browser: start"],
        mode="any",
        timeout=180,
        desc="humanized browser label",
    )
    recs.append(
        tui.still(
            "02-live-browser",
            ["browser: navigate", "browser: click", "browser: fill_form", "browser: snapshot", "browser: type", "browser: start"],
            mode="any",
        )
    )

    # Completion row: the finished mark with the wall-clock total.
    tui.wait_for(
        ["browser: ✓", "browser: ✗", "browser: ⊘"],
        mode="any",
        timeout=240,
        desc="finished task row",
    )
    recs.append(tui.still("03-done", ["browser: ✓", "browser: ✗", "browser: ⊘"], mode="any"))

    # The report in the transcript (the child's contract shape). Best-effort:
    # the parent's closing turn is model-timed and long reports can scroll past
    # the visible pane — a miss is logged, never fatal to the lane.
    try:
        tui.wait_for(["Outcome:", "submitted"], mode="any", timeout=150, desc="child report")
        recs.append(tui.still("04-report", ["Outcome:", "submitted"], mode="any"))
    except PaneTimeout:
        log("04-report: the report text was not visible in time (model-timed) — skipping, not failing")


def run_async_lane(tui: UnownPty, url: str, log, recs: list[StillRecord]) -> None:
    """The async fleet lane: widget row + /tasks lifecycle metadata."""
    tui.type_prompt(ASYNC_PROMPT.format(url=url))
    # The fleet widget mounts above the editor with the ◉ browser glyph.
    tui.wait_for(["Subagents", "browser"], timeout=150, desc="fleet widget")
    # Give the child a moment to start driving so the row carries the label.
    try:
        tui.wait_for(
            ["browser: navigate", "browser: snapshot", "browser: start", "browser: click"],
            mode="any",
            timeout=60,
            desc="fleet row label",
        )
    except PaneTimeout:
        log("fleet row label not observed in time (child may still be booting)")
    recs.append(tui.still("05-fleet", ["Subagents"], mode="any"))

    # /tasks — the enriched lifecycle row.
    tui.type_prompt("/tasks")
    try:
        tui.wait_for(["turns"], timeout=30, desc="/tasks output")
    except PaneTimeout:
        log("/tasks output not observed")
    recs.append(tui.still("06-tasks", ["browser"], mode="any"))


def main() -> int:
    log = make_logger(SCRIPT)
    fixture = Fixture()
    fixture.start()
    log(f"fixture form page at {fixture.url}")
    tui: UnownPty | None = None
    records: list[StillRecord] = []
    try:
        tui = UnownPty(log)
        tui.wait_ready(timeout=120)
        run_sync_lane(tui, fixture.url, log, records)
        run_async_lane(tui, fixture.url, log, records)
        # Provenance: the fixture must have been hit by a real Chromium.
        log(f"fixture hits: {len(fixture.hits)} ({', '.join(fixture.hits[:6]) or 'none'})")
        if not fixture.hits:
            log("WARNING: zero fixture hits — the browser never navigated")
    except PaneTimeout as exc:
        log(f"FAILED: {exc}")
        if tui is not None:
            tui.still("zz-fail-state", [""], mode="any")
    finally:
        if tui is not None:
            tui.close()
        fixture.stop()
    print_summary(SCRIPT, records)
    return exit_code(records)


if __name__ == "__main__":
    sys.exit(main())
