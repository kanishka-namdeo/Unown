# Updating Unown

How `unown update` works in both install modes — source checkout and standalone binary — with the guards, exit codes, state files, rollback, notifications and privacy model.

- [The one command](#the-one-command)
- [Which install mode am I in](#which-install-mode-am-i-in)
- [Check without updating](#check-without-updating)
- [Checkout updates](#checkout-updates)
- [Binary updates](#binary-updates)
- [Update notifications](#update-notifications)
- [Pinned installs and specific versions](#pinned-installs-and-specific-versions)
- [Rollback](#rollback)
- [Offline, air-gapped and CI use](#offline-air-gapped-and-ci-use)
- [Privacy](#privacy)
- [Troubleshooting](#troubleshooting)

Related pages: [install](install.md) · [usage](usage.md) · [configuration](configuration.md) · [quickstart](quickstart.md) · [troubleshooting](troubleshooting.md)

## The one command

```bash
unown update
```

That is the whole update story in both modes. What it does depends on how this `unown` was installed:

- **Source checkout** — a git operation: fetch release tags from `origin`, fast-forward the checkout to the newest ready release tag, then re-run `bun scripts/install.ts` (dependencies via `bun install --frozen-lockfile`, engine build, `.env` bootstrap — never overwriting an existing `.env` — and the PATH shim).
- **Binary** — a verified download: read the release's `version.txt`, download that release's archive and `sha256sums.txt`, verify the exact SHA-256 and `unown --version`, then atomically activate the new versioned directory and rewrite the shim and `install.json`. No git, no bun, no build step.

A move looks like:

```
· rebuilding (vX.Y.Z) — dependencies, engine, PATH shim…
✓ unown updated: <current> → <target>
```

or, in binary mode:

```
· installing unown vX.Y.Z (binary, <platform>)…
· downloaded XX.X MiB
· checksum verified
· verified unown --version = X.Y.Z
✓ unown updated: <current> → <target>
```

**Restart any running unown sessions** after an update — the running process is never hot-swapped. In a source checkout, a running engine keeps executing the old build until you restart it (`unown engine restart`); `unown update` says so when it detects one.

## Which install mode am I in

`unown doctor` prints a `unown version` line that ends in `binary install · <root>` for a binary install, or the checkout path and short SHA for a source install. `unown info --json` exposes the same as an `install` object with `mode`, `root`, `bin`, `shim` and `platform`.

Internally the mode is resolved in this order:

1. the running executable is inside `<root>/versions/<version>/unown[.exe]` → binary
2. `UNOWN_INSTALL_ROOT` is set (the binary shim's marker) or this is a compiled binary → binary
3. `git rev-parse --show-toplevel` from the CLI module finds a checkout → source
4. `~/.unown/install.json` (a stale record after the shim moved) → its recorded mode
5. otherwise the command stops with "cannot determine how this unown was installed"

`install.json` is written by both install paths (`scripts/link.ts` records a checkout; the binary installer and updater record a binary install), so a moved or copied shim still has a mode to fall back on.

## Check without updating

`unown update --check` never mutates anything:

| Mode | How it checks |
|---|---|
| Source checkout | read-only `git ls-remote --tags --refs origin v*` against your remote; nothing local is touched, so it is safe while the agent itself is using git in the checkout |
| Binary | `GET <release-base>/latest/download/version.txt` — no git, no GitHub API |

Both compare the newest release with the running version and share the exit codes:

| State | Exit code |
|---|---|
| Up to date | `0` |
| Update available | `2` |
| Error (offline, no remote, unreachable release feed) | `1` |

`unown update --check --json` prints one machine-readable object:

| Field | Meaning |
|---|---|
| `current` | the running version (`unknown` for a hand-extracted binary with no metadata) |
| `latest` | the newest release, or `null` on error |
| `available` | whether `latest` is newer than `current` |
| `remoteUrl` | the git remote (checkout; credential-free) or release base (binary) |
| `checkedAt` | when this check ran |
| `error` | `null`, or the failure message |
| `mode` | `binary` (binary mode only; checkout output omits it) |

For a checkout, the `remoteUrl` is credential-free — an access token embedded in a git remote URL is stripped before anything reaches stdout or a state file.

## Checkout updates

In order: resolve the checkout, refuse to proceed over uncommitted changes, fetch release tags (`git fetch origin --tags --prune`), pick the target, apply, rebuild, verify.

The safety rules, and why each exists:

| Rule | Reason |
|---|---|
| Dirty tree → refuse (unless `--allow-dirty`) | Never update over uncommitted work. `--allow-dirty` uses git's own `merge --autostash`, so local edits are stashed and restored around the update. |
| Fast-forward only (`git merge --ff-only <tag>`) | For an automatic move the new release must strictly contain your current history. No merge commits, no rebasing your work in the background. |
| Local commits not on the remote → refuse | The update would strand them; push or rebase first, then retry. |
| Half-pushed tags are never offered | A tag whose `package.json` disagrees with the tag name is skipped — you cannot be updated "into" a broken release. |
| Pre-update SHA recorded before anything moves | `~/.unown/update-state.json` gets `{from, to, fromSha}` first — this is what `unown update --rollback` restores. |
| Post-update rebuild failure → automatic rollback | If `bun scripts/install.ts` fails or the version verify fails, the checkout is reset to the recorded SHA and the old build is restored. You end up where you started, with a red exit code. |
| Version verify after applying | The root `package.json` must now declare the new version — catches shadowed checkouts and corrupted installs. |
| Detached HEAD handling | A detached HEAD that is exactly a ready release tag (a normal tag install) may advance automatically. A detached HEAD on any other commit is a deliberate pin and needs an explicit version. |

A successful update prints the changelog slice for the versions you crossed (`CHANGELOG.md`, Keep a Changelog shape), the release-notes URL, and the restart reminders.

## Binary updates

A binary install has no checkout, so the update is the release artifact itself. `unown update` resolves the target (the newest published version from `version.txt`, or an explicit `unown update <version>`), then:

1. checks the platform gate (published target OS/arch; glibc-only Linux; windows-arm64 only with `UNOWN_ALLOW_EXPERIMENTAL=1` or already installed there)
2. downloads `unown-<platform>.tar.gz|.zip` and `sha256sums.txt` from that version's `/download/v<version>/` release path
3. requires an exact SHA-256 entry and verifies the archive (fail-closed: a missing entry is an error, not a skip)
4. extracts with the system `tar` (System32 `bsdtar` on Windows) and verifies `<binary> --version` equals the target
5. renames the verified tree into `<root>/versions/<version>` (an already-verified directory is reused)
6. snapshots the active shims and `install.json`, rewrites the shims for the **host** platform and writes `install.json` last; if activation fails, the snapshot is restored byte-for-byte and the old install stays live
7. records the move in `~/.unown/update-state.json` and keeps the previous version on disk

`--check` reads `version.txt`; the cache file (`~/.unown/update-check.json`) and the notification path are shared with checkout installs. A binary started straight from a hand-extracted archive has no metadata: it reports version `unknown`, so `update --check` offers any published version and `update` installs into the default root and writes shims.

## Update notifications

Interactive sessions (`unown` in a TTY) show a one-line notice when a newer release exists:

```
⚠ update available: unown <current> → <latest>
  run `unown update` · notes: https://github.com/kanishka-namdeo/Unown/releases/tag/vX.Y.Z · silence: export NO_UPDATE_NOTIFIER=1
```

The mechanics follow the ecosystem-standard update-notifier pattern (npm's `update-notifier`, Codex's `version.json`, Aider's versioncheck):

- **Never blocks startup.** The check runs in a detached background process; your session reads a 24-hour cache (`~/.unown/update-check.json`) and the *next* run may show the notice.
- **The cache lives in `~/.unown`**, never inside the repo — the notice can never dirty your working tree.
- **The background check is mode-specific**: `git ls-remote --tags --refs origin v*` for a checkout (read-only against the remote, nothing local touched), or `version.txt` from the release feed for a binary. No GitHub API is called, so there is no rate limit, and private/self-hosted git remotes work with your existing credentials.
- **Suppressed when**: not a TTY, `CI` is set, or any of the opt-outs below are set.

`unown doctor` reports the cached check state (version, short SHA, checkout path, last check age) — it never performs the network check itself.

## Pinned installs and specific versions

**Source checkout.** A checkout with a detached HEAD *on a release tag* (e.g. `git checkout vX.Y.Z`) is a normal tag install and may advance with `unown update`. A detached HEAD on any other commit is a **pinned install**:

```
unown: HEAD is detached at <commit> — a pinned install.
  update explicitly with:  unown update <version>
```

`unown update X.Y.Z` moves any checkout — pinned or not — to exactly that version, in both directions (this is also the manual downgrade path). When the move is not a descendant of HEAD, it applies as a detached checkout. Moving to an older version is always an explicit request; the automatic path only ever moves forward.

**Binary.** Git state does not apply. `unown update` targets the newest published version (and stays put if the running one is already at or ahead of it); `unown update X.Y.Z` installs exactly that version (including an older one) and records the version it replaced as `previousVersion`.

## Rollback

```bash
unown update --rollback
```

- **Source checkout**: restores the commit recorded by the last update (`~/.unown/update-state.json`), rebuilds, and verifies the version. Works only when the tree is clean — rollback never discards your work. `unown update <older-version>` does the same thing by name when the recorded state is gone.
- **Binary**: switches to `previousVersion` from `~/.unown/install.json`, verifying that the kept binary still runs and reports that version. A second `--rollback` toggles back to the version you left. Versions are kept on disk, so no download is needed; if the directory was deleted by hand, rollback refuses instead of guessing.

## Offline, air-gapped and CI use

- The check fails silently offline (exit 1 for `--check`, nothing shown at startup); nothing is mutated, so an offline machine simply never sees a notice.
- **Source**: mirror the git repository, point `origin` at the mirror, and `unown update` works entirely against it.
- **Binary**: mirror the release assets and set `UNOWN_RELEASES_BASE_URL` to the mirror base (also honored by the installers). Updates then need no access to github.com.
- `UNOWN_DISABLE_UPDATES=1` hard-blocks **every** update path — `unown update`, `--check`, and the background check all refuse or no-op. This is the organization/CI kill switch (the equivalent of Claude Code's `DISABLE_UPDATES`).
- In scripts, gate on the exit code without letting `0` trip `set -e`: `unown update --check; code=$?; [ "$code" -eq 0 ] || [ "$code" -eq 2 ] || exit "$code"`.

## Privacy

The update check is the only thing Unown ever phones home for, and there is no telemetry of any kind. A checkout check is a plain `git ls-remote` against **your own remote** — the same operation a `git fetch` performs, carrying no identifiers, no counters, no user data. A binary check fetches `version.txt` from the release host (or your `UNOWN_RELEASES_BASE_URL` mirror). A git remote URL's or mirror URL's embedded credentials are redacted before any output or state write. Opt out of the background check with any of:

| Variable | Effect |
|---|---|
| `NO_UPDATE_NOTIFIER=1` | Silence the startup notice + background check (ecosystem-standard name, same semantics npm's update-notifier uses). |
| `UNOWN_DISABLE_AUTOUPDATE=1` | Same — the Unown-native spelling. Manual `unown update` still works. |
| `DO_NOT_TRACK=1` | The standard nonessential-traffic opt-out; counts as a no for the background check. |
| `UNOWN_DISABLE_UPDATES=1` | Blocks all update paths including manual ones. |

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `unown: cannot determine how this unown was installed` | No checkout, no `UNOWN_INSTALL_ROOT`, no `install.json` — reinstall with the install script, then retry. |
| `unown: the checkout has uncommitted changes` | Commit or stash, or accept autostash with `unown update --allow-dirty`. |
| `unown: HEAD is detached ... a pinned install` | A detached commit, not a release tag — pass an explicit version. |
| `unown: this checkout has N local commit(s) not on the remote` | Your work would be stranded — push or rebase onto `origin` first. |
| `unown: cannot fast-forward HEAD` | The checkout diverged from release history — resolve manually, or pin to an explicit version. |
| `unown: version X not found — available: …` | Typo or a tag your remote lacks; the message lists the known-good releases. |
| `unown: update check failed` | Offline, no `origin`, or an unreachable remote/release feed — see [troubleshooting](troubleshooting.md). |
| `unown: no release archive for this OS/arch` | The host is not a published binary target — use the source install. |
| `unown: the Linux release binaries require glibc` | musl/Alpine cannot run the archive — build from source. |
| `unown: windows-arm64 releases are experimental and un-smoked` | Re-run with `UNOWN_ALLOW_EXPERIMENTAL=1` (or the installer's `-Experimental`). |
| `unown: no previous version recorded` | Nothing to roll back to yet — update once first. |
| `unown: binary update failed — checksum mismatch` | The download was corrupted or the feed is inconsistent; nothing changed. Retry, then verify the mirror's `sha256sums.txt`. |
| Notice shows a version that `--check` does not | The notice reads a 24h cache; run `unown update --check` to refresh it. |
