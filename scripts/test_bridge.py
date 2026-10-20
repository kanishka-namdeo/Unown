#!/usr/bin/env python3
"""End-to-end probe of the llm-bridge on its default port 3031.

Historical note: this harness predates the port split — it was written when
the bridge itself listened on 3032. That port now belongs to the zai-upstream
shim (mini-services/zai-upstream, started by scripts/start.ts only when
BRIDGE_UPSTREAM_URL points at it); the bridge is 3031. Override the target
with BRIDGE_PORT if you run it non-default. Sends the Bearer token from
BRIDGE_API_KEY when set (the bridge enforces auth iff that key is set).
"""
import json, urllib.request, base64, struct, zlib, time, os

BASE = f"http://127.0.0.1:{os.environ.get('BRIDGE_PORT', '3031')}/v1"
key = os.environ.get("BRIDGE_API_KEY")

def call(body, stream=False, timeout=120):
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    req = urllib.request.Request(f"{BASE}/chat/completions", data=json.dumps(body).encode(),
        headers=headers)
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        if stream:
            content, reasoning, usage, chunks, done_seen = "", "", None, 0, False
            for raw in r:
                line = raw.decode().strip()
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    done_seen = True
                    break
                chunks += 1
                obj = json.loads(payload)
                if obj.get("usage"):
                    usage = obj["usage"]
                delta = obj.get("choices", [{}])[0].get("delta", {}) if obj.get("choices") else {}
                if delta.get("content"):
                    content += delta["content"]
                if delta.get("reasoning_content"):
                    reasoning += delta["reasoning_content"]
            return {"content": content, "reasoning_chars": len(reasoning), "usage": usage, "chunks": chunks, "done": done_seen, "dt": time.time() - t0}
        return {"json": json.loads(r.read()), "dt": time.time() - t0}

print("TEST 1: model routing (glm-4-plus should route to kimi-k2.5)")
r = call({"model": "glm-4-plus", "messages": [{"role": "user", "content": "Reply exactly: ROUTED"}], "max_tokens": 100, "thinking": {"type": "disabled"}})
print(f"  -> model={r['json']['model']} content={r['json']['choices'][0]['message']['content']!r} ({r['dt']:.1f}s)")

print("TEST 2: explicit qwen3.7-plus (thinking auto-disabled)")
r = call({"model": "qwen3.7-plus", "messages": [{"role": "user", "content": "17*23? digits only"}], "max_tokens": 2000})
m = r["json"]["choices"][0]["message"]
print(f"  -> model={r['json']['model']} reasoning={len(str(m.get('reasoning_content') or ''))}ch content={m.get('content')!r} ({r['dt']:.1f}s)")

print("TEST 3: streaming passthrough (kimi-k2.5)")
r = call({"model": "kimi-k2.5", "messages": [{"role": "user", "content": "Count 1 to 5 comma separated"}], "max_tokens": 100, "stream": True, "stream_options": {"include_usage": True}}, stream=True)
print(f"  -> content={r['content']!r} chunks={r['chunks']} done={r['done']} usage={'yes' if r['usage'] else 'no'} ({r['dt']:.1f}s)")

print("TEST 4: tool calling through bridge")
tool = {"type": "function", "function": {"name": "read_file", "description": "Read a file", "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}}
r = call({"model": "glm-4-plus", "messages": [{"role": "user", "content": "Read /tmp/x.txt with the read_file tool"}], "tools": [tool], "tool_choice": "auto", "max_tokens": 500})
tcs = r["json"]["choices"][0]["message"].get("tool_calls") or []
tc_desc = [tc['function']['name'] + "(" + tc['function']['arguments'][:40] + ")" for tc in tcs]
print(f"  -> tool_calls={tc_desc} finish={r['json']['choices'][0]['finish_reason']}")

print("TEST 5: vision (VLM) through bridge")
def make_png(w, h, rgb):
    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
img = base64.b64encode(make_png(100, 100, (0, 0, 255))).decode()
r = call({"model": "kimi-k2.5", "messages": [{"role": "user", "content": [
    {"type": "text", "text": "What color? One word."},
    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img}"}}]}], "max_tokens": 100})
print(f"  -> content={r['json']['choices'][0]['message']['content']!r} ({r['dt']:.1f}s)")

print("TEST 6: multi-turn tool round-trip through bridge")
msgs = [{"role": "user", "content": "Run the tests then summarize."}]
ttool = {"type": "function", "function": {"name": "run_tests", "description": "Run tests", "parameters": {"type": "object", "properties": {}, "required": []}}}
r = call({"model": "kimi-k2.5", "messages": msgs, "tools": [ttool], "max_tokens": 1000})
msg = r["json"]["choices"][0]["message"]
tc = (msg.get("tool_calls") or [None])[0]
if not tc:
    print(f"  -> NO TOOL CALL: {str(msg.get('content'))[:80]!r}")
else:
    msgs.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": [{"id": tc["id"], "type": "function", "function": tc["function"]}]})
    msgs.append({"role": "tool", "tool_call_id": tc["id"], "content": "2 passed, 1 failed: sum(2,2) returned 5 in math.test.js"})
    r2 = call({"model": "kimi-k2.5", "messages": msgs, "tools": [ttool], "max_tokens": 1000})
    print(f"  -> final={r2['json']['choices'][0]['message']['content'][:100]!r}")

print()
print("Bridge log:")
_log_headers = {}
if key:
    _log_headers["Authorization"] = f"Bearer {key}"
_log_req = urllib.request.Request(f"{BASE}/log", headers=_log_headers)
with urllib.request.urlopen(_log_req) as r:
    for e in json.loads(r.read())["log"]:
        print(f"  {e['model']} -> {e['upstreamModel']} stream={e['stream']} {e['durationMs']}ms content={e['contentChars']}ch tools={e['toolCalls']} err={e.get('error')}")
