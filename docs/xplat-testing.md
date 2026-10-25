# Xplat testing - the agent-drivable cross-platform lane

> **What this page is.** The driving manual for the two pieces of machinery
> an agent (or a human) uses to demand cross-platform verdicts on demand:
> [.github/workflows/xplat.yml](../.github/workflows/xplat.yml) (the
> dispatch-triggered workflow) and [scripts/xplat.mjs](../scripts/xplat.mjs)
> (the zero-dependency driver). Which scenario answers which question, the
> exact commands, the exit-code contract, where the evidence lands, and how
> to triage a red run without leaving the session.
>
> Companion pages: [testing strategy](testing-strategy.md) (which gate
> proves what, and the cadence contract this lane slots into),
> [install](install.md) (what the installer the smoke lane exercises actually
> does), [updating](updating.md) (the release feed the release-verify lane
> protects), [BEHAVIOR](BEHAVIOR.md) (the agent-behavior contract).

- [What it is](#what-it-is)
- [The quick reference](#the-quick-reference)
- [The scenarios](#the-scenarios)
- [The driver command reference](#the-driver-command-reference)
- [Driving patterns for the common situations](#driving-patterns-for-the-common-situations)
- [Exit codes and the verdict contract](#exit-codes-and-the-verdict-contract)
- [How dispatch finds its own run](#how-dispatch-finds-its-own-run)
- [Receipts and evidence](#receipts-and-evidence)
- [Failure triage](#failure-triage)
- [Choosing the lane local or remote](#choosing-the-lane-local-or-remote)
- [The gh CLI equivalents for humans](#the-gh-cli-equivalents-for-humans)
- [Limits budgets and etiquette](#limits-budgets-and-etiquette)
- [Security notes](#security-notes)

Related pages: [testing strategy](testing-strategy.md) · [install](install.md) · [updating](updating.md) · [troubleshooting](troubleshooting.md)

## What it is

`ci.yml` answers one question well: "does this **push** pass the gates?" It
is push/PR-triggered by design, which means a mid-session agent has no way to
ask the question it most needs answered — *"is this green on all three OSes
right now?"* — without committing something to find out. The xplat lane is
that way back: a `workflow_dispatch` surface over the **same test steps CI
runs**, dispatchable on any ref for any scenario, with machine-readable
receipts and an exit code an agent can branch on.

The lane is a pair:

- **The workflow** runs the scenarios. Its steps are the CI steps (same
  installer, same suites, same smokes, same Windows `shell: bash` /
  `env:`-block discipline ci.yml documents), reorganized under four scenario
  levels and receipt uploads. It is keyless like every CI lane: no secrets,
  no `BRIDGE_UPSTREAM_KEY`, nothing an agent could exfiltrate through it.
- **The driver** (`node scripts/xplat.mjs …`) fires dispatches, correlates
  them back to this invocation, watches them to a verdict, and pulls logs,
  junit XML and artifact receipts to `.run/xplat/`. It has zero dependencies
  (plain node >= 20, or bun), so it runs from any clone with nothing
  installed beyond the repo's own toolchain.

Two capabilities exist here that `ci.yml` structurally cannot offer:

1. **On-demand OS targeting.** `--os windows-latest` runs *only* the Windows
   leg — the debugging lane for "it works on Linux" defects. `--os
   macos-intel` runs the darwin-x64 gap leg on `macos-15-intel`: ci.yml's
   `macos-latest` is arm64-only, yet a `darwin-x64` archive ships in every
   release, so this is the only on-demand way to get an x64 macOS receipt.
2. **Boot-verified binaries before a release.** The `release-verify`
   scenario builds all six per-OS binaries and boots each on its own runner
   — including `windows-11-arm`, which [release.yml's](../.github/workflows/release.yml)
   own smoke matrix cannot cover and documents as shipped-untested.

## The quick reference

From the repo root, with the PAT already in the git remote (the default
clone) or `GITHUB_TOKEN` in the environment:

| Question you are asking | Command | Wall clock |
|---|---|---|
| "Did my engine change break anything anywhere?" | `node scripts/xplat.mjs dispatch --scenario smoke --watch` | ~6-9 min |
| "Same, but just Windows (it broke there)" | `node scripts/xplat.mjs dispatch --scenario smoke --os windows-latest --watch` | ~5-8 min |
| "Does the cross-cutting change survive the lifecycle gate?" | `node scripts/xplat.mjs dispatch --scenario core --watch` | ~9-13 min |
| "Is everything green before I tag a release?" | `node scripts/xplat.mjs dispatch --scenario full --watch` | ~15-25 min |
| "Do the release binaries build and boot?" | `node scripts/xplat.mjs dispatch --scenario release-verify --watch` | ~25-40 min |
| "Fast inner loop before any of that" | `node scripts/xplat.mjs local --scenario core` | ~4-6 min |
| "What ran recently / what is running?" | `node scripts/xplat.mjs runs` | seconds |
| "Show me why it went red" | `node scripts/xplat.mjs logs <runId> --failed-only` | seconds |

`--watch` is optional: without it, `dispatch` prints the run id and URL and
returns; `watch <runId>` is the polling half and can be run separately
(including from a different machine — correlation data lives in the run
name, not the shell).

## The scenarios

Levels escalate: every level runs everything below it. The catalog is
pinned by [scripts/xplat.test.mjs](../scripts/xplat.test.mjs) and rendered by
`node scripts/xplat.mjs scenarios`.

| Level | Scenario | What runs | Where |
|---|---|---|---|
| L1 | `smoke` | real installer (`bun scripts/install.ts`), engine unit suite (junit receipt), version consistency, CLI boot + surface + doctor smokes | the selected OS matrix |
| L2 | `core` | smoke + the integration suite (real server + mock bridge) + the full-stack lifecycle gate (boot, survive the launcher 20s, stop clean - the bun#31603 regression gate, all OSes) | all three OSes or the selected one |
| L3 | `full` | core + every gate `ci.yml` runs outside its matrix: lint-shell, eslint, typecheck, landing unit, changed-line coverage, docs links/anchors, instruction-chars, theme, palette + changelog/blog/benchmarks/claims contracts, bridge suite, gitleaks + `bun audit`, bwrap sandbox smoke, production build + standalone-server smoke, Playwright E2E + axe-core, mermaid byte-identity + brand overflow | matrix on all three OSes + the gate jobs on ubuntu |
| L4 | `release-verify` | the release path minus the publish: the builder plan + suites, the landing production build, **all six per-OS binaries** built by one ubuntu runner, the payload checks (planned === produced, installers staged, manifest generated + verified), then every archive downloaded, checksum-verified, extracted and **booted on its own runner** - including `windows-11-arm` and `macos-15-intel` | one build runner + a six-leg boot matrix |

Choosing between them is a cost/latency trade: smoke is the post-edit reflex,
core is the plumbing-change reflex, full is the pre-release reflex,
release-verify is the tag-reflex. An agent that runs `full` after every edit
is burning 25 minutes per iteration; one that runs only `smoke` before a
release is shipping unverified landing gates. The
[driving patterns](#driving-patterns-for-the-common-situations) section
resolves the common situations.

## The driver command reference

```
node scripts/xplat.mjs <command> [options]

scenarios                        print the scenario catalog
local    [--scenario s] [--keep-going]    run the scenario on THIS machine
dispatch --scenario s [--os o] [--ref r] [--watch] [--interval s] [--timeout s]
status   [runId|latest] [--json]           run + per-job breakdown (+ failed steps)
watch    [runId|latest] [--interval s] [--timeout s]
logs     [runId|latest] [--job substr] [--failed-only] [--out dir]
artifacts [runId|latest] [--download] [--out dir]
cancel   <runId>
rerun    <runId> [--failed]
runs     [-L 10]

scenarios: smoke | core | full | release-verify
os:       all | ubuntu-latest | macos-latest | macos-intel | windows-latest
```

Every command accepts `--repo owner/name` (default: the `origin` remote) and
reads the token from `XPLAT_GITHUB_TOKEN`, then `GITHUB_TOKEN`, then the PAT
embedded in the `origin` remote URL - the repo's standing convention that a
fresh clone can drive CI with zero configuration. `runId` can be the literal
`latest`, which resolves to the newest xplat run; `status`/`watch`/`logs`/
`artifacts` all accept it, so a resumed session does not need to remember
ids.

`local` runs the scenario's steps on this machine instead of GitHub's - the
inner loop. It resolves `bun` from `PATH` then `~/.bun/bin` (override with
`XPLAT_BUN`), expands the docs glob the way bash would (Windows `cmd`
doesn't), and stops at the first failing step unless `--keep-going` is
passed, in which case it tallies them all. The `full` local lane covers
everything that does not need a browser, gitleaks or a second architecture;
those lanes are dispatch-only (noted in
[choosing the lane](#choosing-the-lane-local-or-remote)).

## Driving patterns for the common situations

These are the recipes an agent should reach for. Each names the situation,
the command, and what to do with the result.

**After editing engine / pi-repo / hooks code.** Run
`node scripts/xplat.mjs local --scenario smoke` first - it is the same
suite the dispatch lane runs, minus the installer (your tree is already
installed), and it completes in ~3-4 minutes without spending a runner
minute. If it is green and the change touches only engine logic, dispatch
`smoke --watch` for the three-OS confirmation. Do not dispatch `core` unless
the change crosses a process boundary; the integration suite and the
lifecycle gate exist for exactly that class.

**A user reports "it works on Linux but breaks on Windows."** Dispatch the
single OS leg: `node scripts/xplat.mjs dispatch --scenario core --os
windows-latest --watch`. The Windows leg is where the class lives (pwsh
parsing, MAX_PATH, bun#31603 detach, netstat pid resolution), so target it
directly rather than paying for three runners. On red, pull the leg's logs:
`node scripts/xplat.mjs logs <runId> --failed-only` - the download lands in
`.run/xplat/logs/<runId>/` with one file per job, failed jobs only. The
known Windows failure classes and their fixes are catalogued in
[testing strategy §7.2](testing-strategy.md) (the per-platform residue
table); check the failing step's name against that table before inventing a
new hypothesis.

**A change to `scripts/start.ts` / `stop.ts` / the launcher or anything
that spawns services.** This is the `core` shape: the lifecycle gate (boot,
survive the launcher's exit by 20s, stop, ports go quiet) is the thing that
class of regression breaks, and it runs on all three OSes. `local --scenario
core` covers the suites, but the lifecycle gate itself is dispatch-only -
spawning and killing the stack from inside a driver process on your own
machine measures your machine, not the contract.

**Before tagging a release** (and after any change to
`build-artifacts.ts`, `release-manifest.ts`, the installers, or the release
workflow): dispatch `release-verify` FIRST, then `full`. Release-verify is
the lane that proves the six binaries compile and boot - including the
`windows-11-arm` archive the release workflow ships without a runtime smoke
and the `darwin-x64` archive ci.yml's arm64 matrix never touches. Only when
both are green does the tag deserve to exist. The local approximation
(`local --scenario release-verify` - the builder plan + the manifest suites)
is a 2-4 minute pre-flight, not a substitute: cross-compiling on one
machine proves nothing about booting on six.

**A landing-page or generator change** (`src/`, `scripts/landing_*.mjs`,
`content/blog`, `CHANGELOG.md`): the gates that matter (lint, typecheck,
unit, coverage, docs anchors, the changelog/blog/benchmarks/claims
contracts, E2E + axe, mermaid) are all `full`-scenario steps. Run
`node scripts/xplat.mjs local --scenario full` for the sub-10-minute inner
loop (the browser lanes excepted), then `dispatch --scenario full --watch`
before pushing to `main` if you want the full receipt. Remember the
standing rule that survives independently of this lane: after any push to
`main`, run `bun scripts/verify-deploy.mjs`.

**You dispatched, then realized the change was wrong mid-run.** Cancel it:
`node scripts/xplat.mjs cancel <runId>`. A cancelled run exits the watch
loop with code 2 (not 1 - a cancellation is not a verdict). Fix, then
`rerun <runId> --failed` if the fix only affects the legs that failed, or
dispatch fresh if it changes shared state.

**A run went red and you need the evidence.** Three commands, in the order
an agent should use them: `status <runId>` (which jobs, which steps - the
failed step names are printed inline), `logs <runId> --failed-only` (the
full logs of exactly those jobs, on disk), `artifacts <runId> --download`
(the junit XML and doctor receipts). The junit receipt names every failed
test; the log names the step that failed it. Anything else is reading tea
leaves.

**Resuming a session.** `node scripts/xplat.mjs runs` lists the recent
lanes with verdicts; `watch latest` attaches to the most recent one; the
run id is also in `.run/xplat/` (logs and artifacts are filed under it). A
run is never ambiguous: every dispatch mints a unique `run_id` that lands in
the run name (`xplat smoke · all · x…`), the receipt artifact names, and
the correlation the driver performs.

## Exit codes and the verdict contract

The driver's exit codes are the interface driving agents branch on:

| Code | Meaning | Typical cause |
|---|---|---|
| 0 | green | run succeeded / local steps passed |
| 1 | red | run failed / a local step failed / HTTP error after retries |
| 2 | cancelled | the run was cancelled, or no longer exists |
| 3 | infrastructure | `startup_failure` or `timed_out` - a runner/infra fault, retry before diagnosing code |
| 4 | usage | bad flags, unknown command |
| 5 | auth | 401/403 - the token cannot dispatch or read this repo |

The distinction between 1 (your change is red) and 3 (the runner hiccuped)
matters: a 3 deserves a `rerun --failed`, a 1 deserves a diagnosis.

## How dispatch finds its own run

The dispatch endpoint returns `204 No Content` - no run id in the response -
so the driver solves correlation itself. Every dispatch mints a short unique
`run_id` (e.g. `xmvns58gcbate5v`), passes it as the workflow's `run_id`
input, and the workflow's `run-name` embeds it (`xplat smoke · all ·
xmvns58gcbate5v`). The driver then polls the workflow's dispatch runs and
selects the run whose name carries the minted id **as a whole
`·`-separated segment** (a substring would match a foreign agent's id that
happens to prefix yours), created within the dispatch window on the
dispatched ref. The minted id also lands in every receipt artifact name, so
two agents dispatching simultaneously never read each other's results.

The driver first tries `return_run_details: true` on the dispatch call -
where the API supports it, the response carries the run id directly and no
polling happens. On a 400/422 it retries the plain dispatch, so the
correlation path is exercised on older API deployments regardless.

## Receipts and evidence

Every `test` job uploads a receipt artifact - `if: always()`, so red runs
still carry their evidence - named
`xplat-<scenario>-<os>-<run_id>`:

- `pi-repo/packages/self-learning/engine-junit.xml` - the engine suite as
  junit XML (per-test pass/fail/skip with timings; the header carries the
  totals). Parse it for failed-test names instead of scraping console
  output.
- `doctor-xplat.json` - the CI-context doctor output (which checks pass on
  a keyless runner and which are expected misses).

The `full` scenario additionally uploads the Playwright report + traces;
`release-verify` uploads the whole release payload (six archives,
installers, version.txt, release.json, checksums) for its boot legs to
consume. All receipts expire after 7 days - pull them with `artifacts
--download` if the evidence needs to outlive that.

## Failure triage

The order that converges fastest:

1. **Read the failed step names first** (`status <runId>` prints them).
   The lanes reuse CI's step names, and the failure classes they map to are
   already catalogued: Windows step-syntax classes in ci.yml's comments,
   per-platform residue in [testing strategy §7.2](testing-strategy.md).
2. **Pull the failing job's logs** (`logs <runId> --failed-only`) and read
   the last ~100 lines. The upload gives you one file per failed job,
   human-named.
3. **Check whether it is an infra fault** (exit 3 / `startup_failure` /
   `timed_out` / a cancelled-because-queued-too-long run). `rerun
   <runId> --failed` is the response; a repeated startup failure on one leg
   is a runner-image regression, not your change.
4. **Reproduce locally** with the `local` lane before pushing a fix - the
   suites are the same; if the local lane is green but one remote OS is
   red, the divergence is platform semantics (path separators, pwsh
   parsing, file locking, MAX_PATH), which is exactly the class the OS
   selector exists to bisect.
5. **Cancel rather than abandon** a doomed run - it frees the runners and
   keeps `runs` honest.

A red run is never deleted: it stays in `runs` with its verdict and its
receipts, which is the audit trail for "what was verified before the
release was tagged".

## Choosing the lane local or remote

The local lane is the inner loop: same suites, this machine, minutes, no
runner minutes spent. It cannot cover what needs another OS, a browser, or a
second architecture - so the honest table is:

| Need | Local | Remote |
|---|---|---|
| engine / bridge suites, version, CLI smokes | yes | yes |
| integration suite | yes | yes |
| the stack lifecycle gate | no | yes (core+) |
| another OS's verdict | no | yes (os selector) |
| landing gates (lint/typecheck/unit/coverage/docs/claims) | yes | yes (full) |
| E2E + axe, mermaid byte-identity | no (browser lanes) | yes (full) |
| gitleaks + audit | no | yes (full) |
| six-binary build + boot on six runners | plan + suites only | yes (release-verify) |

The dispatch lanes are the source of truth; a green local run raises
confidence but proves nothing about Windows or macOS. The
[cadence contract](testing-strategy.md) remains the arbiter of what must
run before what.

## The gh CLI equivalents for humans

Everything the driver does has a `gh` equivalent, which humans (and agents
with the CLI installed) may prefer:

```
gh workflow run xplat.yml --ref main -f scenario=core -f os=windows-latest -f run_id=<id>
gh run list --workflow xplat.yml --event workflow_dispatch
gh run watch <run-id> --interval 15 --exit-status --compact
gh run view <run-id> --log-failed
gh run download <run-id> -n <artifact-name> -D outdir
gh run cancel <run-id> ; gh run rerun <run-id> --failed
```

The driver exists because it is dependency-free (a fresh clone with no `gh`
auth can drive CI through the remote-embedded PAT), scriptable, and speaks
the exit-code contract above; `gh run watch --exit-status` gives humans the
same verdict semantics.

## Limits budgets and etiquette

- **Rate limits.** The REST API allows 5,000 requests/hour per PAT; `watch`
  polls every 15s by default (~240/h). The driver honors `Retry-After` and
  `x-ratelimit-reset` and waits rather than erroring. Keep the interval at
  15s or above; a 3s poll is 20x the cost for zero information gain.
- **Runner ceilings.** GitHub discards a dispatched run that is not picked
  up within its queue window; the driver's watch timeout (45 min default)
  sits above the slowest scenario (release-verify ~40 min) and below the
  ceiling. A queued run that never starts exits as infra, not failure.
- **Concurrency.** Dispatch runs never cancel each other or CI runs: the
  workflow's concurrency group is keyed by the agent's `run_id`, not the
  ref, and `cancel-in-progress` is off. Two agents may dispatch
  simultaneously; they will read different receipts.
- **Etiquette.** Public-repo runner minutes are free but not infinite: the
  os selector exists so a Windows question costs one runner, not three.
  Smoke is the reflex; full is the checkpoint; release-verify is the gate.
  Do not dispatch `full` in a fix-verify loop - run `local` between
  dispatches and let the remote lane confirm, not iterate.

## Security notes

The driver never prints the token and never writes it anywhere but the
`Authorization` header. It resolves credentials in the order
`XPLAT_GITHUB_TOKEN` (a dedicated driver token, if you keep one scoped to
`Actions: read/write` only), `GITHUB_TOKEN`, then the PAT embedded in the
`origin` remote URL - which means the minimum viable token for driving this
lane is **Actions read/write only**: dispatch, status, logs, artifacts,
cancel, rerun. Pushing to a protected branch or creating releases (things
this driver does not do) needs wider permissions and is deliberately out of
its scope. The workflow side is keyless like every CI lane - no secrets, no
upstream key - so a compromised dispatch input can at worst spend runner
minutes running the repo's own test suites.
