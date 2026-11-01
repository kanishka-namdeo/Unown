# The Dependency Round — research and decisions (2026-11-01)

> **Purpose.** The 2026-11-01 sweep of every applicable package surface for
> safe updates: what moved, what stayed and why, the breaking-change research
> behind each bump, and the verification method that proved "no regression"
> for the one update with visual-behavior potential. Receipts and the
> checkpoint-by-checkpoint narrative live in
> [the session log](dependency-round-session.md).

- [The question](#the-question)
- [What moved](#what-moved)
- [What stayed, and why](#what-stayed-and-why)
- [Breaking-change notes](#breaking-change-notes)
- [The framer-motion visual A/B](#the-framer-motion-visual-ab)
- [Lockfile findings](#lockfile-findings)
- [The audit state](#the-audit-state)
- [The parked queue](#the-parked-queue)

Related pages: [the session log](dependency-round-session.md) ·
[updating](updating.md) (the product's own updater — a different surface) ·
[testing strategy](testing-strategy.md) ·
[the release-recovery round](release-recovery-session.md) (the release
discipline this round inherits)

## The question

"Safely update all applicable packages and ensure no regression" resolves
into four sub-questions, each answered below:

1. Which package surfaces exist, and which are *applicable* for routine
   updates under this repo's own policy?
2. For each applicable package, what is the newest version inside the
   allowed policy (no semver-major bumps; exact pins move as deliberate
   exact bumps; the playwright trio moves in lockstep)?
3. What do the release notes of each candidate bump say about breaking
   changes, and where does this repo's code actually touch those APIs?
4. How is "no regression" *proven* — not asserted — for the runtime-facing
   bumps?

The method: an `npm view` sweep of all 28 root packages plus
`bun outdated` against the real lockfile (bun 1.4.3, CI's pin), release-note
research for every significant range, and — for framer-motion — an A/B
pixel-diff of the rendered landing page between the old and new dependency
trees. Nothing below is hand-waved; every "at latest" claim was answered by
the registry on 2026-11-01.

## What moved

| Package | From | To | Kind | Risk |
|---|---|---|---|---|
| next | 16.4.2 | 16.4.3 | in-range refresh (^) | low — LTS-active backport bugfixes only |
| eslint-config-next | 16.4.2 | 16.4.3 | in-range refresh (^) | low — only delta is the bundled `@next/eslint-plugin-next` |
| marked | 18.1.1 | 18.1.2 | in-range refresh (^) | low — CommonMark fixes; blog regeneration byte-identical |
| eslint | 10.13.0 | 10.14.0 | exact-pin bump | low — fix/docs-only release |
| lucide-react | 1.61.0 | 1.66.0 | exact-pin bump | low — additions; no icon this repo imports was renamed or redesigned |
| framer-motion | 14.6.0 | 14.9.0 | exact-pin bump | medium — motion-behavior changes; proven no-regression by pixel diff |

69 transitive packages floated along inside their already-declared ranges
(the `typescript-eslint` minors under `eslint-config-next`, the Next
toolchain under `next`); the `bun.lock` diff was reviewed with the manifest
diff, not blindly.

## What stayed, and why

- **No semver-major bumps anywhere.** Root policy
  (`.github/dependabot.yml`): "The dashboard runs pinned majors by policy
  (next 16, react 19) — let humans opt into majors explicitly." The only
  major available anywhere in the root tree is TypeScript 7.0.2 — parked
  (below).
- **`pi-repo/` is frozen.** The vendored pi-mono workspace is an
  upstream-sync decision, not a routine bump surface: its own AGENTS.md
  pins direct external deps to exact versions (`check:pinned-deps`
  enforces it), lockfile commits are gated by `PI_ALLOW_LOCKFILE_CHANGE=1`,
  and the Dependabot stream for it is monthly, limit 1, labeled
  `upstream-sync`. No pi-repo manifest or lockfile was touched by this
  round.
- **`benchmarks/` fixtures stay.** `nonllm`'s `@huggingface/transformers`
  4.3.1 is the encoder the H9 latency receipts were measured with — a bump
  is a re-run decision. `edit-bench`'s `diff`/`prettier` ranges are part of
  the benchmark's measurement environment; its receipts stay comparable
  only if the environment does not move under them.
- **At latest within policy (verified against the registry, 2026-11-01):**
  react / react-dom 19.3.1, tailwindcss + @tailwindcss/postcss 4.3.3,
  sharp 0.35.5 (no 0.36 exists), happy-dom + @happy-dom/global-registrator
  21.0.4, @axe-core/playwright 4.14.0, bun-types 1.4.4 (types one patch
  ahead of the CI bun 1.4.3 runtime — acceptable), z-ai-web-dev-sdk 0.0.18
  (a `^0.0.x` caret is a pin; future bumps need manifest edits),
  @radix-ui/react-accordion 1.3.1, clsx 2.1.1, fuse.js 7.5.0,
  tailwind-merge 3.7.0, @testing-library/react 16.3.3, @types/react +
  @types/react-dom 19.3.0, tw-animate-css 1.4.0.
- **The playwright trio stays 1.64.1.** 1.65.0 exists only as alphas. When
  it ships stable, the bump is one lockstep PR for `@playwright/test` +
  `playwright` + `playwright-core` (exact pins) plus the CI browser
  refresh.
- **GitHub Actions ride their own weekly Dependabot lane** (limit 3,
  `chore(ci)`). State on 2026-11-01: everything current except
  `step-security/harden-runner` (one patch behind) and the known majors
  `github/codeql-action` v4 and `actions/download-artifact` v8 — both
  out of this lane's authority, reported for the humans.

## Breaking-change notes

- **next 16.4.2 → 16.4.3** ([release](https://github.com/vercel/next.js/releases/tag/v16.4.3),
  2026-10-23): explicitly backported bugfixes — extensionless Google font
  URLs, proxy.ts runtime loading, a Turbopack loader-invalidation revert,
  OpenTelemetry trace grouping, standalone React in server bootstrap. No
  breaking changes; peer ranges satisfied.
- **eslint 10.13.0 → 10.14.0** ([changelog](https://github.com/eslint/eslint/blob/main/CHANGELOG.md)):
  fix/docs-only — `no-restricted-globals` crash, LS/PS/hashbang comment
  handling, `no-invalid-this` accessor crash, two autofix corrections, and
  the `minimatch` 10.2.6 hard-pin (the brace-expansion advisory fix). No
  new rules, no config-format change.
- **framer-motion 14.6.0 → 14.9.0** ([changelog](https://github.com/framer/motion/blob/main/CHANGELOG.md)):
  no semver-breaking changes; the behavior items that touch this repo's
  surface — `AnimatePresence` popped-element positioning (14.7.0),
  background-color animations moved to the main thread (14.7.0),
  accelerated animations stuck at `initial` after remount (fixed,
  14.8.0), `layoutId` animating relative to the closest `layoutRoot`
  (14.7.0). This repo uses `AnimatePresence mode="wait"` (loop),
  `motion.span` fade-rise (finale), `reducedMotion="user"` (shell) — no
  `Reorder`/`drag`/`layoutId`/`useScroll`. Judged by pixel diff, below.
- **lucide-react 1.61.0 → 1.66.0** ([releases](https://github.com/lucide-icons/lucide/releases)):
  per-icon export shims (1.62), `archive-restore` → `archive-arrow-up`
  rename (1.63), currency-icon cap-height realignment (1.64), metadata
  (1.65), `*-letter-p-off` redesigns (1.66). The repo's imports
  (ChevronDown, Brain, Compass, ExternalLink, FlaskConical, Layers,
  Repeat, ShieldCheck, Swords, Target, Check, Copy, Pause, Play,
  RotateCcw, MoveRight, ArrowRight, ArrowUpRight) intersect none of those.
- **marked 18.1.1 → 18.1.2** ([release](https://github.com/markedjs/marked/releases/tag/v18.1.2)):
  CommonMark compliance fixes (type-6 HTML blocks, emphasis flanking,
  blockquote continuation, nested image alt) + ~16% faster parsing. The
  blog generator was re-run under it: all 37 posts and the feed rendered
  **byte-identical** — the compliance fixes do not alter this corpus.

## The framer-motion visual A/B

The VLM design-review pass (`scripts/agnes_review.mjs`, the Agnes lane)
returned mixed verdicts on the updated page — but it had been briefed to
look for framer-motion regressions, and its concrete claims (half-finished
reveals "mid-transition" in `prefers-reduced-motion` screenshots, where
nothing transitions) did not survive scrutiny. Pixel evidence replaced the
opinion:

1. `scripts/landing_shots.mjs` (the landing AGENTS.md's mandatory visual
   pass) shot all 22 sections in both schemes plus the 3 reduced-motion
   sections, against the production standalone build — twice on the new
   tree (the noise floor) and once on the old tree (the pre-round
   lockfile, rebuilt).
2. A per-pixel diff (tolerance 8/channel) compared the passes.

| Comparison | Result |
|---|---|
| same build, two passes (noise floor) | 22/25 images pixel-identical; 3 differ only in the live star-count / animated-terminal regions (0.006–0.143% of pixels) |
| new tree vs old tree | 21/25 images pixel-identical; the 4 differing images differ in **the same dynamic regions** the noise floor identified; mean channel deltas 9–165 in ≤0.113% of pixels |
| reduced-motion lane (deterministic) | **3/3 pixel-identical, 0 differing pixels** |

Settled rendering is unchanged by framer-motion 14.9.0. The shot pass also
asserted both palettes resolve (`--color-canvas` dark and light) and
recorded zero browser console errors across all 25 frames. One incidental
receipt: the palette assert once refused to photograph the page — a stale
`next-server` process was serving the previous build's chunk names (CSS
HTTP 500). The assert did exactly what it is designed to do: refuse to
call a broken stylesheet "covered".

## Lockfile findings

- bun 1.4.3 (CI's pin) **preserves** the root `bun.lock`'s
  `lockfileVersion: 1` in place through `bun update`/`bun install` —
  verified before and after every stage. The documented lockfile-downgrade
  incident class (a sub-1.4 bun rewriting the lock) was kept out of play
  by upgrading the sandbox's bun 1.3.14 → 1.4.3 before any install.
- Two stale comments were corrected in this round:
  `.github/dependabot.yml` claimed the root lock is "lockfileVersion 3
  from bun 1.4.3" (it is v1 — pi-repo's is the v3 one; Dependabot's own
  bun writer maintains the v1 shape), and `ci.yml`'s frozen-install step
  still said "brings in playwright@1.57" (the lock pins 1.64.1).
- Manifest and lock moved in the same commits, as CI's
  `bun install --frozen-lockfile` requires; a post-update frozen install
  was re-run locally as part of the xplat smoke lane.

## The audit state

`bun audit --prod` (CI's security gate) is clean on the new tree —
"No vulnerabilities found (checked 79 packages)", from 82 at baseline
(the next 16.4.2 → 16.4.3 transitive graph is marginally smaller). The
one open advisory in the *dev* graph — `minimatch` 10.2.6 (GHSA
"potential DoS via globparts amplification", via `eslint >
@eslint/config-array`) — is not fixable in-range: `@eslint/config-array`
wants `^10.2.4` and the fix is in 11.0.1; eslint 10.14.0 itself hard-pins
minimatch at the fixed-for-the-previous-advisory 10.2.6. Dev-only
exposure, tracked until upstream publishes; it does not gate this repo's
`--prod` audit.

## The parked queue

- **TypeScript 7.0.2** — the native-port major
  ([announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)):
  a human opt-in decision (tsc output compatibility, editor LSP rollout,
  typescript-eslint under the new compiler), not a routine bump. 6.0.3 is
  the newest 6.x; nothing to do within policy.
- **Playwright 1.65.0** — alpha-only today; the lockstep bump is
  pre-written above for when it ships.
- **`step-security/harden-runner` v2.22.3** — one patch behind; rides the
  weekly `chore(ci)` Dependabot stream like every actions update.
- **A standing reminder this round institutionalized**: `bun outdated` is
  the truth-teller for a mixed pinned/caret manifest — a plain
  `bun update` moves only the caret half and silently leaves every exact
  pin (10 of them here) in place.
