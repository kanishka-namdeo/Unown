#!/bin/sh
# unown installer - the one-line bootstrap.
#
#   curl -fsSL https://unown-nine.vercel.app/install.sh | sh
#   curl -fsSL https://unown-nine.vercel.app/install.sh | sh -s -- --main
#   curl -fsSL https://unown-nine.vercel.app/install.sh | sh -s -- --binary
#
# Two modes:
#
#   default (source checkout) - checks git, checks/installs bun (bun's own
#     installer), clones the newest STABLE release tag (vX.Y.Z, no prerelease
#     suffix), and runs the repo's own installer (bun run agent:install), which
#     builds the full stack and puts `unown` on your PATH. --main is an explicit
#     edge install of the main branch; --version vX.Y.Z pins a release tag.
#
#   --binary - downloads the per-OS release archive, verifies its SHA-256
#     against the SAME release's sha256sums.txt, and installs the CLI
#     atomically under ${UNOWN_INSTALL_ROOT:-$XDG_DATA_HOME/unown}/versions/
#     <version>/ with a PATH shim and ~/.unown/install.json metadata. No git
#     and no bun are required. The binary is the CLI only - the engine and
#     learning stack need the source install.
#
# Release assets come from https://github.com/kanishka-namdeo/Unown/releases
# (override the base with UNOWN_RELEASES_BASE_URL). Latest is fetched from
# <base>/latest/download/<name>; a pin from <base>/download/v<version>/<name>.
#
# curl|sh mitigations implemented here (the standard set):
#   - the whole body runs inside main() { ... }; main "$@" - sh reads the pipe
#     incrementally, so a truncated/mid-stream script must not execute half of
#     itself
#   - set -eu: fail fast, no half-installs
#   - refuses to run as root
#   - downloads use --proto '=https' --tlsv1.2; the binary path verifies a
#     SHA-256 checksum before extracting and never trusts a missing entry
#   - --help; ASCII only; POSIX sh; LF endings
#   - review-before-running works too:
#       curl -fsSL <url> -o install.sh && sh install.sh
#     (or use https://checksum.sh to verify before executing)
#   - source integrity: the clone comes over HTTPS from GitHub; release tags
#     carry SLSA build-provenance attestations on the GitHub Release
#
# The script is served from the repo's Vercel deployment (public/install.sh
# in the repository - https://github.com/kanishka-namdeo/Unown).

set -eu

VERSION=""
TAG=""
DEST="Unown"
DEST_SET=0
MAIN=0
BINARY=0
FORCE=0
REPO="https://github.com/kanishka-namdeo/Unown.git"
RELEASES_BASE_URL="${UNOWN_RELEASES_BASE_URL:-https://github.com/kanishka-namdeo/Unown/releases}"
case "$RELEASES_BASE_URL" in
  https://*) CURL_PROTO="=https" ;;
  http://*) CURL_PROTO="=http,https" ;; # explicit mirror/test override only
  *) CURL_PROTO="=https" ;;
esac

TMP=""
EXISTING_MODE=""
EXISTING_VERSION=""
EXISTING_SHIM=""
EXISTING_PREV=""
PREVIOUS_VERSION=""

cleanup() {
  if [ -n "$TMP" ] && [ -d "$TMP" ]; then
    rm -rf "$TMP"
  fi
}

fail() {
  echo "install.sh: $*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
unown installer

  sh install.sh [--version vX.Y.Z] [--dest DIR] [--main] [--force]
  sh install.sh --binary [--version vX.Y.Z] [--force] [--experimental]

  default        source checkout: clone the newest stable release tag and run
                 bun run agent:install (full stack; needs git + bun)
  --main         source install from the main branch (edge) instead of a tag
  --binary       standalone CLI binary: verified download, no git/bun required
  --version      pin a release (vX.Y.Z or X.Y.Z)
  --dest         source clone directory (default: ./Unown; not valid with --binary)
  --force        replace an install recorded in the other mode
  --experimental accepted for install.ps1 parity (Windows arm64 only; no effect here)
  --help         this help

Version policy: without --version the source mode picks the newest stable
vX.Y.Z tag; --binary installs the release marked "latest". Prerelease tags
are never picked implicitly.

After install: unown setup   (connect a model)
              unown doctor   (verify)
              unown update   (stay current)
USAGE
}

