#!/usr/bin/env python3
"""
pty_common.py — shared machinery for the dependency-light PTY capture lane.

Drives the real `unown` TUI inside a plain pty (128x36), parses the byte
stream with pyte, and renders full-frame PNG stills with PIL. Every still is
written together with `<name>.pane.txt` — the literal screen text at capture
time — which is the audit ground truth (mirrors the tmux lane's
`capture-pane` pane dumps).

Why this lane exists: the tmux/ttyd/Chromium lane (driver.js) needs tmux,
ttyd and Playwright Chromium on the host; this sandbox has none of them. A
pty + pyte + PIL stack is enough for full-frame addon-surface stills.

Known limits (documented in pty-README.md):
  - no scrollback (the pane is exactly 36 rows; content that scrolls past
    the top is gone),
  - no ligatures (JetBrains Mono rendered cell-by-cell),
  - the palette comes from the terminal's 256-color mode: pyte resolves
    `38;5;N` to exact hex, so stills match the shipped unown theme's 256-
    color approximations, not a truecolor render,
  - italics render as regular (no italic face installed),
  - ctx.ui.select modality: while a select is open the editor is detached —
    always Escape out of it before sending the next command, or keystrokes
    land in the selector and vanish.

Geometry: 128 cols x 36 rows x 14 px cell width (JetBrains Mono 23 px, advance
13.8 px) x 28 px cell height, plus a 34 px title bar. Override fonts via
FONT_PATH / FONT_BOLD_PATH env vars (the DejaVu Sans Mono fallback works).
"""

from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass, field

import pyte

# ---------------------------------------------------------------------------
# Geometry / fonts / palette (env-overridable knobs)
# ---------------------------------------------------------------------------

COLS = int(os.environ.get("PTY_COLS", 128))
ROWS = int(os.environ.get("PTY_ROWS", 36))
CELL_W = int(os.environ.get("PTY_CELL_W", 14))
CELL_H = int(os.environ.get("PTY_CELL_H", 28))
TITLE_H = int(os.environ.get("PTY_TITLE_H", 34))

UNOWN_ROOT = os.environ.get("UNOWN_ROOT", "/home/z/my-project/Unown")
UNOWN_BIN = os.path.join(UNOWN_ROOT, "bin", "unown")
OUT_DIR = os.environ.get(
    "OUT", "/home/z/my-project/download/unown-addon-captures/stills"
)

FONT_PATH = os.environ.get(
    "FONT_PATH", os.path.expanduser("~/.local/share/fonts/JetBrainsMono-Regular.ttf")
)
FONT_BOLD_PATH = os.environ.get(
    "FONT_BOLD_PATH", os.path.expanduser("~/.local/share/fonts/JetBrainsMono-Bold.ttf")
)
_DEJAVU = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
_DEJAVU_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
if not os.path.exists(FONT_PATH):
    FONT_PATH = _DEJAVU
if not os.path.exists(FONT_BOLD_PATH):
    FONT_BOLD_PATH = _DEJAVU_BOLD

FONT_SIZE = int(os.environ.get("PTY_FONT_SIZE", 23))

# Default fg/bg mirror the unown brand theme (text #e4e4e7, pageBg #09090b).
# Title band mirrors the theme chrome pattern: dim-rung fg (zinc-400) on
# chromeSurface — zinc-500 measured 3.67:1 there (U1-B), under WCAG AA.
DEFAULT_FG = "#e4e4e7"
DEFAULT_BG = "#09090b"
TITLE_BG = "#18181b"
TITLE_FG = "#a1a1aa"
TITLE_RULE = "#3f3f46"

# pyte's 16 named colors -> xterm dark-palette RGB.
NAMED_PALETTE = {
    "black": "#404040",
    "red": "#cd3131",
    "green": "#0dbc79",
    "brown": "#e5e510",
    "blue": "#2472c8",
    "magenta": "#bc3fbc",
    "cyan": "#11a8cd",
    "white": "#e5e5e5",
    "brightblack": "#707070",
    "brightred": "#f14c4c",
    "brightgreen": "#23d18b",
    "brightbrown": "#f5f543",
    "brightblue": "#3b8eea",
    "brightmagenta": "#d670d6",
    "brightcyan": "#29b8db",
    "brightwhite": "#ffffff",
}

# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

_FONTS: dict = {}


def _font_at(path: str, size: int):
    from PIL import ImageFont

    key = (path, size)
    if key not in _FONTS:
        _FONTS[key] = ImageFont.truetype(path, size)
    return _FONTS[key]


def _font(bold: bool, size: int):
    return _font_at(FONT_BOLD_PATH if bold else FONT_PATH, size)


# --- per-glyph font fallback -------------------------------------------------
# The primary font (JetBrains Mono) lacks several status glyphs the TUI uses
# (★☆ difficulty, ◐ starting, ⏸ paused, ⟳ running, ⎇ rollback — measured
# 2026-10-21: PIL then draws the .notdef tofu box, which a VLM audit read as
# "solid-block placeholders looking like corruption" in the dashboard stills).
# A real terminal stack falls back per glyph (xterm.js font chaining); the
# renderer now does the same: primary → DejaVu Sans Mono (same 0.602 advance,
# covers ★☆◐⎇) → Sarasa Mono SC (covers ⏸⟳⎇). Coverage is probed once per
# font via fontTools when available; without fontTools the lane keeps the
# legacy single-font behavior.

FONT_FALLBACK_PAIRS = [
    (
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    ),
    (
        "/usr/share/fonts/truetype/chinese/SarasaMonoSC-Regular.ttf",
        "/usr/share/fonts/truetype/chinese/SarasaMonoSC-Bold.ttf",
    ),
]
_COVERAGE: dict = {}


def _covered(path: str, cp: int) -> bool:
    if path not in _COVERAGE:
        try:
            from fontTools.ttLib import TTFont

            _COVERAGE[path] = set(TTFont(path, lazy=True).getBestCmap().keys())
        except Exception:
            _COVERAGE[path] = None  # unknown coverage — never selected
    cov = _COVERAGE[path]
    return cov is not None and cp in cov


def _font_for_char(ch: str, bold: bool, size: int):
    """First font (primary, then fallbacks) whose cmap covers the character."""
    primary_path = FONT_BOLD_PATH if bold else FONT_PATH
    cp = ord(ch)
    if _covered(primary_path, cp):
        return _font_at(primary_path, size)
    for reg, boldp in FONT_FALLBACK_PAIRS:
        path = boldp if bold else reg
        if os.path.exists(path) and _covered(path, cp):
            return _font_at(path, size)
    return _font_at(primary_path, size)  # legacy .notdef behavior


def _color(value: str, fallback: str) -> tuple[int, int, int]:
    v = (value or "").strip().lower()
    if v in ("", "default"):
        v = fallback
    if v.startswith("#"):
        v = v[1:]
    elif v in NAMED_PALETTE:
        v = NAMED_PALETTE[v].lstrip("#")
    if re.fullmatch(r"[0-9a-f]{6}", v):
        return (int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16))
    return _hex6(fallback)


def _hex6(hexstr: str) -> tuple[int, int, int]:
    v = hexstr.lstrip("#")
    return (int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16))


