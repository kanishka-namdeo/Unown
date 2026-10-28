---
title: "The commerce round: a storefront, a checkout, and a browser QA pass"
description: "Three SDLC rounds — planned, reviewed, browser-QA'd — and the landing page now frames two agent-built apps in a live gallery: 838 calls, one SHIP verdict."
date: 2026-10-28
lastmod: 2026-10-28
tags: [landing, demo]
type: feature
media: [/blog/2026-10-28-the-commerce-round/plan-approval.png, /blog/2026-10-28-the-commerce-round/the-plan.png, /blog/2026-10-28-the-commerce-round/qa-verdict.png, /landing/bazaar/poster.png]
---

The live-preview round asked whether the artifact runs. This round asks the
harder one: **can the agent carry a whole SDLC** — plan, build, review, QA —
on an app complex enough that each stage has real work to do? And can the
landing page carry more than one proof at a time?

## What got built

**Sigil Bazaar** — a fullstack e-commerce demo, an arcane marketplace of
runes, sigils, relics and tomes:

- a storefront with 16 products, search, category chips, four sorts, and
  CSS-drawn glyph monograms (no binary image assets anywhere);
- a cart drawer with steppers, tax at 8%, and free shipping over $50;
- a three-step checkout wizard with real inline validation (Luhn on the
  card, expiry-not-in-the-past, 5-digit ZIP);
- an order history seeded with eight orders so the analytics have data;
- an owner dashboard: KPIs, a 14-day revenue chart, top-5 products,
  category mix, and an inventory table with restock actions;
- API routes with an in-memory store seeded identically to the client;
  localStorage-first persistence; 88 unit tests (the brief asked for 40).

## How it was driven

Like a real user, across the three rounds — planned, reviewed, then
browser-QA'd by the agent itself:

1. **Plan** — plan mode, the 13-point plan, the approval overlay (a human
   in the loop before a line of code), then the build: scaffold, domain
   layer, components, API routes, tests, curl verification, commits.
2. **Review** — my real-user pass found the API snapshotting order items
   as `name=productId, price=0` and re-posting every seeded order on each
   fresh load; a VLM design critique through the bridge found the rest.
   The agent verified all 56 findings claim-by-claim, fixed the real ones,
   and rejected the misreadings with reasons.
3. **QA** — the agent drove a real browser (a browser subagent) through
   every view, a failing-validation checkout, and the mobile layout. It
   found one real bug — the confirmation step closed too fast to read —
   fixed it, re-ran the pass, and shipped the verdict below.

<figure>
  <img src="/blog/2026-10-28-the-commerce-round/plan-approval.png" alt="The unown TUI in plan mode: the 13-point plan for Sigil Bazaar rendered above the approval overlay, with Execute the plan pre-selected" width="880" loading="lazy"/>
  <figcaption>The plan-approval overlay — the moment the round stops being a
  prompt and becomes work. The pane is a real PTY capture; the plan is the
  agent's own.</figcaption>
</figure>

<figure>
  <img src="/blog/2026-10-28-the-commerce-round/qa-verdict.png" alt="The QA round's closing summary in the unown TUI, ending in the SHIP verdict with the honest follow-ups listed" width="880" loading="lazy"/>
  <figcaption>The QA round's closing summary — the verdict is SHIP, and the
  follow-ups it lists are the ones it could not fix (server-side id-dedup,
  chart tooltips, mobile at desktop width only). An honest list, not a
  marketing one.</figcaption>
</figure>

The receipts: 838 tool calls across the round (the ledger also counts 9
auto-checkpoints), 7 agent commits, 88 tests, zero human edits to the app's
code. The full record — briefs, findings, patches — is
[docs/bazaar-demo-session.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/bazaar-demo-session.md).

## The gallery

The landing page's live-demo band is now a **gallery**: two agent-built
apps, each iframed from its own route in browser chrome, one switcher — the
pattern v0's template gallery made the category default. Pick **Sigil
Focus** and drag a card; pick **Sigil Bazaar** and buy something.

<figure>
  <img src="/landing/bazaar/poster.png" alt="Sigil Bazaar — the storefront the agent built: an arcane marketplace with category chips, product cards with glyph monograms, and the cart in the header" width="880" loading="lazy"/>
  <figcaption>The poster is a real capture of the route the band frames —
  the app boots seeded, so this is what a first-time visitor's storefront
  looks like.</figcaption>
</figure>

Switching apps is one same-origin navigation on a persistent frame; the
receipt chips swap with the tab (each app's numbers come from its own build
record, pinned by test — no hand-typed counts).

## The honest engineering of embedding

The integration pass found real defects and fixed them at the right layer:

- **A future-dated seed**: the seed generates same-day orders at fixed
  times-of-day. At 00:04 UTC the integration test caught the seed dating
  orders into the future — future orders render ahead of "now" in the
  Orders view and the analytics count revenue that has not happened. A
  same-day time still ahead of now is now dated yesterday at the same
  time.
- **AA contrast through alpha**: the first cut of the gallery's selected
  tab used a translucent background over the chrome bar. Axe computes the
  effective contrast *through* an alpha background — 1.73:1. The tab is an
  opaque pill now, and the a11y gate is the reason.
- **Both demos got the hardening round**: CSP `frame-ancestors 'self'` +
  `X-Frame-Options: SAMEORIGIN` on the demo routes, the reset handshake
  pinned to `window.origin` (never `"*"`), a per-IP rate limit on the
  public order POST, a `seedVersion` tag so new seeds reach returning
  visitors, and the sandbox attribute trimmed of `allow-modals`.

## Try to break it

The band keeps the same contract as the first demo: sandboxed frame,
lazy-mounted (an idle visit never pays the demo's hydration cost — the
poster carries the first impression), a working reset, and a full-screen
escape hatch per app. Below `sm` it is the poster and a tap-through, not a
390px iframe.

If the storefront sells you nothing else, the checkout wizard is worth one
pass: type an invalid card, watch the inline validation, then put
`4242 4242 4242 4242` through and read your order number. It was built,
reviewed, browser-tested, and shipped by the agent — the receipts are one
click away.
