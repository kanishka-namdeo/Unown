---
title: "The keyboard round: the shortcut that never worked, and five more finds"
description: "The planning round's headline shortcut never worked on a fresh install. The keyboard round found it and five more, fixed all six, verified live."
date: 2026-10-31
lastmod: 2026-10-31
tags: [planning, keyboard, tui, release]
type: feature
media: [/landing/tui/plan-mode/stills/02-plan-mode-on.png]
---

The planning round shipped Shift+Tab mode cycling — the Claude Code lane —
and documented it in two places. One of them was wrong about what the key
did, and the honest answer is: **both were, because the shortcut never
worked.** Not on a fresh install, not once. This round audited every
interactive surface in plan mode and fixed what the audit found.

## The shortcut that never worked

unown's plan-mode cycle registers as an extension shortcut on `shift+tab`.
The pi coding agent underneath drops any extension shortcut that collides
with a reserved built-in default — and `app.thinking.cycle` defaults to
exactly that key. On every fresh install, Shift+Tab cycled thinking levels,
the permission cycle never ran, and the docs contradicted themselves about
which one you'd get.

The fix moved the vendored thinking-cycle default to **Alt+T** (free,
terminal-safe, mnemonic). Your explicit `keybindings.json` still wins, and
the runner test now pins that `shift+tab` registers under default
keybindings — the exact failure can't come back silently.

## Five more finds

- **Questionnaire arrows pointed the wrong way in half the terminals.** The
  ask-user-question tab switcher matched raw escape bytes, listed SS3
  right-arrow in *both* the left and right branches, and never listed SS3
  left at all. In application-cursor mode (DECCKM), right moved you back.
  It now matches logical keys through the same matcher everything else
  uses — CSI, SS3, Kitty CSI-u, modifyOtherKeys and Windows encodings all
  route identically.
- **Typing an emoji corrupted the input line.** The input buffer split
  non-escape input per UTF-16 unit, so a directly-typed astral character
  (emoji, rare CJK) became two lone surrogates the editor happily inserted.
  Pastes and Kitty-protocol terminals were safe; legacy terminals were not.
  The buffer now emits whole code points and the editor rejects unpaired
  surrogates as defense in depth.
- **The approval gate ignored half the keyboard.** PageUp, PageDown, Home,
  End — bindings that exist and every other selector honors — did nothing.
  Options are now numbered: **press `1`-`4` to pick an approval lane
  directly**, in plain, Kitty and modifyOtherKeys encodings. Lists longer
  than nine stay unnumbered rather than display an unreachable number.
- **A stray Esc destroyed your plan edits.** The plan editor cancelled on
  the first Esc with no dirty check. Now the first press arms a "press Esc
  again to discard" guard, any other key disarms it, and the second
  consecutive press discards. No timer — deterministic, and testable
  without a clock.
- **The plan-mode bash gate had a curl write primitive.** `curl -o`,
  `--output`, `-O`, `--remote-name`, `-D` and clusters like `-sO` wrote
  files inside "read-only" plan mode. All of those forms now sit on the
  destructive side; read-only fetching still works.

## Verified like a user, not like a test suite

Every fix has a regression pin, but the headline got more than that: a live
PTY session drove the real TUI against the real model — Shift+Tab stepped
default → acceptEdits → plan → default, the gate rendered its numbered
options, digit `1` approved, and the agent executed the approved plan (it
created the file and ran the verification command). The questionnaire
rendered live too, numbered options and all.

The receipts — findings, fixes, milestones and the resumable log — live in
[the session doc](https://github.com/kanishka-namdeo/Unown/blob/main/docs/plan-mode-keyboard-round-session.md).
