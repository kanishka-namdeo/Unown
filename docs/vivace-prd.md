# The Legato PRD (outline — proposed, selection pre-registered)

> **Verdict up front:** this is the Vivace round's §0.9 project-selection
> record AND the proposed PRD for **Legato** — an offline-first,
> keyboard-first read-later / web-clip PWA at `apps/legato/`. The selection
> scoring below was written BEFORE any Legato ticket ran (pre-registered,
> 2026-11-05, tree `18e4a98a`); the rejected alternatives and the predicted
> failure classes are on file so post-hoc story-telling is impossible.
> **PARKED 2026-11-06 at the triple-incarnation reconciliation**: the
> Rondo round's Chaconne selection (a parallel lineage of the same
> directive) landed on `main` first with its C-0 plan closed — the
> ledger-arbiter law gives it precedence; Tempo is carry-over #1, Legato
> carry-over #2. The page stands as the future-round candidate's record;
> nothing here was rewritten post-hoc.

One-line purpose: name the round's vehicle, justify it against the
weakness map with scores, and fix the scope + verification contract the
tickets will build against.

- Round: [the Vivace round](vivace-round-session.md) · suite:
  [benchmarks/vivace-round/](../benchmarks/vivace-round/)
- Selection law: the A1 directive §0.9 (weakness-driven, not
  comfort-driven; human approval at the selection gate)

## The weakness map (input to selection; each entry sourced)

| # | Weakness | Evidence |
|---|---|---|
| W1 | Structured-output brittleness of the current model lane — correct content, prose-wrapped JSON | C3 canary, exit 3 ([validation log V-3](../benchmarks/vivace-round/validation-log.md)) |
| W2 | Browser/fetch autonomy on hostile pages — JS walls, redirects, odd encodings; prior app rounds stayed Chromium-desktop-only with live-web classes unexercised | [browser-autonomy rounds](../docs/browser-autonomy-round-session.md); research: pi upstream delegates containerization, Letta/OpenCode stress e2e; landing demo apps' `[U]`s |
| W3 | Memory retention across a multi-session project — the 110-bullet render cap prunes; schema contracts from early tickets must survive to late tickets | [memory.md render footer](memory.md); the R-2 measured degradation curve (~75 messages); SkillsBench-class drift findings |
| W4 | Self-minted skill quality unmeasured on live work — the mint gate exists but the Vivace angle is to exercise it on real recurring patterns | [skills.md](skills.md); SkillsBench (LLM-authored +0.0pp vs human +16.2pp) |
| W5 | Metered upstream (~20 RPM free tier; bridge caps 3 concurrent / 400 ms) — batching discipline over parallel fan-out | root AGENTS.md metered-tier guard; bridge lanes receipt |
| W6 | Long-horizon planning across 10+ tickets with shared state — plan-mode V3 exists, needs a real vehicle | [plan-mode-v3.md](plan-mode-v3.md); the A1 directive's SDLC-coverage requirement |

## The candidates (scored 0-2 per §0.9; scores pre-registered 2026-11-05)

| Candidate | Exposure | Tractability | Measurement | Generalizability | Value | Verdict |
|---|---|---|---|---|---|---|
| **A. Legato** — offline-first read-later / web-clip PWA (clip URLs → readable text, full-text search, tags, highlights, queue, byte-stable import/export, PWA offline) | 2 (W2 real-page fetching, W3 schema evolution, W6 12+ tickets) | 2 (the proven `apps/` lane — vanilla TS, zero deps, serve.mjs, Playwright battery) | 2 (byte-stable export, search-correctness units, e2e keyboard battery, deterministic hostile-clip fixture B-16) | 2 (hostile-clip skill, schema-contract memory rule, e2e stabilizer — all reusable) | 2 (read-later is a real, widely-used category) | **SELECTED** — max E×G×V at full tractability |
| B. Tempo — keyboard-first time-tracking + invoicing PWA (the parked Etude proposal) | 1 (keyboard/offline yes; no hostile-web axis; moderate schema evolution) | 2 | 2 (timers deterministic) | 1 | 2 | Rejected as the fresh directive's vehicle (it remains the Etude round's queued PRD, parked intact) — weaker on W2/W3 |
| C. Aria-shaped multi-tenant support-triage SaaS (real backend service) | 2 (long-horizon, multi-service) | 1 (a NEW service lane in the monorepo, unproven under engine recycles + metered upstream; core-adjacent infra risk) | 2 | 2 | 2 | Rejected for this round: T=1 means the round risks becoming an infra fight instead of a learning program; revisit as a future round once the PWA lane's learning cargo ships |

