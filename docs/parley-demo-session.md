# The Parley demo's session record

> The receipt behind the landing page's live-demo **gallery's fourth app**:
> what the multi-tenant support-inbox SaaS round built, the agent sessions
> that built it, what each stage's testing found, and the learning-loop
> evidence the round captured while it ran. Kept as a resumable record:
> each checkpoint states what is done, what is verified, and what is next,
> so an interrupted session can resume from the last green state.

- [What the app is](#what-the-app-is)
- [How it was built](#how-it-was-built)
- [What the testing found (and fixed)](#what-the-testing-found-and-fixed)
- [The learning-loop evidence](#the-learning-loop-evidence)
- [The embedding adaptations](#the-embedding-adaptations)
- [Where things live](#where-things-live)

Related pages: [Cadence session record](cadence-demo-session.md) (the third
app) · [Sigil Bazaar session record](bazaar-demo-session.md) (the second) ·
[focus session record](live-demo-session.md) (the first) · [Parley round
competitor research](parley-round-competitor-research.md) (the research that
grounds this round) · [the learning report](unown-learning-report.md) · [the
benchmark report](benchmark-improvement-report.md) · [the validation
log](../benchmarks/parley-round/validation-log.md) (the failure→fix ledger) ·
[tui capture workflow](tui-capture-workflow.md) (the capture lane the round's
stills came from).

## What the app is

Parley — a **multi-tenant customer-support inbox SaaS**, the gallery's
fourth agent-built app and the first with tenancy, authentication, RBAC
and isolation on its surface (the round's SDLC stress test):

- **Multi-tenancy** — two seeded tenants (Lumen Labs `team` plan, Northwind
  Kits `free` plan at 47/50 conversations), row-level tenancy
  (`tenantId` on every owned row) behind a **fail-closed repository**:
  a repository call without tenant context throws; a cross-tenant call
  returns not-found — the isolation is structural, not per-route
  discipline.
- **Authentication** — credential login with scrypt-hashed passwords
  (`node:crypto`, salted, timing-safe), **server-side sessions** (a
  session store with `expiresAt`, an HMAC-signed HttpOnly cookie), real
  logout (row destroyed), real expiry (8h TTL), no external service.
- **RBAC** — four roles (owner / admin / agent / viewer) behind a
  data-driven `can(role, action)` matrix, enforced in BOTH the API
  (401/403/404 ladder) and the UI (disabled-with-reason surfaces).
- **The inbox** — two-pane layout, six filters with count chips
  (all/open/pending/closed/unassigned/SLA-at-risk), per-conversation SLA
  chips (breached red / at-risk amber live countdown / ok), thread view
  with customer-vs-agent bubbles + system-event timeline, a `/`-canned
  composer, assignment/status/priority/tag controls, empty states.
- **SLA policies** — per-tenant data-driven targets by priority; due
  dates, breach and the 20% at-risk band are pure explicit-now functions.
- **Invites** — owner/admin invites generate real single-use 24h tokens;
  the in-app **Demo Mailbox** drawer shows the "sent" emails; accepting
  creates the user + membership with the invited role (410 used / 410
  expired / 404 unknown).
- **Audit log** — every mutation appends a tenant-scoped event with
  actor/action/entity/before-after; admin-visible, filterable feed.
- **Usage metering** — plan caps (free 3 seats/50 conv-month, team 10/500,
  scale higher), overage banner, seat-cap gate on invites (402
  `quota_exceeded`), per-agent load.
- **Analytics** — volume by status, median first response, resolution
  rate, per-agent load — pure functions, accessible SVG (cadence's
  chart pattern).
- **Customer portal toggle** — the customer-side view of a conversation,
  clearly labeled, internal controls swapped out.
- **Demo contract** — `?embed=1` strips chrome; the demo auto-login is a
  REAL login (session row + cookie; the server reads the cookie first so
  the embedded first load never 401s in the console); the role switcher
  and tenant switcher re-login through the real API; the reset handshake
  `{source:"unown-landing", type:"parley-reset"}` wipes, reseeds
  deterministically and rotates the demo session.

## How it was built

Written end-to-end by `unown` — the pi coding agent under the self-learning
layer — driven through the established phase chain against the Agnes AI
endpoint (`agnes-3.0-flash`) through the bundled llm-bridge, on 2026-10-28.
**20 session boots, 1,109 tool calls** (receipts
`.unown/receipts/2026-10-28*.jsonl`), as chunked resume-chains of one
session (the host sandbox's ~10-minute call budget):

| Phase | What happened | Receipts |
|---|---|---|
| Plan | `--plan` mode: the 36-step plan (~1,260 lines) with file map, test plan, 12-risk list — including the verified correction of the brief (the siblings DO use scoped Tailwind v4) | 1 boot |
| Lib | The domain layer: types, clock, ids, password, rbac, tenancy, sla, sessions, audit, metering, validation, seed, analytics, store — **180 tests** | 3 boots |
| API | The shared `_auth.ts` + 22 tenant-scoped routes + the isolation/auth/invite/audit/reset integration suites — **76 tests** | 3 boots |
| UI | The client store (request-driven, no localStorage for domain state), shell/login/inbox/thread/composer/detail/admin/portal + component tests — **32 tests** | 3 boots |
| E2E | The live headless-Chromium pass: all 8 steps green, **3 defects found + fixed live** (screenshots `.unown/briefs/parley-e2e/`) | 5 boots |
| Review | The adversarial round (this round's adopted pattern): 2 reviewer subagent passes + a 27-probe adversarial suite + the P0 regression pin — **2 P0 wall-breaks found, fixed, pinned** (+29 tests) | 3 boots |
| Drill | The checkpoint/undo/redo drill (the agent-lane equivalent, honestly recorded) | 1 boot |
| Landing | The gallery entry #4, the four-app copy, the test pins, the favicon, the poster (production-build capture), the embed console-noise fix | 1 boot |

- **Tests**: **302** across 23 files (lib 180 + api 99 + ui 23); the full
  repo suite **676 pass** (the 359 baseline + parley 302 + 15 shared-lane
  pins); typecheck and biome clean.
- **Files**: 81 under the parley trees (26 lib, 33 app incl. 22 routes,
  22 components).
- **Commits**: the round's 7 code commits (`parley: the domain layer` →
  `landing + demo: the parley round`) + the docs/reports commits from the
  mission's parallel reports lane.
- **Zero human edits to the app's code**: every line in the parley trees
  the agent wrote; the brief, the phase prompts and the verifications
  were the operator's.

## What the testing found (and fixed)

- **E2E (the agent's browser pass)** — three real defects, each fixed and
  re-verified in the same round: **D1** the role/tenant switchers left the
  previous tenant's domain state in the provider (logout now wipes all
  domain state); **D2** `loadTenant` fetched every lane unconditionally
  so a viewer's audit fetch 403'd (now fetches only the active role's
  matrix-allowed lanes); **D3** the invite/accept dialogs' stale-closure
  refresh never updated members/mailbox/audit (a `reloadTenant()` provider
  action re-probes and re-fetches with the active role's read gates).
- **The adversarial review round** (the OpenClaude-verification pattern
  adopted from this round's competitor research): two reviewer verdicts
  landed **BLOCK** on the first pass —
  **P0-1** an admin could promote any seat TO owner (a second owner per
  tenant — the owner-seat wall had a two-way hole); fixed at BOTH layers
  (route Guard 1b 403 + a store-level backstop) and pinned by
  `p0-repro.test.ts`;
  **P0-2** a malformed cookie (broken %-sequence) crashed requests into a
  500 instead of the ladder's 401 — the decode is guarded now, pinned by
  the malformed-cookie probes.
  P1s fixed: the probe-lane cookie double-encode, three write lanes
  missing the rate limiter (incl. the unauthenticated `invites/accept`),
  the invite seat-cap gate (invitees could cross `PLAN_CAPS.seats`).
  Three findings ACCEPTED with documented reasons (the guard-ordering
  trade, the safe-fail default, the two-clocks bound).
- **The full failure→fix ledger** (including the two Unown-side defects
  the round's sessions surfaced — the F3 print-mode envelope fix and the
  F4 usage-log gap) lives in
  [`benchmarks/parley-round/validation-log.md`](../benchmarks/parley-round/validation-log.md).

## The learning-loop evidence

The round's benchmark-first measurement (snapshots in
[`benchmarks/parley-round/snapshots/`](../benchmarks/parley-round/snapshots/),
each annotated with its engine instance — the round ran the build lane
and the reports lane on two parallel engine instances):

- **Baseline** (build engine, before any app code): 5/5 seed tasks
  passing, 14/14 runs, 0 improvements, 0 skills — and 5 dreams already
  consolidated while the baseline cycled.
- **Midpoint** (reports engine): 6 tasks (the minted
  `swap-if-else-messages` — a measured edit-bench failure converted into
  a suite task), 1 improvement shipped (the closed
  mine→patch→verify-twice→ship cycle), 13 dreams.
- **Final** (build engine): **13 cycles, 30 dreams, 5 skills**,
  72 runs at 95.8% pass — the five skills are the headline:
  AutoDream distilled the round's OWN procedures into staged skills
  (`parley-adversarial-probe`, `parley-code-review-verdict`,
  `verify-parley-rbac-change-role`, `setup-parley-tailwind-scoped-css`,
  `spy-localstorage-in-tests`) — the adversarial-probe skill is
  literally the P0-fix procedure, minted from the review round's notes.
- The five-mechanism verdicts with their receipts:
  [`docs/unown-learning-report.md`](unown-learning-report.md); the
  trajectories: [`docs/benchmark-improvement-report.md`](benchmark-improvement-report.md).

## The embedding adaptations

The app as **built** is untouched. The copy embedded at `/parley` carries
the documented host-integration patches:

1. **Embed param read server-side** (`page.tsx`) — `?embed=1` reaches the
   client tree as a PROP; the server ALSO reads the session cookie and
   passes `hasSession` so the embedded first load goes straight to the
   demo auto-login POST (zero console errors — the poster lane's gate).
2. **Reset listener** (`client-store.tsx`) — origin- and shape-checked
   `parley-reset` handshake; wipes the store, reseeds deterministically,
   rotates the demo session.
3. **CSP headers block** (`next.config.ts`) — `/parley/:path*` joins
   demo/bazaar/cadence (`frame-ancestors 'self'` + SAMEORIGIN).
4. **Gallery entry + copy** (`live-demo-data.ts` + `live-demo.tsx`) —
   the fourth entry; "Four apps, live. Pick one."; a fourth switcher pill.
5. **Test pins** (`__tests__/live-demo.test.tsx`) — ≥4 apps with distinct
   routes/posters/reset types/receipt docs + the parley reset-type pin.
6. **Poster** (`public/landing/parley/poster.png`) — captured by
   `scripts/landing_demo_poster.mjs` from the **production build**
   (1440×900 @2x, 2880×1800); all four posters re-shot clean there.
7. **Favicon** (`public/parley/favicon.svg`) — the two-speech-bubble
   correspondence mark (the F7 finding's ship).
8. **Rate-limit buckets** — test-resettable so suites never bleed 429s.

## Where things live

- The app: `src/lib/parley/` (domain, 14 modules), `src/app/parley/`
  (routes + 22 API handlers), `src/components/parley/` (15 components).
- The adversarial suites: `src/app/parley/api/__tests__/adversarial.test.ts`
  (27 probes) + `p0-repro.test.ts`.
- The round's records: this page, the
  [validation log](../benchmarks/parley-round/validation-log.md), the
  [snapshots](../benchmarks/parley-round/snapshots/) (baseline / midpoint /
  final, engine-annotated), the [competitor research](parley-round-competitor-research.md).
- The build receipts: `.unown/receipts/2026-10-28*.jsonl` (gitignored,
  counted in the gallery entry), the E2E screenshots
  (`.unown/briefs/parley-e2e/`), the adversarial review
  (`.unown/briefs/parley-review.md`), the drill record
  (`.unown/briefs/parley-drill.md`).