normalize_version() {
  # accepts v0.0.2 or 0.0.2; rejects prerelease/build suffixes
  NORM="$1"
  case "$NORM" in
    v*) NORM="${NORM#v}" ;;
    V*) NORM="${NORM#V}" ;;
  esac
  if ! printf '%s' "$NORM" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    fail "invalid --version '$1': expected a stable release like v0.0.2 (no prerelease suffix)"
  fi
  VERSION="$NORM"
  TAG="v$NORM"
}

check_install_meta() {
  # $1 = mode we are about to install (checkout|binary)
  META="$UNOWN_HOME/install.json"
  EXISTING_MODE=""
  EXISTING_VERSION=""
  EXISTING_SHIM=""
  EXISTING_PREV=""

  if [ ! -f "$META" ]; then
    return 0
  fi

  EXISTING_MODE=$(sed -n 's/.*"mode"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$META" | head -n 1)
  EXISTING_VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$META" | head -n 1)
  EXISTING_SHIM=$(sed -n 's/.*"shim"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$META" | head -n 1)
  EXISTING_PREV=$(sed -n 's/.*"previousVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$META" | head -n 1)

  if [ -z "$EXISTING_MODE" ]; then
    if [ "$FORCE" != "1" ]; then
      fail "cannot read the install mode from $META. Refusing to guess; pass --force to install the $1 mode anyway, or remove that file."
    fi
    return 0
  fi

  # The runtime writes "checkout"; accept the task's "source" spelling too so a
  # pre-release record cannot block a normal source reinstall.
  case "$EXISTING_MODE" in
    source|checkout) EXISTING_MODE="checkout" ;;
  esac

  if [ "$EXISTING_MODE" != "$1" ]; then
    if [ "$FORCE" != "1" ]; then
      WHERE=""
      if [ -n "$EXISTING_SHIM" ]; then
        WHERE=" at $EXISTING_SHIM"
      fi
      fail "an existing $EXISTING_MODE install is recorded$WHERE ($META); refusing to install the $1 mode over it. Re-run with --force to replace it, or uninstall the $EXISTING_MODE install first."
    fi
  fi
}

resolve_latest_tag() {
  echo "install.sh: resolving the newest stable release tag..."
  if ! TAGS=$(git ls-remote --tags --refs --sort=-v:refname "$REPO" 'v*' 2>&1); then
    fail "could not list release tags from $REPO: $TAGS"
  fi
  LATEST_TAG=$(printf '%s\n' "$TAGS" | awk -F/ '$3 ~ /^v[0-9]+\.[0-9]+\.[0-9]+$/ { print $3; exit }')
  if [ -z "$LATEST_TAG" ]; then
    fail "no stable release tags (vX.Y.Z) found in $REPO. Re-run with --main to install the edge branch, or --version vX.Y.Z to pin one."
  fi
}

verify_tag_version() {
  # $1 = checkout dir, $2 = tag (vX.Y.Z)
  PKG_DIR="$1"
  TAG_NAME="$2"
  WANT="${TAG_NAME#v}"
  GOT=$(UNOWN_PKG="$PKG_DIR/package.json" bun -e 'const fs = require("node:fs"); const p = JSON.parse(fs.readFileSync(process.env.UNOWN_PKG, "utf8")); process.stdout.write(String(p.version || ""));' 2>/dev/null || true)
  if [ "$GOT" != "$WANT" ]; then
    fail "release tag $TAG_NAME does not match its package.json version (${GOT:-unreadable}). Refusing a half-pushed release. Remove $PKG_DIR and re-run with --main, or pick another --version."
  fi
}

install_source() {
  # git
  if ! command -v git >/dev/null 2>&1; then
    fail "git is required for the source install (https://git-scm.com). Use --binary for a CLI-only install with no git."
  fi

  # bun (bootstrap via bun's own installer when missing)
  if ! command -v bun >/dev/null 2>&1; then
    echo "install.sh: bun not found - installing it (https://bun.sh)"
    curl -fsSL --proto '=https' --tlsv1.2 https://bun.sh/install | bash
    # bun lands in ~/.bun/bin; make it visible for THIS script
    BUN_HOME="$HOME/.bun/bin"
    case ":$PATH:" in
      *":$BUN_HOME:"*) ;;
      *) PATH="$BUN_HOME:$PATH" ;;
    esac
    export PATH
    if ! command -v bun >/dev/null 2>&1; then
      fail "bun install failed - install it manually (https://bun.sh), then re-run"
    fi
  fi

  # clone
  if [ -e "$DEST" ]; then
    fail "$DEST already exists - remove it or pass --dest DIR"
  fi

  if [ "$MAIN" = "1" ]; then
    echo "install.sh: cloning Unown (main - edge) into $DEST"
    if ! git clone --quiet "$REPO" "$DEST"; then
      fail "git clone failed. Remove $DEST if a partial checkout was left behind, then retry."
    fi
  else
    if [ -n "$TAG" ]; then
      CLONE_TAG="$TAG"
    else
      resolve_latest_tag
      CLONE_TAG="$LATEST_TAG"
    fi
    echo "install.sh: cloning Unown at $CLONE_TAG (stable release) into $DEST"
    if ! git clone --quiet --branch "$CLONE_TAG" "$REPO" "$DEST"; then
      fail "git clone of $CLONE_TAG failed. If that tag does not exist, run without --version for the newest stable release (or --main for the edge branch). Remove $DEST if a partial checkout was left behind."
    fi
    verify_tag_version "$DEST" "$CLONE_TAG"
  fi

  # install (deps + pi build + .env + PATH shim)
  cd "$DEST"
  CHECKOUT=$(pwd)
  if ! bun run agent:install; then
    fail "agent:install failed. The checkout remains at $CHECKOUT for diagnosis; fix the error and re-run 'bun run agent:install' there."
  fi

  INSTALLED=$(cd "$CHECKOUT" && bun bin/unown --version 2>/dev/null | head -n 1 || true)
  if [ -z "$INSTALLED" ]; then
    INSTALLED="unknown"
  fi

  SHIM=""
  if [ -n "${UNOWN_BIN_DIR:-}" ]; then
    for CANDIDATE in "$UNOWN_BIN_DIR/unown" "$UNOWN_BIN_DIR/unown.cmd" "$UNOWN_BIN_DIR/unown.ps1"; do
      if [ -f "$CANDIDATE" ]; then
        SHIM="$CANDIDATE"
        break
      fi
    done
  else
    for CANDIDATE in "$HOME/.local/bin/unown" "$HOME/.local/bin/unown.cmd" "$HOME/.local/bin/unown.ps1" "$HOME/bin/unown" "/usr/local/bin/unown"; do
      if [ -f "$CANDIDATE" ]; then
        SHIM="$CANDIDATE"
        break
      fi
    done
  fi
  if [ -z "$SHIM" ]; then
    SHIM=$(command -v unown 2>/dev/null || true)
  fi
  if [ -z "$SHIM" ]; then
    SHIM="not found yet - run: bun run agent:link"
  fi

  echo ""
  echo "unown $INSTALLED installed (checkout)"
  echo "  checkout: $CHECKOUT"
  echo "  shim:     $SHIM"
  echo ""
  echo "next steps:"
  echo "  cd \"$CHECKOUT\" && unown setup     # connect a model provider"
  echo "  unown doctor                    # verify the chat path end to end"
  echo "  unown update                    # stay current (self-update)"
  echo ""
  echo "uninstall anytime: unown uninstall"
}

