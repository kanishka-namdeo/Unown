---
title: The browser autonomy round: dogfooding the browser until it taught us back
description: One hostile checkout page, five blind runs, two real defects found and fixed in-round, and the first receipts of a browser tool that remembers what broke.
date: 2026-11-01
lastmod: 2026-11-01
tags: [browser, benchmarks, memory]
type: feature
media: []
---

We just spent a round using Unown's browser tool the way we tell everyone
else to: as a first-class operating environment. Not E2E tests — real
product work. The browser audited our own landing page like a first-time
visitor, filed GitHub issues, read MDN to learn an API it had never touched,
monitored three competitors' release feeds, and fought a checkout page
specifically designed to derail it. Every fallback, failure and recovery is
receipted. This post is what the round taught us.

## The hostile checkout page

We built a fixture with nine planted failure classes: a buy button whose id
changes on every page load, a newsletter modal that interrupts 1.5 seconds
in (and re-opens if you fall for the discount), a cookie banner, an
arm-race that punishes fast clicks by resetting the cart, content that
arrives two seconds late, a variant picker sealed inside an open shadow
root, an address form inside a same-origin iframe, and a native `confirm()`
dialog guarding the final click.

The agent completed it blind — goal stated, trap list withheld — in 32
seconds on its first try, and five for five across the round. The native
dialog was the only trap that ever landed: it auto-dismissed and silently
cancelled the order, and the agent recovered by arming a dialog answer and
re-clicking. Every run. Which is the interesting part: the lesson went into
project memory via AutoDream, the next run recalled it (the recovery got
directer — no exploration, just re-arm and click) but still did not pre-arm.
Knowing is not applying. That gap is now
[issue #45](https://github.com/kanishka-namdeo/Unown/issues/45): browser
lessons belong at the tool call, not just in the session-start memory dump.

## The two real defects

Dogfooding against our own demo app found better bugs than the fixture did.

The `/demo` kanban's "+" button was dead — for the agent, for a second
browser stack, for anyone. Forty agent-turns of investigation, an
independent reproduction, and a localhost-versus-IP-literal diff later, the
dev log confessed: Next 16 blocks "cross-origin" dev resources from origins
it doesn't recognize, and `127.0.0.1` — the address every agent and curl
reaches for first — wasn't in `allowedDevOrigins`. The page rendered, no
console error surfaced, and client hydration silently never happened.
Production was never affected; our e2e lane boots a production build, which
is exactly why CI could never catch it. The fix is one line, pinned by two
unit tests and a troubleshooting row with the real log line.

The second one was worse because it was silent: `fill_form` against a
same-origin iframe reported success while the values evaporated — the fill
landed in a frame document that was still loading, and when the frame
finished, the values went with it. We reproduced it standalone, root-caused
it (the readiness gate only checked the top document), and fixed it with
two layers: navigate now waits for same-origin frames — including the
about:blank window before a frame's real document commits — and every fill
is verified after it lands, re-filled once on mismatch, and fails loudly
instead of lying. The live test suite pins both layers against a real
Chromium with a fixture that wipes its own value exactly once, 120 ms after
your first keystroke. ([Issue #43](https://github.com/kanishka-namdeo/Unown/issues/43)
has the full story; #44 covers the smaller jpeg-under-a-.png-name quirk.)

## The part where the agent remembered

The round's best receipt isn't a bug — it's the learning loop closing on
browser work by itself. Three session notes went to the engine; AutoDream
consolidated them into project memory within the hour, unprompted, and it
even caught the jpeg-extension quirk from the transcripts alone. A dream
later carried the exact dialog procedure. When a dream render then pruned a
line our own landing page quotes — reddening a CI gate — the repo's
precedent (a hand-restored manual note from an earlier round) was already
there, waiting. The memory file is a living document now, with receipts in
both directions: what it learned from us, what it taught us.

Nobody in the browser-agent category persists a memory of failed actions
between sessions — we checked all eight major systems, and the closest
anyone comes is caching what succeeded. That axis is open. Our round's
verdict on it: recall works, proactive application is the next mile.

## Receipts

- The [session log](../../docs/browser-autonomy-round-session.md) — every
  checkpoint, finding and fix, resumable.
- The [competitor research](../../docs/browser-autonomy-competitor-research.md)
  — eight systems on the round's axes, every claim URL-cited.
- The [benchmark receipts](../../benchmarks/browser-autonomy-round/RESULTS.md)
  — cold/warm numbers, five stress runs, zero interventions, honest nulls.
- The CHANGELOG's `[Unreleased]` section — the two in-round fixes.
