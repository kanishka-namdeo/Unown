#!/usr/bin/env python3
"""Probe the Dashscope coding-intl endpoint: chat, tools, stream, vision."""
import json, urllib.request, base64, time

BASE = "https://coding-intl.dashscope.aliyuncs.com/v1"
import os
KEY = os.environ.get("BRIDGE_UPSTREAM_KEY", "")

def call(model, body, timeout=90):
    body["model"] = model
    req = urllib.request.Request(
        f"{BASE}/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"},
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read()), time.time() - t0, None
    except urllib.error.HTTPError as e:
        return None, time.time() - t0, f"HTTP {e.code}: {e.read().decode()[:300]}"
    except Exception as e:
        return None, time.time() - t0, str(e)[:300]

MODELS = ["qwen3.7-plus", "kimi-k2.5", "qwen3.6-plus"]

print("=" * 70)
print("TEST 1: basic chat completion (short)")
for m in MODELS:
    res, dt, err = call(m, {"messages": [{"role": "user", "content": "Reply with exactly: OK"}], "max_tokens": 2000})
    if err:
        print(f"  {m}: ERROR {err}")
    else:
        msg = res["choices"][0]["message"]
        print(f"  {m}: {dt:.1f}s finish={res['choices'][0].get('finish_reason')} content={repr((msg.get('content') or '')[:60])} usage={res.get('usage', {}).get('total_tokens')}")

print("=" * 70)
print("TEST 2: tool calling")
tool = {"type": "function", "function": {"name": "read_file", "description": "Read a file from disk", "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}}
for m in MODELS:
    res, dt, err = call(m, {"messages": [{"role": "user", "content": "Read the file /tmp/hello.txt using the read_file tool."}], "tools": [tool], "tool_choice": "auto", "max_tokens": 2000})
    if err:
        print(f"  {m}: ERROR {err}")
    else:
        msg = res["choices"][0]["message"]
        tcs = msg.get("tool_calls") or []
        tc_desc = [f"{tc['function']['name']}({tc['function']['arguments'][:50]})" for tc in tcs]
        print(f"  {m}: tool_calls={tc_desc} finish={res['choices'][0].get('finish_reason')}")

print("=" * 70)
print("TEST 3: vision (base64 image input)")
# 8x8 red square PNG
png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR4nGP8z8Dwn4GBgYGJgYEBAA1cAwUAAAAASUVORK5CYII=")
img_b64 = base64.b64encode(png).decode()
for m in MODELS:
    body = {"messages": [{"role": "user", "content": [
        {"type": "text", "text": "What color is this image? Answer in one word."},
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
    ]}], "max_tokens": 2000}
    res, dt, err = call(m, body)
    if err:
        print(f"  {m}: ERROR {err}")
    else:
        msg = res["choices"][0]["message"]
        print(f"  {m}: {dt:.1f}s content={repr((msg.get('content') or '')[:80])}")
