# Windows guide

Unown runs natively on Windows 10/11 — the same commands as macOS/Linux, the same stack (bridge + engine + dashboard), the same interactive TUI. This page collects everything Windows-specific: installation, terminals, the PowerShell tool, the sandbox story, and the known limitations.

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

Identical to every other OS:

```powershell
git clone https://github.com/kanishka-namdeo/Unown.git
cd Unown
bun run agent:install
```

What the installer does on Windows (same as elsewhere, plus two Windows specifics):

1. `bun install` at the repo root and inside `pi-repo/`, hydration of the provider model data, `build:offline` — all through bun; no bash-isms anywhere.
2. Creates `.env` from `.env.example` if you don't have one.
3. Writes **`unown.cmd` + `unown.ps1`** shims into `%USERPROFILE%\.local\bin` and appends that directory to your **user PATH via the registry** (`[Environment]::SetEnvironmentVariable('Path', …, 'User')` — never `setx`, which silently truncates at 1024 characters).

> **Restart your terminal after the install.** The PATH change is written to the *User* environment; already-open cmd/PowerShell windows never see it. New terminals will.

## Using `unown` — cmd vs PowerShell

| Shell | What runs | Notes |
|---|---|---|
| cmd.exe | `%USERPROFILE%\.local\bin\unown.cmd` | Works out of the box, no policy questions. |
| PowerShell | `%USERPROFILE%\.local\bin\unown.ps1` | If script execution is disabled on a locked-down machine you'll see *“running scripts is disabled on this system”* — fix once with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or just call `unown.cmd` (in PowerShell, typing `unown` may resolve to the `.cmd` anyway depending on PATHEXT order). |

Both shims exec `bun <repo>\bin\unown` and propagate the exit code — `unown doctor; if ($LASTEXITCODE) { … }` works.

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
# inside WSL2 (Ubuntu), keep the clone in the Linux filesystem (~/…), not /mnt/c
curl -fsSL https://bun.sh/install | bash
git clone https://github.com/kanishka-namdeo/Unown.git && cd Unown
bun run agent:install
```

Inside WSL2 you're on Linux: the engine picks up the vendored bwrap and every run gets the full mount/network-namespace isolation. The Windows Terminal-integrated WSL2 experience is first-class — same tabs, same fonts.

## Known limitations

| Limitation | Reality |
|---|---|
| `chmod 0600` on `~/.unown/agent/auth.json` | A no-op on NTFS — the engine skips it on win32 and relies on the file living under your profile directory (ACLs do the job). No action needed. |
| Symlinks | Creating them needs Developer Mode or an elevated shell — but **the install no longer uses any symlinks**: the launcher (`scripts/start.ts`) parses `.env` and exports it into each child's environment instead. You only need Developer Mode if *you* create symlinks in your own projects. |
| `MAX_PATH` (260 chars) | Deep vendored trees (`pi-repo/…/examples/**/node_modules`) can exceed it. The CI matrix sets `git config --global core.longpaths true`; do the same on your machine if `git checkout` ever complains. Bun and Node themselves handle long paths on Win10+. |
| Process signals | There are none on Windows — the lifecycle scripts use `taskkill /F /T` (tree kill) where POSIX would send SIGTERM/SIGKILL. You never notice unless you read `.run/*.log` for fun. |
| Detached engine spawn | Bun's `detached: true` child dies with its parent on Windows (oven-sh/bun#31603), so `unown engine start` launches through `cmd /c start /b` — the empty-title form, so quoted paths with spaces stay commands. The engine's pidfile is not written on this path (cmd.exe's own pid is not the engine's); `unown engine status` reads the pid from the engine's `/api/overview` instead. |
| Graceful engine stop | SIGTERM cannot reach JS handlers on Windows (TerminateProcess skips them), so `unown engine stop` asks the engine over HTTP first (`POST /api/shutdown`, loopback — the same drain path the signal handlers run on POSIX) and only falls back to a hard kill. The WAL checkpoint + lock release happen on the HTTP path; a hard-killed engine is still safe at next boot (SQLite WAL recovery + `recoverOrphans`). |
| SQLite cross-process writes | Bun's `BEGIN IMMEDIATE` does not exclude across processes on Windows (oven-sh/bun#40659). Unown's detachment contract closes this by construction: only the engine process ever opens `db/selflearning.db` (pinned by a fresh-process test suite); the terminal agent talks to the engine over HTTP + files. Don't run two engines against one data dir — the engine's boot lockfile refuses the second one. |

## When something breaks

Start with:

```powershell
unown doctor
```

then work [troubleshooting](troubleshooting.md) — the **[Windows section](troubleshooting.md#windows)** covers the usual suspects (`'unown' is not recognized`, execution policy, bun missing, native-module hiccups). The logs live in `.run\` inside the repo, exactly as on macOS/Linux.
