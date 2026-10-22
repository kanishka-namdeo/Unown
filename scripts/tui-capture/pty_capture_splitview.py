#!/usr/bin/env python3
"""pty_capture_splitview.py — the split-view display mode's landing stills.

The landing page's feature carousel (src/components/landing/feature-carousel.tsx)
shows these six stills on its split-view slide. They are PTY-lane assets
(see pty-README.md): the band/dock/response-only surfaces are composed through
the fullscreen layout engine, a different visual language from the classic
transcript the other nine landing scenarios capture — so this script is their
reproducible generator. It drives REAL sessions (live model turns included)
against the current TUI, same story as the original set:

  session A (default model, /tmp/sv-demo fixture):
    /split                                  -> 01-band-thinking-tools
    /files                                  -> 02-files-dock
    /split-height 24 · /split-tools-width 40 · /split-tools-view
                                            -> 03-geometry-commands
    "Read README.md and reply with its first line only."
                                            -> 05-agent-turn-tools
  session B (--model qwen3.7-plus --effort high — the unown CLI's own flag;
  pi's --thinking is not parsed by unown's CLI front end and would land as
  prompt text):
    "What is 17 * 23? Think briefly and answer with just the number."
                                            -> 04-live-thinking (mid-turn)
    /split-trim-response on · "What is 19 * 21? Answer with just the number."
                                            -> 06-response-only

The qwen session needs reasoning to actually stream: the bundled bridge keeps
qwen thinking OFF by default (snappier agent turns) and pi only sends
`enable_thinking` for models marked `reasoning: true` with
`compat.thinkingFormat: "qwen"` — so this script snapshots
~/.unown/agent/models.json, adds exactly that metadata to the qwen3.7-plus
entry (the bridge forwards a client `enable_thinking` to Dashscope; verified:
qwen3.7-plus then streams reasoning_content), and restores the original bytes
on exit — the AddonsJsonGuard pattern from pty_common.

Fixture: a scratch demo project (SV_DEMO, default /tmp/sv-demo) carrying a
README.md whose first line is `# Demo` — the read-turn's target. Stills land
in $OUT (default <OUT_ROOT>/split-view/stills) together with <name>.pane.txt
pane dumps, the lane's audit ground truth.

Usage:
  UNOWN_ROOT=/home/z/unown \
  OUT=/home/z/my-project/download/unown-tui-captures/split-view/stills \
  python3 scripts/tui-capture/pty_capture_splitview.py
"""
from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pty_common import PaneTimeout, UnownPty, exit_code, make_logger, print_summary  # noqa: E402

SV_DEMO = os.environ.get("SV_DEMO", "/tmp/sv-demo")
README = "# Demo\n\nSplit-view feature verification project. One heading, one line of context.\n"
QWEN_MODEL = os.environ.get("SPLITVIEW_THINKING_MODEL", "qwen3.7-plus")
MODELS_JSON = os.path.expanduser("~/.unown/agent/models.json")


class ModelsJsonThinking:
    """Snapshot models.json; mark the qwen entry reasoning-capable; restore on exit.

    Adds ONLY `reasoning: true` + `compat: {thinkingFormat: "qwen",
    supportsReasoningEffort: false, supportsDeveloperRole: false}` to the
    bridge-provider entry whose id is QWEN_MODEL — pi then sends
    `enable_thinking: true` whenever a thinking level is set, and the bridge
    forwards it (its buildUpstreamBody passes a client enable_thinking through
    for qwen models). supportsDeveloperRole:false is required: reasoning-capable
    models get the system prompt as the OpenAI `developer` role, which
    Dashscope rejects with a 400 ("developer is not one of ['system', ...]") —
    measured on this stack. Byte-for-byte restore, no matter what happens in
    between.
    """

    def __init__(self, log):
        self.log = log
        self.before = None

    def __enter__(self):
        if os.path.exists(MODELS_JSON):
            with open(MODELS_JSON, "rb") as f:
                self.before = f.read()
            try:
                cfg = json.loads(self.before)
                touched = 0
                for prov in cfg.get("providers", {}).values():
                    for m in prov.get("models", []):
                        if m.get("id") == QWEN_MODEL:
                            m["reasoning"] = True
                            m["compat"] = {"thinkingFormat": "qwen", "supportsReasoningEffort": False, "supportsDeveloperRole": False}
                            touched += 1
                if touched:
                    with open(MODELS_JSON, "w", encoding="utf-8") as f:
                        json.dump(cfg, f, indent=2)
                        f.write("\n")
                self.log(f"models.json: marked {QWEN_MODEL} reasoning-capable ({touched} entry), snapshot taken")
            except Exception as exc:
                self.log(f"models.json patch FAILED ({exc!r}) — leaving untouched; 04/06 may show an idle panel")
                self.__exit__()
        return self

    def __exit__(self, *exc):
        if self.before is not None:
            with open(MODELS_JSON, "wb") as f:
                f.write(self.before)
            self.log("models.json restored to pre-run bytes")
        return False


