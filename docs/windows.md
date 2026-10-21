# Windows guide

Unown runs natively on Windows 10/11 — the same commands as macOS/Linux, the same stack (bridge + engine; mission control is the `unown dashboard` TUI), the same interactive TUI. This page collects everything Windows-specific: installation, terminals, the PowerShell tool, the sandbox story, and the known limitations.

Related pages: [quickstart](quickstart.md) · [troubleshooting](troubleshooting.md#windows) · [configuration](configuration.md) · [macOS guide](macos.md)

- [Prerequisites](#prerequisites)
- [Install](#install)
- [Using `unown` — cmd vs PowerShell](#using-unown--cmd-vs-powershell)
- [The bash tool and Git Bash](#the-bash-tool-and-git-bash)
- [The PowerShell tool](#the-powershell-tool)
- [The sandbox story on Windows](#the-sandbox-story-on-windows)
- [Known limitations](#known-limitations)
- [When something breaks](#when-something-breaks)

## Prerequisites

- **[Bun](https://bun.sh) ≥ 1.2** — install from PowerShell:

  ```powershell
  powershell -c "irm bun.sh/install.ps1 | iex"
  ```

  then open a new terminal (the installer puts bun in `%USERPROFILE%\.bun\bin` and updates your PATH). Verify: `bun --version`.
- **[Git for Windows](https://git-scm.com/download/win)** — recommended (you need git for the clone anyway, and the agent's bash tool resolves Git Bash automatically; see below). The default install options are fine.
- An API key for any OpenAI-compatible provider — same as on every OS ([quickstart §3](quickstart.md#3-connect-a-model)).

No WSL, no Docker, no Developer Mode required for the standard install.

## Install

One command in PowerShell installs the full stack from the newest **stable release tag** — it checks `git`, installs `bun` via bun's own PowerShell installer when missing, refuses an elevated shell, clones, and runs `bun run agent:install`:

```powershell
irm https://unown-nine.vercel.app/install.ps1 | iex
```

`irm | iex` runs with default parameters. To pass a flag, download the script first, review it, then run it:

```powershell
irm https://unown-nine.vercel.app/install.ps1 -OutFile install.ps1
Get-Content .\install.ps1
.\install.ps1
```

| Flag | Effect |
|---|---|
| `-Version vX.Y.Z` | pin a stable release tag (bare `X.Y.Z` accepted) |
| `-Main` | install the `main` branch — the edge lane |
| `-Binary` | install the standalone CLI instead of the source stack |
| `-Dest DIR` | source clone directory (default `.\Unown`); invalid with `-Binary` |
| `-Force` | install over an install recorded in the other mode (the old files are left for its own uninstall); also allows overwriting a foreign binary shim |
| `-Experimental` | allow the un-smoked windows-arm64 binary |
| `-NoModifyPath` | do not add the binary shim directory to the user PATH |
| `-Help` | usage |

Or the same source install by hand, pinned to the newest tag on [Releases](https://github.com/kanishka-namdeo/Unown/releases):

```powershell
git clone --branch vX.Y.Z https://github.com/kanishka-namdeo/Unown.git
cd Unown
bun run agent:install
```

Plain `git clone` without `--branch` gives you `main` — the edge lane, not the stable default.

### The binary lane (`-Binary`)

```powershell
.\install.ps1 -Binary                  # windows-x64
.\install.ps1 -Binary -Experimental    # windows-arm64 (experimental; no CI runtime smoke)
```

No git and no bun are required. The installer downloads `unown-windows-x64.zip` (or the arm64 archive) plus the same release's `sha256sums.txt`, verifies the exact SHA-256 before extracting, checks the archive's `VERSION` file and `unown.exe --version`, and installs atomically to:

- `%LOCALAPPDATA%\unown\versions\<version>\unown.exe` (root override: `UNOWN_INSTALL_ROOT`)
- `%USERPROFILE%\.local\bin\unown.cmd` + `unown.ps1` (override: `UNOWN_BIN_DIR`), and appends that directory to your **user PATH** unless `-NoModifyPath`

The shims set `UNOWN_INSTALL_ROOT`; `~/.unown/install.json` records the active version. To check an archive you downloaded by hand, compare `Get-FileHash .\unown-windows-x64.zip -Algorithm SHA256` with its line in `sha256sums.txt`. The builds are unsigned, so SmartScreen may warn on first run (`Unblock-File unown.exe` clears it). Update with `unown update` — it reads the `release.json` manifest, verifies the Windows asset's size and SHA-256 and keeps the previous version for `unown update --rollback` — and remove with `unown uninstall`.

The binary is the **CLI only** — the engine and bridge need the source install above. Windows arm64 is opt-in with `-Experimental` because no GitHub arm64 Windows runner exists to execute that archive in CI.

What the source installer does on Windows (same as elsewhere, plus three Windows specifics):

1. `bun install --frozen-lockfile` at the repo root and inside `pi-repo/`, hydration of the provider model data, `build:offline` — all through bun; no bash-isms anywhere.
2. Creates `.env` from `.env.example` if you don't have one.
3. Writes **`unown.cmd` + `unown.ps1`** shims into `%USERPROFILE%\.local\bin`, records the checkout in `~/.unown/install.json`, and appends that directory to your **user PATH via the registry** (`[Environment]::SetEnvironmentVariable('Path', …, 'User')` — never `setx`, which silently truncates at 1024 characters).

> **Restart your terminal after the install.** The PATH change is written to the *User* environment; already-open cmd/PowerShell windows never see it. New terminals will. `unown update` is mode-aware — it moves a source checkout tag to tag and a binary install to the next manifest-verified release ([updating](updating.md)).

## Using `unown` — cmd vs PowerShell

| Shell | What runs | Notes |
|---|---|---|
| cmd.exe | `%USERPROFILE%\.local\bin\unown.cmd` | Works out of the box, no policy questions. |
| PowerShell | `%USERPROFILE%\.local\bin\unown.ps1` | If script execution is disabled on a locked-down machine you'll see *“running scripts is disabled on this system”* — fix once with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or just call `unown.cmd` (in PowerShell, typing `unown` may resolve to the `.cmd` anyway depending on PATHEXT order). |

For a source install, both shims exec `bun <repo>\bin\unown` and propagate the exit code — `unown doctor; if ($LASTEXITCODE) { … }` works. A `-Binary` install's shims instead set `UNOWN_INSTALL_ROOT` and exec the active `versions\<version>\unown.exe`.

The interactive TUI is fully native on Windows: the vendored pi TUI ships a `win32-console-mode.node` prebuild (x64 + arm64) that switches the console into VT/UTF-8 mode, so colors, boxes and the editor work in Windows Terminal (recommended) and in the classic conhost.

## The bash tool and Git Bash

The agent's `bash` tool needs a bash. pi resolves it in this order (no environment variable — it's a setting):

1. `shellPath` in pi's settings (`~/.pi/agent/settings.json`, or per-project `.pi/settings.json`)
2. Git Bash at `%ProgramFiles%\Git\bin\bash.exe` (and the `ProgramFiles(x86)` variant)
3. `bash.exe` anywhere on PATH (Cygwin, MSYS2 — a WSL `bash.exe` from System32 is detected and spoken to in legacy mode)

For most people **Git for Windows is sufficient** — install it with default options and you're done. If your bash lives somewhere exotic:

```json
// ~/.pi/agent/settings.json
{ "shellPath": "C:\\cygwin64\\bin\\bash.exe" }
```

See the vendored guide: [`pi-repo/packages/coding-agent/docs/windows.md`](../pi-repo/packages/coding-agent/docs/windows.md).

## The PowerShell tool

pi ships an optional **`powershell`** tool that runs commands through PowerShell (`pwsh.exe` when available, otherwise Windows PowerShell) with `-NoProfile -NonInteractive -ExecutionPolicy Bypass`. Give it to the model alongside or instead of bash:

```json
// ~/.pi/agent/settings.json
{ "defaultTools": ["read", "bash", "powershell", "edit", "write"] }
```

Unown's guardrail hooks apply to both shells on every platform: the engine deny-list carries the Windows catastrophic patterns (`format`, `reg add`, `bcdedit`, `diskpart`, `Remove-Item -Recurse` on system trees, `\\.\PhysicalDrive` redirects, …), plan mode understands the PowerShell verb vocabulary, and subagent kills use `taskkill /F /T` so whole process trees come down. Details: [README § Security model](../README.md#security-model).

## The sandbox story on Windows

Honest summary: **native Windows has no OS-level sandbox** — nobody ships one (Claude Code runs unsandboxed on native Windows too; WSL2 is the official answer there). What Unown does on native Windows:

- **Engine runs** (verify scripts, the agent's own commands) execute under the **in-process path jail + deny lists** — same degradation Claude Code ships on native Windows. `unown doctor` reports this as `OS sandbox (Windows)` ⚠; chat and learning are unaffected.
- The vendored bubblewrap binary is **Linux-only by design** — the engine gates it out on Windows (`src/bwrap.ts` refuses to resolve it, so a Git-Bash `bwrap` from a WSL mount can never win by accident). Don't try to force it with `UNOWN_BWRAP`.

**Want bwrap-grade isolation?** Use WSL2:

```bash
# inside WSL2 (Ubuntu), keep the checkout in the Linux filesystem (~/…), not /mnt/c
curl -fsSL https://unown-nine.vercel.app/install.sh | sh
```

Inside WSL2 you're on Linux: the engine picks up the vendored bwrap and every run gets the full mount/network-namespace isolation. The Windows Terminal-integrated WSL2 experience is first-class — same tabs, same fonts.

## Known limitations

| Limitation | Reality |
|---|---|
| `chmod 0600` on `~/.unown/agent/auth.json` | A no-op on NTFS — the engine skips it on win32 and relies on the file living under your profile directory (ACLs do the job). No action needed. |
| Symlinks | Creating them needs Developer Mode or an elevated shell. The launcher avoids them (it parses `.env` and exports it into each child's environment), and the one remaining install-time symlink (`mini-services/*/.env → ../../.env`, so service-local dev boots also read the root config) is **non-fatal when it fails** on Windows without symlink rights — the launcher path covers it either way. You only need Developer Mode if *you* create symlinks in your own projects. |
| User hooks (`command` handlers) | They run through the OS shell: `cmd.exe` on Windows, `/bin/sh` on macOS/Linux — a hook written for bash will not run as written under `cmd.exe`. Write hooks in the shell of the machine that runs them (or call an explicit interpreter: `powershell -File …` / `bash -c …`), and remember `taskkill /F /T` tree-kills timed-out hook processes on Windows where POSIX sends SIGKILL to the process group. |
| `MAX_PATH` (260 chars) | Deep vendored trees (`pi-repo/…/examples/**/node_modules`) can exceed it. The CI matrix sets `git config --global core.longpaths true`; do the same on your machine if `git checkout` ever complains. Bun and Node themselves handle long paths on Win10+. |
| Process signals | There are none on Windows — the lifecycle scripts use `taskkill /F /T` (tree kill) where POSIX would send SIGTERM/SIGKILL. You never notice unless you read `.run/*.log` for fun. |
| Detached engine spawn | Bun's `detached: true` child dies with its parent on Windows (oven-sh/bun#31603), so `unown engine start` **and `bun run agent:start`'s service spawns** launch through `cmd /c start /b` — the empty-title form, so quoted paths with spaces stay commands (System32 `cmd.exe`, resolved absolutely). The launcher cannot know the real pid at spawn time (cmd.exe's own pid is not the service's), so it resolves each service's listener pid via `netstat -ano` after the health check and writes THAT into `.run/<name>.pid` — `bun run agent:stop` tree-kills it, with a netstat fallback for missing pidfiles. A Windows CI leg boots and stops the full stack as the regression gate. |
| Graceful engine stop | SIGTERM cannot reach JS handlers on Windows (TerminateProcess skips them), so `unown engine stop` asks the engine over HTTP first (`POST /api/shutdown`, loopback — the same drain path the signal handlers run on POSIX) and only falls back to a hard kill. The WAL checkpoint + lock release happen on the HTTP path; a hard-killed engine is still safe at next boot (SQLite WAL recovery + `recoverOrphans`). |
| SQLite cross-process writes | Bun's `BEGIN IMMEDIATE` does not exclude across processes on Windows (oven-sh/bun#40659). Unown's detachment contract closes this by construction: only the engine process ever opens `db/selflearning.db` (pinned by a fresh-process test suite); the terminal agent talks to the engine over HTTP + files. Don't run two engines against one data dir — the engine's boot lockfile refuses the second one. |
| Terminal input corruption under heavy CPU load (inherited, upstream) | The vendored pi TUI ([earendil-works/pi](https://github.com/earendil-works/pi), snapshot 0.84.3 + two cherry-picked terminal fixes) carries Windows mitigations — VT-sequence reinterpretation, `\r`/Ctrl+G handling, win32 console-mode prebuilds. Two upstream terminal fixes are cherry-picked into the vendored tree: fragmented OSC color-reply tails no longer leak into the editor (upstream `edb2eb9`, pi-tui 1.2.0; the #10256/#10717/#10742 class), and terminal modes are restored after exits that skip `stop()` (upstream `9df819d`; #11170). The one still-open upstream P0 — symbols leaking into the editor under heavy CPU load (#11086) — is unfixed at every upstream version including 1.3.0, so no re-vendor today removes it; if you see stray characters during heavy load, it is that inherited class, nothing in unown's own layer. A full re-vendor to pi 1.x is deliberately deferred: upstream crossed its 1.0 fullscreen-by-default rewrite with five breaking SDK changes while this tree carries ~29 local commits of TUI/branding divergence (tracked at `pi-repo/packages/self-learning/AGENTS.md`). Re-assess at the next upstream release, watching upstream issues #11086 and #10657. |

## When something breaks

Start with:

```powershell
unown doctor
```

then work [troubleshooting](troubleshooting.md) — the **[Windows section](troubleshooting.md#windows)** covers the usual suspects (`'unown' is not recognized`, execution policy, bun missing, native-module hiccups). The logs live in `.run\` inside the repo, exactly as on macOS/Linux.