def render_png(screen: pyte.Screen, path: str, title: str) -> tuple[int, int]:
    """Render one full frame from the pyte screen; returns (w, h).

    The 34px title bar is a harness label, not terminal content. For shipped
    landing assets set PTY_TITLE=off to render the pure terminal frame (no
    bar — same shape as the tmux-lane stills); PTY_TITLE=<text> renders a bar
    with a custom label; unset keeps the legacy "pty+pyte lane" bar for
    addon-verification stills.
    """
    from PIL import Image, ImageDraw

    title_mode = os.environ.get("PTY_TITLE")
    title_h = 0 if title_mode == "off" else TITLE_H

    width = COLS * CELL_W
    height = title_h + ROWS * CELL_H
    img = Image.new("RGB", (width, height), _hex6(DEFAULT_BG))
    draw = ImageDraw.Draw(img)

    if title_h:
        # Title bar: capture name + geometry + timestamp, thin rule underneath.
        draw.rectangle([0, 0, width, TITLE_H - 5], fill=_hex6(TITLE_BG))
        draw.rectangle([0, TITLE_H - 5, width, TITLE_H - 4], fill=_hex6(TITLE_RULE))
        tfont = _font(bold=False, size=13)
        label = title_mode if title_mode else f"unown TUI · {title} · {COLS}x{ROWS} · pty+pyte lane"
        draw.text((10, 7), label, font=tfont, fill=_hex6(TITLE_FG))

    font = _font(bold=False, size=FONT_SIZE)
    font_bold = _font(bold=True, size=FONT_SIZE)
    ascent, descent = font.getmetrics()
    text_top = title_h + (CELL_H - (ascent + descent)) // 2

    default_fg = _hex6(DEFAULT_FG)
    default_bg = _hex6(DEFAULT_BG)

    buffer = screen.buffer
    for y in range(ROWS):
        row = buffer[y]
        for x in range(COLS):
            cell = row[x]
            ch = cell.data
            if ch == "":
                continue
            fg = _color(cell.fg, DEFAULT_FG)
            bg = _color(cell.bg, DEFAULT_BG)
            if cell.reverse:
                fg, bg = bg, fg
            px, py = x * CELL_W, title_h + y * CELL_H
            if bg != default_bg or cell.reverse:
                draw.rectangle([px, py, px + CELL_W - 1, py + CELL_H - 1], fill=bg)
            if ch != " ":
                draw.text(
                    (px, text_top + y * CELL_H),
                    ch,
                    font=_font_for_char(ch, cell.bold, FONT_SIZE),
                    fill=fg,
                )
            if cell.underscore:
                uy = title_h + y * CELL_H + CELL_H - 3
                draw.rectangle([px, uy, px + CELL_W - 1, uy + 1], fill=fg)

    img.save(path, "PNG")
    return width, height


# ---------------------------------------------------------------------------
# PTY session
# ---------------------------------------------------------------------------

KEYS = {
    "Enter": b"\r",
    "Tab": b"\t",
    "Esc": b"\x1b",
    "Up": b"\x1b[A",
    "Down": b"\x1b[B",
    "Right": b"\x1b[C",
    "Left": b"\x1b[D",
    "CtrlC": b"\x03",
}

# The LAST section of the TUI's startup resource block (── Themes ──) — the
# v0.0.8-era "unown v" first line was retired when the startup banner became
# the loaded-resources block, so that anchor hangs every fresh boot on the
# current build (same fix as driver.js waitReady).
READY_ANCHOR = "── Themes ──"

# The first-flights catalog (flights-core.ts) — a FOCUSED component riding
# the boot of a fresh session. While focused it consumes keypresses: a
# printable char is "none" (the keystroke is eaten — a prompt typed too
# early loses characters), and stray 'x' latches never-again PERSISTENTLY
# (any later prompt containing an 'x' — "exactly", "fix"… — would flip the
# user's config). The PTY lane therefore dismisses it before typing
# anything; the catalog only auto-shows on fresh sessions (dismiss is
# per-session, never-again is a persisted latch we never send).
FIRST_FLIGHT_ANCHORS = ["How unown's memory works", "Generate an AGENTS.md"]


def dismiss_first_flights(session, log, attempts=3):
    """Dismiss the boot-time first-flights catalog if it is on the pane.

    Sends Esc until an anchor leaves the pane; a no-op when the catalog is
    not shown (resumed sessions, latched never-again). Returns True when a
    dismissal happened, False when it was not needed, and logs loudly when
    the catalog refuses to leave (keys after it may be eaten).
    """
    for i in range(attempts):
        session.pump(0.4)
        pane = session.pane_text()
        if not any(a in pane for a in FIRST_FLIGHT_ANCHORS):
            if i == 0:
                return False  # not shown — nothing to do, not even a log line
            log("first-flights catalog dismissed")
            return True
        session.key("Esc", delay=0.3)
        session.pump(0.8)
    if any(a in session.pane_text() for a in FIRST_FLIGHT_ANCHORS):
        log("WARN: first-flights catalog still on pane after Esc x3 — keystrokes may be eaten")
        return False
    log("first-flights catalog dismissed")
    return True


