#!/usr/bin/env python3
"""verify_memory_matrix.py — the memory-engine × TUI combination matrix lane.

The memory-engine combination round (2026-11-10,
docs/memory-engine-combo-round-session.md): the read/write lanes of the
memory engine that live INSIDE a terminal session, driven through the REAL
TUI in a real project against a live engine — the cells the engine-side live
suites (memory-live/memory-poison, which drive the engine's own loop) never
touch.

Phases (all need the stack up — bridge + engine — but NO model turns; the
commands are local: /learning reads disk, /note posts to the engine, /memory
search hits the engine API):

  boot     the TUI boots in the target project; the memory footer row renders
  learning `/learning` (R2): the effective four-tier stack fresh from disk —
           the engine header ("memory engine: up"), the injection budget line,
           per-tier staleness ages, the deep-dive footer hint
  manual   the W6 hand-edit lane: a unique marker bullet planted under
           `## Manual notes` rides the very next /learning — no dream needed
           (the injection is file-based; the render-preservation contract is
           pinned by test/manual-notes.test.ts, this lane pins the READ side)
  note     `/note <marker>` (W1): the in-session write lane — "Note delivered
           to the engine." and the row lands in /api/notes (kind terminal)
  search   `/memory search <query>` (R5): the cross-scope recall surface —
           results tagged by source scope, or the honest empty answer
  new      `/new` (R3): the stack re-resolves from disk — a marker planted
           AFTER boot is visible to the very next /learning, no restart
  budget   T4: a tiny PI_MEMORY_TOTAL_CHARS forces the injection budget to
           overflow — the budget line must NAME it (pruned/head-truncated/
           OVERFLOW; truncation is never silent) and, since the round's F5
           reorder, stay visible in a 36-row pane
  exit     a clean quit delivers the exit note (W3): a "Terminal session
           outcome" row appears in /api/notes

Usage:
  python3 scripts/tui-capture/verify_memory_matrix.py                     # all phases
  python3 scripts/tui-capture/verify_memory_matrix.py --phases boot,learning
  MEMORY_PROJECT=/path/to/project python3 scripts/tui-capture/verify_memory_matrix.py

The target project defaults to a fresh scratch dir (the lane works anywhere);
point MEMORY_PROJECT at a project with dreamed memories to also see content.
The engine must be up (bun run agent:start); AGNES_API_KEY must be exported
for the provider preflight.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
import uuid

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _SCRIPT_DIR)
import pty_common as pc  # noqa: E402

ENGINE_URL = os.environ.get("UNOWN_ENGINE_URL", "http://127.0.0.1:3030")
# The engine's per-boot token: own-data-dir first, shared mirror second (the
# resilience R11 heal — the same resolution the CLI clients use).
_TOKEN_PATHS = [
    os.path.join(os.environ.get("UNOWN_ROOT", pc.UNOWN_ROOT), "data", "self-learning", "engine.token"),
    os.path.expanduser("~/.unown/engine.token"),
]


def engine_token() -> str:
    for p in _TOKEN_PATHS:
        try:
            with open(p) as f:
                return f.read().strip()
        except OSError:
            continue
    return ""


def engine_notes() -> list:
    tok = engine_token()
    req = urllib.request.Request(f"{ENGINE_URL}/api/notes")
    if tok:
        req.add_header("Authorization", f"Bearer {tok}")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.load(r).get("notes", [])
    except Exception:
        return []


_results: list[tuple[str, str, bool]] = []


def note(log, phase, name, ok, extra=""):
    _results.append((phase, name, ok))
    log(f"[STEP] {'PASS' if ok else 'FAIL'}  {name}  {extra}")


def target_project(log) -> str:
    d = os.environ.get("MEMORY_PROJECT")
    if d:
        os.makedirs(d, exist_ok=True)
        return d
    import tempfile

    d = os.path.join(tempfile.mkdtemp(prefix="unown-mem-matrix-"))
    os.makedirs(d, exist_ok=True)
    return d


def project_memory_path(project: str) -> str:
    return os.path.join(project, ".unown", "memory", "project.md")


def plant_manual_marker(project: str, marker: str) -> bool:
    """Plant a bullet under ## Manual notes (the W6 hand-edit lane)."""
    path = project_memory_path(project)
    try:
        with open(path, encoding="utf-8") as f:
            content = f.read()
    except OSError:
        return False
    if "## Manual notes" not in content:
        return False
    content = content.replace(
        "## Manual notes",
        f"## Manual notes\n- {marker}",
        1,
    )
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return True


