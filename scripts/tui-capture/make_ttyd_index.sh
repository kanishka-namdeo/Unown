#!/usr/bin/env bash
# make_ttyd_index.sh — build the patched ttyd index.html the driver serves
# with -I. The stock index is embedded in the ttyd binary and served at `/`;
# we fetch it from a bare instance, inject one style line (zinc-950 page
# background so browser letterboxing never flashes white), and write the file.
# This keeps ~730 KB of vendored ttyd dist OUT of the repo.
#
# Env: TTYD_BIN (default /home/z/.local/bin/ttyd), OUT (default ./ttyd-index.html)
set -euo pipefail
TTYD="${TTYD_BIN:-/home/z/.local/bin/ttyd}"
OUT="${1:-$(cd "$(dirname "$0")" && pwd)/ttyd-index.html}"
PORT="${PORT:-7999}"

command -v curl >/dev/null || { echo "curl required"; exit 1; }
[ -x "$TTYD" ] || { echo "ttyd not found at $TTYD (set TTYD_BIN)"; exit 1; }

# boot a bare ttyd on a throwaway port (it serves the embedded index at /)
"$TTYD" -p "$PORT" --writable sleep 3600 >/dev/null 2>&1 &
TTYD_PID=$!
trap 'kill $TTYD_PID 2>/dev/null || true' EXIT

for i in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:$PORT/" -o /tmp/ttyd-raw-index.html; then break; fi
  sleep 0.25
done
[ -s /tmp/ttyd-raw-index.html ] || { echo "could not fetch stock index"; exit 1; }

# inject the page background style right after </title>, and make the embedded
# xterm default font JetBrains Mono (the driver also passes -t fontFamily, but
# a good default keeps bare runs consistent)
if grep -q 'html,body{background:#09090b' /tmp/ttyd-raw-index.html; then
  cp /tmp/ttyd-raw-index.html "$OUT"
else
  python3 - "$OUT" <<'PY'
import sys
raw = open("/tmp/ttyd-raw-index.html", encoding="utf-8").read()
marker = "</title>"
patch = '</title>\n<style>html,body{background:#09090b !important;}</style>'
assert marker in raw, "no </title> in stock index — ttyd version drift?"
assert raw.count(marker) == 1, "ambiguous </title> count"
raw = raw.replace(marker, patch, 1)
old_font = 'fontFamily:"Consolas,Liberation Mono,Menlo,Courier,monospace"'
new_font = 'fontFamily:"JetBrains Mono,DejaVu Sans Mono,monospace"'
assert old_font in raw, "stock xterm default fontFamily not found — ttyd/xterm version drift?"
raw = raw.replace(old_font, new_font, 1)
open(sys.argv[1], "w", encoding="utf-8").write(raw)
PY
fi
echo "wrote $OUT ($(wc -c < "$OUT") bytes)"