Selection rule check: maximize Exposure × Generalizability × Value subject
to Tractability ≥ 1 and Measurement = yes → A (8) over C (8, but T=1 risk)
on the tie-break "prefer the proven lane when the learning cargo, not the
infra, is the mission". Anti-gaming check: A is not a comfort-zone pick
(W2's live-page axis is exactly where prior rounds recorded `[U]`s), and
not an impossible pick (the apps/ lane is proven by Coda + Ostinato).

## The one-paragraph vision

Legato is the reading inbox that never loses a page: clip any URL, get a
clean readable copy stored locally, find it again instantly with
full-text search and tags, read it in a keyboard-driven queue, highlight
what mattered, and carry everything with you — a byte-stable JSON bundle
in, the same bundle out, offline-first, no account, no server. "Legato"
because the reading flow should be smooth and connected.

## Users and jobs

- The developer who bookmarks 40 tabs a week and never reads them: clip
  now, search later ("that error-handling article with the retry
  ladder"), read offline on a train.
- The researcher collecting sources for a writeup: tags + highlights +
  Markdown export feed their notes tool.
- Jobs: clip fast → read later → find again → take it out.

## Scope (P0 — the Vivace drive tickets V-1..V-12)

| Ticket | Lane (SDLC) | Deliverable |
|---|---|---|
| V-1 | Planning + Engineering | scaffold `apps/legato/` (vanilla TS, zero deps, serve.mjs, unit harness, lint/typecheck lane) — via a plan-mode ticket |
| V-2 | Architecture + Engineering | storage core: IDB wrapper, stores (clips/tags/queue/highlights), schema v1 + the migration frame + its design note |
| V-3 | Engineering | clip pipeline: URL → fetch → readability-lite extraction → clip record; the error taxonomy; fixture-page unit tests; **freezes holdout B-16** |
| V-4 | Engineering + Quality | search: inverted index, query, snippets, ranking tests |
| V-5 | Engineering | UI shell: keyboard-first list/detail, command palette, theming, axe a11y pass |
| V-6 | Engineering | reading queue + states (unread/reading/done/archived) with keyboard flows |
| V-7 | Engineering | tags + filter combos |
| V-8 | Engineering | highlights/annotations in the reader |
| V-9 | Quality | import/export: byte-stable JSON bundle round-trip + Markdown export |
| V-10 | Operations | PWA offline: service-worker precache + offline e2e |
| V-11 | Quality | the e2e battery: keyboard flows, hostile-clip e2e vs the local fixture server, cross-browser smoke |
| V-12 | Collaboration + Learning | docs (legato.md), README surface, blog post, CHANGELOG; the round's memory/skill harvest |

P1 backlog (post-round candidates): browser-extension quick capture,
reading-time estimates, per-tag digests, sync via file (WebDAV), Firefox/
WebKit full batteries.

## Non-goals (P0)

- No server, no accounts, no sync service (offline-first local only).
- No full browser engine embedding — clipping is fetch + extraction with
  the browser tool as the FALLBACK lane for JS-walled pages, not the
  default path.
- No Firefox/WebKit full parity — the honest Chromium-first scope of the
  prior app rounds, with a cross-browser smoke if the lane allows; the
  gap stays a named `[U]` otherwise.
- No AI features in the app itself (the agent builds it; the app is
  deterministic).

## Hardening-first mapping (weakness → how this vehicle stresses it)

- W1 → V-3/V-9's schema'd clip records + the B-15 holdout: every
  structured-output lane the tickets exercise.
- W2 → V-3 (fetch real pages: encodings, redirects, 403s) + B-16 (the
  frozen hostile fixture) + V-11's hostile-clip e2e.
- W3 → V-2's schema-contract note + every later ticket re-deriving it:
  a 12-ticket project with evolving stores is the retention test.
- W4 → recurring patterns (fixture-server setup, e2e keyboard-flow
  authoring, export round-trip tests) are the minting candidates; the
  mint gate gets exercised on real repetitions, not toys.
- W5 → batching discipline: tickets are sequential single-session chunks
  (the R-2 lesson), parallel fan-out only for independent e2e specs.
- W6 → V-1 runs plan-mode V3; the roadmap itself is the long-horizon
  plan the round executes.

## Edge cases the PRD names up front

- Clipping: non-UTF-8 pages (charset sniffing), redirect chains, 403/429
  JS-walled pages (the fallback lane), paywalled content (clip the
  excerpt + link, never bypass), gigantic pages (size caps), pages whose
  readable text is empty (fall back to title+URL with a flag).
- Storage: schema migrations between tickets (v1→v2 while data exists),
  IDB quota errors, interrupted writes (the Ostinato atomic-write
  pattern), export while mid-migration.
- Search: CJK text (no naive word splitting), hyphenation, snippet
  boundaries, index rebuild after import.
- Queue: concurrent state flips, keyboard focus traps, empty states.

## Success criteria

- The app: all twelve tickets landed through A2 with the battery green
  (unit, tsc, lint, e2e keyboard battery, byte-stable round-trip proof,
  offline e2e); the e2e battery ≥ 12 specs like the Ostinato bar.
- The cargo: canary rig deltas receipted (C3's schema class cured at the
  right layer — brief, augmentation, or upstream-filed); ≥1 augmentation
  through the full PROPOSE→CANARY→GATE→PROMOTE lifecycle with paired
  evidence; each advertised learning mechanism exercised ≥1 time with
  receipts (the §6c matrix); the evidence packet current.

## Approval

Proceeding autonomously per the standing directive (the eighteenth
lineage, 2026-11-05); this page is the veto surface — swapping the
vehicle before V-2 costs one parked PRD, after V-9 it costs the round.

## Related pages

- [The Vivace round log](vivace-round-session.md) · [the suite](../benchmarks/vivace-round/README.md)
- [The Ostinato round](ostinato-round-session.md) (the prior DRIVE round —
  the lane Legato inherits) · [the Coda round](coda-app-round-session.md)
