# The Website Excellence Round 2 — the session record

> The resumable checkpoint log for the second Website Excellence Program
> round (2026-10-30 →): the same mission as the first round — evolve
> Unown into a design-aware, visually intelligent, self-improving website
> creation platform — executed as a fresh programme, not a continuation:
> new research, new capability gaps, new tools/skills/agents, new
> benchmark websites, and the failure→learning pipeline retaining what
> works. Each checkpoint states what is done, what is verified, and what
> is next, so an interrupted session resumes from the last green state.
> The round's failure ledger is
> [`../benchmarks/website-excellence-round-2/validation-log.md`](../benchmarks/website-excellence-round-2/validation-log.md)
> (F-numbers continue from the first round's F1–F20).

- [Checkpoint 0 — setup, the stack verified, and the state of main](#checkpoint-0--setup-the-stack-verified-and-the-state-of-main)
- [Checkpoint 1 — main restored to green: the release gate, the DNS retry, the ledger](#checkpoint-1--main-restored-to-green-the-release-gate-the-dns-retry-the-ledger)

## The contract

The programme's success question is unchanged: *"If we restarted these
projects from scratch using the improved version of Unown, would the
resulting websites be significantly better than those produced by the
original version?"* — answerable only with measured evidence. The
operating principle is also unchanged: when a weakness is identified,
decide where the defect lives (Unown, the caller environment, or the
artifact), fix it where it lives, and create the benchmark that would
catch it next time. This round adds a gate-credibility corollary the
baseline taught: **a claimed gate result that CI never ran is a defect
of its own** — measure, never record.

## Checkpoint 0 — setup, the stack verified, and the state of main

**DONE.** Fresh clone at `e52664fe`; bun upgraded 1.3.14 → 1.4.4 (the
lockfileVersion-3 floor); `bun run agent:install` (root + pi-repo
installs, model-data hydration, build, `.env` bootstrap, PATH link);
`.env` configured with the Agnes upstream
(`BRIDGE_UPSTREAM_URL=https://apihub.agnes-ai.com/v1`, key set,
`AGNES_API_KEY` set, the metered free-tier guards untouched);
`bun run agent:start` brought up the stack.

**VERIFIED (all receipts from this machine, 2026-10-30):**

| Gate | Result |
|---|---|
| Agnes upstream | `/models` 200 (6 models served); chat completion 200 (`agnes-3.0-flash`) |
| Bridge `:3031/health` | ok, upstream 200, `agnes-3.0-flash` default, concurrency guards active |
| Engine `:3030/api/health` | `phase: ready`, v0.0.42 |
| `bun bin/unown -p` end-to-end | `UNOWN-AGENT-OK` through the bridge |
| `unown doctor` | all green (bubblewrap sandbox active, instruction-set audit clean) |
| `bun run typecheck` / `lint` | green / 0 errors (4 pre-existing warnings) |
| `bun run test:unit` | 2041/2041 |
| `bun run build` | green |
| `bun run test:e2e` | 14/15 — the scroll budget red (see F22), fixed upstream mid-diagnosis; 15/15 on `989205c7` |

**The state of main found at baseline (the round's first findings):**

- **CI was RED** on `e52664fe` and had been red since the v0.0.42
  release: the e2e scroll-budget breach (F22) plus a macOS runner DNS
  blip (F23), cascading into the deploy-verify "Live production check"
  failure. The v0.0.42 release had shipped while its own CI was red —
  the Release workflow never gates on CI's conclusion (F21).
- **A scheduled routine had already fixed the word breach** (commit
  `989205c7`, sessions `e13-fix*`): the built-improved lede compressed
  17 words, ceiling held at 3,750, CI green on the fix. This round
  verified the fix rather than re-fixing it, and ledgered the process
  failure (F21/F22) with API receipts.
- **A tooling lesson recorded for this workspace**: a "corrupted"
  `branches: ain]` finding in `ci.yml` was a display artifact — the
  tool-output pipeline renders `[main]` with its `[m` consumed as an
  ANSI reset. Verified with `od -c` + `git log -S` before any edit; the
  file was always correct. Byte-level verification before surprising
  conclusions is now a session rule (the docs workspace's own AGENTS.md
  records the same artifact class for markdown link labels).

**NEXT.** Milestone 1's remaining fixes: the release gate (F21), the
DNS retry (F23), the ledger + this doc, then push and watch CI go green
end-to-end — the first push this round makes under its own new
discipline (every gate measured locally before the push, CI observed to
conclusion, never cancelled mid-flight).

## Checkpoint 1 — main restored to green: the release gate, the DNS retry, the ledger

**DONE.**

- `release.yml` — the new `ci-green` first job (F21's durable fix):
  resolves the CI run for the tagged SHA via the GitHub API, waits
  while CI is queued/running (bounded 40 min), and fails the release
  unless CI concluded `success`. Every downstream job needs it, so a
  red or in-flight CI can no longer mint release artifacts. YAML
  validated; the bash step `bash -n` clean; the needs chain asserted.
- `ci.yml` — the `update --check` smoke step now retries once (15s
  backoff) on exit 1 (F23): a hosted-runner DNS blip is transient; two
  strikes still fail.
- `benchmarks/website-excellence-round-2/validation-log.md` — F21, F22,
  F23 ledgered with reproduction commands and API receipts.
- This session doc.

**VERIFIED.** `python3 -c "import yaml; …"` parses both workflows
(job graph: `ci-green` → `verify` → `build` → `smoke-artifacts` →
`publish-release` → `verify-feed`/`smoke-install`); both edited run
blocks pass `bash -n`; the touched markdown passes `bun run check:docs`.

**NEXT.** Phase 1 — the second research base (the first round covered
Linear, Geist/Vercel, Stripe; this round surveys the rest of the
mission's list: Apple, Airbnb, Arc, Resend, Cursor, OpenAI, Anthropic,
Perplexity, Raycast, Mercury, Attio, Notion, Framer) and the refreshed
capability gap analysis, then the round's capability builds.

## Checkpoint 2 — the second research base

**DONE.**
[`website-excellence-research-2.md`](website-excellence-research-2.md) —
nine elite sites read from their live production HTML/CSS (Apple,
Airbnb, Notion, Framer, Raycast, Resend, Anthropic, Mercury, Attio —
each with its token values extracted, not paraphrased from posts) plus
the 2026 motion state of the art (the scroll-driven-animation matrix
that completed with Firefox 159 on 2026-10-27; Stripe/Vercel as the
production adopters; what died — particles, Lottie-on-marketing, cursor
followers, JS animation libraries — and what replaced them). Two
mission-list sites sat behind Cloudflare challenges (arc.net,
openai.com) and are recorded as **not-verified** rather than guessed —
the doc's honesty rule. The synthesis distills the nine sites into
**ten enforceable builder rules** (closed type ramps with weight
ceilings, tracking-vs-size curves, tinted neutrals, one-accent
censuses, product-as-hero, quantified trust, compositing-only motion,
`@supports`-wrapped scroll timelines, breakpoint ceilings,
one-scale spacing+leading) — each phrased so a tool can check it, which
is what the round's capability builds consume.

**VERIFIED.** Every number in the research doc carries the [V] tier
(extracted this round from the named production artifacts) or [C]
(publisher-cited); `bun run check:docs` green; the doc registered in
the README table and `docs/AGENTS.md`.

**NEXT.** Phase 2 — the capability gap analysis refresh (what the
platform could not do at `661801fa`), then the round's builds: the
critic's new objective axes and the website skills the ten rules
imply.

## Checkpoint 3 — the capability builds: craft axes, six skills, four agents

**DONE.**

- **The craft axes** (`scripts/design_critic.mjs`, schema
  `website-excellence/critique/2`): six new objective gates, each a
  research rule made mechanical — the weight census (ceiling 600, ≤4
  distinct), the tracking-vs-size curve (distinct off-curve combos ≤3),
  the tinted-neutral hue spread (≤30° circular stddev), the accent
  cluster census (≤2 on interactive elements), the animated-property
  whitelist (layout props + `transition: all` = violations;
  Tailwind v4's individual transforms, discrete steps and the radix
  accordion height exception correctly classified), the breakpoint
  census (≤8), and the reduced-motion guard. Receipts moved to
  `benchmarks/website-excellence-round-2/critiques/`; the rubric moved
  and extended with the craft table.
- **Six website skills** (`.unown/skills/`, committed):
  `landing-page-architect`, `design-system-generator`, `ux-reviewer`,
  `accessibility-auditor`, `motion-designer`, `frontend-craftsman` —
  the mission's Phase-3 skills, each grounded in the two research
  bases and each ending in its verification command.
- **Four specialist agents** (`.unown/agents/`): `design-reviewer`
  (the critique-lane gate), `ux-critic`, `a11y-auditor`,
  `performance-engineer` — composable with the skills, receipts-only
  reporting, BLOCKED-protocol aware.
- **F24 found and fixed by the new tooling itself**: the axes' first
  run against the real landing caught the HP bars' `width` transition
  and four `transition[-]all`s (the first gallery app + the vendored
  accordion) — fixed with `scaleX(var(--fill))` + `clip-path` mount and
  explicit property lists. The platform's own medicine applied to its
  earlier work.

**VERIFIED.** The real landing passes ALL craft gates (weights
400/500/600, tracking 0 offenders, neutral hue 2.7° over 22 grays,
accents 2, anim 0 layout props, breakpoints 6, prm guard true); the
known-bad calibration fixture still FAILS (weight 700 detected) — the
axes discriminate both ways (receipts committed under
`benchmarks/website-excellence-round-2/critiques/`). 2041/2041 unit
green after the component fixes; typecheck + build green.

**NEXT.** Phase 4's validation website: a new gallery app built under
the new skills + agents, through the critique loop, exercising every
craft gate from the first build — the round's benchmark scenario.

## Checkpoint 4 — Ledger: the validation app, green on iteration three

**DONE.** The gallery's ninth app — **Ledger**, a warm-paper fintech
treasury dashboard (the mission's PROJECT TYPE 2, the one gallery type
never exercised), deliberately opposite to the landing's dark GBA
aesthetic to prove the craft gates hold across design languages. The
`design-system-generator` procedure produced the tokens before any
component existed; the build followed the motion and craftsman laws;
every iteration ran the full rubric with committed receipts (the
loop's honest trajectory — v0 FAIL, 132 contrast violations, 252px
overflow, a persona bug; iter1 a TDZ crash caught by the audit
measuring an error shell; iter2 two gates left; **iter3/final
`--enforce` PASS, exit 0**: contrast 0, 8 sizes, 0% off-grid, VLM
7.0–8.23, every craft axis green). 22 tests (the drift gate asserting
the rendered figures against the seed's arithmetic); the ninth gallery
entry + poster via the media lane; the scroll budget holds at 3749 of
3750; 2063/2063 unit; 15/15 e2e.

**The loop's retained learning:** F25 (the F20 documentation trap
repeated by this round's own F24 receipt — defusal now happens at
write time); the VLM persona must be brand-scoped (the critic's new
`--brand` flag — a judge pinned to one design language fails every
other on identity, not craft); the sr-only table's `th` defaults trip
the weight census (scoped tables inherit the ramp); grid children need
`min-width: 0` the moment a wide table enters them. The full record:
[docs/ledger-demo-session.md](ledger-demo-session.md).

**NEXT.** The round's closing docs (the gap-analysis refresh, the blog
post, the README), the version bump to 0.0.44, and the release —
through the new ci-green gate this round shipped.
