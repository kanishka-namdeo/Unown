#!/usr/bin/env python3
"""V-38 pin — pre-seed maxTokens=4096 for both agnes flash models.

The Agnes upstream rejects max_tokens > 4096 with a 400
("max_tokens exceeds the limit of 4096"). A fresh UNOWN_HOME seeds
65536 from the curated catalog, so every dispatch on a fresh home
would die at the first request. This script pins the output cap in
BOTH spec files (models.json + model-specs.json) with operator-pin
provenance, is idempotent, and rides every a1-dispatch run.

Receipted as V-38 in benchmarks/rondo-round/validation-log.md.
"""
import json
import os
import sys

HOME = os.environ.get("UNOWN_HOME", "/home/z/my-project/unown-home")
AGENT = os.path.join(HOME, "agent")
MODELS = ["agnes-3.0-flash", "agnes-2.5-flash"]
PIN = 4096
PROVENANCE = "operator-pin: V-38 (agnes upstream max_tokens limit 4096) 2026-11-07"


def pin_models_json(path: str) -> int:
    if not os.path.exists(path):
        return 0
    with open(path) as f:
        d = json.load(f)
    changed = 0
    for p in d.get("providers", {}).values():
        for m in p.get("models", []):
            if m.get("id") in MODELS and m.get("maxTokens") != PIN:
                m["maxTokens"] = PIN
                m["maxTokensProvenance"] = PROVENANCE
                changed += 1
    if changed:
        with open(path, "w") as f:
            json.dump(d, f, indent=2)
    return changed


def pin_model_specs(path: str) -> int:
    """model-specs.json shape: {"version":1,"specs":{"<provider>/<model>":{...
    "maxTokens": N}}} — keys embed the model id, so match on the key."""
    if not os.path.exists(path):
        return 0
    with open(path) as f:
        d = json.load(f)
    changed = 0
    specs = d.get("specs", {})
    for key, node in specs.items():
        model = key.split("/")[-1]
        if model in MODELS and isinstance(node, dict) and "maxTokens" in node:
            if node["maxTokens"] != PIN:
                node["maxTokens"] = PIN
                # V-11 (sonata): SpecSource is a closed enum
                # (curated|models-dev|litellm|endpoint|user|learned) —
                # "operator" is NOT a member and bricks doctor's
                # formatSpecShort (SOURCE_LABELS[unknown] -> undefined).
                # The receipted value is "user" ("you entered it");
                # provenance rides the operatorPin field.
                node["source"] = "user"
                node["operatorPin"] = PROVENANCE
                changed += 1
    if changed:
        with open(path, "w") as f:
            json.dump(d, f, indent=2)
    return changed


VALID_SOURCES = {"curated", "models-dev", "litellm", "endpoint", "user", "learned"}


def main() -> int:
    # pin BOTH homes: the pinned UNOWN_HOME (engine + dispatches) and the
    # default ~/.unown (smokes / dispatches that run without UNOWN_HOME)
    homes = [HOME, os.path.expanduser("~/.unown")]
    total = 0
    for h in homes:
        agent = os.path.join(h, "agent")
        a = pin_models_json(os.path.join(agent, "models.json"))
        b = pin_model_specs(os.path.join(agent, "model-specs.json"))
        print(f"v38-pin: {h} -> models.json {a}, model-specs.json {b} pinned -> {PIN}")
        total += a + b
        mp = os.path.join(agent, "models.json")
        if os.path.exists(mp):
            with open(mp) as f:
                d = json.load(f)
            for p in d.get("providers", {}).values():
                for m in p.get("models", []):
                    if m.get("id") in MODELS:
                        assert m.get("maxTokens") == PIN, f"pin failed for {m['id']} in {h}"
        # V-11 guard: no spec may carry a source outside the engine's
        # SpecSource enum — an invalid value bricks doctor (formatSpecShort).
        sp = os.path.join(agent, "model-specs.json")
        if os.path.exists(sp):
            with open(sp) as f:
                specs = json.load(f).get("specs", {})
            bad = [k for k, v in specs.items()
                   if isinstance(v, dict) and v.get("source") not in VALID_SOURCES]
            if bad:
                raise SystemExit(f"v38-pin: INVALID spec source in {h} for {bad} — "
                                 "repair to a SpecSource member before dispatch")
    print(f"v38-pin: verified OK across {len(homes)} homes ({total} fields pinned)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
