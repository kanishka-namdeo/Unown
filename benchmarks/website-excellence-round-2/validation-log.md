# The Website Excellence Round 2 — the validation log

> The failure → learning ledger for the second Website Excellence round
> (2026-10-30 →): every significant failure gets an entry — description,
> reproduction, root cause, impact, the benchmark created, the fix
> implemented, and the validation evidence. No failure is resolved until a
> previously failing benchmark passes. F-numbers continue from the first
> round's ledger (`../website-excellence-round/validation-log.md`, F1–F20).

- [F21 — the release that shipped while its own CI was red](#f21--the-release-that-shipped-while-its-own-ci-was-red)
- [F22 — the encore round's growth breached the scroll-budget ceiling it claimed to hold](#f22--the-encore-rounds-growth-breached-the-scroll-budget-ceiling-it-claimed-to-hold)
- [F23 — a hosted-runner DNS blip red all of main's CI](#f23--a-hosted-runner-dns-blip-red-all-of-mains-ci)
- [F24 — the landing's HP bars animated width, and the first gallery app shipped transition-all](#f24--the-landings-hp-bars-animated-width-and-the-first-gallery-app-shipped-transition-all)

---

## F21 — the release that shipped while its own CI was red

**Failure.** The v0.0.42 release (`367b9f32`, 2026-10-29) was cut, tagged
and published while the CI run for the very same commit had FAILED — its
`E2E + a11y (landing)` job red on the scroll-budget breach (F22 below),
its `Build + test (macos-latest)` job red on a DNS blip (F23 below). The
release notes claimed "all gates green (2041 unit, 15 e2e, every check:*
lane)". The Release workflow ran its own assertion suites (which passed)
and published; nothing in it looked at the CI workflow's conclusion.

**Reproduction.** API receipts (this round, 2026-10-30):

```
GET /repos/…/actions/runs?head_sha=367b9f32…
  40924727511 | CI          | failure   ← the tagged commit's CI, red
  40924796128 | Release     | success   ← the release published anyway
```

The mid-round commits (`3166ce70`, `8428f1b6`, `3d20001e`) show
`cancelled` CI runs — the encore round pushed faster than CI could
finish (the workflow's `concurrency: cancel-in-progress: true` cancels
superseded runs), so the round's "gates green" claims were never tested
against the commits that shipped.

**Root cause.** Process defect, and it lives in the Release workflow:
`release.yml` triggers on tags (`on: push: tags`) and never consults the
CI workflow's conclusion for the tagged SHA. The two lanes are
deliberately separate workflows — but that separation means a tag can be
cut from a commit whose CI has failed or is still in flight. The
release's own verification matrix is narrower than CI's (it does not run
the landing e2e lane at all), so "release assertion green" is not
evidence that "CI green".

**Impact.** A release whose landing page failed its own scroll-budget
and a11y gates went out as "green"; the deploy-verify workflow then
correctly reported "main's CI was failure and Vercel deploys main on
push — production may be serving a commit that failed its own gates",
and main's badge stayed red for every subsequent push until the breach
was fixed.

**Fix implemented.** `release.yml` gains a first job — `ci-green` —
that every downstream job needs: it resolves the CI run for the tagged
SHA through the GitHub API (waiting while CI is queued or running,
bounded at 40 minutes) and fails the release unless CI's conclusion is
`success`. A tag on a commit never pushed to main (no CI run can exist)
fails the same gate after the bounded wait.

**Benchmark / regression net.** The gate is its own benchmark: any
future tag cut from a red or in-flight CI commit fails the `ci-green`
job and produces no artifacts. Verified in this round by inspecting the
job graph: `verify → needs: ci-green`, `build → needs: verify`,
`smoke-artifacts → needs: build`, `publish-release → needs: [build,
smoke-artifacts]`.

---

## F22 — the encore round's growth breached the scroll-budget ceiling it claimed to hold

**Failure.** The landing page measured **3,762 readable words against
the 3,750 ceiling** (15.1vh, inside the vh ceiling) at the finished
replay state — reproducibly, in this round's fresh clone AND in the
v0.0.42 release's own CI logs (`scroll budget @900px viewport: page
15.1vh, 3762 words`, run 40924727511, job `E2E + a11y (landing)`).

**Reproduction.**

```
bun run build && bun .next/standalone/server.js &   # :3000
bun scripts/landing_audit.mjs        # 15.1vh, 3,762 words, no WARN
bunx playwright test e2e/landing-budget.spec.ts     # 3762 words > 3750
```

**Root cause.** The encore round added the eighth gallery app (switcher
tab + receipt chips ≈ 25 words of data chrome) plus the 0.0.42 rail
stop (~30 generated words) on top of the fifth amendment's 3,707-word
baseline: +55 words of contract-protected growth against a ceiling set
3,750 with ~43 words of headroom. The round compressed the gallery lede
by a few words, claimed "the scroll budget holds at eight apps" in its
commit message, and pushed fast enough that the CI runs that would have
falsified the claim were cancelled (see F21). The claim was recorded,
not measured.

**Impact.** Main's CI red on every push from the release until the fix;
the deploy-verify cascade failure; a false "all gates green" in the
release notes.

**Fix implemented.** The repo's own scheduled routine fixed it within
the hour (sessions `e13-fix*`, commit `989205c7`): the built-improved
lede compressed 17 words ("The gallery the rounds built (Encore, the
eighth app) — minted, remembered, proved: receipts first."), keeping the
test-pinned `(Encore, the eighth app)` fragment — no generated number
touched, ceiling unchanged at 3,750. This round verified the fix
end-to-end (15/15 e2e green on `989205c7`'s CI).

**Benchmark / regression net.** The existing twin gates
(`scripts/landing_audit.mjs --budget` + `e2e/landing-budget.spec.ts`)
ARE the net — they caught it; the process failure was shipping anyway,
which is F21's half and is closed by the release gate.

---

## F23 — a hosted-runner DNS blip red all of main's CI

**Failure.** The `Build + test (macos-latest)` job of the CI run for
`e52664fe` failed at the `Smoke — CLI surface` step:
`unown update --check` exited 1 with
`fatal: unable to access 'https://github.com/kanishka-namdeo/Unown/': Could not resolve host: github.com`
— while the identical step passed on ubuntu and windows in the same run.

**Reproduction.** The CI logs (run `40931768114`, job
`Build + test (macos-latest)`): the failure text above, timestamped
`18:40:00`, one transient window. A local re-run of
`bun bin/unown update --check` succeeds.

**Root cause.** Infra flake, not a repo defect: a macOS runner's
transient DNS failure. But the step's contract turns it into a repo
defect: exit 1 ("offline/broken remote") fails the step hard with zero
tolerance for the documented flakiness class of hosted runners. The
other two OSes passing the same step at the same minute is the receipt
that the remote was fine.

**Impact.** A green-otherwise push reports red CI — which both blocks
honest status reading and (post-F21) would block a release on a flake.

**Fix implemented.** The smoke step now retries `update --check` once
(15s backoff) when it exits 1, and fails only if both attempts fail.
Two strikes still fail; exits {0, 2} remain accepted as before.

**Benchmark / regression net.** The retry is deliberately bounded (one
retry, one sleep) so a genuinely-broken remote still fails — the same
step on a genuinely offline network fails twice in ~16s. The
ubuntu/windows legs of the same matrix act as the control for any
future mac-only network claim.

---

## F24 — the landing's HP bars animated width, and the first gallery app shipped transition-all

**Failure.** The craft axes' first run against the real landing found
the animated-property whitelist violated from both directions: the
landing's `.gb-hp > i` (the dex/benchmark HP bars) transitioned `width`
(a layout property — `transition: width 400ms steps(12, end)`), and four
hand-written `transition-all` usages shipped in the vendored accordion
plus the FIRST gallery app's components (focus-timer, task-card, header).

**Reproduction.** `node scripts/design_critic.mjs --route / --label
craft-smoke --no-vlm` at `f5b3290f`: `anim: 16 layout props +
transition:all` (the 16 included Tailwind v4's individual `translate`/
`scale`/`rotate` — compositing, initially misclassified — plus the real
`width`, `height` from tw-animate's radix accordion keyframes, and the
discrete `display`/`overlay`/`pointer-events` steps; `usesAll: true`).

**Root cause.** The bars predate the rule: `width` is the naive fill
level, and `transition-all` is the lazy transition — both were
acceptable patterns when those components were written (the sigil app is
the FIRST gallery app) and nothing measured animated properties before
this round's craft axes existed.

**Fix implemented.** The HP fill now rides `scaleX(var(--fill))` with
`transform-origin: left` on a full-width element (identical stepped
drain, compositor-only); framer's mount effect on the benchmark bars
moved from scaleX (which now carries the level) to `clip-path` inset
wipe (paint-only). The four `transition-all`s became explicit property
lists (`transition-[transform,border-color,box-shadow]` etc.).

**Benchmark / regression net.** The craft axes themselves: `animLayoutProps
≤ 0` (the whitelist now correctly classifies Tailwind v4's individual
transforms, discrete steps, and the radix accordion `height` exception —
documented in the rubric) and `usesAll` flagged. The post-fix receipt
(`craft-landing`, committed): `anim: 0 layout props · prm guard true`,
and the known-bad calibration fixture still FAILS the weight gate (700
detected) — the axis discriminates both ways.
