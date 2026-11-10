---
title: Four alerts, three findings, zero regressions: the security round
description: How Unown cleared every open Dependabot advisory and CodeQL finding in one gated round — including the one Dependabot's own patch would have left broken.
date: 2026-11-01
lastmod: 2026-11-01
tags: [release, security, verification]
type: release
media: []
---

v0.0.55 is a security release: both open Dependabot advisories closed, all
three open CodeQL findings fixed, nothing regressed. Like the dependency
round before it, the interesting part is not the diff — it is the discipline
that lets you believe the diff. Here is the shape of it.

## The intake came from the API, not from memory

The round opened by reading the repo's actual security state through the
GitHub API: four open Dependabot alerts (follow-redirects at HIGH severity,
minimatch at MEDIUM, three manifests), three open code-scanning findings
(one `js/insecure-randomness`, two `js/polynomial-redos`), zero secret
alerts, and seven open Dependabot PRs. That census is the contract —
"address dependabot and code sense" means that list goes to zero, and every
decline has to be argued, not shrugged.

## The advisory that needed five surfaces, not one

minimatch's fix ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249))
is a major bump: v11 swaps the matcher to a non-recursive engine that
upstream explicitly will not backport. Dependabot's PR touched two files —
the manifest and the shrinkwrap. But this repo's vendored tree carries
**five** surfaces that pin that version, and leaving three of them behind
would either keep the alert open or, worse, break the lock generators'
consistency checks. So the fix regenerated all five through the repo's own
tooling: the exact pin, `npm-shrinkwrap.json`, `install-lock/package-lock.json`,
the workspace `package-lock.json`, and `bun.lock` — whose diff came out at
four lines. `npm audit --omit=dev` now reads zero vulnerabilities in both
trees that carry lockfiles, and the 288 tests covering minimatch's two
consumers (model-resolver globs, package-manager path patterns) pass.

follow-redirects ([GHSA-mrwp-f3q8-3g9p](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p))
was the quieter one: the bun lockfile had already drifted up to the fixed
1.16.2 on its own; only the npm lock lagged — a three-line fix once you know
that `npm install --package-lock-only` alone will *not* move a range that is
already satisfied, because npm conservatively preserves existing
resolutions. The fix forces exactly one re-resolution.

## The finding that was eleven bugs wearing two hats

CodeQL flagged two lines: `.replace(/\/+$/, "")` on a user-supplied base
URL in `setup.ts` and `providers-cli.ts`. That regex is polynomial — a paste
ending in N slashes makes the engine rescan the run from every offset,
O(N²) for what should be one backward scan. But grepping the tree found the
same idiom inline at **eleven** call sites, including one normalizing the
`Origin` header of live HTTP requests. Fixing only the two flagged lines
would have bought a clean dashboard until the next scan flagged the next
copy. So the round extracted one linear, regex-free helper
(`charCodeAt` backward scan — no engine, no backtracking, allocation-free
when nothing trims), swept all eleven sites, and pinned the contract with
tests — including a hostile 100 000-slash URL that must trim in a single
linear pass, and byte-identity proofs for every shape the old regex
produced, down to the Windows-path normalizers in the uninstall code.

The randomness finding got the same treatment class: the sigil demo's task
ids drew from `Math.random()`. They now draw from `crypto.getRandomValues`
— the CSPRNG — same id shape, and a pinning test that stubs `Math.random`
deterministic and proves the ids still vary, so the fix cannot silently
regress.

## The decline that is also a receipt

One Dependabot PR was declined, on the record: `@vitest/coverage-v8` 4 → 5.
The registry shows its peer contract pins vitest to **exactly** 5.0.5 — the
isolated bump cannot satisfy the frozen vendored workspace it targets, and
the paired vitest 5 migration is an upstream-sync decision, not a routine
bump. Declining with the receipt is the difference between "ignored the
robot" and "audited the robot." The same reasoning left the root lint
chain's old minimatch alone: dev-only, majors-ignored by policy, clean
`bun audit --prod`.

The actions pins got the audit treatment too — every new SHA verified
against its tag through the API — and one improvement over the machine's
own patch: Dependabot's codeql-action PR moves only the `analyze` step,
which would leave `init` and `analyze` on different versions inside one
workflow. Both moved together.

## Receipts

Every claim above is checkable: the
[session log](https://github.com/kanishka-namdeo/Unown/blob/main/docs/security-round-session.md)
carries the full gate table — engine suite 5331/0, bridge 243/0, root
2067/0, 15/15 e2e, frozen installs, audits at both roots, and a real-user
smoke that round-tripped a prompt through the live bridge to the model and
back (`UNOWN_OK`, exit 0). The changelog stop links it from the release
notes.

## What ships next

The queue recorded in `docs/SESSION.md` — the S2 ledger's head first, then
the injection-scanner classifier. Security rounds like this one are what
make the feature rounds safe to ship fast.
