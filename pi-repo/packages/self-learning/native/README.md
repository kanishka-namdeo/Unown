# native/ — vendored sandbox binary

## bin/bwrap

- **What**: bubblewrap 0.12.0 — the unprivileged Linux sandbox (user/mount/net/IPC namespaces) that underpins Flatpak's isolation; also the basis of Claude Code's Linux sandbox and OpenAI Codex's current Linux sandbox.
- **Why vendored**: this environment has no root (no `apt install`), no Docker/KVM (no microVM options), and a 5.10 kernel (no Landlock). Unprivileged user namespaces are available, which is exactly what bubblewrap needs.
- **Provenance**: extracted from the Debian 13 (trixie) repository package `bubblewrap_0.12.0-1~deb13u1_amd64.deb` (fetched via `apt-get download bubblewrap`, unpacked with `dpkg -x`). Distro-built, stripped, `setuid`-free (0.12 relies on unprivileged userns only).
- **SHA-256**: `573236e5328ac2ebb08f59ae3a9805b4f8d12bdef14be8af4450d5463294985f`
- **License**: LGPL-2.1-or-later (upstream: https://github.com/containers/bubblewrap).

## Refresh

```bash
cd scripts && apt-get download bubblewrap
mkdir -p /tmp/bx && dpkg -x bubblewrap_*.deb /tmp/bx
cp /tmp/bx/usr/bin/bwrap ../pi-repo/packages/self-learning/native/bin/bwrap
sha256sum ../pi-repo/packages/self-learning/native/bin/bwrap   # record above
```

Then re-run `scripts/bwrap_smoke.sh` and `scripts/verify_sandbox.sh` — both must fully pass before committing a new binary.
