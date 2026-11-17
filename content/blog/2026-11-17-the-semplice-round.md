---
title: "The Semplice round: a quieter terminal, on evidence"
description: We tore down Claude Code, Codex CLI, Gemini CLI and aider like UX researchers, then removed everything a first-time user should never see.
date: 2026-11-17
lastmod: 2026-11-17
tags: [tui, ux, research]
type: feature
media: [/blog/2026-11-17-the-semplice-round/semplice-cp1-quiet-boot.png, /blog/2026-11-17-the-semplice-round/semplice-cp2-honest-gate.png, /blog/2026-11-17-the-semplice-round/semplice-cp3-grouped-catalog.png]
---

*Semplice* — the musical instruction to play simply. The Toccata and Da
capo rounds asked "what do the best tools do that we don't?" This round
asked a different question: **what does a first-time user see that they
shouldn't?** We captured unown's own first boot through a real PTY — a
brand-new home, no state, the exact pane bytes a new user's terminal
renders — and counted. Twenty-five lines of preamble before the first
keystroke. A slash popup that said `(1/99)` — ninety-nine commands, one
flat list. A status bar fluent in a language nobody taught the user:
`ttft`, `CH90.2%`, `conf ✓`.

Then we did what a UI/UX researcher does: we tore down the competitors
the same way — Claude Code, Codex CLI, Gemini CLI, OpenCode, Crush,
aider, plus the classic TUIs — and read the actual HCI literature before
changing anything: cognitive load theory, Miller's chunking and Cowan's
4±1, Hick's law, progressive disclosure, Nielsen's heuristics, error
guidelines, onboarding self-determination theory, terminal accessibility.
The full record, every claim with its source, lives in
[docs/tui-overwhelm-research.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/tui-overwhelm-research.md).

## What landed, checkpoint by checkpoint

**The quiet first boot.** The baseline opened with developer-facing
warnings (`[Extension issues]` defending unown's *own intentional* command
overrides), a download progress bar that usually failed with a raw
`GitHub API error: 403`, a resource inventory (Context ×5, Skills ×4,
Extensions, Themes) and a mission panel reporting "no tracked steps ·
conf ✓ · 0m in session" — three facts about nothing. Every one of those
was the wrong conversation to have with a stranger. Product-owned
override notices are gone (they were extension-author feedback, never
end-user signal); managed-tool housekeeping is silent unless it fails,
and a failure is one calm, actionable line; fresh installs open on the
editor with the resource listing behind `ctrl+o`; the mission panel's
null state renders nothing. The boot pane went from **eleven preamble
lines to one**:

![The quiet first boot: one actionable fd line where eleven lines of developer chatter used to be](/blog/2026-11-17-the-semplice-round/semplice-cp1-quiet-boot.png)

**The two-beat first run.** Every studied competitor gets you to a
working prompt in one or two beats. Unown's gate used to ask a question
whose honest answer was "you don't need to do any of this yet" — and the
wizard's summary was a ~25-row reading assignment that printed every
model id it knew. Now the gate tells the truth: when the bundled bridge
is answering, `Enter` keeps it and you are **one keypress from your
first prompt**. The wizard (for those who want it) summarizes in eight
rows or fewer, and the spec gate's blank answer is a safe default with
honest provenance — the sidecar says "the safe default you accepted",
never "you entered it".

![The honest gate: Enter keeps a working provider, y is for the curious](/blog/2026-11-17-the-semplice-round/semplice-cp2-honest-gate.png)

**The grouped command catalog.** Ninety-nine commands in one flat list
is Hick's law with the safety off. Both command surfaces — the `/` popup
and the `ctrl+k` palette — now chunk under ten category headers (search
flattens them again: a query means you know what you want, and grouping
must never delete). The `/help` the footer always promised now actually
exists — before this round, typing it sent a *chat turn to the model*
(the baseline capture caught the model politely answering a docs
question instead). And the docs' command counts were simply wrong; they
now count what ships.

![The grouped catalog: category headers in the slash popup](/blog/2026-11-17-the-semplice-round/semplice-cp3-grouped-catalog.png)

**Plain-language chrome.** Every footer chip now either says what it
means or moves behind `UNOWN_FOOTER_CLASSIC=1`. The turn chip reads
`turn 3.4s · ~$0.0084` — `ttft` is perf-diagnosis shorthand a first-week
user cannot act on. The idle hint row carries five hints, not six
(Cowan's 4±1 — the sixth was the esc-esc tree, now in `/hotkeys` where
it is explained). The cache codes (`CH`, `W`, `R`) are classic-only;
the facts live where they are *explained*: `/context` and `/usage`.

**Onboarding that yields.** The first-flights starter card used to EAT
printable keystrokes while focused — a documented hazard where typing a
prompt at the card made your text vanish, and a stray `x` could
permanently dismiss the card for your whole machine. Now plain typing
falls through to the editor: the card steps aside, your text rides
through. The card's own footer teaches it: `esc close · or just type`.

**The everyday-first `--help`.** `unown --help` was a ~315-line wall.
It now opens with an **Everyday** block — the seven verbs a first-week
user needs, one line each — before the full grammar, and the ~31
subcommands group under six headers. Nothing was deleted; what changed
is that a new user reads nine lines and starts.

## What we refused, on record

The memory-recall line ("memory recalled: 2 rules") stayed — it is a
Claude-Code-parity contract and it is honest. The full command list
stayed all 99 — search and grouping beat deletion, and a power user's
`/checkpoint` is not a first-week user's problem. The classic footer
stays one env var away, because the people who *do* speak `ttft` and
`CH%` deserve their dialect too.

## Two investigations closed with receipts

The round's baseline capture showed a `» //help` echo that looked like a
corrupted buffer. It isn't: the `/` that opens the popup *survives* Esc
by design (closing autocomplete must never destroy typed text), and
`//text` is the double-slash escape hatch — it submits as chat, exactly
Claude Code's semantics. We verified all three user paths live
(`scripts/tui-capture/verify_slash_escape.py`, 4/4 stills) and committed
the probe.

And a confession that belongs in the record: the round's security sweep
reported a "corrupted branch filter" in seven workflow files. Before
touching them we read the raw bytes — `od -c` — and the files said
`branches: [main]`, as they always had. The `[m` byte pair is an SGR
escape suffix; the terminal-emulating capture output had eaten it. The
finding was retracted in the changelog, and the *real* sweep findings
(the one live dev-tooling advisory, cleared by moving the eslint chain;
the edit-bench Dependabot coverage gap, closed with its own stream and
audit lane) shipped in the same cut. The lesson is the round's thesis
wearing a different coat: **read the actual bytes before you believe
what the screen tells you.**

## The receipts

Six checkpoints, each pinned by its own tests and verified through the
PTY lane as a real user — fresh scratch homes, real boots, live model
turns through the bundled bridge. The suites at the cut: self-learning
**5973 pass / 105 skip / 0 fail**, landing unit 2094/0, lint and type
gates clean, `bun audit` at zero across all 458 packages. The full
ledger, every decision with its study citation, is
[docs/semplice-round-session.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/semplice-round-session.md).