# ---------------------------------------------------------------------------
# Phases
# ---------------------------------------------------------------------------

def phase_boot(log, cwd) -> bool:
    steps: list[tuple[str, bool]] = []

    def check(name, ok, extra=""):
        steps.append((name, ok))
        note(log, "boot", name, ok, extra)

    s = pc.UnownPty(log, cwd=cwd)
    try:
        s.wait_ready()
        pc.dismiss_first_flights(s, log)
        s.pump(2.0)
        pane = s.pane_text()
        check("TUI boots in the target project", "esc-esc tree" in pane or "Themes" in pane)
        s.still("mem-boot", ["esc-esc tree"], mode="any")
    finally:
        s.close()
    return all(ok for _, ok in steps)


def phase_learning(log, cwd) -> bool:
    steps: list[tuple[str, bool]] = []

    def check(name, ok, extra=""):
        steps.append((name, ok))
        note(log, "learning", name, ok, extra)

    s = pc.UnownPty(log, cwd=cwd)
    try:
        s.wait_ready()
        pc.dismiss_first_flights(s, log)
        s.type_prompt("/learning")
        try:
            pane = s.wait_for(
                [
                    "memory engine:",
                    "injection budget:",
                ],
                timeout=30,
            )
            check("/learning renders the engine header + budget line (the transparency tail)", True)
        except pc.PaneTimeout:
            check("/learning renders the engine header + budget line (the transparency tail)", False, "timeout")
            pane = s.pane_text()
        # A long stack scrolls the head tiers off a 36-row pane; the tail
        # tiers + labels are the always-visible contract (F5: the header and
        # budget line ride the tail since the round's reorder).
        visible_tiers = [t for t in ("POLICY", "PROJECT", "USER", "LOCAL") if t in pane]
        check(
            "tier labels render (tail tiers always visible)",
            len(visible_tiers) >= 2,
            f"visible: {visible_tiers}",
        )
        check(
            "per-tier staleness ages render",
            "updated" in pane,
        )
        check(
            "the deep-dive footer hint names /memory search",
            "/memory search" in pane,
        )
        s.still("mem-learning", ["injection budget:"])
    finally:
        s.close()
    return all(ok for _, ok in steps)


def phase_manual(log, cwd) -> bool:
    steps: list[tuple[str, bool]] = []

    def check(name, ok, extra=""):
        steps.append((name, ok))
        note(log, "manual", name, ok, extra)

    marker = f"MANUAL-INJECT-{uuid.uuid4().hex[:8]}"
    planted = plant_manual_marker(cwd, marker)
    check("marker planted under ## Manual notes", planted)
    if not planted:
        return False

    s = pc.UnownPty(log, cwd=cwd)
    try:
        s.wait_ready()
        pc.dismiss_first_flights(s, log)
        s.type_prompt("/learning")
        try:
            pane = s.wait_for([marker], timeout=30)
            check("the hand-edited Manual-notes marker rides the next /learning", True)
        except pc.PaneTimeout:
            check("the hand-edited Manual-notes marker rides the next /learning", False)
            pane = s.pane_text()
        s.still("mem-manual", [marker])
    finally:
        s.close()
    return all(ok for _, ok in steps)


