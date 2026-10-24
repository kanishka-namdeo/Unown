#!/usr/bin/env bash
# Reset the api-server demo fixture (UNOWN_DEMO_DIR) to the state a scenario needs.
# Fixture states are identified by TAGS (created by prepare_fixture.sh), never by
# raw SHAs, so a freshly-prepared clone works unchanged.
#   prep_demo.sh s1-hero-bugfix   → tag "seed"  (bug present, suite red)
#   prep_demo.sh s3-checkpoints   → tag "fixed" (clean tree, suite green)
#   prep_demo.sh s5-review        → "seed" + uncommitted one-char hero fix (green, dirty)
#   prep_demo.sh default          → tag "fixed", clean
# .unown/ (project memory read by the TUI at boot) is preserved on disk across
# resets — it is what makes the boot screen show the real memory tiers.
set -euo pipefail
D="${UNOWN_DEMO_DIR:-/home/z/my-project/demo-projects/api-server}"
cd "$D"
rm -rf /tmp/api-unown-bak
if [ -d .unown ]; then cp -r .unown /tmp/api-unown-bak; fi
git reset -q --hard fixed
git clean -qfdx -e .unown -- src/ test/
case "${1:-default}" in
  s1-hero-bugfix)
    git reset -q --hard seed
    ;;
  s3-checkpoints)
    ;;
  s5-review)
    git reset -q --hard seed
    sed -i 's/page \* perPage + 1/page * perPage/' src/pagination.ts
    ;;
  s14-mcp)
    # the Mcp lane's dice server at USER scope (trusted by definition — the
    # user's own config dir; the landing copy's .unown/mcp.json project flow
    # is the same plumbing one file away). Idempotent: a stale entry is
    # replaced so the fixture state never drifts between runs.
    unown mcp remove dice >/dev/null 2>&1 || true
    unown mcp add dice bun "${UNOWN_ROOT:-/home/z/my-project/Unown}/scripts/tui-capture/fixtures/mini-mcp-dice.mjs" >/dev/null
    unown mcp list
    ;;
esac
# Restore .unown if it existed (part of the boot screen a real user sees);
# otherwise leave it absent — the TUI scaffolds a fresh one on first boot,
# exactly what a first-run user gets.
rm -rf .unown
[ -d /tmp/api-unown-bak ] && cp -r /tmp/api-unown-bak .unown
echo "[$1] HEAD=$(git rev-parse --short HEAD) tags: $(git describe --tags)"
git status --short
echo "--- suite ---"
set +e
bun test 2>&1 | grep -E "^ *[0-9]+ (pass|fail)|Ran [0-9]+ tests" || true
set -e
