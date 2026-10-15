#!/usr/bin/env python3
"""Test enable_thinking toggle + max_tokens behavior on qwen models."""
import json, urllib.request, time

BASE = "https://coding-intl.dashscope.aliyuncs.com/v1"
import os
KEY = os.environ.get("BRIDGE_UPSTREAM_KEY", "")

def call(model, body, timeout=90):
    body["model"] = model
    req = urllib.request.Request(f"{BASE}/chat/completions", data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read()), time.time() - t0, None
    except urllib.error.HTTPError as e:
        return None, time.time() - t0, f"HTTP {e.code}: {e.read().decode()[:250]}"
    except Exception as e:
        return None, time.time() - t0, str(e)[:250]

print("TEST A: enable_thinking=false (top-level)")
for m in ["qwen3.7-plus", "qwen3.6-plus"]:
    res, dt, err = call(m, {"messages": [{"role": "user", "content": "What is 17*23? One line."}],
                            "max_tokens": 2000, "enable_thinking": False})
    if err:
        print(f"  {m}: ERROR {err}")
    else:
        msg = res["choices"][0]["message"]
        print(f"  {m}: {dt:.1f}s reasoning={len(str(msg.get('reasoning_content') or ''))} chars content={repr(str(msg.get('content'))[:50])} completion_tokens={res['usage']['completion_tokens']}")

print("TEST B: low max_tokens (512)")
for m in ["qwen3.7-plus", "kimi-k2.5", "qwen3.6-plus"]:
    res, dt, err = call(m, {"messages": [{"role": "user", "content": "Write a 3-line poem about code."}],
                            "max_tokens": 512})
    if err:
        print(f"  {m}: ERROR {err}")
    else:
        msg = res["choices"][0]["message"]
        print(f"  {m}: {dt:.1f}s finish={res['choices'][0]['finish_reason']} content={repr(str(msg.get('content'))[:60])}")

print("TEST C: multi-turn tool round-trip (agentic loop simulation)")
tool = {"type": "function", "function": {"name": "run_tests", "description": "Run project test suite", "parameters": {"type": "object", "properties": {}, "required": []}}}
for m in ["kimi-k2.5", "qwen3.7-plus"]:
    msgs = [{"role": "user", "content": "Run the tests, then report the result."}]
    res, dt, err = call(m, {"messages": msgs, "tools": [tool], "max_tokens": 4000})
    if err:
        print(f"  {m}: ERROR {err}"); continue
    msg = res["choices"][0]["message"]
    tcs = msg.get("tool_calls") or []
    if not tcs:
        print(f"  {m}: no tool call, content={repr(str(msg.get('content'))[:80])}"); continue
    tc = tcs[0]
    # feed the tool result back
    msgs.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": [{"id": tc["id"], "type": "function", "function": tc["function"]}]})
    msgs.append({"role": "tool", "tool_call_id": tc["id"], "content": "3 passed, 1 failed: expected 5, got 4 in math.test.js"})
    res2, dt2, err2 = call(m, {"messages": msgs, "tools": [tool], "max_tokens": 4000})
    if err2:
        print(f"  {m}: round2 ERROR {err2}"); continue
    m2 = res2["choices"][0]["message"]
    print(f"  {m}: turn1={dt:.1f}s turn2={dt2:.1f}s final={repr(str(m2.get('content'))[:90])}")
