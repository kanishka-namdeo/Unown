---
title: "The provider round: what nine competitors taught unown about connecting a model"
description: "Wire-aware probes, a rate-limit verdict that stops lying, masked key entry everywhere, and latency chips — the 2026-10-30 hardening of the provider path."
date: 2026-10-30
lastmod: 2026-10-30
tags: [providers, hardening]
type: feature
media: [/blog/2026-10-30-the-provider-round/providers-test-latency.png, /blog/2026-10-30-the-provider-round/doctor-health-marks.png, /blog/2026-10-30-the-provider-round/models-annotations.png, /blog/2026-10-30-the-provider-round/tui-providers-test.png]
---

The provider configuration path is the first ten minutes of every install: connect a model, trust it works, start coding. This round took that path apart against the field — Claude Code, Codex CLI, Gemini CLI, opencode, Cursor, Aider, Cline/Roo, Continue.dev and Cherry Studio, reverse-engineered from their docs, config schemas and error catalogs — and rebuilt every place unown was weaker. Five fixes landed (two of them P0s), three new indicator surfaces, and 16 new pinning tests; the full list is in [the 0.0.43 changelog stop](https://github.com/kanishka-namdeo/Unown/blob/main/CHANGELOG.md).

## The two P0s

**An update silently truncated your model list.** `upsertProvider` — the one mutation path behind `unown setup`, `unown providers add` and the engine's registry merge — rebuilt a provider's `models` array from the incoming ids only. The comment above that line said *"drop nothing"*; the code dropped everything not named. The real-world damage: the bridge seeds its full 9-model allow-list on first run, and a later `unown setup --provider bridge --model agnes-2.5-flash` quietly deleted the other eight from `/model` and `--model` routing. Updates now take the union — incoming ids first, registered extras kept — with `--force` as the only reset, matching refresh's existing "removal is a deliberate act" rule.

**`providers key` echoed your secret in clear text.** The TTY prompt used a plain readline question while its label claimed "input hidden by your terminal's paste" — the typed key was on screen the whole time. Key rotation and the interactive `providers add` wizard now use the setup wizard's raw-mode masked reader (`•` echo, Ctrl+C cancels with nothing written), verified end-to-end in a real PTY with a pane-truth gate: bullets on screen, zero clear-text occurrences.

## Wire-aware probes — Anthropic keys stopped lying

Every reachability check — session preflight, `doctor`, `providers test`, setup verification — probed with the OpenAI wire's `Authorization: Bearer` header. Anthropic's API authenticates with `x-api-key`, so a perfectly good Anthropic key read as *"credentials rejected (HTTP 401)"*. The probe now speaks each provider's own wire: `anthropic-messages` providers are authenticated with `x-api-key` + `anthropic-version` against `{root}/v1/models` — the exact shape the Anthropic SDK's own models listing uses. A side effect worth the round by itself: the setup wizard's live model discovery now offers a **numbered choice of what a real Anthropic endpoint actually serves**, the same as the OpenAI wire always did.

## A 429 is not "unreachable"

Claude Code's error catalog draws the line explicitly — *the server is temporarily limiting requests, not your usage limit* — and unown's probe now does the same. A 429 on a model-listing probe used to pass silently (with an empty model list, which read as "serves no listable models") or, on refresh, report the endpoint as down. It now classifies as `rate-limit`: the endpoint is up, the key passed auth, only the throttle is in the way. `doctor` rates it warn-class — the chat path answered — and every surface from preflight to the `/providers` manager says the same sentence: *"rate-limited (HTTP 429) — the endpoint is up and throttling; retry in a moment."*

## Indicators: latency, health marks, time-to-first-token

The round's competitor sweep kept surfacing the same delighters — live latency badges, health states on screen, cost before you ask. Three landed:

![The providers test verdict with its live probe latency chip](/blog/2026-10-30-the-provider-round/providers-test-latency.png)

Every answered probe now carries its round-trip time — `· 17 ms` next to the reachability verdict on `providers test`, `doctor`'s model-endpoint row, the `unown models` served-list header, and the in-session `/providers` test verdict.

![Doctor surfacing the model-health marks row](/blog/2026-10-30-the-provider-round/doctor-health-marks.png)

The model-health store — the cross-process marks subagents use to skip a provider-failed model for 30 minutes — was written everywhere and read nowhere user-facing. `doctor` now carries a `model health marks` warn row (`agnes-2.5-flash — failed 5 min ago (subagents skip it for up to 30 min)`), so a silent skip is never mysterious.

![The models overview with recently-failed annotations](/blog/2026-10-30-the-provider-round/models-annotations.png)

`unown models` annotates marked models inline (`⚠ recently failed (5 min ago — subagents skip it)`) and labels Anthropic-wire providers with `· anthropic wire`.

![The in-session /providers test verdict, live](/blog/2026-10-30-the-provider-round/tui-providers-test.png)

And the footer turn meter gains a time-to-first-token chip — `turn 3.4s · ttft 0.8s · ctx 62% · …` — captured from the first streamed assistant chunk (goose v1.42+ row parity; the chip is omitted when the host cannot observe it).

## Paste hygiene, edge to edge

The classic provider-setup failures are paste failures: a trailing newline on a key that becomes a stored secret that 401s, a base URL with a trailing slash, whitespace inside a key. Every entry point — the wizard's masked prompt, `--api-key` flags, `providers key`, the `/providers` set-key action — now trims, strips CR/LF artifacts, and rejects keys that still contain whitespace or control characters with a Claude-Code-style diagnosis that names the character class and **never echoes the value**. Base URLs get the same normalization before anything is written or probed. And two smaller edges closed: the wizard's provider-choice step no longer silently selects preset 1 on a non-integer answer (the `NaN || 1` hole — it goes through the dialog's validated numbered-list contract), and `removeProvider` can no longer write a bogus empty-string `defaultModel` when the surviving provider has no models.

## Receipts

- The changelog stop: [0.0.43 in CHANGELOG.md](https://github.com/kanishka-namdeo/Unown/blob/main/CHANGELOG.md)
- The user-facing flow: [docs/providers.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/providers.md)
- The pins: `providers-probe.test.ts` (16 new — wire-aware headers, rate-limit class, latency, `sanitizeApiKey`, the empty-default guard, the TTFT chip) plus the union-merge regression in `providers.test.ts`; full suite 4901 pass / 0 fail
- The captures: the PTY lane's `pty_capture_provider_cli.py` and `pty_capture_providers.py`, every still written with its pane-truth dump and re-grepped on exit
