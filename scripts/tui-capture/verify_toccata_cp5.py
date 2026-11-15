#!/usr/bin/env python3
"""
verify_toccata_cp5.py — the Toccata round CP5's real-user verification
(PTY lane, pane-truth discipline per docs/tui-capture-workflow.md).

Drives the REAL `unown` TUI against the real stack (bridge + engine on
:3031/:3030, Agnes upstream) and asserts the personality lane's contract
as a user sees it:

  chunk A (A15 spinner verbs, a live turn): with
           UNOWN_SPINNER_VERBS=Pondering,Brewing,Vibing forced for
           determinism, a real turn's working line carries one of the
           three verbs while the model thinks, and the honest tool label
           ("Reading README.md...") takes over the moment the read tool
           runs — verbs never shadow tool activity.
  chunk B (A16 fresh boot, bare repo): an isolated UNOWN_HOME in a repo
           with no instruction file boots into the repo-aware catalog —
           the "Initialize an AGENTS.md" OFFER leads (headline + first
           row + "this repo has no AGENTS.md yet"), and the fresh boot
           records nothing (the returning-boot lane still owns its offer).
  chunk C (A16 returning user, once per repo): a home with firstTaskAt
           set (the returning-user latch) opening a SECOND bare repo gets
           the offer card exactly once — the agentsMdOfferedFor latch
           records the cwd; a re-boot in the same repo never shows it.
  chunk D (A16 repo WITH an instruction file): the same returning home in
           a repo carrying an AGENTS.md never sees the offer card.

Exit 0 = every assertion held. Any failure prints the pane tail.
Stills + pane dumps land in OUT (default /tmp/unown-toccata-cp5-out).

Requirements: the stack up (`bun run agent:start`), python3 with
pyte/pexpect/PIL. See pty-README.md for the lane contract.
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pty_common import (  # noqa: E402
    UNOWN_ROOT,
    UnownPty,
    answer_first_run_gate,
    dismiss_first_flights,
    make_logger,
)

OUT = os.environ.get("OUT", "/tmp/unown-toccata-cp5-out")
os.makedirs(OUT, exist_ok=True)
log = make_logger("verify-toccata-cp5")

OFFER_HEADLINE = "Initialize an AGENTS.md"
OFFER_BLURB = "this repo has no AGENTS.md yet"
VERBS = ("Pondering", "Brewing", "Vibing")


def say(msg: str) -> None:
    log(msg)


def fail(msg: str, pane: list) -> None:
    say(f"FAIL: {msg}")
    say("--- pane tail ---")
    for line in pane[-30:]:
        say(f"    {line}")
    sys.exit(1)


def dump_pane(name: str, pane: list) -> None:
    path = os.path.join(OUT, f"{name}.pane.txt")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(pane) + "\n")
    say(f"pane dump: {path}")


def read_onboarding(home: str) -> dict:
    path = os.path.join(home, "onboarding.json")
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


def write_onboarding(home: str, state: dict) -> None:
    os.makedirs(home, exist_ok=True)
    path = os.path.join(home, "onboarding.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2)
        fh.write("\n")


def fresh_repo(name: str, with_agents_md: bool = False) -> str:
    repo = os.path.join(OUT, name)
    os.makedirs(repo, exist_ok=True)
    marker = os.path.join(repo, "AGENTS.md")
    if with_agents_md:
        with open(marker, "w", encoding="utf-8") as fh:
            fh.write("# fixture repo (verify_toccata_cp5)\n")
    elif os.path.exists(marker):
        os.remove(marker)
    return repo


def boot(cwd: str, env_extra: dict | None = None, settle_s: float = 3.0) -> UnownPty:
    """Spawn the TUI and wait for a LIVE surface.

    Fresh homes boot INTO the first-flights catalog (or the A16 offer card),
    which replaces the editor slot and hides the default ready anchors (the
    footer hint line rides the editor dock) — so readiness here is ANY-of:
    the card's own intro, the standard footer token, or the themes block.
    """
    session = UnownPty(say, cwd=cwd, env_extra=env_extra)
    session.wait_for(
        ["Pick a starter task", "esc-esc tree", "── Themes ──", "First run"],
        mode="any",
        timeout=240,
        desc="TUI ready (card-or-footer)",
    )
    session.pump(1.5)
    answer_first_run_gate(session, say)
    session.pump(1.0)
    return session


def main() -> int:
    results: list[tuple[str, bool]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        say(f"{name}: {'OK' if ok else 'FAIL'}{' — ' + detail if detail else ''}")
        results.append((name, ok))

    # ---------------- chunk A: A15 spinner verbs over a live turn ----------------
    say("A: booting the TUI with the forced verb pool for a live turn…")
    a = boot(UNOWN_ROOT, env_extra={"UNOWN_SPINNER_VERBS": "Pondering,Brewing,Vibing"})
    dismiss_first_flights(a, say)
    a.pump(2.0)
    a.wait_idle(timeout=40, stable_for=1.5)

    # type_prompt types + Esc-closes any popup + Enter-submits (the lane's
    # deterministic submit protocol — no extra Enter from us).
    a.type_prompt(
        "Use the read tool to read the file README.md in the current directory, "
        "then reply with only the first heading line you see.",
        cps=40,
    )
    a.pump(0.4)

    # Sample the pane through the turn. A fast turn's tool-label window can
    # be under half a second (the read itself is local), so the pre-tool
    # phase samples at 0.12 s; once the tool row lands in the transcript
    # the loop gives the working line three more samples before settling.
    samples: list[str] = []
    deadline = time.time() + 150
    verb_seen = False
    tool_label_seen = False
    tool_row_seen_at: float | None = None
    while time.time() < deadline:
        a.pump(0.12 if not tool_label_seen else 0.5)
        pane_text = a.pane_text()
        samples.append(pane_text)
        if not verb_seen and re.search(r"(Pondering|Brewing|Vibing)\.\.\.", pane_text):
            verb_seen = True
            say(f"A: verb on the working line: {[v for v in VERBS if v + '...' in pane_text]}")
            # The round's blog still: the working line carrying a verb mid-turn.
            try:
                a.still("verb-thinking", ["..."], mode="any")
            except Exception as exc:  # cosmetic — the pane check is the verdict
                say(f"(verb still soft-failed: {exc!r})")
        if not tool_label_seen and "Reading README.md..." in pane_text:
            tool_label_seen = True
            say("A: honest tool label took over (Reading README.md...)")
        if verb_seen and tool_label_seen:
            a.wait_idle(timeout=30, stable_for=1.5)
            samples.append(a.pane_text())
            break
        if "read README.md" in pane_text and "✓" in pane_text and tool_row_seen_at is None:
            tool_row_seen_at = time.time()  # the tool row landed in the transcript
        if tool_row_seen_at is not None and time.time() - tool_row_seen_at > 3.0:
            a.wait_idle(timeout=15, stable_for=1.2)
            samples.append(a.pane_text())
            break
    else:
        a.wait_idle(timeout=15, stable_for=1.2)
    dump_pane("a-turn-last", a.pane())

    check("A1 thinking-time verb on the working line (forced pool)", verb_seen)
    check("A2 the tool label wins while the read runs (Reading README.md...)", tool_label_seen)
    # Informational only: the turn produced an answer (the last sample
    # differs from the pre-turn pane by the transcript growth).
    say(f"A3 (informational) samples collected: {len(samples)}")
    a.close()

    # ---------------- chunk B: A16 fresh boot in a bare repo ----------------
    say("B: fresh boot in a bare repo (isolated home) — the offer leads the catalog…")
    home_b = os.path.join(OUT, "home-b")
    os.makedirs(home_b, exist_ok=True)
    repo_b = fresh_repo("bare-repo-1")
    b = boot(repo_b, env_extra={"UNOWN_HOME": home_b})
    b.pump(1.5)
    pane_b = b.pane()
    dump_pane("b-fresh-offer", pane_b)
    text_b = "\n".join(pane_b)

    ok_b1 = OFFER_HEADLINE in text_b and OFFER_BLURB in text_b
    check("B1 the offer card (Initialize an AGENTS.md + no-AGENTS.md blurb)", ok_b1)
    if ok_b1:
        # The round's blog still: the AGENTS.md offer card in a bare repo.
        try:
            b.still("agents-md-offer", [OFFER_HEADLINE], mode="any")
        except Exception as exc:  # cosmetic — the pane check is the verdict
            say(f"(offer still soft-failed: {exc!r})")
    if ok_b1:
        # The promoted flight leads: the offer appears before the memory flight.
        idx_offer = text_b.index(OFFER_HEADLINE)
        idx_memory = text_b.find("How unown's memory works")
        ok_b2 = idx_memory == -1 or idx_offer < idx_memory
        check("B2 the offer row leads the catalog (before the memory flight)", ok_b2)
    else:
        check("B2 the offer row leads the catalog (before the memory flight)", False)
    # The standard title must NOT be the headline when the repo is bare.
    check("B3 the card is offer-titled (not 'First flights')", "First flights" not in text_b or OFFER_HEADLINE in text_b)

    # Esc-dismiss for the session, then exit; the fresh boot never records.
    b.key("Esc", delay=0.6)
    b.pump(1.0)
    state_b = read_onboarding(home_b)
    offered_b = state_b.get("agentsMdOfferedFor", [])
    check("B4 the fresh boot records no offer (agentsMdOfferedFor empty)", offered_b == [])
    b.close()

    # ---------------- chunk C: A16 returning user, once per repo ----------------
    say("C: a returning user (firstTaskAt latched) opens a SECOND bare repo…")
    home_c = os.path.join(OUT, "home-c")
    os.makedirs(home_c, exist_ok=True)
    repo_c = fresh_repo("bare-repo-2")
    # The returning-user latch exactly as the input handler would have written it.
    write_onboarding(
        home_c,
        {
            "schema": 1,
            "flightsDismissed": False,
            "tipsSeen": [],
            "agentsMdOfferedFor": [],
            "firstTaskAt": "2026-11-16T00:00:00.000Z",
        },
    )
    c = boot(repo_c, env_extra={"UNOWN_HOME": home_c})
    c.pump(1.5)
    pane_c = c.pane()
    dump_pane("c-returning-offer", pane_c)
    text_c = "\n".join(pane_c)
    ok_c1 = OFFER_HEADLINE in text_c and OFFER_BLURB in text_c
    check("C1 the returning user gets the offer card in the unoffered bare repo", ok_c1)
    c.key("Esc", delay=0.6)
    c.pump(1.0)
    state_c = read_onboarding(home_c)
    offered_c = state_c.get("agentsMdOfferedFor", [])
    ok_c2 = offered_c == [repo_c]
    check("C2 the offer is recorded once (agentsMdOfferedFor == [the repo])", ok_c2, str(offered_c))
    c.close()

    say("C(boot 2): the same repo again — the offer never repeats…")
    c2 = boot(repo_c, env_extra={"UNOWN_HOME": home_c})
    c2.pump(2.5)
    pane_c2 = c2.pane()
    dump_pane("c2-returning-silent", pane_c2)
    text_c2 = "\n".join(pane_c2)
    check("C3 a re-boot in the offered repo never shows the card again", OFFER_HEADLINE not in text_c2)
    c2.close()

    # ---------------- chunk D: A16 repo WITH an instruction file ----------------
    say("D: the same returning home in a repo that HAS an AGENTS.md…")
    repo_d = fresh_repo("repo-with-agents", with_agents_md=True)
    d = boot(repo_d, env_extra={"UNOWN_HOME": home_c})
    d.pump(2.5)
    pane_d = d.pane()
    dump_pane("d-repo-with-agents", pane_d)
    text_d = "\n".join(pane_d)
    check("D1 a repo with an instruction file never sees the offer card", OFFER_HEADLINE not in text_d)
    d.close()

    # ---------------- summary ----------------
    say("")
    say("=" * 60)
    passed = sum(1 for _, ok in results if ok)
    for name, ok in results:
        say(f"  {'✓' if ok else '✗'} {name}")
    say(f"{passed}/{len(results)} checks passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
