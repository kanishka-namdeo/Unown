#!/usr/bin/env bash
# Unown benchmark toolchain — user-space restore script.
# Re-provisions everything a polyglot-benchmark sandbox wipe destroys.
# Idempotent: safe to re-run; skips pieces that already verify.
set -uo pipefail

HOME_DIR="$HOME"
LOCAL_BIN="$HOME_DIR/.local/bin"
LOG_DIR="/home/z/my-project/bench-runs/toolchain-logs"
mkdir -p "$LOCAL_BIN" "$LOG_DIR"

log() { echo "[$(date +%H:%M:%S)] $*"; }

# ── Go (latest stable) ────────────────────────────────────────────────────────
install_go() {
  if [ -x "$HOME_DIR/.local/go/bin/go" ]; then log "go: present ($("$HOME_DIR/.local/go/bin/go" version))"; return 0; fi
  local ver
  ver=$(curl -fsS "https://go.dev/VERSION?m=text" | head -1)
  log "go: installing $ver"
  curl -fsSL "https://go.dev/dl/${ver}.linux-amd64.tar.gz" -o "$LOG_DIR/go.tgz" \
    && rm -rf "$HOME_DIR/.local/go" \
    && mkdir -p "$HOME_DIR/.local" \
    && tar -C "$HOME_DIR/.local" -xzf "$LOG_DIR/go.tgz" \
    && log "go: OK ($("$HOME_DIR/.local/go/bin/go" version))"
}

# ── JDK 21 (Temurin via Adoptium API) ─────────────────────────────────────────
install_jdk() {
  if "$HOME_DIR/.local/jdk-21/bin/java" -version 2>&1 | grep -q '"21'; then log "jdk: present"; return 0; fi
  log "jdk: downloading Temurin 21"
  curl -fsSL "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse" \
    -o "$LOG_DIR/jdk21.tgz" || { log "jdk: adoptium API failed"; return 1; }
  rm -rf "$HOME_DIR/.local/jdk-21" "$HOME_DIR/.local/jdk21-extract"
  mkdir -p "$HOME_DIR/.local/jdk21-extract"
  tar -C "$HOME_DIR/.local/jdk21-extract" -xzf "$LOG_DIR/jdk21.tgz"
  local inner
  inner=$(ls -d "$HOME_DIR/.local/jdk21-extract"/* | head -1)
  mv "$inner" "$HOME_DIR/.local/jdk-21"
  rmdir "$HOME_DIR/.local/jdk21-extract" 2>/dev/null || true
  log "jdk: OK ($("$HOME_DIR/.local/jdk-21/bin/java" -version 2>&1 | head -1))"
}

# ── Rust (via rustup, unattended) ─────────────────────────────────────────────
install_rust() {
  if [ -x "$HOME_DIR/.cargo/bin/rustc" ]; then log "rust: present ($("$HOME_DIR/.cargo/bin/rustc" --version))"; return 0; fi
  log "rust: installing via rustup"
  curl -fsSL https://sh.rustup.rs -o "$LOG_DIR/rustup-init.sh" \
    && sh "$LOG_DIR/rustup-init.sh" -y --default-toolchain stable --profile minimal \
      --no-modify-path >/dev/null 2>&1 \
    && log "rust: OK ($("$HOME_DIR/.cargo/bin/rustc" --version))"
}

# ── fd (GitHub release binary) ────────────────────────────────────────────────
install_fd() {
  if [ -x "$LOCAL_BIN/fd" ]; then log "fd: present"; return 0; fi
  local url
  url=$(curl -fsSL https://api.github.com/repos/sharkdp/fd/releases/latest \
    | grep -oE '"browser_download_url": *"[^"]*fd-v[0-9.]+-x86_64-unknown-linux-musl\.tar\.gz"' \
    | head -1 | grep -oE 'https[^"]*')
  log "fd: installing from $url"
  curl -fsSL "$url" -o "$LOG_DIR/fd.tgz" \
    && tar -C "$LOG_DIR" -xzf "$LOG_DIR/fd.tgz" \
    && mv "$LOG_DIR"/fd-*-x86_64-unknown-linux-musl/fd "$LOCAL_BIN/fd" \
    && rm -rf "$LOG_DIR"/fd-*-x86_64-unknown-linux-musl \
    && log "fd: OK ($("$LOCAL_BIN/fd" --version))"
}

# ── cmake (pip into the persistent venv, symlink into ~/.local/bin) ───────────
install_cmake() {
  if [ -x "$LOCAL_BIN/cmake" ] || command -v cmake >/dev/null 2>&1; then log "cmake: present"; return 0; fi
  /home/z/.venv/bin/pip install -q cmake \
    && ln -sf /home/z/.venv/bin/cmake "$LOCAL_BIN/cmake" \
    && log "cmake: OK ($("$LOCAL_BIN/cmake" --version | head -1))"
}

install_go
install_jdk
install_rust
install_fd
install_cmake

log "=== versions ==="
"$HOME_DIR/.local/go/bin/go" version 2>&1 || echo "go FAILED"
"$HOME_DIR/.local/jdk-21/bin/java" -version 2>&1 | head -1 || echo "jdk FAILED"
"$HOME_DIR/.cargo/bin/rustc" --version 2>&1 || echo "rust FAILED"
"$LOCAL_BIN/fd" --version 2>&1 || echo "fd FAILED"
"$LOCAL_BIN/cmake" --version 2>&1 | head -1 || echo "cmake FAILED"
log "toolchain restore complete"
