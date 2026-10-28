---
title: "The parley round: a multi-tenant SaaS, two P0s found by the adversarial review"
description: "The gallery's fourth app adds tenancy, real auth, RBAC and isolation — and the round's failures became pinned regressions and agent skills."
date: 2026-10-28
lastmod: 2026-10-28
tags: [landing, demo]
type: feature
media: [/blog/2026-10-28-the-parley-round/inbox.png, /blog/2026-10-28-the-parley-round/viewer-gated.png, /blog/2026-10-28-the-parley-round/embed-reset.png, /landing/parley/poster.png]
---

The first three gallery apps asked whether the agent could carry a whole
SDLC. This round asked the harder question: **can it build the kind of app
where a mistake is a security hole — tenancy, authentication, RBAC,
isolation — and prove the walls hold?**

Short answer: the app shipped. The adversarial review round found **two
real P0s** in it (both fixed and pinned the same round). And the learning
loop minted **five skills** out of the build's own procedures. The gallery
now frames **four** agent-built apps.

## What got built

**Parley** — a multi-tenant customer-support inbox SaaS at `/parley`:

- **two tenants** (Lumen Labs on the team plan, Northwind Kits on free at
  47/50 monthly conversations), row-level tenancy behind a fail-closed
  repository — a call without tenant context throws, a cross-tenant call
  returns not-found;
- **real authentication**: scrypt-hashed credentials, server-side session
  rows with expiry, an HMAC-signed HttpOnly cookie — the demo auto-login
  is a real login, never a faked client state;
- **a four-role RBAC matrix** (owner / admin / agent / viewer) enforced in
  both the API and the UI — a viewer's composer is disabled with its
  reason, an agent can't read the audit feed;
- **the inbox itself**: six filters with live counts, per-conversation SLA
  chips (breached red, at-risk amber with a live countdown), a thread
  view with customer-vs-agent bubbles and a system-event timeline, a
  `/`-canned composer, assignment/status/priority/tag controls;
- **invites with a demo mailbox** (real single-use 24h tokens, no SMTP),
  an **audit log** on every mutation, **usage metering** with plan caps
  and a seat-cap gate, **analytics**, and a **customer-portal toggle**
  that flips to the other side of the conversation.

302 tests pin it — the full RBAC matrix as a table, the cross-tenant
isolation suite (every endpoint: tenant-A session × tenant-B entity →
404), the auth/expiry/cookie ladder, SLA explicit-now math, the invite
lifecycle, quota, seed determinism.

![The Parley inbox — SLA chips, filters, the two-pane layout](/blog/2026-10-28-the-parley-round/inbox.png)

## The adversarial review that earned its name

This round's research (six NEW competitor systems reverse-engineered —
ZCode, OpenClaude, Codewhale, Goose, Crush, Amp) adopted one pattern
above the rest: OpenClaude's **adversarial verification agent** — the
reviewer whose job is to try to break the work, not read it.

So the review round didn't just read the diff. It drove 27 probes against
the real route handlers — cross-tenant reads, role-escalation attempts,
expired-token replays, cookie tampering, quota bypasses. Two reviewer
subagents landed a **BLOCK** verdict, and they were right:

- **P0-1**: an admin could promote *any* seat to owner — a second owner
  per tenant. The owner-seat wall had a two-way hole. Fixed at both
  layers (the route 403s, the store backstop refuses), pinned by a
  regression test.
- **P0-2**: a malformed cookie crashed requests into a 500 instead of the
  ladder's 401 — fail-open on garbage input. The decode is guarded now,
  pinned by the malformed-cookie probes.

Three more P1s shipped (a probe-lane double-encode, three write lanes
missing the rate limiter, the invite seat-cap gate); three findings were
accepted with documented reasons. The 647-test suite was green **before**
the review — the walls looked fine until someone tried to break them.

![The viewer role — composer disabled with its reason](/blog/2026-10-28-the-parley-round/viewer-gated.png)

## The learning loop, on live work

The round was measured benchmark-first (baseline / midpoint / final
snapshots, all committed). The headline: while the agent built, its own
loop ran — and **AutoDream distilled five skills out of the build's own
procedures**, staged for promotion:

- `parley-adversarial-probe` — literally the P0-fix procedure, minted
  from the review round's notes;
- `verify-parley-rbac-change-role` — the role-change verification dance;
- `parley-code-review-verdict`, `setup-parley-tailwind-scoped-css`,
  `spy-localstorage-in-tests`.

Thirteen harness cycles, thirty dreams, and a minted suite task on the
parallel engine — a measured edit-bench failure converted into a
regression task by the self-improving harness, exactly as designed. The
five-mechanism verdicts with receipts are in the
[learning report](/docs/unown-learning-report.md); the trajectories are in
the [benchmark report](/docs/benchmark-improvement-report.md).

## Try it

The gallery on the landing page now says **"Four apps, live. Pick one."**
Parley auto-logs you into Lumen Labs as the owner; the role switcher
re-logins you through the real API as each role; the tenant switcher
moves you to Northwind where none of Lumen's conversations exist; the
reset handshake reseeds the whole store deterministically.

![The embedded demo after a reset — the store back to its seed](/blog/2026-10-28-the-parley-round/embed-reset.png)

The full record — every phase, every defect, every fix — is in the
[Parley session record](/docs/parley-demo-session.md).