def make_fixture(log):
    os.makedirs(SV_DEMO, exist_ok=True)
    with open(os.path.join(SV_DEMO, "README.md"), "w", encoding="utf-8") as f:
        f.write(README)
    log(f"fixture ready: {SV_DEMO}/README.md (first line '# Demo')")


def wait_thinking_streams(t: UnownPty, timeout=90.0):
    """The Thinking panel's empty placeholder disappears the moment reasoning
    streams; wait for that, then let a few lines accumulate."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        t.pump(0.4)
        if "Thinking idle" not in t.pane_text():
            time.sleep(1.5)  # let the reasoning window fill a few lines
            t.pump(0.4)
            return t.pane_text()
    raise PaneTimeout(f"thinking never streamed within {timeout:.0f}s (panel still idle) — is the model reasoning-capable?")


def session_a(log, records):
    """Default-model session: band, dock, geometry, one read-tool turn."""
    t = UnownPty(log, cwd=SV_DEMO)
    try:
        t.wait_ready()
        t.wait_idle(60)
        t.type_prompt("/split")
        t.wait_for(["Split view on"], timeout=30, desc="band on")
        t.wait_for(["Thinking", "Tool Usage", "No tools called yet"], timeout=15, desc="band panels")
        records.append(t.still("01-band-thinking-tools",
                               ["Thinking", "Tool Usage", "No tools called yet", "Split view on"]))
        t.type_prompt("/files")
        t.wait_for(["Files panel docked right"], timeout=30, desc="dock on")
        t.wait_for(["Files (", "No files touched yet", "r read"], timeout=15, desc="dock body")
        records.append(t.still("02-files-dock",
                               ["Files (", "No files touched yet", "r read", "Files panel docked right"]))
        t.type_prompt("/split-height 24")
        t.type_prompt("/split-tools-width 40")
        t.type_prompt("/split-tools-view")
        t.wait_for(["Tool panel: full"], timeout=30, desc="geometry toasts")
        t.wait_for(["No edit yet"], timeout=15, desc="edit-diff subpanel")
        records.append(t.still("03-geometry-commands",
                               ["Tool panel: full", "No edit yet", "Files ("]))
        t.type_prompt("Read README.md and reply with its first line only.")
        t.wait_for(["Files (1)"], timeout=150, desc="read call registered in the dock")
        t.wait_idle(timeout=180)
        t.pump(1.0)
        records.append(t.still("05-agent-turn-tools",
                               ["read ", "README.md", "Files (1)"]))
    finally:
        t.close()


def session_b(log, records):
    """Reasoning-model session: live thinking mid-turn, then response-only."""
    t = UnownPty(log, cwd=SV_DEMO,
                 extra_args=["--model", QWEN_MODEL, "--effort", "high"])
    try:
        t.wait_ready()
        t.wait_for([QWEN_MODEL], timeout=30, desc="qwen model active in the footer")
        t.wait_idle(60)
        t.type_prompt("/split")
        t.wait_for(["Split view on"], timeout=30, desc="band on")
        t.type_prompt("/files")
        t.wait_for(["Files panel docked right"], timeout=30, desc="dock on")
        t.type_prompt("What is 17 * 23? Think briefly and answer with just the number.")
        pane = wait_thinking_streams(t, timeout=120)
        log("thinking is streaming — capturing mid-turn")
        records.append(t.still("04-live-thinking", ["Thinking"]))
        if "Thinking idle" in pane:
            records[-1].ok = False
            records[-1].detail = "(thinking panel idle — reasoning never streamed)"
        t.wait_for(["391"], timeout=180, desc="17*23 answer")
        t.wait_idle(timeout=60)
        t.type_prompt("/split-trim-response on")
        t.wait_for(["Panel C: response only"], timeout=30, desc="response-only mode")
        t.type_prompt("What is 19 * 21? Answer with just the number.")
        t.wait_for(["399"], timeout=180, desc="19*21 answer")
        t.wait_idle(timeout=60)
        t.pump(1.0)
        records.append(t.still("06-response-only",
                               ["399", QWEN_MODEL, "19 * 21"]))
    finally:
        t.close()


def main():
    log = make_logger("pty_capture_splitview")
    make_fixture(log)
    records = []
    with ModelsJsonThinking(log):
        session_a(log, records)
        session_b(log, records)
    passed, total = print_summary("pty_capture_splitview", records)
    return exit_code(records)


if __name__ == "__main__":
    sys.exit(main())
