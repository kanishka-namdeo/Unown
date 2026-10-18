# Updating Unown

How to move an installed Unown to a newer release — `unown update`, update notifications, pinned installs, rollback, and the privacy model of the update check.

- [The one command](#the-one-command)
- [Check without updating](#check-without-updating)
- [What `unown update` does](#what-unown-update-does)
- [Update notifications](#update-notifications)
- [Pinned installs and specific versions](#pinned-installs-and-specific-versions)
- [Rollback](#rollback)
- [Offline, air-gapped and CI use](#offline-air-gapped-and-ci-use)
- [Privacy](#privacy)
- [Troubleshooting](#troubleshooting)

Related pages: [usage](usage.md) · [configuration](configuration.md) · [quickstart](quickstart.md) · [troubleshooting](troubleshooting.md)

## The one command

```bash
unown update
```

That is the whole update story for a normal install. Unown is installed as a git checkout (clone + `bun run agent:install`) with the `unown` shim pointing into that checkout, so updating is a git operation, not a package-manager one: `unown update` fetches the release tags from your `origin`, fast-forwards the checkout to the newest release tag, and re-runs the installer (dependencies, engine build, `.env` bootstrap — never overwriting an existing `.env` — and the PATH shim). A version move looks like:

```
· rebuilding (v2.1.0) — dependencies, engine, PATH shim…
✓ unown updated: 2.0.0 → 2.1.0
```

Restart any running unown sessions (and `bun run agent:start` if the stack is up) to pick up the new build; the running process is never hot-swapped — the same restart rule Claude Code, Aider and Gemini CLI apply.

## Check without updating

`unown update --check` never mutates anything — it runs a read-only `git ls-remote` against your remote and compares the newest `v*` tag with the version in your checkout's `package.json`.

| State | Exit code |
|---|---|
| Up to date | `0` |
| Update available | `2` |
| Error (offline, no remote, not a checkout) | `1` |

`unown update --check --json` prints a machine-readable result (scriptable; safe to wire into cron or a CI readiness gate):

```json
{
  "current": "2.0.0",
  "latest": "2.1.0",
  "available": true,
  "remoteUrl": "https://github.com/kanishka-namdeo/Unown.git",
  "checkedAt": "2026-10-18T09:07:16.109Z",
  "error": null
}
```

The `remoteUrl` is printed credential-free — an access token embedded in your git remote URL is stripped before anything reaches stdout or a state file.

## What `unown update` does

In order: resolve the checkout (`git rev-parse --show-toplevel`), refuse to proceed over uncommitted changes, fetch release tags (`git fetch origin --tags --prune`), pick the target, apply, rebuild, verify.

The safety rules, and why each exists:

| Rule | Reason |
|---|---|
| Dirty tree → refuse (unless `--allow-dirty`) | Never update over uncommitted work. `--allow-dirty` uses git's own `merge --autostash`, so local edits are stashed and restored around the update. |
| Fast-forward only (`git merge --ff-only <tag>`) | The new release must strictly contain your current history. No merge commits, no rebasing your work in the background. |
| Local commits not on the remote → refuse | The update would strand them; push or rebase first, then retry. |
| Half-pushed tags are never offered | A tag whose `package.json` disagrees with the tag name is skipped — you cannot be updated "into" a broken release. |
| Pre-update SHA recorded before anything moves | `~/.unown/update-state.json` gets `{from, to, fromSha}` first — this is what `unown update --rollback` restores. |
| Post-update rebuild failure → automatic rollback | If `bun scripts/install.ts` fails or the version verify fails, the checkout is reset to the recorded SHA and the old build is restored. You end up where you started, with a red exit code. |
| Version verify after applying | The root `package.json` must now declare the new version — catches shadowed checkouts and corrupted installs (the anti-shadowing rule Gemini CLI applies). |

A successful update prints the changelog slice for the versions you crossed (`CHANGELOG.md`, Keep a Changelog shape) and the release-notes URL.

## Update notifications

Interactive sessions (`unown` in a TTY) show a one-line notice when a newer release exists:

```
⚠ update available: unown 2.0.0 → 2.1.0
  run `unown update` · notes: https://github.com/kanishka-namdeo/Unown/releases/tag/v2.1.0 · silence: export NO_UPDATE_NOTIFIER=1
```

The mechanics follow the ecosystem-standard update-notifier pattern (npm's `update-notifier`, Codex's `version.json`, Aider's versioncheck):

- **Never blocks startup.** The check runs in a detached background process; your session reads a 24-hour cache (`~/.unown/update-check.json`) and the *next* run may show the notice.
- **The cache lives in `~/.unown`**, never inside the repo — the notice can never dirty your working tree.
- **The background check is `git ls-remote --tags --refs origin v*`** — read-only against the remote, nothing local is touched (safe while the agent itself is using git in the checkout). No GitHub API is called, so there is no rate limit and private/self-hosted remotes work with your existing git credentials.
- **Suppressed when**: not a TTY, `CI` is set, or any of the opt-outs below are set.

`unown doctor` reports the cached check state (version, short SHA, checkout path, last check age) — it never performs the network check itself.

## Pinned installs and specific versions

A checkout with a detached HEAD (e.g. `git checkout v2.0.0`) is a **pinned install** — `unown update` refuses to move it implicitly:

```
unown: HEAD is detached at v2.0.0 — a pinned install.
  update explicitly with:  unown update <version>
```

`unown update 2.1.0` moves any install — pinned or not — to exactly that version, in both directions (this is also the manual downgrade path). Moving to an older version is always an explicit request; the automatic path only ever moves forward.

## Rollback

```bash
unown update --rollback
```

Restores the commit recorded by the last update (`~/.unown/update-state.json`), rebuilds, and verifies the version. Works only when the tree is clean — rollback never discards your work. `unown update <older-version>` does the same thing by name when the recorded state is gone.

## Offline, air-gapped and CI use

- The check fails silently offline (exit 1 for `--check`, nothing shown at startup); nothing is mutated, so an offline machine simply never sees a notice.
- `UNOWN_DISABLE_UPDATES=1` hard-blocks **every** update path — `unown update`, `--check`, and the background check all refuse or no-op. This is the organization/CI kill switch (the equivalent of Claude Code's `DISABLE_UPDATES`).
- Air-gapped installs update by the manual path: mirror the repo, point `origin` at the mirror, and `unown update <version>` works entirely against it.
- In scripts, gate on the exit code: `unown update --check; [ $? -eq 2 ] && unown update`.

## Privacy

The update check is the only thing Unown ever phones home for, and it is a plain `git ls-remote` against **your own remote** — the same operation a `git fetch` performs, carrying no identifiers, no counters, no user data. There is no telemetry of any kind. Opt out of the background check with any of:

| Variable | Effect |
|---|---|
| `NO_UPDATE_NOTIFIER=1` | Silence the startup notice + background check (ecosystem-standard name, same semantics npm's update-notifier uses). |
| `UNOWN_DISABLE_AUTOUPDATE=1` | Same — the Unown-native spelling. Manual `unown update` still works. |
| `DO_NOT_TRACK=1` | The standard nonessential-traffic opt-out; counts as a no for the background check. |
| `UNOWN_DISABLE_UPDATES=1` | Blocks all update paths including manual ones. |

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `unown: this install is not a git checkout` | The CLI is running from a layout without `.git` — re-clone and re-run `bun run agent:install`. |
| `unown: the checkout has uncommitted changes` | Commit or stash, or accept autostash with `unown update --allow-dirty`. |
| `unown: this checkout has N local commit(s) not on the remote` | Your work would be stranded — push or rebase onto `origin` first. |
| `unown: cannot fast-forward HEAD` | The checkout diverged from release history — resolve manually, or pin to an explicit version. |
| `unown: version X not found — available: …` | Typo or a tag your remote lacks; the message lists the known-good releases. |
| `unown: update check failed` | Offline, no `origin`, or an unreachable remote — see [troubleshooting](troubleshooting.md). |
| Notice shows a version that `--check` does not | The notice reads a 24h cache; run `unown update --check` to refresh it. |
