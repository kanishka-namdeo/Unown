# Installing Unown

The ways to get Unown on your machine — the one-line installer, the plain git clone, standalone per-OS binaries, offline/air-gapped installs, and how to remove it afterwards.

- [One-line installer](#one-line-installer)
- [Manual install (git clone)](#manual-install-git-clone)
- [Standalone per-OS binaries](#standalone-per-os-binaries)
- [What the installer does](#what-the-installer-does)
- [Requirements](#requirements)
- [Offline and air-gapped installs](#offline-and-air-gapped-installs)
- [Uninstalling](#uninstalling)

Related pages: [quickstart](quickstart.md) · [updating](updating.md) · [configuration](configuration.md) · [windows](windows.md) · [macos](macos.md)

## One-line installer

macOS / Linux / WSL (POSIX `sh` — on Windows this fails confusingly, because PowerShell aliases `curl` to `Invoke-WebRequest`; use the PowerShell one-liner below):

```bash
curl -fsSL https://unown-nine.vercel.app/install.sh | sh
```

Windows (PowerShell) — the same contract as the POSIX script: checks `git`, installs `bun` via bun's own PowerShell installer when missing, refuses an elevated shell, clones, runs `bun run agent:install`:

```powershell
irm https://unown-nine.vercel.app/install.ps1 | iex
```

(`irm | iex` runs with default parameters; to pin a version, download the script first: `irm https://unown-nine.vercel.app/install.ps1 -OutFile install.ps1`, review it with `Get-Content .\install.ps1`, then `.\install.ps1 -Version v2.1.0` — the same review-before-running pattern as the POSIX side, plus [checksum.sh](https://checksum.sh) or the SLSA attestations on the release.)

Pinned to a specific release (POSIX):

```bash
curl -fsSL https://unown-nine.vercel.app/install.sh | sh -s -- --version v2.1.0
```

Flags: `--version vX.Y.Z` (clone a release tag instead of `main`), `--dest DIR` (clone directory, default `./Unown`), `--help` — PowerShell: `-Version`, `-Dest`, `-Help`.

The scripts are `public/install.sh` and `public/install.ps1` in the repository, served by the site deployment — read them before running if you like (you should):

```bash
curl -fsSL https://unown-nine.vercel.app/install.sh -o install.sh
less install.sh          # review it
sh install.sh
```

Or verify-then-run with [checksum.sh](https://checksum.sh). What the script does: refuse root, check `git`, install `bun` via [bun's own installer](https://bun.sh) when missing, clone the repo, and run the repo's own installer (`bun run agent:install`). The whole body runs inside a `main() { … }; main "$@"` wrapper with `set -eu` — the standard curl-pipe-sh mitigations against a truncated or mid-stream-mutated download. Integrity of what lands on disk comes from the git transport itself: HTTPS clone from GitHub, release tags with SLSA build-provenance attestations, and `sha256sums.txt` attached to every GitHub Release.

## Manual install (git clone)

The same path by hand (this is what the README quickstart shows):

```bash
git clone https://github.com/kanishka-namdeo/Unown.git
cd Unown
bun run agent:install
```

Identical result — the one-liner just does the prerequisite setup and the clone for you.

## Standalone per-OS binaries

Every GitHub Release also carries six standalone builds of the `unown` CLI —
`unown-darwin-arm64.tar.gz`, `unown-darwin-x64.tar.gz`,
`unown-linux-arm64.tar.gz`, `unown-linux-x64.tar.gz`,
`unown-windows-arm64.zip`, `unown-windows-x64.zip` — produced from the tagged
commit by one Linux runner (`bun build --compile --target=` bundles the target
platform's runtime, so no Mac or Windows machine is involved in building them).
Each platform's archive is then downloaded and **executed on that platform** in
CI before the Release is published; `windows-arm64` is the one asset with no
runtime smoke, because GitHub hosts no arm64 Windows runner.

They need no bun, no clone and no repo:

```bash
tar -xzf unown-linux-x64.tar.gz          # creates unown-linux-x64/
export PATH="$PWD/unown-linux-x64:$PATH"
unown --version                          # prints the release version
unown setup                              # connect a model provider
```

Verify what you downloaded against the release's `sha256sums.txt`:

```bash
sha256sum -c sha256sums.txt
```

**These builds are not signed or notarized.** The repository holds no Apple
Developer certificate and no code-signing secret, so the first run of a freshly
downloaded binary is blocked by macOS Gatekeeper and warned about by Windows
SmartScreen. `INSTALL.txt` inside every archive gives the unblock step
(`xattr -d com.apple.quarantine unown` on macOS, `Unblock-File unown.exe` on
Windows). Check the checksum before you unblock anything.

The binary is the terminal agent only. The self-learning engine, `llm-bridge`
and the dashboard run from a checkout — see [manual install](#manual-install-git-clone)
and [quickstart](quickstart.md). State lives under `~/.unown` (memory, agent
config, crash records, and the engine's data/db directories when it runs), and
`unown update` is not the update path here: with no git checkout behind it, the
binary reports `not a git checkout` and refuses. Replace the file with the one
from a newer release instead. [updating](updating.md) covers the checkout path.

## What the installer does

`bun run agent:install` is idempotent and safe to re-run (it is also what `unown update` re-runs after moving the checkout):

1. verifies bun ≥ 1.2 (install hint per OS when missing)
2. `bun install` at the repo root (dashboard dependencies)
3. `bun install` in `pi-repo/` (the vendored pi coding agent workspace)
4. hydrates the pi provider model data on first run (network fetch, ~1–2 min — upstream gitignores that directory, a fresh clone cannot build without it)
5. builds the pi engine (`bun run build:offline`)
6. creates `.env` from `.env.example` when absent — never overwrites an existing one
7. links the root `.env` into both mini-services (`mini-services/llm-bridge/.env` and `mini-services/agent-service/.env` → `../../.env`) — bun auto-loads `.env` only from a process's own CWD, so a supervisor that starts a service from its own directory would otherwise miss the root config; idempotent, and a stray regular file that would shadow the root config is replaced
8. puts `unown` on your PATH: a shim into `~/.local/bin` on macOS/Linux (or the first writable dir of `~/bin`, `/usr/local/bin`), `%USERPROFILE%\.local\bin\unown.cmd` + `unown.ps1` on Windows. The shim points INTO the checkout — that is what makes `unown update` a plain git operation later.

## Requirements

| Requirement | Notes |
|---|---|
| [bun](https://bun.sh) ≥ 1.2 | The one-liner installs it when missing; manual installs need it up front |
| [git](https://git-scm.com) | Any build; Git-for-Windows is fine |
| An OpenAI-compatible endpoint + key | Configured after install — see [quickstart](quickstart.md) |

## Offline and air-gapped installs

- **The model-data hydration (step 4) needs the network once.** On an air-gapped machine, copy `pi-repo/packages/ai/src/providers/data/*.json` from any hydrated checkout of this repo, then run `bun run agent:install` — it detects the data and skips the fetch.
- **Model traffic stays on your network.** The agent talks to whatever endpoint you configure (`unown setup` — Dashscope, OpenAI, OpenRouter, Anthropic, local vLLM, anything OpenAI-compatible). Nothing else phones home; the only optional outbound call is the [update check](updating.md#privacy), which you can disable.
- **Air-gapped updates**: mirror the repo (any git mirror reachable from the machine), point `origin` at the mirror, and `unown update <version>` works entirely against it.

## Uninstalling

```bash
unown uninstall                # removes the PATH shims
unown uninstall --dry-run      # shows what would happen
unown uninstall --purge-data   # also removes ~/.unown (memories, notes, config)
unown uninstall --purge-checkout   # also removes the checkout (refuses if it has uncommitted work)
```

By default your memories and the checkout are kept — only the shims are removed, and only the shims that point into THIS checkout (a second install's shims are reported, not touched). Manual leftovers: the bin directory may stay on your PATH; remove its line from your shell profile if you want it gone. Full reference: [updating](updating.md).
