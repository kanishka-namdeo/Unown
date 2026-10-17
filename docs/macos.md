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

Then the standard install: `git clone … && cd Unown && bun run agent:install` (PATH shim goes to `~/.local/bin/unown`; if that dir wasn't on your PATH, the installer prints the exact profile line to add).

## The OS sandbox on macOS

The engine's OS-level sandbox backend for macOS is **seatbelt (`sandbox-exec`)**, landing in parallel with this documentation (the M3 branch). Once merged, engine sandbox runs on macOS get a **bwrap-equivalent seatbelt profile**:

- filesystem **reads allowed**, writes confined to the workspace + system temp,
- **network denied by default** (`UNOWN_SANDBOX_NET=1` to share it),
- the same guarantees the Linux leg gets from bubblewrap, expressed in seatbelt.

Until that merge, macOS behaves exactly like today: engine runs use the in-process path jail and `unown doctor` reports `OS sandbox (macOS)` ⚠ — chat and learning are unaffected either way.

Two things that are *not* options on macOS:

- The **vendored bwrap is Linux-only** — don't try to use it (`UNOWN_BWRAP` won't help; `src/bwrap.ts` gates non-Linux hosts out by design, so a Homebrew bwrap can never sneak in either).
- macOS has no `taskkill`/`kill -0` equivalents needed — the lifecycle scripts are plain POSIX here and just work.

## Native terminal behavior

No configuration needed: the TUI ships **bundled darwin prebuilds** (`darwin-modifiers.node` for x64 and arm64) that capture native modifier-key events (Cmd/Cmd-Q etc. in the editor), and macOS's terminal already speaks VT. If you live in tmux, the vendored pi docs have you covered: [`pi-repo/packages/coding-agent/docs/tmux.md`](../pi-repo/packages/coding-agent/docs/tmux.md).

## When something breaks

`unown doctor` first, then [troubleshooting](troubleshooting.md). The logs are in `.run/` inside the repo, same as every OS.