def phase_note(log, cwd) -> bool:
    steps: list[tuple[str, bool]] = []

    def check(name, ok, extra=""):
        steps.append((name, ok))
        note(log, "note", name, ok, extra)

    marker = f"TUI-NOTE-{uuid.uuid4().hex[:8]}: the in-session note lane works"
    before = len([n for n in engine_notes() if marker.split(":")[0] in n.get("content", "")])
    s = pc.UnownPty(log, cwd=cwd)
    try:
        s.wait_ready()
        pc.dismiss_first_flights(s, log)
        # Avoid '/' inside the body (autocomplete popup retrigger rule)
        s.type_prompt(f"/note {marker}")
        try:
            s.wait_for(["Note delivered to the engine."], timeout=30)
            check("/note answers 'Note delivered to the engine.'", True)
        except pc.PaneTimeout:
            check("/note answers 'Note delivered to the engine.'", False)
        s.still("mem-note", ["Note delivered to the engine."])
    finally:
        s.close()
    # The row must actually land in the engine (kind terminal, this project)
    deadline = time.time() + 20
    landed = False
    while time.time() < deadline and not landed:
        rows = [n for n in engine_notes() if marker.split(":")[0] in n.get("content", "")]
        landed = len(rows) > before and rows[0].get("kind") == "terminal"
        time.sleep(1)
    check("the note row lands in /api/notes (kind terminal)", landed)
    return all(ok for _, ok in steps)


def phase_search(log, cwd) -> bool:
    steps: list[tuple[str, bool]] = []

    def check(name, ok, extra=""):
        steps.append((name, ok))
        note(log, "search", name, ok, extra)

    s = pc.UnownPty(log, cwd=cwd)
    try:
        s.wait_ready()
        pc.dismiss_first_flights(s, log)
        s.type_prompt("/note")  # bare command: the usage line (no network)
        s.pump(1.0)
        s.type_prompt("/memory search BOM-aware reader")
        try:
            pane = s.wait_for(
                ["cross-project memory search", "memory search failed", "memory search unreachable"],
                mode="any",
                timeout=45,
            )
            ok = "cross-project memory search" in pane
            check("/memory search answers through the cross-scope lane", ok)
        except pc.PaneTimeout:
            check("/memory search answers through the cross-scope lane", False, "timeout")
            pane = s.pane_text()
        # results (when any) must be scope-tagged
        if "match(es) across" in pane:
            check("results are scope-tagged", "alpha" in pane or "engine" in pane or "scope" in pane)
        else:
            check("results are scope-tagged", True, "(no matches — scope tags n/a)")
        s.still("mem-search", ["memory search"], mode="any")
    finally:
        s.close()
    return all(ok for _, ok in steps)


def phase_new(log, cwd) -> bool:
    steps: list[tuple[str, bool]] = []

    def check(name, ok, extra=""):
        steps.append((name, ok))
        note(log, "new", name, ok, extra)

    marker = f"NEW-RESOLVE-{uuid.uuid4().hex[:8]}"
    s = pc.UnownPty(log, cwd=cwd)
    try:
        s.wait_ready()
        pc.dismiss_first_flights(s, log)
        # Plant the marker AFTER boot (mid-session memory write on disk)
        planted = plant_manual_marker(cwd, marker)
        check("marker planted mid-session (after boot)", planted)
        s.type_prompt("/new")
        s.pump(2.0)
        s.type_prompt("/learning")
        try:
            pane = s.wait_for([marker], timeout=30)
            check("/new re-resolves the stack from disk (marker visible)", True)
        except pc.PaneTimeout:
            check("/new re-resolves the stack from disk (marker visible)", False)
            pane = s.pane_text()
        s.still("mem-new", [marker])
    finally:
        s.close()
    return all(ok for _, ok in steps)


