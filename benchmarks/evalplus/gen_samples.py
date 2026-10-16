#!/usr/bin/env python
"""Unown × evalplus — HumanEval+ sample generation through the local llm-bridge.

Protocol (chat completion, greedy):
  - system: complete the Python function, output only code
  - user:   the official HumanEval+ prompt (docstring + signature)
  - temperature 0, 1 sample per problem, 164 problems
The model's extracted code (fence-stripped) is stored as the *complete*
"solution" per evalplus's sample.jsonl schema (task_id, solution).

Resume: re-running skips task_ids already present in the samples file.
Usage: python gen_samples.py --model kimi-k2.5 [--bridge http://127.0.0.1:3031/v1]
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error

from evalplus.data import get_human_eval_plus

SYSTEM_MSG = (
    "You are an expert Python programmer. Complete the given function. "
    "Reply with ONLY the complete Python function definition in a single code block. "
    "No explanations, no test code, no example usage."
)

FENCE_RE = re.compile(r"```(?:python)?\s*\n(.*?)```", re.DOTALL)


def extract_code(text: str) -> str:
    """Extract code from the reply: prefer a fenced block, else raw text."""
    if not text:
        return ""
    m = FENCE_RE.search(text)
    code = m.group(1) if m else text
    # drop a leading 'python' language line if the fence regex missed it
    lines = code.split("\n")
    if lines and lines[0].strip().lower() in ("python", "py", "python3"):
        lines = lines[1:]
    code = "\n".join(lines)
    # common chat-model artifact: leading plain text before the def
    defs = [i for i, l in enumerate(code.split("\n")) if l.startswith("def ")]
    if defs and defs[0] > 0:
        pre = "\n".join(code.split("\n")[: defs[0]])
        # only strip prose before the first def, never code
        if not pre.strip().startswith(("import", "from", '"', "'", "#")):
            code = "\n".join(code.split("\n")[defs[0] :])
    return code.strip() + "\n"


def chat(bridge: str, model: str, prompt: str, api_key: str, timeout: int = 300):
    body = json.dumps(
        {
            "model": model,
            "messages": [
                {"role": "system", "content": SYSTEM_MSG},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0,
            "top_p": 1,
            "max_tokens": 2048,
        }
    ).encode()
    req = urllib.request.Request(
        f"{bridge}/chat/completions",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    if api_key:
        req.add_header("Authorization", f"Bearer {api_key}")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.loads(r.read().decode())
    return data["choices"][0]["message"]["content"] or ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--bridge", default="http://127.0.0.1:3031/v1")
    ap.add_argument("--api-key", default=os.environ.get("BRIDGE_API_KEY", ""))
    ap.add_argument("--out", default=None)
    ap.add_argument("--limit", type=int, default=0, help="debug: only N problems")
    args = ap.parse_args()

    problems = get_human_eval_plus()
    if args.limit:
        problems = dict(list(problems.items())[: args.limit])

    out_path = args.out or os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "results",
        args.model,
        "samples.jsonl",
    )
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    done = set()
    if os.path.exists(out_path):
        with open(out_path) as f:
            for line in f:
                if line.strip():
                    done.add(json.loads(line)["task_id"])
    todo = [t for t in problems if t not in done]
    print(f"[{args.model}] {len(done)} done, {len(todo)} to go -> {out_path}", flush=True)

    fails = 0
    with open(out_path, "a") as f:
        for i, task_id in enumerate(todo):
            prompt = problems[task_id]["prompt"]
            code, err = None, None
            for attempt in range(4):
                try:
                    raw = chat(args.bridge, args.model, prompt, args.api_key)
                    code = extract_code(raw)
                    if f"def {problems[task_id]['entry_point']}" not in code:
                        raise ValueError(
                            f"entry_point def missing; head={code[:120]!r}"
                        )
                    break
                except Exception as e:  # noqa: BLE001
                    err = e
                    wait = 15 * (attempt + 1)
                    print(f"  [{task_id}] attempt {attempt+1} failed: {e}; sleep {wait}s", flush=True)
                    time.sleep(wait)
            if code is None:
                fails += 1
                print(f"  [{task_id}] GIVING UP: {err}", flush=True)
                code = f"# generation failed: {err}\n"
            f.write(json.dumps({"task_id": task_id, "solution": code}) + "\n")
            f.flush()
            if (i + 1) % 10 == 0:
                print(f"[{args.model}] {i+1}/{len(todo)} (gave up so far: {fails})", flush=True)
    print(f"[{args.model}] DONE. gave-up={fails}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
