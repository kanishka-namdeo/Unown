#!/usr/bin/env python3
"""Test SSE streaming + inspect full response shape for each model."""
import json, urllib.request, time

BASE = "https://coding-intl.dashscope.aliyuncs.com/v1"
import os
KEY = os.environ.get("BRIDGE_UPSTREAM_KEY", "")

# --- Non-streaming: inspect full message shape (reasoning_content? tool_calls format?)
for m in ["qwen3.7-plus", "kimi-k2.5", "qwen3.6-plus"]:
    body = {"model": m, "messages": [{"role": "user", "content": "What is 17*23? One line answer."}], "max_tokens": 4000}
    req = urllib.request.Request(f"{BASE}/chat/completions", data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=90) as r:
        res = json.loads(r.read())
    msg = res["choices"][0]["message"]
    print(f"[{m}] {time.time()-t0:.1f}s keys={sorted(msg.keys())}")
    print(f"   reasoning_content={repr(str(msg.get('reasoning_content'))[:100])}")
    print(f"   content={repr(str(msg.get('content'))[:100])}")
    print(f"   usage={ {k: v for k, v in res.get('usage', {}).items()} }")

print("=" * 70)
# --- Streaming test
for m in ["qwen3.7-plus", "kimi-k2.5", "qwen3.6-plus"]:
    body = {"model": m, "messages": [{"role": "user", "content": "Count 1 to 5, comma separated."}],
            "max_tokens": 4000, "stream": True, "stream_options": {"include_usage": True}}
    req = urllib.request.Request(f"{BASE}/chat/completions", data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}", "Accept": "text/event-stream"})
    t0 = time.time()
    chunks, content_acc, reasoning_acc, usage_seen = 0, "", "", None
    with urllib.request.urlopen(req, timeout=120) as r:
        for raw in r:
            line = raw.decode().strip()
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload == "[DONE]":
                break
            chunks += 1
            obj = json.loads(payload)
            if obj.get("usage"):
                usage_seen = obj["usage"]
            delta = obj.get("choices", [{}])[0].get("delta", {}) if obj.get("choices") else {}
            if delta.get("content"):
                content_acc += delta["content"]
            if delta.get("reasoning_content"):
                reasoning_acc += delta["reasoning_content"]
    print(f"[stream {m}] {time.time()-t0:.1f}s chunks={chunks} content={repr(content_acc[:60])} reasoning_chars={len(reasoning_acc)} usage={'yes' if usage_seen else 'no'}")