def phase_budget(log, cwd) -> bool:
    steps: list[tuple[str, bool]] = []

    def check(name, ok, extra=""):
        steps.append((name, ok))
        note(log, "budget", name, ok, extra)

    # T4: force the injection budget to overflow — a tiny PI_MEMORY_TOTAL_CHARS
    # makes the resolver prune the oldest blocks / head-truncate tiers, and the
    # budget line must SAY so (truncation is never silent — the F5 tail keeps
    # the line visible in a 36-row pane).
    s = pc.UnownPty(log, cwd=cwd, env_extra={"PI_MEMORY_TOTAL_CHARS": "900"})
    try:
        s.wait_ready()
        pc.dismiss_first_flights(s, log)
        s.type_prompt("/learning")
        try:
            pane = s.wait_for(["injection budget:"], timeout=30)
            check("the budget line renders under an overflowing cap", True)
            overflow_visible = any(
                w in pane for w in ("pruned", "head-truncated", "OVERFLOW")
            )
            check("overflow is NAMED (pruned/head-truncated/OVERFLOW)", overflow_visible)
            s.still("mem-budget", ["injection budget:"])
        except pc.PaneTimeout:
            check("the budget line renders under an overflowing cap", False, "timeout")
            check("overflow is NAMED (pruned/head-truncated/OVERFLOW)", False)
            s.still("mem-budget", ["esc-esc tree"], mode="any")
    finally:
        s.close()
    return all(ok for _, ok in steps)


def phase_exit(log, cwd) -> bool:
    steps: list[tuple[str, bool]] = []

    def check(name, ok, extra=""):
        steps.append((name, ok))
        note(log, "exit", name, ok, extra)

    marker = f"EXIT-NOTE-{uuid.uuid4().hex[:8]}"
    s = pc.UnownPty(log, cwd=cwd)
    try:
        s.wait_ready()
        pc.dismiss_first_flights(s, log)
        s.type_prompt(f"/note {marker}")
        try:
            s.wait_for(["Note delivered to the engine."], timeout=30)
        except pc.PaneTimeout:
            pass
        before = len([n for n in engine_notes() if marker in n.get("content", "")])
        # A real prompt so the exit note has something to summarize (at least
        # one prompt/tool call) — one tiny model turn.
        s.type_prompt("Reply with the single word OK")
        try:
            s.wait_for(["OK"], timeout=90)
        except pc.PaneTimeout:
            pass
        s.still("mem-exit-pre", ["matrix/alpha", "esc-esc tree"], mode="any")
    finally:
        s.close()
    # The session ended (close) → the exit note must land within a grace window
    deadline = time.time() + 30
    landed = False
    while time.time() < deadline and not landed:
        rows = [n for n in engine_notes() if "Terminal session outcome" in n.get("content", "")]
        landed = len(rows) > 0 and any(cwd in (n.get("project_path") or "") for n in rows)
        time.sleep(1)
    check("a clean quit delivers the exit note (Terminal session outcome)", landed)
    return all(ok for _, ok in steps)


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

RUNNERS = {
    "boot": phase_boot,
    "learning": phase_learning,
    "manual": phase_manual,
    "note": phase_note,
    "search": phase_search,
    "new": phase_new,
    "budget": phase_budget,
    "exit": phase_exit,
}
PHASES = list(RUNNERS)


def main() -> int:
    log = pc.make_logger("verify-memory-matrix")
    selected = None
    for i, arg in enumerate(sys.argv):
        if arg == "--phases" and i + 1 < len(sys.argv):
            selected = [p.strip() for p in sys.argv[i + 1].split(",") if p.strip()]
    if selected is None:
        selected = list(PHASES)
    unknown = [p for p in selected if p not in RUNNERS]
    if unknown:
        log(f"unknown phases: {unknown} (valid: {PHASES})")
        return 2

    if not engine_token():
        log("engine token not found — is the engine up? (bun run agent:start)")
        return 2

    cwd = target_project(log)
    log(f"matrix cwd: {cwd} (override with MEMORY_PROJECT); phases: {selected}")
    for phase in selected:
        log(f"--- phase {phase} (cwd={cwd}) ---")
        try:
            RUNNERS[phase](log, cwd)
        except Exception as exc:  # a phase crash is a phase failure, not a lane crash
            note(log, phase, f"phase {phase} crashed", False, repr(exc))

    log("=== SUMMARY ===")
    failed = []
    for phase, name, ok in _results:
        log(f"  {'PASS' if ok else 'FAIL'}  {name}")
        if not ok:
            failed.append(name)
    log(f"{'ALL GREEN' if not failed else 'FAILURES: ' + '; '.join(failed)}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
