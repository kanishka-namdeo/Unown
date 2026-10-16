# Landing Page — Research & Design Rationale

Design research behind the marketing landing page (`/`), distilled from how the
leading AI coding-agent products present themselves. Captured 2026-10 while
building the page; kept here so future page changes stay grounded.

## Products studied

Claude Code, Cursor, Devin, Cline, Warp, Amp, Copilot, Codex, Aider (aider.chat).

| Product | H1 pattern | Hero visual | Theme |
|---|---|---|---|
| Claude Code | identity + outcome subhead | simulated live agent transcript | dark, warm |
| Cursor | category claim | interactive tabbed demo | cream + dark |
| Devin | "autonomous engineer" promise | screenshot collage | light + dark |
| Cline | "The Open Agent" | product UI + stats strip | dark zinc, purple |
| Warp | infra claim | animated live agent grid | dark technical |
| Aider | "AI pair programming in your terminal" | stats badges only | plain docs-style |

## Principles applied to Unown's page

1. **The terminal is the hero visual** — show the real product loop (prompt →
   memory injection → fix → note queued for AutoDream) in one static terminal
   block. No stock illustration (Claude Code / Warp pattern).
2. **Prove the loop, don't assert it** — Warp-style pass-rate chart and the
   verify-twice ship gate, not adjectives.
3. **Short H1 (2–8 words) + mechanism subhead** — identity in the H1, the
   "how" in the subhead.
4. **Install command with copy button, high on the page** — for a
   git-clone-installed tool the visible command *is* the conversion.
5. **"Any model" as a first-class section** — neutralizes lock-in anxiety;
   every category winner does this.
6. **Layered architecture as a trust device** — the 4-tier memory and the
   sandbox layers, drawn as emerald-lit layers on zinc.
7. **A dedicated safety section** — for a *self-modifying* agent, integrity
   gates are the #1 objection to preempt (sandbox, canary gate, rollback).
8. **Real dashboard screenshots with real numbers** — more credible than any
   illustration (Cursor / Devin pattern).
9. **Dark theme, one accent** — emerald reserved for CTAs, pass curves and
   "shipped" states so it reads as *verified / healthy*.
10. **FAQ before the footer** — answer the skeptic (does it send my code
    anywhere? what if a dream makes it worse?).
11. **No demo gate, no email wall** — self-serve install, one scroll away.
12. **Honest small numbers** — engine stats over fabricated adoption.

## What we deliberately did NOT copy

- Devin's demo-gate / cloud-only framing — Unown's mirror-image positioning is
  *your terminal, your repo, your model*.
- Amp's 24-minute hero video — attention budget for an unknown OSS tool is
  ~10 seconds.
- Consumer logo walls and "research lab" self-positioning — borrowed authority
  that an early-stage tool hasn't earned; Unown's credibility claim is the
  verify-gated loop itself.

## Screenshot assets

Live captures of the running dashboard (`public/landing/`), seeded with real
engine data (runs, dreams, notes, hook decisions):

- `dash-overview.png` — KPI cards, the five patterns, cumulative-passes chart,
  live activity feed (primary showcase).
- `dash-learning-lab.png` — harness cycles, improvements, runs.
- `dash-hooks.png` — the six hook layers and decision log.

## Headline work

Candidates generated via the model endpoint (qwen3.7-plus) and edited:

- **Chosen H1:** "The self-improving terminal agent." (category-claim formula)
- **Chosen subhead:** the AutoDreaming mechanism — notes → nightly
  consolidation → sandbox-verified memory.
- Runner-ups: "Agents that forget cost you time." (pain-first),
  "Your terminal agent, dreaming at night." (poetic, used as section copy).