detect_platform() {
  OS_NAME=$(uname -s)
  ARCH_NAME=$(uname -m)
  case "$OS_NAME" in
    Darwin)
      # Rosetta: an x86_64 shell on Apple silicon should get the arm64 build
      if [ "$ARCH_NAME" = "x86_64" ] && command -v sysctl >/dev/null 2>&1; then
        TRANSLATED=$(sysctl -in sysctl.proc_translated 2>/dev/null || true)
        if [ "$TRANSLATED" = "1" ]; then
          ARCH_NAME="arm64"
        fi
      fi
      case "$ARCH_NAME" in
        arm64|aarch64) PLATFORM="darwin-arm64" ;;
        x86_64|amd64) PLATFORM="darwin-x64" ;;
        *) fail "unsupported macOS architecture '$ARCH_NAME' (release assets: darwin-arm64, darwin-x64)" ;;
      esac
      ;;
    Linux)
      case "$ARCH_NAME" in
        aarch64|arm64) PLATFORM="linux-arm64" ;;
        x86_64|amd64) PLATFORM="linux-x64" ;;
        *) fail "unsupported Linux architecture '$ARCH_NAME' (release assets: linux-arm64, linux-x64)" ;;
      esac
      # released Linux binaries are glibc-only; musl cannot run them
      MUSL=0
      if command -v ldd >/dev/null 2>&1; then
        if ldd --version 2>&1 | grep -qi musl; then
          MUSL=1
        fi
      fi
      if [ "$MUSL" != "1" ]; then
        for LIB in /lib/ld-musl-*.so.1 /lib/ld-musl-*; do
          if [ -e "$LIB" ]; then
            MUSL=1
            break
          fi
        done
      fi
      if [ -e /etc/alpine-release ]; then
        MUSL=1
      fi
      if [ "$MUSL" = "1" ]; then
        fail "this machine uses musl libc, but the released Linux binaries are glibc-only. Use the source install (sh install.sh) or build from source."
      fi
      ;;
    *)
      fail "the binary install supports macOS and Linux; on Windows run the PowerShell installer (irm https://unown-nine.vercel.app/install.ps1 | iex). For source on this OS, use git clone + bun run agent:install."
      ;;
  esac
}

