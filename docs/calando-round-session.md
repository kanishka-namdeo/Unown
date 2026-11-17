# The Calando round — session log (mid-session overwhelm, end to end)

Opened: 2026-11-17. Status: IN FLIGHT.

Operator mission (verbatim):

> reverse engineer competitor products like an expert ui/ux researcher and
> make the TUI experience less overwhelming for the end user. follow actual
> study backed research. understand how it applies to all our features and
> capabilities and implement the learninings end to end. test, iterate and
> improve Unown's experience.

Standing operator requirements for this round: document the session at each
checkpoint (resume safety); use subagents aggressively; extensive online
research even for minor choices; push to the repo on EACH milestone;
production-grade implementation with edge cases; full cross-platform support
including keyboard experience; test like a real user via the PTY lane; update
landing page (with captures where relevant), README, blog, stale docs; leave
no stone unturned; update the DOX tree; never delete media assets; version
bump + release with each OS build compiling; address Dependabot and code
scanning issues.

Related pages:
- [docs/tui-overwhelm-research.md](tui-overwhelm-research.md) — the Semplice
  research record (first-boot scope)
- [docs/unown-ux-principles.md](unown-ux-principles.md) — the binding UX card
- [docs/SESSION.md](SESSION.md) — the running index

## Why this round exists

The Semplice round (v0.0.70) quieted the FIRST minute: boot preamble,
first-run gate, the command catalog, the hint row, `--help`. Its own closing
inventory left the mid-session experience explicitly open (items 9–17:
keybinding sprawl, settings sprawl, the dashboard advertised in the first
60 s, ~8 token-info homes, env-only quiet knobs, 11 split-view commands,
5 plan entry lanes). This round takes the same study-backed method to the
rest of the session: the transcript's tool-output bulk, the toast and chip
narration, the wait experience, and the discoverability of the depth that
Semplice deliberately kept.

Naming: "Calando" — musical instruction, "growing calmer, dying away";
the sequel to Semplice ("play simply"). Findings are Q-numbers (Quiet).

## Research record

Four lanes, all completed before the first edit (reports preserved in the
round's working notes and folded into the interventions below):

1. **Prior-round archaeology** — Semplice/Toccata/Da capo/footer-quiet/
   hints-ranking session logs + UX principles re-read; the open-item list
   above is its output; the standing non-adoptions (never remove commands,
   no tutorial wall, memory recall stays visible, ctx meter stays visible,
   no ghost text, no prompt suggestions) carry forward unchanged.
2. **Study-backed brief (mid-session scope)** — 5 areas, all citations
   verified online; full text at
   `/research/mid-session-overwhelm-brief.md` in the working tree root.
   Top findings ranked: (1) toasts are for blockers only — interruption
   cost ~23 min return + attention residue (Mark et al. 2008; Leroy 2009;
   Anufrieva et al. 2026; Fallon et al. 2023); (2) one authoritative surface
   per fact — the redundancy effect taxes working memory (Sweller &
   Chandler 1994); (3) close the split-attention loop between footer and
   transcript (Chandler & Sweller 1992); (4) persist what streams away —
   the transient-information effect (Wong et al. 2012); (5) adapt verbosity
   to expertise — expertise reversal (Kalyuga et al. 2003); (6) make waits
   feel occupied and moving (Maister 1985; Harrison et al. 2007/2010;
   Kuroki & Ishihara 2015); (7) the footer is a calm periphery — fixed
   slots, stable when healthy, animate on change only (Weiser & Brown
   1996; Matthews 2006); (8) pre-attentive scanning — fixed left-edge
   glyph/color column + one-line high-scent summaries (Treisman & Gelade
   1980; Pirolli & Card 1995; Nielsen 2006).
3. **Competitor teardown (2025–26 state)** — Claude Code 2.1.326, Codex CLI
   0.171, Gemini CLI, OpenCode, aider, Crush, Amp, Cursor CLI, Copilot CLI,
   lazygit/k9s/fzf/gitui/Helix. Convergent patterns already held by unown:
   collapsed tool output + ctrl+o viewer, repeat-call summarization, 2-row
   footer, plan badge + Shift+Tab, compact, numbered permission prompts,
   `?` help, queueing, undo. Divergent candidates this round evaluates:
   the fleet panic button (Claude Ctrl+X Ctrl+K — stops all background
   subagents with a 3 s confirm), the `/raw` copy-friendly toggle (Codex),
   `?`-key tabbed help (Copilot), prefix-matched commands (Gemini `/cha`).
   Loudest cross-tool complaints to design against: tool-output verbosity
   (Claude #65961, Codex #26279, Gemini #14387/#14569), progress ambiguity
   ("not clear if it's stuck", Gemini #2456), hidden background processes
   (Codex daemon, #48195).
4. **TUI surface map** — every user-visible surface inventoried with its
   file seam and density constants (the audit's baseline table; the
   intervention list below names its seams).

## Phase ledger

| CP | Name | Status | Artifact |
|----|------|--------|----------|
| CP0 | Research + baseline | DONE | this file + PTY density baseline |
| CP1 | Gap analysis → intervention set | IN FLIGHT | Q-numbered list below |
| CP2 | Implementation (end to end) | — | — |
| CP3 | Verification (unit + PTY + suites) | — | — |
| CP4 | Docs/DOX/landing/blog sync | — | — |
| CP5 | Dependabot + code scanning sweep | — | — |
| CP6 | Version bump + release + OS builds | — | — |

## Environment notes (for resume)

- Sandbox recycles kill processes but keep `/home/z/my-project/`;
  `scripts/rebuild_unown.sh` (working-tree copy, outside the repo) restores
  clone → installs → model-data hydrate → `build:offline` → `.env` →
  services → verify in one idempotent run (~6 min).
- **pi-repo/bun.lock trap**: bun 1.3.14 rewrites the v3 lockfile to v1 on
  every `bun install` in pi-repo. Restore with
  `git checkout -- pi-repo/bun.lock` after ANY install there; never commit
  the downgrade.
- PTY lane: `python3 scripts/tui-capture/pty_density.py` needs
  `pip install pyte pexpect pillow numpy`; services must be up
  (`bun run agent:start`); a stale engine is a stale verdict — restart
  onto the current tree before lane runs (Divertimento law).
- First PTY spawn after a recycle is a cold boot (~90 s bun compile); the
  120 s default ready-timeout can race — the lane's own ready anchors are
  correct, patience is the fix.
- The self-learning suite runs from `pi-repo/packages/self-learning`
  (`bun test test/`, ~260 s), never from the repo root; after vendored
  changes run `bun run build:unbundled` in coding-agent first or the TUI
  won't boot.

## The baseline (CP0)

`scripts/tui-capture/pty_density.py` — one real tool turn (write hi.py,
run it, reply DENSITYOK) captured at 128 and 96 cols against v0.0.70
(10fcdb22). Receipts: `unown-density-captures/run/` (pane dumps + PNGs +
geometry). Findings Q-list opens at CP1 against those panes.
