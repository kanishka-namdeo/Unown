# Bolero — PRD (the Scherzo round's DRIVE vehicle)

- **Status**: APPROVED 2026-11-07 (the §0.9 selection receipt at
  [benchmarks/scherzo-round/README.md](../benchmarks/scherzo-round/README.md))
- **Operator**: A1 (the twenty-sixth lineage) · **Executor**: A2 (Unown v0.0.57 @ `ae8a73db`,
  zai-bridge/agnes-3.0-flash, maxTokens pinned 4096 per V-38)
- **One-liner**: Bolero is a recipe-driven website watchdog — scheduled
  browser-recipe runs against real sites, a server that ingests, validates
  and stores the run reports, a status dashboard, and an alert lane. It is
  named for the piece that repeats one theme, relentlessly.

## 1. Why this vehicle (the weakness-driven case)

The Scherzo round's §0.9 selection scored five candidates against the
weakness map (receipts in the selection doc). Bolero maximizes
Exposure × Generalizability × Value under the Tractability/Measurement
constraints because it is the first vehicle that forces A2 into the four
lanes the prior rounds' apps (Coda, Ostinato, Chaconne — all local-first
PWAs) never exercised:

| Weakness (evidence) | How Bolero stresses it |
|---|---|
| **W3 — browser resilience** (H-10's honest null: the skill's firing surface "never occurred" all round) | The core loop IS scheduled browser runs — form fills, read-backs, screenshots against both fixture pages and real public sites |
| **W4 — cross-host artifact contracts** (V-41, the Rondo round's genuine find: the runner's report ext drifted from the PWA's boot grammar across 3 invisible gate gaps) | The runner (browser) and the server (storage) are separate hosts by construction; the report grammar is frozen day-one with cross-host round-trip pins (the V-41 lesson as a design law) |
| **W5 — real-data bridges** (C-10's lesson: the real-runner capture lane was a late addition) | Real public sites are a first-class input from S-2 onward, with fixture-first e2e as the deterministic verifier |
| **W6 — the ops/deploy lane** (the SDLC matrix's thinnest lane: no server supervision, health checks, or monitoring lanes were ever exercised) | A real server process (bun + SQLite) with health endpoints, supervision via the operator daemonizer, a CI lane, and a dashboard deployed on the public landing (Vercel) |

Incidental stress (no ticket wasted on it): W1 long-horizon budget
discipline (the server tickets are multi-file backends — chunked ≤4×8
turns per the playbook) and W2 stuck-pattern spirals (async/debug-heavy
work is exactly the H-17 surface).

## 2. Users and jobs

- **Site owner / dev team**: "tell me when my site's login flow / pricing
  page / checkout breaks, and show me what it looked like when it did."
- **The Unown project itself** (dogfood): Bolero watches the project's own
  public surfaces (landing page, release feed) — the app studies its own
  builder's health.

Job stories (P0):

1. As a site owner I can register a **watch** (a named Chaconne-domain
   recipe + a schedule) so it runs unattended.
2. As a site owner I can see each watch's **latest status, history and
   screenshot** in a dashboard, so I can tell at a glance what is healthy.
3. As a site owner I can receive an **alert** when a run fails (or fails
   N consecutive times), so silence means healthy.
4. As an operator I can run the whole thing **locally with one command**
   (server + dashboard + runner) and trust its **health endpoint**.

## 3. Scope

### P0 — the tickets (S-1..S-10, coverage-mapped in the round log)

| Ticket | Lane | What ships |
|---|---|---|
| S-0 | Planning | `apps/bolero/PLAN.md` through A2 — architecture, grammar, ticket map, edge-case register (the C-0 pattern) |
| S-1 | Engineering | Domain core: the FROZEN recipe + report grammar (Chaconne's frozen domain, re-expressed), with cross-host round-trip pins (RED by construction — the V-41 law) |
| S-2 | Engineering | Runner v1: executes a recipe against a page, emits a report; fixture-first (local `file://` fixtures), deterministic |
| S-3 | Architecture/Engineering | Server: bun + SQLite storage, watch registry, report ingest API with STRICT grammar validation, health endpoint |
| S-4 | Engineering | Scheduler: interval execution of watches (bounded real-clock polls — the V-18 lesson: no fake clocks, the operator hands the mechanism down) |
| S-5 | Engineering | Dashboard: status board PWA (watch list, run history, latest screenshot, failure detail) |
| S-6 | Operations | Deploy + supervision: server under the operator daemonizer with health checks + a CI lane; the dashboard shipped as a static build under `public/bolero/` (live on the Vercel landing) |
| S-7 | Quality | Resilience battery: corrupt report, offline runner, server restart mid-run, kill-and-resume (the O-1/C-7 pattern) |
| S-8 | Quality | e2e + a11y battery: keyboard-only flows, axe WCAG2A/2AA, offline boot, crash-resume |
| S-9 | Collaboration | Docs + landing + README + blog: `docs/bolero.md`, the landing demo card, the round-table row, the blog post (with captured stills) |
| S-10 | Learning/Close | The round closeout: §6c learning-mechanism receipts, §8 evidence pack, RESULTS.md |

### P1 (parked unless the round re-scopes)

- Alert delivery beyond a local notification lane (email/webhook integrations)
- Multi-user accounts/auth on the server
- Watch sharing/import-export (Chaconne recipe files)
- WebKit/Firefox/mobile browser lanes (honest `[U]`s — the Ostinato
  precedent)

### Out of scope (P0)

- Anything requiring credentials for watched sites (public pages only)
- Heavy concurrency (the metered upstream ~20 RPM argues for a small
  bounded runner pool; document, don't fight it)

## 4. Architecture (the shape A2 builds within)

```
apps/bolero/
  src/domain/       recipe + report types, the FROZEN grammar, round-trip pins
  src/runner/       recipe executor (Chaconne-recipe semantics, CDP/chromium lane)
  src/server/       bun server + SQLite (bun:sqlite), ingest API, health, static face
  src/dashboard/    status board (vanilla TS, zero deps — the house pattern)
  fixtures/         deterministic local pages the e2e runs against
  scripts/          serve.mjs (the house pattern), verify-*.ts gates
```

- **The contract law (V-41 encoded)**: the report grammar is declared
  once in `src/domain/`, both hosts import it, and a round-trip pin test
  throws on any drift (dotted names THROW — RED by construction, the
  A2H-13/A2H-14 pattern).
- **The browser law**: every runner feature lands fixture-first (a local
  deterministic page under `fixtures/`); real-site runs are canaries
  (polite: public pages only, rate-limited, cached, robots-respecting),
  never the deterministic verifier.
- **The ops law**: the server's health endpoint is its contract;
  supervision rides the operator daemonizer (`.a1/scripts/dispatch-bg.py`);
  the CI lane runs the unit + e2e gates.
- **The deploy lane**: `public/bolero/` carries the dashboard's static
  build → live at the Vercel landing on merge to `main` (the repo's
  standing deployment contract); the server ships as a local service with
  a one-command boot.

## 5. Acceptance framework (per ticket)

Every ticket brief carries the PROMPT ECONOMY header + acceptance items
that NAME THE SCRIPT (`bun run bolero:test`, `bun run bolero:e2e`, the
five check gates) — the C-6 lesson (A2's bare `bun test src` is a
substring filter; the real battery is `bun run test:unit`). The operator
gate re-runs every lane on the final tree (V-31) and tree-verifies FILE
claims (H-2). Turn caps: ≤4 chunks × ≤8 turns per ticket; continuations
ride `scripts/a1-continue.py` (H-12).

## 6. Predicted failure classes (pre-registered, §0.9.4)

1. **Contract drift between runner and server** (the V-41 class) —
   mitigated day-one by the frozen grammar + round-trip pins; predicted
   to surface as a gate catch at least once.
2. **Real-site flake** (load/A-B tests/geo variance) — mitigated by the
   fixture-first law; the real-site lane is a canary, never a verifier.
3. **Long-horizon overruns on the server tickets** (multi-file backend
   work) — mitigated by chunk discipline + the H-12 continuation lane;
   H-16 (turn-budget hook) is this round's build candidate.
4. **Async/timing spirals in the scheduler** (the V-18 class) — the
   mechanism is handed down by the operator (bounded real-clock polls),
   A2 implements within it.

## 7. Seed augmentation hypotheses (pre-registered)

- **H-10 re-activation**: the browser-resilience skill finally has its
  firing surface — the round decides promote-or-retire on real evidence.
- **H-16 build**: the mid-run turn-budget hook (PROPOSE, research done)
  is built and gated during the round.
- **H-18 (new)**: the cross-host contract-pin skill — generalize the
  V-41/A2H-14 pattern into a reusable skill ("two hosts, one grammar,
  round-trip pin RED-by-construction").
- **H-19 (new)**: ops-lane memory rules — server supervision/health-check
  patterns (the first ops memory this project accumulates).

## 8. Honesty ledger (declared up front)

- Chromium-desktop-only browser lanes (the Ostinato precedent); WebKit/
  Firefox/mobile stay `[U]`.
- Real-site canaries run against a small fixed set of public pages,
  rate-limited; no credentials, no ToS-hostile scraping.
- The dashboard's public deploy is the Vercel static lane; the server is
  a local service (the sandbox has no cloud credentials) — "deployed"
  means both of those, said plainly.