class PaneTimeout(Exception):
    pass


@dataclass
class StillRecord:
    name: str
    anchors: list
    png: str
    pane: str
    ok: bool
    detail: str = ""
    w: int = 0
    h: int = 0
    variance: float = 0.0


class UnownPty:
    """One `unown` TUI process inside a pty, parsed live by pyte."""

    def __init__(self, log, cwd=UNOWN_ROOT, extra_args=None, env_extra=None):
        import pexpect

        self.log = log
        self.cwd = cwd
        self.extra_args = list(extra_args or [])
        env = dict(os.environ)
        env["TERM"] = "xterm-256color"
        env["LINES"] = str(ROWS)
        env["COLUMNS"] = str(COLS)
        # Truthful color: strip CI color-suppression env (same rule as the
        # tmux lane's driver.js).
        for k in ("NO_COLOR", "CLICOLOR", "CLICOLOR_FORCE", "COLORTERM"):
            env.pop(k, None)
        env.update(env_extra or {})
        args = ["bun", UNOWN_BIN] + self.extra_args
        self.log(f"spawn: {' '.join(args)} (cwd={cwd})")
        self.child = pexpect.spawn(
            args[0],
            args[1:],
            cwd=cwd,
            env=env,
            dimensions=(ROWS, COLS),
            timeout=5,
            encoding=None,
        )
        self.screen = pyte.Screen(COLS, ROWS)
        self.stream = pyte.ByteStream(self.screen)
        self.raw_bytes = 0
        self.dead = False

    # -- pane access ---------------------------------------------------------

    def pump(self, timeout=0.4) -> int:
        """Read whatever the TUI emitted (within timeout); feed pyte."""
        import pexpect

        got = 0
        end = time.time() + timeout
        while True:
            remaining = end - time.time()
            if remaining <= 0:
                break
            try:
                chunk = self.child.read_nonblocking(size=65536, timeout=max(remaining, 0.05))
            except pexpect.exceptions.TIMEOUT:
                break
            except (pexpect.exceptions.EOF, ValueError):
                self.dead = True
                break
            except OSError:
                self.dead = True
                break
            if not chunk:
                continue
            got += len(chunk)
            self.raw_bytes += len(chunk)
            try:
                self.stream.feed(chunk)
            except Exception as exc:  # pyte bug tolerance: keep the lane alive
                self.log(f"pyte feed warning: {exc!r}")
        return got

    def pane(self) -> list:
        """Screen lines, trailing whitespace stripped (tmux capture-pane style)."""
        return [line.rstrip() for line in self.screen.display]

    def pane_text(self) -> str:
        return "\n".join(self.pane())

    # -- input ---------------------------------------------------------------

    def send(self, text: str, delay=0.05):
        self.child.send(text.encode("utf-8"))
        time.sleep(delay)

    def key(self, name: str, delay=0.12):
        self.child.send(KEYS[name])
        time.sleep(delay)

    def type_prompt(self, text: str, cps=60):
        """Type text, then submit deterministically.

        Protocol: type char-by-char, pause (the debounced command
        autocomplete popup may open), send Esc to CLOSE any open popup
        (Esc in the editor only cancels autocomplete), then Enter submits
        the raw buffer verbatim. Without the Esc, Enter can race the
        popup's stale prefix and apply a mangled completion (observed:
        "/addons" -> "/addaddons", which then submits as a chat turn).
        Avoid '@', '!' and '/' inside prompt bodies — they retrigger the
        popup mid-text.
        """
        for ch in text:
            self.child.send(ch.encode("utf-8"))
            time.sleep(1.0 / cps)
        time.sleep(0.3)
        self.child.send(b"\x1b")  # close autocomplete popup if open
        time.sleep(0.18)
        self.child.send(b"\r")  # submit raw buffer

    # -- waits ---------------------------------------------------------------

    def wait_for(
        self,
        anchors,
        mode: str = "all",
        timeout: float = 30.0,
        exclude=None,
        desc: str = "",
        poll: float = 0.25,
    ):
        """Pump until every (or any) anchor is visible in the pane text.

        Returns the pane text at success. Raises PaneTimeout otherwise.
        """
        if isinstance(anchors, str):
            anchors = [anchors]
        deadline = time.time() + timeout
        last = ""
        while time.time() < deadline:
            self.pump(poll)
            last = self.pane_text()
            if exclude is not None:
                if isinstance(exclude, str):
                    exclude = [exclude]
                if any(e in last for e in exclude):
                    continue
            if mode == "any":
                hit = next((a for a in anchors if a in last), None)
                if hit is not None:
                    return last
            else:
                if all(a in last for a in anchors):
                    return last
        what = desc or ("any of " + " | ".join(anchors) if mode == "any" else " | ".join(anchors))
        raise PaneTimeout(f"timeout ({timeout:.0f}s) waiting for {what!r}")

    def wait_ready(self, timeout: float = 90.0, anchors=None):
        """Wait until the TUI is interactive.

        Default anchor: the startup resource block's last section (fresh
        sessions). Pass ``anchors`` for boots where that block is not on the
        pane — a RESUMED session's chat history pushes the block off the
        36-row pane, so the resume lane waits on the always-rendered status
        footer instead (same readiness: the footer only draws once the
        interactive loop is live).
        """
        if anchors is None:
            return self.wait_for([READY_ANCHOR], timeout=timeout, desc="TUI header")
        if isinstance(anchors, str):
            anchors = [anchors]
        return self.wait_for(list(anchors), timeout=timeout, desc="TUI ready")

    def wait_idle(self, timeout: float = 60.0, stable_for: float = 1.2):
        """Wait until the pane stops changing (spinner churn settles)."""
        deadline = time.time() + timeout
        last, since = self.pane_text(), time.time()
        while time.time() < deadline:
            self.pump(0.3)
            cur = self.pane_text()
            if cur != last:
                last, since = cur, time.time()
            elif time.time() - since >= stable_for:
                return last
        return last

    # -- stills --------------------------------------------------------------

    def still(self, name: str, anchors, mode: str = "all") -> StillRecord:
        """Verify anchors against the pane, then write PNG + pane.txt."""
        if isinstance(anchors, str):
            anchors = [anchors]
        pane_lines = self.pane()
        text = "\n".join(pane_lines)
        if mode == "any":
            hit = next((a for a in anchors if a in text), None)
            ok, proving = hit is not None, hit
        else:
            ok = all(a in text for a in anchors)
            proving = "; ".join(a for a in anchors if a in text)
        os.makedirs(OUT_DIR, exist_ok=True)
        png_path = os.path.join(OUT_DIR, f"{name}.png")
        pane_path = os.path.join(OUT_DIR, f"{name}.pane.txt")
        with open(pane_path, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        w, h = render_png(self.screen, png_path, name)
        variance = _png_variance(png_path)
        rec = StillRecord(
            name=name,
            anchors=anchors,
            png=png_path,
            pane=pane_path,
            ok=ok,
            detail=proving or "(no anchor matched)",
            w=w,
            h=h,
            variance=variance,
        )
        self.log(
            f"still {name}: {'OK' if ok else 'FAIL'} anchor={rec.detail!r} "
            f"png={w}x{h} variance={variance:.1f}"
        )
        return rec

    # -- teardown ------------------------------------------------------------

    def close(self):
        try:
            if self.child.exitstatus is None and not self.dead:
                self.child.terminate()
                try:
                    self.child.expect(pexpect.EOF, timeout=4)
                except Exception:
                    self.child.terminate(force=True)
        except Exception:
            try:
                self.child.terminate(force=True)
            except Exception:
                pass
        self.log(f"closed (pane bytes total: {self.raw_bytes})")


def _png_variance(path: str) -> float:
    """Mean per-pixel stddev across RGB — a blank frame scores ~0."""
    from PIL import Image

    with Image.open(path) as img:
        small = img.convert("RGB").resize((160, 44))
        hist = small.histogram()
    # variance proxy: sum of squared bin deviations / total pixels
    total = 160 * 44
    per_channel = []
    for c in range(3):
        h = hist[c * 256 : (c + 1) * 256]
        mean = sum(i * n for i, n in enumerate(h)) / total
        var = sum(((i - mean) ** 2) * n for i, n in enumerate(h)) / total
        per_channel.append(var)
    return sum(per_channel) / 3.0


# ---------------------------------------------------------------------------
# addons.json guard (defensive restore)
# ---------------------------------------------------------------------------

ADDONS_JSON = os.path.expanduser("~/.unown/agent/addons.json")


class AddonsJsonGuard:
    """Read the bytes before, write them back after — no matter what."""

    def __init__(self, log):
        self.log = log
        self.before = None

    def __enter__(self):
        if os.path.exists(ADDONS_JSON):
            with open(ADDONS_JSON, "rb") as f:
                self.before = f.read()
            self.log(f"addons.json snapshot taken ({len(self.before)} bytes)")
        return self

    def __exit__(self, *exc):
        if self.before is not None:
            with open(ADDONS_JSON, "wb") as f:
                f.write(self.before)
            self.log("addons.json restored to pre-run bytes")
        return False


def set_addons_json(addons: dict, log):
    os.makedirs(os.path.dirname(ADDONS_JSON), exist_ok=True)
    with open(ADDONS_JSON, "w", encoding="utf-8") as f:
        json.dump(addons, f, indent=2)
        f.write("\n")
    log("addons.json written (advisor="
        + ("on" if addons.get("advisor", {}).get("enabled") else "off") + ")")


def read_addons_json() -> dict:
    if not os.path.exists(ADDONS_JSON):
        return {}
    with open(ADDONS_JSON, "r", encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Script scaffold: logging + summary table
# ---------------------------------------------------------------------------

def make_logger(script_name: str):
    os.makedirs(OUT_DIR, exist_ok=True)
    log_path = os.path.join(OUT_DIR, f"{script_name}.capture.log")

    def log(msg: str):
        stamp = time.strftime("%H:%M:%S")
        line = f"[{stamp}] {msg}"
        print(line, flush=True)
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(line + "\n")

    log(f"=== {script_name} === OUT_DIR={OUT_DIR}")
    return log


def print_summary(script_name: str, records: list):
    print(f"\n--- {script_name}: PASS/FAIL per surface ---")
    passed = 0
    for r in records:
        status = "PASS" if r.ok else "FAIL"
        if r.ok:
            passed += 1
        blank_note = "" if r.variance > 1.0 else "  (WARN: near-blank frame)"
        print(
            f"  {status}  {r.name:36s} anchor: {r.detail!r}{blank_note}"
        )
    print(
        f"  {passed}/{len(records)} passed · stills in {OUT_DIR}"
    )
    return passed, len(records)


def exit_code(records: list) -> int:
    return 0 if all(r.ok and r.variance > 1.0 for r in records) else 1


# ---------------------------------------------------------------------------
# Session-file crafting (todo overlay lane)
# ---------------------------------------------------------------------------

def craft_todo_session(
    path: str,
    tasks: list,
    next_id: int,
    cwd: str,
    session_id: str | None = None,
) -> str:
    """Write a session .jsonl carrying `unown-todo-state` custom entries.

    The todo addon replays its overlay from the session branch on
    session_start (todo.ts → replayFromBranch): entries are
    {"type":"custom","customType":"unown-todo-state","data":{action,params,
    tasks,nextId}, id, parentId, timestamp} chained leaf-wards, so a linear
    chain whose LAST entry holds the final snapshot reproduces the overlay
    without any model turn.
    """
    sid = session_id or str(uuid.uuid4())
    now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    lines = [
        json.dumps(
            {
                "type": "session",
                "version": 3,
                "id": sid,
                "timestamp": now,
                "cwd": cwd,
            }
        )
    ]
    parent = None
    for i, snapshot in enumerate(tasks):
        entry_id = f"todo-{sid[:8]}-{i:02d}"
        lines.append(
            json.dumps(
                {
                    "type": "custom",
                    "customType": "unown-todo-state",
                    "data": {
                        "action": "create",
                        "params": {},
                        "tasks": snapshot,
                        "nextId": next_id,
                    },
                    "id": entry_id,
                    "parentId": parent,
                    "timestamp": now,
                }
            )
        )
        parent = entry_id
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return path
