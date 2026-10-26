---
title: "The stress round: what breaks when a real user drives the browser"
description: "Fifteen hostile scenarios and seven competitor repos exposed three browser-agent architecture bugs — all closed in v0.0.29."
date: 2026-10-26
lastmod: 2026-10-26
tags: [browser, release]
type: release
media: [/landing/tui/dashboard/stills/01-overview.png]
---

The browser tool had a clean test suite. Every action was pinned: navigate,
snapshot, click by ref, fill_form, downloads, PDF, teardown — 43 live tests,
all green. Then we did what the tests don't: we asked the *agent* to use it,
the way a real user would, on pages built to be hostile. A login wall with
2FA. A registration form with a typeahead combobox, a date picker and an
upload. Shadow-DOM widgets two roots deep. A login form inside an iframe.
OAuth popups. Infinite scroll. Rate limits. A canvas game with no DOM
targets. Two downloads at once.

Fifteen scenarios, driven as natural-language prompts. Twelve "passed". The
transcripts told a different story — and that story is
[v0.0.29](https://github.com/kanishka-namdeo/Unown/releases/tag/v0.0.29).

## The pass that was actually a fail

Scenario three looked beautiful: the agent "typed jane into the widget's user
field and clicked the nested Ping button three times." But the transcript
showed `type ref e46` failing twice before the model gave up on the tool and
finished the job with `eval` — reaching into the shadow root with JavaScript
and calling `.click()` itself. The report said done; the mechanism was
programmatic DOM puppetry, not trusted input. On an anti-bot site that
distinction is the whole game: `isTrusted` events are the one thing `eval`
can never produce.

Same story in the iframe scenario — refs minted inside the frame went "stale"
until the model drove `contentDocument` by hand. Same story in the dialog
scenario, where "answer green in the prompt" was *impossible*: every native
dialog auto-dismisses (that's what keeps sessions alive), and there was no
lane to answer one. And the popup scenario — click "Connect account", approve
in the provider window, report the status — didn't fail beautifully. It
hung for four minutes and produced nothing.

## The bug under the bug: Target.setAutoAttach wedges popups

We reproduced the popup failure with raw CDP, no unown code, and the ack
timings named the culprit:

| Setup | `mouseReleased` ack | popup state |
|---|---|---|
| no auto-attach | 16 ms | navigated to the provider page |
| `Target.setAutoAttach` (any config, zero commands sent) | **12,000 ms timeout** | **stalled at `about:blank` forever** |

On Chrome for Testing 143, arming auto-attach is enough to wedge a popup
opened by `window.open()` during trusted input dispatch — the popup never
navigates and the click's `Input.dispatchMouseEvent` ack hangs for its full
timeout. Not `waitForDebuggerOnStart`. Not missing `Runtime.run`. We tested
every variant; the attach mode itself is the trigger. Every guide says "use
auto-attach"; on this engine, for popups during input, it's a trap.

The fix is the pattern nobody writes about: `Target.setDiscoverTargets` +
explicit `Target.attachToTarget` per new page target. Discovery events
arrive, we attach on our own terms, and the popup navigates like it should —
19 ms acks. As a bonus, `targetInfoChanged` now refreshes tab URLs straight
from the browser, which is why popup tabs used to list as `(untitled)`
forever.

![Mission control — the same live-feed surface the stress scenarios were verified against](/landing/tui/dashboard/stills/01-overview.png)

## Two more architecture fixes

**Deep refs.** The snapshot walker always descended into open shadow roots
and same-origin iframes — that's why the refs *appeared*. But every action
resolved refs with a main-document `querySelector`, which cannot pierce
either boundary. All ref actions now resolve through a deep query that walks
both, with iframe boxes offset-compensated so the input coordinates land on
the frame's element (an element's `getBoundingClientRect` is relative to its
own frame's viewport — sum the ancestor frames' offsets or you click the
wrong spot). Labels resolve in the element's own root via `getRootNode()`,
so `<label for>` inside a widget finally names its field.

**Answerable dialogs.** `browser dialog accept text=green` arms a one-shot
policy; the next `Page.javascriptDialogOpening` consumes it, answers the
prompt with your text, and records the outcome. `browser dialog list` shows
the ring — every dialog and how it resolved. Un-armed dialogs still
auto-dismiss: a wedged `confirm()` blocks every later CDP input, and that
default is what keeps headless sessions alive.

## The long tail

Fourteen more findings, each with its pin: the deny-list only gated
`navigate` (now `tabs new` and history too); captcha service solves
submitted *turnstile* wire format for four of eight challenge types, so the
documented reCAPTCHA-v3/DataDome/AWS-WAF/image service tiers never actually
worked (job mapping is now two pure, unit-tested functions); the 60k
snapshot char budget was documented but never compared against anything;
`Control+Shift+p` pressed with `Shift` alone (the modifier loop overwrote
bits instead of accumulating them); `fill_form` typed an instant paste in
stealth humanize mode — the exact tell `type` exists to avoid; concurrent
downloads updated "the newest in-progress entry" on every event; `tabs new`
could stall 30 s waiting for a load event that fired before our listener
existed; macOS `clear` used `Ctrl+A`, which is line-start there; per-page
CDP handlers leaked on tab churn; a SIGKILL'd session leaked its Chromium
(the exit hook's `Browser.close` is a queued websocket send a dying process
never flushes — now it SIGKILLs the child directly).

And one outside the browser module, caught by round two: an interrupted
tool sequence can leave a tool message without `tool_call_id` in the request
history, and the upstream answers that with a hard 400 — forever, because
every retry re-sends the same broken list. The llm-bridge now repairs
request histories before routing (five unit tests pin the repair).

## Verification, both directions

The competitor side of the research — seven repos reverse-engineered at
source level (browser-use's watchdog architecture, Skyvern's combobox
specialist and failure taxonomy, Stagehand's cache, Playwright MCP's
`handle_dialog` and secrets redaction, agent-browser's security model,
LaVague's cautionary tale, AgentQL's examples-as-testlist) — fed the
priorities; the receipts are in
[docs/browser-research.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/browser-research.md)
and the round's [CHANGELOG](https://github.com/kanishka-namdeo/Unown/blob/main/CHANGELOG.md)
entry.

Then the scenarios ran again, same prompts, no hints. The popup flow that
timed out at 240 seconds finished in **12** — click, provider tab tracked
with its URL, Allow pressed, "connected as jane@example.com" read off the
opener. The registration form dropped from 154 s to 39. The iframe login
that needed `eval` improvisation now runs on refs alone. Every fix is
pinned: nine new live tests and five pure ones, 4938 unit tests and 50 live
tests green. The torture chamber lives on as the fixture those tests grow
from.
