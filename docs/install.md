# Installing Unown

The two install modes — a full source checkout and a standalone CLI binary — the one-line installers for both, manual and archive installs, requirements, offline use, version policy, and how to remove an install.

- [Two install modes](#two-install-modes)
- [One-line installer](#one-line-installer)
- [Binary install (CLI only)](#binary-install-cli-only)
- [Manual source install (git clone)](#manual-source-install-git-clone)
- [Standalone per-OS binaries](#standalone-per-os-binaries)
- [What the source installer does](#what-the-source-installer-does)
- [Requirements](#requirements)
- [Offline and air-gapped installs](#offline-and-air-gapped-installs)
- [Version policy](#version-policy)
- [Uninstalling](#uninstalling)

Related pages: [quickstart](quickstart.md) · [updating](updating.md) · [configuration](configuration.md) · [windows](windows.md) · [macos](macos.md)

## Two install modes

| | Source checkout | Standalone binary |
|---|---|---|
| What you get | `unown` **plus** the self-learning engine and `llm-bridge` (`bun run agent:start`) | the `unown` terminal agent only |
| Needs | git, bun ≥ 1.2, network | network (the download) — no git, no bun |
| How | the default one-liner, a manual clone, or `bun run agent:install` | `--binary` / `-Binary`, or a release archive by hand |
| Updates | `unown update` (git tag to tag) | `unown update` (verified release download) |
| On disk | your clone; the PATH shim runs `bun <repo>/bin/unown` | a versioned root + a PATH shim that sets `UNOWN_INSTALL_ROOT` |

The binary is the CLI only. It has no engine, no bridge and no dashboard data source; the learning stack (session notes, AutoDream, harness, mission control) runs from a source checkout. Use the binary when you want a coding agent on a machine that should not carry a repo and a toolchain.

## One-line installer

macOS / Linux / WSL (POSIX `sh` — on Windows this fails confusingly, because PowerShell aliases `curl` to `Invoke-WebRequest`; use the PowerShell one-liner below):

```bash
curl -fsSL https://unown-nine.vercel.app/install.sh | sh
```

Windows (PowerShell) — the same contract: checks `git`, installs `bun` via bun's own PowerShell installer when missing, refuses an elevated shell, clones the newest **stable release tag**, and runs `bun run agent:install`:

```powershell
irm https://unown-nine.vercel.app/install.ps1 | iex
```

Without a flag both installers build the full stack from the newest stable `vX.Y.Z` tag (the newest entry on [Releases](https://github.com/kanishka-namdeo/Unown/releases) that is not marked prerelease). A tag whose `package.json` does not declare the tag's version is refused — a half-pushed release is never installed.

| POSIX | PowerShell | Effect |
|---|---|---|
| `--version vX.Y.Z` | `-Version vX.Y.Z` | pin a stable release tag (bare `X.Y.Z` accepted) |
| `--main` | `-Main` | install the `main` branch — the edge lane |
| `--binary` | `-Binary` | install the standalone CLI instead of the source stack |
| `--dest DIR` | `-Dest DIR` | source clone directory (default `./Unown`); invalid with the binary lane |
| `--force` | `-Force` | install over an install recorded in the other mode (the old files are left for its own uninstall); also allows overwriting a foreign binary shim |
| `--experimental` | `-Experimental` | allow the un-smoked windows-arm64 archive (Windows only; accepted for parity elsewhere) |
| — | `-NoModifyPath` | do not add the binary shim directory to the user PATH |
| `--help` | `-Help` | usage |

`--main`/`-Main` and `--version`/`-Version` are mutually exclusive, and neither combines with the binary lane. Both installers refuse to run as root/Administrator; `UNOWN_INSTALL_ALLOW_ROOT=1` overrides that for a deliberately shared machine.

Pinned installs use a version placeholder — take the current one from [Releases](https://github.com/kanishka-namdeo/Unown/releases):

```bash
curl -fsSL https://unown-nine.vercel.app/install.sh | sh -s -- --version vX.Y.Z
```

`irm | iex` always runs with default parameters. To pass a flag, download the script first, review it, then run it (the same review-before-running pattern as the POSIX side):

```powershell
irm https://unown-nine.vercel.app/install.ps1 -OutFile install.ps1
Get-Content .\install.ps1
.\install.ps1 -Version vX.Y.Z
```

The scripts are `public/install.sh` and `public/install.ps1` in the repository, served by the site deployment. You can review the POSIX one the same way, or verify-then-run with [checksum.sh](https://checksum.sh):

```bash
curl -fsSL https://unown-nine.vercel.app/install.sh -o install.sh
less install.sh          # review it
sh install.sh
```

Both run their whole body as one `main` call after argument parsing (with `set -eu` on POSIX and `$ErrorActionPreference = 'Stop'` on Windows), so a truncated or mid-stream-mutated download cannot execute half an install. Integrity of what lands on disk comes from the transport and the release: an HTTPS clone from GitHub for the source lane, and an exact SHA-256 from the same release's `sha256sums.txt` for the binary lane.

## Binary install (CLI only)

```bash
curl -fsSL https://unown-nine.vercel.app/install.sh | sh -s -- --binary
```

```powershell
.\install.ps1 -Binary          # after downloading the script; -Version vX.Y.Z pins
```

By default the binary lane installs the release marked **latest**; `--version`/`-Version` pins a stable release instead. It needs no git and no bun: it downloads the release archive for the host platform, verifies the exact SHA-256 against that release's `sha256sums.txt`, extracts it, checks the archive's `VERSION` file and `unown --version`, and only then activates the install.

### Layout

| What | Where |
|---|---|
| Install root (POSIX) | `$UNOWN_INSTALL_ROOT`, else `$XDG_DATA_HOME/unown`, else `~/.local/share/unown` |
| Install root (Windows) | `%UNOWN_INSTALL_ROOT%`, else `%LOCALAPPDATA%\unown` |
| Versioned binary | `<root>/versions/<version>/unown` (`.exe` on Windows) |
| POSIX shim | `${UNOWN_BIN_DIR:-$HOME/.local/bin}/unown` |
| Windows shims | `%UNOWN_BIN_DIR%` else `%USERPROFILE%\.local\bin\unown.cmd` + `unown.ps1` |
| Metadata | `~/.unown/install.json` (`UNOWN_HOME` is honored) |

The shims set `UNOWN_INSTALL_ROOT` and execute the active versioned binary, which is how `unown update` and `unown uninstall` know they are looking at a binary install. `install.json` is schema 1 and records `mode`, `version`, `platform`, `root`, `bin`, `shim`, `previousVersion` (after an update) and `installedAt`. `unown update` reuses an already verified version directory and keeps the old version on disk for rollback; the Windows installer does the same for a same-version reinstall.

### Platform support

| Platform | Archive | Notes |
|---|---|---|
| macOS arm64 / x64 | `unown-darwin-arm64.tar.gz` / `unown-darwin-x64.tar.gz` | an x64 shell under Rosetta gets the arm64 build |
| Linux arm64 / x64 | `unown-linux-arm64.tar.gz` / `unown-linux-x64.tar.gz` | **glibc only**; musl (Alpine) is detected and refused — use the source install |
| Windows x64 | `unown-windows-x64.zip` | the default Windows target |
| Windows arm64 | `unown-windows-arm64.zip` | experimental: requires `-Experimental` / `--experimental`, and has no CI runtime smoke |

Binaries are **unsigned** (no Apple Developer certificate, no code-signing secret in the repository). macOS Gatekeeper and Windows SmartScreen warn on first run; the installer clears the quarantine/Mark-of-the-Web mark on the staged binary as a best effort, and every archive's `INSTALL.txt` repeats the manual unblock step. Installs verify checksums and GitHub build-provenance attestations. The binary **updater** reads the release manifest (`release.json`) and verifies the platform archive's exact size and SHA-256 before trusting it; `unown update --check --json` reports `signature: "unsigned"` for a manifest-feed answer (the label names the feed shape, not a cryptographic check). The manifest itself is not signed, so its integrity rests on HTTPS to the release host or to a mirror you configure.

### Verify, update, remove

- The installer reads the release's `version.txt` when present and the archive's `VERSION` otherwise, and aborts on a missing `sha256sums.txt` entry, a checksum mismatch, a `VERSION`/`version.txt`/pin disagreement, or a binary that does not print the expected `--version`.
- `unown update` in a binary install validates `release.json`, selects the platform asset, verifies its size and SHA-256, and swaps the versioned directory; `unown update --check` reads the manifest (falling back to `version.txt` only when a release has no manifest); `unown update --rollback` returns to the `previousVersion` recorded in `install.json`.
- `unown uninstall` removes only the shims that point into this install root, the versioned root (including rollback copies) and `install.json`; `~/.unown` is kept unless `--purge-data`. A hand-extracted archive has no metadata or shim — delete the extracted directory yourself.

Details and exit codes: [updating](updating.md).

## Manual source install (git clone)

Clone the newest stable release tag — replace the placeholder with the current tag from [Releases](https://github.com/kanishka-namdeo/Unown/releases):

```bash
git clone --branch vX.Y.Z https://github.com/kanishka-namdeo/Unown.git
cd Unown
bun run agent:install
```

`git clone https://github.com/kanishka-namdeo/Unown.git` without `--branch` gives you `main`, which is the **edge** lane (the same as `--main`), not the stable default. A manual tag clone is the same source install the one-liner produces; it does not re-check the tag, so use a published release tag rather than a local one.

## Standalone per-OS binaries

Every GitHub Release carries six standalone builds of the `unown` CLI, produced from the tagged commit by one Linux runner (`bun build --compile --target=` bundles the target platform's runtime, so no Mac or Windows machine is involved in building them). The complete payload is 13 assets:

| Asset | What it is |
|---|---|
| the six `unown-<platform>.tar.gz` / `.zip` archives | `unown`/`unown.exe`, `VERSION`, `LICENSE`, `INSTALL.txt` inside `unown-<platform>/` |
| `version.txt` | the plain release version — the installers and legacy update source |
| `release.json` | the update manifest: version, per-platform asset name/size/SHA-256, severity, minimum version |
| `install.sh`, `install.ps1` | the release's own installers (the binary lane uses them) |
| `sha256sums.txt` | SHA-256 for the other 12 assets (it does not cover itself) |
| `sbom-spdx.json` | SPDX SBOM of the installed dependency tree |
| `release-checklist.md` | what this release actually verified |

Extract and run one:

```bash
tar -xzf unown-linux-x64.tar.gz          # creates unown-linux-x64/
export PATH="$PWD/unown-linux-x64:$PATH"
unown --version                          # prints the release version
unown setup                              # connect a model provider
```

`VERSION` is the plain release version, and `INSTALL.txt` is versioned per archive: it names that platform's checksum command, the update/uninstall commands for both install modes, and the CLI-only boundary.

### Verify what you downloaded

The checksum command is platform-specific because the manifest also covers assets you may not have downloaded:

macOS (`shasum` has no `--ignore-missing`, so limit the check with `grep`):

```bash
grep "  unown-darwin-arm64.tar.gz$" sha256sums.txt | shasum -a 256 -c -
```

Linux (`--ignore-missing` skips assets you did not download):

```bash
sha256sum -c --ignore-missing sha256sums.txt
```

Windows (compare the hash with the archive's line in `sha256sums.txt`):

```powershell
Get-FileHash .\unown-windows-x64.zip -Algorithm SHA256
```

The six archives and both installer scripts also carry GitHub build-provenance attestations, bound to the release workflow and commit:

```bash
gh attestation verify unown-linux-x64.tar.gz --repo kanishka-namdeo/Unown
```

Before publishing, CI downloads and **runs** each archive on its own platform (linux arm64/x64, darwin arm64/x64, windows x64); `windows-arm64` is the one asset without a runtime smoke because GitHub hosts no arm64 Windows runner, and the checklist says so. The release is created as a **draft**, its 13-asset list and prerelease flag are asserted, and only then is it promoted. A post-publish feed gate fetches the live `release.json`, checks `version.txt`, and downloads every platform archive to verify its exact size and SHA-256; a smoke-install matrix on ubuntu/macos/windows then installs the released binary through the release's own installer and checks `--version`, `update --check` and `uninstall --dry-run`. Only stable `vX.Y.Z` tags are released — a hyphenated prerelease tag is rejected before anything is built.

**The builds are not signed or notarized.** No Apple Developer certificate and no code-signing secret exist in this repository, so the first run of a freshly downloaded binary is blocked by macOS Gatekeeper and warned about by Windows SmartScreen. `INSTALL.txt` inside every archive gives the unblock step (`xattr -d com.apple.quarantine unown` on macOS, `Unblock-File unown.exe` on Windows). Check the checksum before you unblock anything.

The binary is the terminal agent only. The self-learning engine and `llm-bridge` run from a checkout — see [manual source install](#manual-source-install-git-clone) and [quickstart](quickstart.md). State lives under `~/.unown` (memory, agent config, crash records). For updates in this mode see [updating](updating.md#binary-updates).

## What the source installer does

`bun run agent:install` is idempotent and safe to re-run (it is also what `unown update` re-runs after moving the checkout):

1. verifies bun ≥ 1.2 (install hint per OS when missing)
2. `bun install --frozen-lockfile` at the repo root
3. `bun install --frozen-lockfile` in `pi-repo/` (the vendored pi coding agent workspace)
4. hydrates the pi provider model data on first run (network fetch, ~1–2 min — upstream gitignores that directory, a fresh clone cannot build without it)
5. builds the pi engine (`bun run build:offline`)
6. creates `.env` from `.env.example` when absent — never overwrites an existing one
7. links the root `.env` into both mini-services (`mini-services/llm-bridge/.env` and `mini-services/agent-service/.env` → `../../.env`) — bun auto-loads `.env` only from a process's own CWD, so a supervisor that starts a service from its own directory would otherwise miss the root config; idempotent, and a stray regular file that would shadow the root config is replaced
8. puts `unown` on your PATH: a shim into `~/.local/bin` on macOS/Linux (or the first writable dir of `~/bin`, `/usr/local/bin`), `%USERPROFILE%\.local\bin\unown.cmd` + `unown.ps1` on Windows, and records the active install in `~/.unown/install.json` (mode `checkout`). The shim points INTO the checkout — that is what makes `unown update` a plain git operation later; if a binary install is still recorded there, link.ts warns that this checkout now owns the PATH shim and leaves the binary's files for its own uninstall.

## Requirements

| Requirement | Source checkout | Binary |
|---|---|---|
| [bun](https://bun.sh) ≥ 1.2 | yes — the one-liner installs it when missing | no |
| [git](https://git-scm.com) | yes (Git-for-Windows is fine) | no |
| Network | clone + first-run model-data hydration | the download (and later update checks) |
| An OpenAI-compatible endpoint + key | configured after install — see [quickstart](quickstart.md) | same |

## Offline and air-gapped installs

- **Source: the model-data hydration (step 4) needs the network once.** On an air-gapped machine, copy `pi-repo/packages/ai/src/providers/data/*.json` from any hydrated checkout of this repo, then run `bun run agent:install` — it detects the data and skips the fetch.
- **Source updates**: mirror the repo (any git mirror reachable from the machine), point `origin` at the mirror, and `unown update` works entirely against it.
- **Binary: mirror the release assets** and point both the installer and updater at the mirror with `UNOWN_RELEASES_BASE_URL` (an `https://` base; `http://` is accepted only for an explicit mirror/test setup, with a warning). The layout override variables — `UNOWN_INSTALL_ROOT`, `UNOWN_BIN_DIR`, `UNOWN_HOME` — let an offline install live wherever you stage it.
- **Model traffic stays on your network.** The agent talks to whatever endpoint you configure (`unown setup` — Dashscope, OpenAI, OpenRouter, Anthropic, local vLLM, anything OpenAI-compatible). Nothing else phones home; the only optional outbound call is the [update check](updating.md#privacy), which you can disable.

## Version policy

- Releases are stable `vX.Y.Z` tags only. The release workflow rejects a hyphenated (prerelease) tag before it builds anything, and GitHub's "latest" marker ignores prereleases, so this repository never publishes a prerelease for a default lane to pick.
- The source one-liner installs the newest stable tag; the manual route pins the tag you name. `--main`/`-Main` is the explicit edge lane, and `--version`/`-Version` pins a tag. The one-line installer refuses a tag whose `package.json` version differs from the tag.
- The binary one-liner installs the release marked latest; `--version`/`-Version` pins one. Its update check reads that release's `release.json` (with a `version.txt` + `sha256sums.txt` fallback for releases that predate the manifest).
- `unown --version` prints the same version as the checkout's `package.json` (or the tag the binary was built from). That identity is asserted in CI.
- Examples in this documentation use `vX.Y.Z` placeholders; the current version is always the newest stable entry on [Releases](https://github.com/kanishka-namdeo/Unown/releases).

## Uninstalling

| Mode | What `unown uninstall` removes | What it keeps |
|---|---|---|
| Source checkout | the PATH shims that point into THIS checkout (foreign shims are reported, not deleted) | the checkout and `~/.unown` |
| Binary | the shims that point into this install root, the versioned root (including rollback copies), and `install.json` | `~/.unown` |

```bash
unown uninstall                # remove the install's shims (+ the binary root in binary mode)
unown uninstall --dry-run      # show what would be removed; change nothing
unown uninstall --purge-data   # also remove ~/.unown (memories, notes, agent config)
unown uninstall --purge-checkout   # source mode: also remove the checkout (refuses uncommitted work)
unown uninstall --purge-all    # both of the above
```

In binary mode `--purge-checkout` is a no-op note — the versioned root is the install and is already removed. The bin directory may stay on your PATH; remove its line from your shell profile if you want it gone. Full reference: [updating](updating.md).
