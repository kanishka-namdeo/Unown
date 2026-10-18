#!/bin/sh
# unown installer — the one-line bootstrap.
#
#   curl -fsSL https://unown-nine.vercel.app/install.sh | sh
#
# or pinned to a release:
#   curl -fsSL https://unown-nine.vercel.app/install.sh | sh -s -- --version v2.1.0
#
# What it does: checks git, checks/installs bun (bun's own installer),
# clones the repo (default: main; --version pins a release tag), and runs
# the repo's own installer (bun run agent:install) which builds everything
# and puts `unown` on your PATH. Uninstall: `unown uninstall`.
#
# curl|bash mitigations implemented here (the standard set):
#   - the whole body runs inside main() { ... }; main "$@" — bash reads the
#     pipe incrementally, so a truncated/mid-stream script must not execute
#     half of itself
#   - set -eu: fail fast, no half-installs
#   - refuses to run as root
#   - --version + --dest flags; --help; ASCII only; POSIX sh; LF endings
#   - review-before-running works too:
#       curl -fsSL <url> -o install.sh && sh install.sh
#     (or use https://checksum.sh to verify before executing)
#   - integrity: the clone comes over HTTPS from GitHub; releases are git
#     tags with SLSA build-provenance attestations on the GitHub Release
#
# The script is served from the repo's Vercel deployment (public/install.sh
# in the repository — https://github.com/kanishka-namdeo/Unown).

set -eu

VERSION=""
DEST="Unown"
REPO="https://github.com/kanishka-namdeo/Unown.git"

usage() {
  cat <<'USAGE'
unown installer

  sh install.sh [--version vX.Y.Z] [--dest DIR]

  --version   pin to a release tag (default: main branch)
  --dest      clone directory (default: ./Unown)
  --help      this help

After install: unown setup   (connect a model)
              unown doctor   (verify)
              unown update   (stay current)
USAGE
}

main() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --version) VERSION="$2"; shift 2 ;;
      --dest) DEST="$2"; shift 2 ;;
      --help|-h) usage; exit 0 ;;
      *) echo "install.sh: unknown argument: $1 (see --help)" >&2; exit 1 ;;
    esac
  done

  # refuse root: builds + PATH shims belong to a user account
  if [ "$(id -u)" = "0" ] && [ "${UNOWN_INSTALL_ALLOW_ROOT:-}" != "1" ]; then
    echo "install.sh: refusing to run as root (override: UNOWN_INSTALL_ALLOW_ROOT=1)" >&2
    exit 1
  fi

  # git
  if ! command -v git >/dev/null 2>&1; then
    echo "install.sh: git is required (https://git-scm.com)" >&2
    exit 1
  fi

  # bun (bootstrap via bun's own installer when missing)
  if ! command -v bun >/dev/null 2>&1; then
    echo "install.sh: bun not found - installing it (https://bun.sh)"
    curl -fsSL https://bun.sh/install | bash
    # bun lands in ~/.bun/bin; make it visible for THIS script
    BUN_HOME="$HOME/.bun/bin"
    case ":$PATH:" in
      *":$BUN_HOME:"*) ;;
      *) PATH="$BUN_HOME:$PATH" ;;
    esac
    export PATH
    if ! command -v bun >/dev/null 2>&1; then
      echo "install.sh: bun install failed - install it manually, then re-run" >&2
      exit 1
    fi
  fi

  # clone
  if [ -e "$DEST" ]; then
    echo "install.sh: $DEST already exists - remove it or pass --dest DIR" >&2
    exit 1
  fi
  if [ -n "$VERSION" ]; then
    echo "install.sh: cloning Unown at $VERSION into ./$DEST"
    git clone --quiet --branch "$VERSION" "$REPO" "$DEST"
  else
    echo "install.sh: cloning Unown (main) into ./$DEST"
    git clone --quiet "$REPO" "$DEST"
  fi

  # install (deps + pi build + .env + PATH shim)
  cd "$DEST"
  bun run agent:install

  echo ""
  echo "next steps:"
  echo "  cd $DEST && unown setup     # connect a model provider"
  echo "  unown doctor                # verify the chat path end to end"
  echo "  unown update                # stay current (self-update)"
  echo ""
  echo "uninstall anytime: unown uninstall"
}

main "$@"
