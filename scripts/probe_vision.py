#!/usr/bin/env python3
"""Retest vision with a larger image (100x100 solid red PNG)."""
import json, urllib.request, base64, struct, zlib, time

BASE = "https://coding-intl.dashscope.aliyuncs.com/v1"
import os
KEY = os.environ.get("BRIDGE_UPSTREAM_KEY", "")

def make_png(w, h, rgb):
    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b""))

png = make_png(100, 100, (255, 0, 0))
img_b64 = base64.b64encode(png).decode()

for m in ["qwen3.7-plus", "kimi-k2.5", "qwen3.6-plus"]:
    body = {"model": m, "messages": [{"role": "user", "content": [
        {"type": "text", "text": "What color is this image? Answer in one word."},
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
    ]}], "max_tokens": 2000}
    req = urllib.request.Request(f"{BASE}/chat/completions", data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            res = json.loads(r.read())
            print(f"  {m}: {time.time()-t0:.1f}s content={repr(res['choices'][0]['message'].get('content','')[:80])}")
    except urllib.error.HTTPError as e:
        print(f"  {m}: ERROR HTTP {e.code}: {e.read().decode()[:200]}")
