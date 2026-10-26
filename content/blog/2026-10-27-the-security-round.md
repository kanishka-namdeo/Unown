---
title: "The security round: every open advisory, closed at the source"
description: "Eleven Dependabot alerts, three CodeQL findings, one lockfile incident — the advisory surface went to zero by fixing causes, not findings."
date: 2026-10-27
lastmod: 2026-10-27
tags: [security, release]
type: release
media: []
---

The security round is the least glamorous kind: no new capability, no new
surface, nothing to film. It is the round where the backlog of things that
were merely *known* becomes the set of things that are *fixed*, and the
verification story is the product. The release is
[v0.0.30](https://github.com/kanishka-namdeo/Unown/releases/tag/v0.0.30).

The scoreboard that motivated it: **eleven open Dependabot alerts** (three
high, eight medium) across the vendored pi monorepo, **three open CodeQL
code-scanning findings** in the self-learning engine, and eleven open
Dependabot pull requests queuing to bump dependencies one at a time. After
the round: zero, zero, and zero — `npm audit` reports **0 vulnerabilities**
across the monorepo, and both post-fix CodeQL runs are green.

## The dependency advisories, fixed as a system

The undici alerts were the straightforward ones — in version, out the other.
The coding agent's HTTP dispatcher sat on 8.10.2; 8.12.2 is the security
release (content-encodings DoS, EventSource parser memory, SRI bypass —
GHSA-xjj6-f33q-929c, GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472), and 8.12.3
adds two robustness fixes on top. The bump itself is two characters of diff;
the work is the paper trail. The pi-repo's own contract requires reading the
changelog for the target version before touching undici — done, and the
verdict is recorded: no breaking changes to `Client`, `Pool`,
`EnvHttpProxyAgent`, `setGlobalDispatcher` or `install()`, the exact surface
`http-dispatcher.ts` uses.

The zod alert was the interesting one. GHSA-mrhx-c7xc-m3w5 (memory
exhaustion via oversized constrained collections, high) flags everything
below 4.6.6 — but zod is **declared nowhere** in this repository. It rides
in transitively: `mem0ai` (the memory platform), `@anthropic-ai/sandbox-runtime`
and the `openai` peer all pull it, each pinning `^3`. No direct edit can reach
it, and the upstream packages hadn't moved. The lever that exists is npm's
`overrides` — one line at the monorepo root forces the resolution for every
path, and bun honors it, so both lockfiles move together. The scary part of
forcing a major under a dependency is silent breakage, so the call sites were
read first: `mem0ai` uses `z.string/object/any/number/record/union/boolean`,
the sandbox runtime uses `z.string/object/array` — all zod-4-compatible. Then
the real verdict: the full engine suite, with the memory tier running through
the overridden zod at runtime, re-ran green.

The gondolin example closed the oldest debt on the board. The previous
advisory round had bumped it 0.12.0 → 0.13.0 and *dismissed* the two
node-forge advisories (GHSA-86w9-cpqp-85rv — no patched node-forge exists,
ever) as `fix_started`, with the documented follow-up: gondolin 0.14.0 drops
node-forge entirely, once it passes the repo's `min-release-age=2` gate. That
date arrived; the bump shipped; the dismissal is now simply the truth.

And because "every open advisory" means exactly that, the round also swept the
maintenance queue: get-east-asian-width 1.7.0 for the TUI's CJK width
calculation, the landing stack's four bumps (framer-motion 14.6.0,
lucide-react 1.61.0, happy-dom 21.0.4, bun-types 1.4.4), and the three
GitHub Actions pins — all eleven Dependabot PRs landed as four verified
commits instead of eleven lockfile-conflicting merges.

## The CodeQL findings, fixed to the scanner's verdict

Three medium findings, and the fix discipline came from the repo's own
history — round 3 of the security rounds established `pageCall`, an
argument-passing CDP primitive whose entire reason to exist is
`js/bad-code-sanitization`: no stringifier can be proven complete for code
construction, so dynamic values cross the boundary as `Runtime.callFunctionOn`
JSON arguments — data, never code.

The stress round's captcha native-click tier had reintroduced the anti-pattern:
`challenge.type` (page-derived, straight from the captcha probe's evaluation
of untrusted page content) and the response-field selector were
`JSON.stringify`'d into evaluated source. Both sites now go through
`pageCall`. Same selectors, same isolated-world semantics under stealth, same
return contracts — the transport changed, the behavior didn't.

The other two findings were the scanner catching real dead code wearing the
shape of intent. `context-viz.ts` ran `.replace(/\.md$/, ".md")` — replace
".md" with itself, an identity no-op, on a name that is now pinned by test as
the verbatim last segment of the virtual display path. `import-config.ts` ran
`.replaceAll("$1", "$1")` — also a no-op, and the online research says the
intent was undetectable: Gemini's TOML command contract defines only `{{args}}`
and `!{…}` shell escapes. There is no `$1` placeholder in that format to
convert. The call is gone, and a pinning test documents that a literal `$1`
in a user's prompt survives migration untouched.

## The incident the round will be remembered for

The first push of the dependency leg failed CI — all three operating systems,
same error: *"overrides in package.json changed since bun.lock was saved"*.
The lockfile had been regenerated with a bun older than the repo's own 1.4
floor, and that bun writes `lockfileVersion` 1 while silently dropping npm's
nested overrides from the lock. CI's 1.4.3 read the file, saw a lock that
didn't know about the new override, and refused the frozen install — exactly
the failure class the previous round documented when it said both locks move
together or every frozen install fails.

The fix is unglamorous and permanent: the lockfile is regenerated with the
exact version CI pins, `lockfileVersion` 3 comes back, the overrides serialize,
and the 3-OS frozen-install gate in the release pipeline carries the guarantee
from now on.

## Verification

Every fix landed with its suite:

- **Full engine suite**: 4,839 pass / 101 env-gated skips / 0 fail (under the
  CI-pinned bun 1.4.3).
- **Integration suite** (real server + mock bridge): 13/13. **Bridge**: 216
  pass. **Landing unit**: 120 pass. **E2E + axe a11y**: 15/15, including the
  scroll budget — the new release stop's chrome cost seven words, paid by
  compressing rail titles, landing at 3,199 of the 3,200 budget.
- **Dependency gates**: `check:pinned-deps`, `check:shrinkwrap`,
  `check:install-lock` all green; frozen installs verified on both roots.
- **The scanners themselves**: `npm audit` 0 vulnerabilities; CodeQL green on
  both post-fix runs; zero open Dependabot and code-scanning alerts.

## Receipts

- CHANGELOG: the
  [0.0.30 stop](https://github.com/kanishka-namdeo/Unown/blob/main/CHANGELOG.md)
  — every finding, every version, every GHSA id.
- Release: [v0.0.30](https://github.com/kanishka-namdeo/Unown/releases/tag/v0.0.30)
  — six platform binaries, SBOM, build provenance, checksums.
- The commits, in order: `0180b9a` (dependency advisories), `693e1db` (CodeQL
  findings), `5c9d905` (landing stack), `e70c14b` (CI actions), `f603259`
  (the lockfile lesson), `eeef4fc` (the cut).

What ships next is ordinary feature work on a board that no longer has a
security column.
