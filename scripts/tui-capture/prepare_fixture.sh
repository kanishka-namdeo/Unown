#!/usr/bin/env bash
# prepare_fixture.sh — materialize a working demo-repo instance from the
# template at scripts/tui-capture/fixtures/api-server/ and give it the two
# tagged states scenarios prep against:
#   tag "seed"  : the seeded pagination off-by-one bug (suite red)
#   tag "fixed" : the same repo after the intended work — function renamed to
#                 paginateItems and the slice end fixed (suite green)
# The working tree keeps .unown/ (project memory) so the TUI boot shows the
# real memory-tier banner; scenarios never depend on the SHAs, only the tags.
# Env: UNOWN_DEMO_DIR (target dir, default /home/z/my-project/demo-projects/api-server)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TPL="$HERE/fixtures/api-server"
D="${UNOWN_DEMO_DIR:-/home/z/my-project/demo-projects/api-server}"

if [ -d "$D/.git" ]; then
  echo "fixture already prepared at $D (HEAD $(git -C "$D" rev-parse --short HEAD)) — delete it first to re-prepare"
  exit 0
fi
mkdir -p "$(dirname "$D")"
rm -rf "$D"
cp -r "$TPL" "$D"
cd "$D"
git init -q
git add -A
git commit -qm "feat: task list endpoint with pagination + store"
git tag seed
# the "already finished" state: rename + bug fix, one commit.
# \bpaginate\b is exact-token: it renames `paginate`, `paginate<T>`, imports
# and describe() labels, but never touches `pagination.ts` or `paginateItems`.
sed -i 's/\bpaginate\b/paginateItems/g' src/*.ts test/*.ts
sed -i 's/page \* perPage + 1/page * perPage/' src/pagination.ts
git add -A
git commit -qm "fix: pagination off-by-one — slice end was perPage+1"
git tag fixed
echo "prepared $D: seed=$(git rev-parse --short seed) fixed=$(git rev-parse --short fixed)"
bun test >/dev/null 2>&1 || true