download() {
  # $1 = url, $2 = output file
  if ! curl -fsSL --proto "$CURL_PROTO" --tlsv1.2 -o "$2" "$1"; then
    fail "download failed: $1 (check network access to the release host; UNOWN_RELEASES_BASE_URL overrides the base)"
  fi
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  else
    fail "no SHA-256 tool found (need sha256sum, shasum, or openssl)"
  fi
}

sh_quote() {
  # single-quote a value for a POSIX sh shim
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
}

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

write_binary_metadata() {
  if ! mkdir -p "$UNOWN_HOME"; then
    fail "could not create $UNOWN_HOME for the install metadata (set UNOWN_HOME to a writable directory)"
  fi
  META_TMP="$UNOWN_HOME/install.json.tmp.$$"
  ROOT_JSON=$(json_escape "$ROOT")
  BIN_JSON=$(json_escape "$FINAL/unown")
  SHIM_JSON=$(json_escape "$SHIM_PATH")
  INSTALLED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  if [ -n "$PREVIOUS_VERSION" ]; then
    if ! printf '{\n  "schema": 1,\n  "mode": "binary",\n  "version": "%s",\n  "platform": "%s",\n  "root": "%s",\n  "bin": "%s",\n  "shim": "%s",\n  "previousVersion": "%s",\n  "installedAt": "%s"\n}\n' \
      "$VERSION" "$PLATFORM" "$ROOT_JSON" "$BIN_JSON" "$SHIM_JSON" "$PREVIOUS_VERSION" "$INSTALLED_AT" > "$META_TMP"; then
      rm -f "$META_TMP"
      fail "could not write $UNOWN_HOME/install.json (the previous metadata was left untouched)"
    fi
  else
    if ! printf '{\n  "schema": 1,\n  "mode": "binary",\n  "version": "%s",\n  "platform": "%s",\n  "root": "%s",\n  "bin": "%s",\n  "shim": "%s",\n  "installedAt": "%s"\n}\n' \
      "$VERSION" "$PLATFORM" "$ROOT_JSON" "$BIN_JSON" "$SHIM_JSON" "$INSTALLED_AT" > "$META_TMP"; then
      rm -f "$META_TMP"
      fail "could not write $UNOWN_HOME/install.json (the previous metadata was left untouched)"
    fi
  fi

  if ! mv -f "$META_TMP" "$UNOWN_HOME/install.json"; then
    rm -f "$META_TMP"
    fail "could not write $UNOWN_HOME/install.json (the previous metadata was left untouched)"
  fi
}

