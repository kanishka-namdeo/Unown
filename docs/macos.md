# macOS guide

Unown runs natively on macOS (Intel and Apple Silicon) — same commands, same stack, same interactive TUI as on Linux. This page is the short list of macOS-specific facts.

Related pages: [quickstart](quickstart.md) · [windows guide](windows.md) · [troubleshooting](troubleshooting.md) · [configuration](configuration.md)

## Prerequisites

- **[Bun](https://bun.sh) ≥ 1.2**:

  ```bash
  curl -fsSL https://bun.sh/install | bash     # or: brew install bun
  ```

- git (ships with the Xcode Command Line Tools — `xcode-select --install` — or brew).
- An API key for any OpenAI-compatible provider — same as everywhere ([quickstart §3](quickstart.md#3-connect-a-model)).

Then the standard install — the one-line installer (checks git, installs bun when missing, clones, installs; [install](install.md)):

```bash
curl -fsSL https://unown-nine.vercel.app/install.sh | sh
```

…or the manual route: `git clone … && cd Unown && bun run agent:install`. The PATH shim goes to `~/.local/bin/unown`; if that dir wasn't on your PATH, the installer prints the exact profile line to add.

## The OS sandbox on macOS

Shipped in 0.0.1: the OS-level sandbox backend on macOS is **seatbelt (`sandbox-exec`)** with a **bwrap-equivalent profile** — the same defense-in-depth under the in-process path jail that the Linux leg gets from bubblewrap. Every engine run (verify scripts *and* the agent's own bash commands) re-execs under `sandbox-exec -f <profile> -- <command>`, with a profile generated deterministically per workspace (`${TMPDIR:-/tmp}/unown-seatbelt-<hash>.sb`, rewritten when the workspace or the net flag changes):

- filesystem **reads stay allowed** — one documented asymmetry: bwrap's `/home` tmpfs *hides* your home directory from the sandbox, seatbelt cannot hide it, only deny writes, so the host `$HOME` remains readable (never writable),
- **writes confined** to the workspace (at its real path, no path translation), `/private/tmp`, `/var/folders` and `/dev/null`, with `/System` belt-and-braces denied,
- **network denied by default** (`UNOWN_SANDBOX_NET=1` to share it),
- everything else `(deny default)` — execution and fork allowed, mach-lookup allowed (darwin IPC), signals only to self.

`sandbox-exec` ships at `/usr/bin` on every macOS — deprecated by Apple but present, and the same mechanism shipping agents use today — so there is nothing to install. `unown doctor` reports the row as `OS sandbox (seatbelt)` with `fs isolation active (seatbelt profile; network denied|shared)`; knobs: `UNOWN_SANDBOX_EXEC` (explicit binary path), `UNOWN_OS_SANDBOX=0` (kill-switch, falls back to the path jail), `UNOWN_SANDBOX_NET=1`. The cross-platform picture is in the README's Security model.

Two things that are *not* options on macOS:

- The **vendored bwrap is Linux-only** — don't try to use it (`UNOWN_BWRAP` won't help; `src/bwrap.ts` gates non-Linux hosts out by design, so a Homebrew bwrap can never sneak in either).
- macOS has no `taskkill`/`kill -0` equivalents needed — the lifecycle scripts are plain POSIX here and just work.

## Native terminal behavior

No configuration needed: the TUI ships **bundled darwin prebuilds** (`darwin-modifiers.node` for x64 and arm64) that capture native modifier-key events (Cmd/Cmd-Q etc. in the editor), and macOS's terminal already speaks VT. If you live in tmux, the vendored pi docs have you covered: [`pi-repo/packages/coding-agent/docs/tmux.md`](../pi-repo/packages/coding-agent/docs/tmux.md).

Platform notes worth knowing:

- **The `powershell` tool is Windows-only** — it throws "only available on Windows" on macOS even when PowerShell 7 (`pwsh`) is installed (the tool wraps Windows PowerShell semantics; it is opt-in on win32 sessions). Script with `bash` instead.
- **User hooks (`command` handlers) run under `/bin/sh`** (dash on macOS) — same as Linux; a `powershell -File …` handler only works where PowerShell exists.
- **The OS sandbox is seatbelt**, not bubblewrap — see [the OS sandbox section](#the-os-sandbox-on-macos) above; the engine detects darwin and builds the SBPL profile at run time.

## When something breaks

`unown doctor` first, then [troubleshooting](troubleshooting.md). The logs are in `.run/` inside the repo, same as every OS.