install_binary() {
  if ! command -v curl >/dev/null 2>&1; then
    fail "curl is required for --binary (it is the downloader). Install curl, or use the source install: sh install.sh"
  fi

  detect_platform

  ROOT="${UNOWN_INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/unown}"
  BIN_DIR="${UNOWN_BIN_DIR:-$HOME/.local/bin}"
  BIN_DIR="${BIN_DIR%/}"
  # absolute paths: the shim and metadata must not depend on the caller's cwd
  case "$ROOT" in
    /*) ;;
    *) ROOT="$(pwd)/$ROOT" ;;
  esac
  case "$BIN_DIR" in
    /*) ;;
    *) BIN_DIR="$(pwd)/$BIN_DIR" ;;
  esac

  case "$RELEASES_BASE_URL" in
    */) RELEASES_BASE_URL="${RELEASES_BASE_URL%/}" ;;
  esac
  case "$RELEASES_BASE_URL" in
    http://*) echo "install.sh: WARNING: using an insecure http release base (mirror/test only): $RELEASES_BASE_URL" ;;
  esac

  if [ -n "$TAG" ]; then
    RELEASE_BASE="$RELEASES_BASE_URL/download/$TAG"
  else
    RELEASE_BASE="$RELEASES_BASE_URL/latest/download"
  fi

  SHIM_PATH="$BIN_DIR/unown"
  # An older checkout install has a shim but no install.json (the metadata was
  # introduced with this release). Refuse before downloading or installing
  # anything, so a refusal leaves no versioned tree behind.
  if [ -e "$SHIM_PATH" ] && [ "$FORCE" != "1" ]; then
    if ! { grep -Fq "UNOWN_INSTALL_ROOT" "$SHIM_PATH" 2>/dev/null && grep -Fq "$ROOT" "$SHIM_PATH" 2>/dev/null; }; then
      fail "an existing command is at $SHIM_PATH and is not this binary install. Refusing to overwrite it; re-run with --force to replace it, or uninstall the existing install first."
    fi
  fi

  mkdir -p "$ROOT" || fail "could not create the install root $ROOT (set UNOWN_INSTALL_ROOT to a writable directory)"
  TMP=$(mktemp -d "$ROOT/.install-tmp.XXXXXX") || fail "could not create a temp directory under $ROOT (set UNOWN_INSTALL_ROOT to a writable directory)"

  # The version.txt asset is authoritative when present; the archive's VERSION
  # file is the fallback, and both must agree with an explicit --version.
  RELEASE_VERSION=""
  VERSION_TXT="$TMP/version.txt"
  if curl -fsSL --proto "$CURL_PROTO" --tlsv1.2 -o "$VERSION_TXT" "$RELEASE_BASE/version.txt" 2>/dev/null; then
    RELEASE_VERSION=$(tr -d '\r\n' < "$VERSION_TXT" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    if ! printf '%s' "$RELEASE_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
      fail "the release's version.txt is not plain semver (got '$RELEASE_VERSION')"
    fi
    if [ -n "$VERSION" ] && [ "$VERSION" != "$RELEASE_VERSION" ]; then
      fail "pinned version $TAG does not match version.txt ($RELEASE_VERSION) in that release"
    fi
    if [ -z "$VERSION" ]; then
      VERSION="$RELEASE_VERSION"
    fi
  fi

  ARCHIVE_NAME="unown-$PLATFORM.tar.gz"
  ARCHIVE="$TMP/$ARCHIVE_NAME"
  SUMS="$TMP/sha256sums.txt"

  echo "install.sh: downloading $ARCHIVE_NAME from $RELEASE_BASE"
  download "$RELEASE_BASE/$ARCHIVE_NAME" "$ARCHIVE"
  download "$RELEASE_BASE/sha256sums.txt" "$SUMS"

  EXPECTED=$(awk -v want="$ARCHIVE_NAME" '{ name = $2; sub(/^\*/, "", name); if (name == want) { print $1; exit } }' "$SUMS")
  if ! printf '%s' "$EXPECTED" | grep -Eq '^[0-9a-fA-F]{64}$'; then
    fail "no usable SHA-256 entry for $ARCHIVE_NAME in $RELEASE_BASE/sha256sums.txt (got '${EXPECTED:-<missing>}'). Refusing to install an unverified download."
  fi
  EXPECTED=$(printf '%s' "$EXPECTED" | tr 'A-F' 'a-f')
  ACTUAL=$(sha256_of "$ARCHIVE" | tr 'A-F' 'a-f')
  if [ "$EXPECTED" != "$ACTUAL" ]; then
    fail "SHA-256 mismatch for $ARCHIVE_NAME: expected $EXPECTED, got $ACTUAL. Refusing to install a corrupted or tampered download."
  fi
  echo "install.sh: checksum verified ($ACTUAL)"

  EXTRACT="$TMP/extract"
  mkdir -p "$EXTRACT"
  if ! tar -xzf "$ARCHIVE" -C "$EXTRACT"; then
    fail "could not extract $ARCHIVE_NAME"
  fi
  STAGE="$EXTRACT/unown-$PLATFORM"
  if [ ! -f "$STAGE/unown" ]; then
    fail "archive $ARCHIVE_NAME does not contain unown-$PLATFORM/unown"
  fi
  if [ ! -f "$STAGE/VERSION" ]; then
    fail "archive $ARCHIVE_NAME has no VERSION file"
  fi

  ARCHIVE_VERSION=$(tr -d '\r\n' < "$STAGE/VERSION" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  if ! printf '%s' "$ARCHIVE_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    fail "the archive's VERSION file is not plain semver (got '$ARCHIVE_VERSION')"
  fi
  if [ -n "$VERSION" ] && [ "$VERSION" != "$ARCHIVE_VERSION" ]; then
    fail "version mismatch: release metadata says $VERSION, the archive says $ARCHIVE_VERSION"
  fi
  if [ -n "$RELEASE_VERSION" ] && [ "$RELEASE_VERSION" != "$ARCHIVE_VERSION" ]; then
    fail "version mismatch: version.txt says $RELEASE_VERSION, the archive says $ARCHIVE_VERSION"
  fi
  VERSION="$ARCHIVE_VERSION"

  # The builds are unsigned. On macOS the quarantine bit otherwise kills the
  # version check before we can install; clearing it is best effort.
  if [ "$PLATFORM" = "darwin-arm64" ] || [ "$PLATFORM" = "darwin-x64" ]; then
    xattr -d com.apple.quarantine "$STAGE/unown" 2>/dev/null || true
  fi
  chmod 755 "$STAGE/unown" 2>/dev/null || true

  if ! BIN_OUT=$("$STAGE/unown" --version 2>&1); then
    fail "the downloaded binary failed to run (output: '$BIN_OUT'). On macOS, Gatekeeper may have blocked this unsigned build: xattr -d com.apple.quarantine '$STAGE/unown' and retry."
  fi
  if [ "$BIN_OUT" != "$VERSION" ]; then
    fail "binary --version printed '$BIN_OUT', expected '$VERSION'. Refusing to install a mismatched artifact."
  fi

  # previousVersion: the same-mode install this one replaces (upgrade/reinstall)
  PREVIOUS_VERSION=""
  if [ "$EXISTING_MODE" = "binary" ] && [ -n "$EXISTING_VERSION" ]; then
    if [ "$EXISTING_VERSION" != "$VERSION" ]; then
      PREVIOUS_VERSION="$EXISTING_VERSION"
    elif [ -n "$EXISTING_PREV" ]; then
      PREVIOUS_VERSION="$EXISTING_PREV"
    fi
  fi

  # Move the verified tree into versions/<version>. A reinstall of the same
  # version swaps via a backup so a failure restores what was there.
  VERSIONS_DIR="$ROOT/versions"
  mkdir -p "$VERSIONS_DIR" || fail "could not create $VERSIONS_DIR"
  FINAL="$VERSIONS_DIR/$VERSION"
  OLD_DIR=""
  if [ -e "$FINAL" ]; then
    OLD_DIR="$TMP/previous-$VERSION"
    if ! mv "$FINAL" "$OLD_DIR"; then
      fail "could not move the existing $FINAL aside; nothing was changed"
    fi
  fi
  if ! mv "$STAGE" "$FINAL"; then
    if [ -n "$OLD_DIR" ] && [ -d "$OLD_DIR" ]; then
      mv "$OLD_DIR" "$FINAL" 2>/dev/null || true
    fi
    fail "could not move the verified install into $FINAL; the previous version was left in place"
  fi
  if [ -n "$OLD_DIR" ] && [ -d "$OLD_DIR" ]; then
    rm -rf "$OLD_DIR"
  fi

  mkdir -p "$BIN_DIR" || fail "could not create the bin directory $BIN_DIR (set UNOWN_BIN_DIR to a writable directory)"
  SHIM_TMP="$BIN_DIR/.unown-shim.$$"
  {
    printf '#!/bin/sh\n'
    printf '# unown shim - written by the Unown installer; re-running it overwrites this file.\n'
    printf "export UNOWN_INSTALL_ROOT='%s'\n" "$(sh_quote "$ROOT")"
    printf "exec '%s' \"\$@\"\n" "$(sh_quote "$FINAL/unown")"
  } > "$SHIM_TMP" || { rm -f "$SHIM_TMP"; fail "could not write the shim temp file in $BIN_DIR"; }
  if ! chmod 755 "$SHIM_TMP"; then
    rm -f "$SHIM_TMP"
    fail "could not make the shim executable in $BIN_DIR"
  fi
  if ! mv -f "$SHIM_TMP" "$SHIM_PATH"; then
    rm -f "$SHIM_TMP"
    fail "could not replace $SHIM_PATH (the previous shim was left untouched)"
  fi

  write_binary_metadata

  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *)
      echo ""
      echo "install.sh: $BIN_DIR is not on your PATH."
      echo "  use it now:"
      echo "    export PATH=\"$BIN_DIR:\$PATH\""
      echo "  add it permanently (then restart the shell):"
      echo "    echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.profile   # or ~/.zshrc for zsh"
      ;;
  esac

  echo ""
  echo "unown $VERSION installed (binary)"
  echo "  binary: $FINAL/unown"
  echo "  shim:   $SHIM_PATH"
  echo ""
  echo "next steps:"
  echo "  unown setup                 # connect a model provider"
  echo "  unown doctor                # verify the chat path end to end"
  echo "  unown update                # update this binary install"
  echo ""
  echo "note: this is the CLI only - the engine/learning stack needs the source install:"
  echo "  sh install.sh"
  echo ""
  echo "the release binaries are unsigned (no code-signing certificate)."
  echo "provenance check (optional, against the archive you downloaded):"
  echo "  gh attestation verify $ARCHIVE_NAME --repo kanishka-namdeo/Unown"
}

main() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --version)
        if [ $# -lt 2 ]; then
          fail "--version needs a value (for example: --version v0.0.2)"
        fi
        normalize_version "$2"
        shift 2
        ;;
      --dest)
        if [ $# -lt 2 ]; then
          fail "--dest needs a directory (for example: --dest ./Unown)"
        fi
        DEST="$2"
        DEST_SET=1
        shift 2
        ;;
      --main) MAIN=1; shift ;;
      --binary) BINARY=1; shift ;;
      --force) FORCE=1; shift ;;
      --experimental) shift ;; # Windows installer only; accepted for flag parity
      --help|-h) usage; exit 0 ;;
      *) fail "unknown argument: $1 (see --help)" ;;
    esac
  done

  if [ -z "${HOME:-}" ]; then
    fail "HOME is not set - the installer needs it for the install root and shims"
  fi

  if [ "$BINARY" = "1" ] && [ "$MAIN" = "1" ]; then
    fail "--main and --binary are mutually exclusive: --binary installs a release archive, --main clones the edge branch"
  fi
  if [ "$BINARY" = "1" ] && [ "$DEST_SET" = "1" ]; then
    fail "--dest is a source-mode flag; the binary install lives under UNOWN_INSTALL_ROOT and cannot use --dest"
  fi
  if [ "$MAIN" = "1" ] && [ -n "$TAG" ]; then
    fail "--main and --version are mutually exclusive: pick the edge branch or a pinned release"
  fi

  # refuse root: builds + PATH shims belong to a user account
  if [ "$(id -u)" = "0" ] && [ "${UNOWN_INSTALL_ALLOW_ROOT:-}" != "1" ]; then
    fail "refusing to run as root (override: UNOWN_INSTALL_ALLOW_ROOT=1)"
  fi

  UNOWN_HOME="${UNOWN_HOME:-$HOME/.unown}"
  case "$UNOWN_HOME" in
    /*) ;;
    *) UNOWN_HOME="$(pwd)/$UNOWN_HOME" ;;
  esac
  trap cleanup EXIT
  trap 'cleanup; exit 1' HUP INT TERM

  if [ "$BINARY" = "1" ]; then
    check_install_meta "binary"
    install_binary
  else
    check_install_meta "checkout"
    install_source
  fi
}

main "$@"
