# local-ml — the OPTIONAL ONNX embedding lane (H15)

**Role:** gives the engine's `localml` dream lanes (dedup cosine tier +
activation relevance) real embeddings. WITHOUT this package the lanes still
run in their symbolic-only verified shapes (MinHash-only dedup, structural +
frequency ranking) and the dream pipeline is byte-identical when the env
flags are unset.

**This directory is deliberately NOT a workspace member** — it owns its own
`node_modules` so neither the Unown repo nor the vendored pi-repo installs
native addons. The H9 guard (the repo stays native-addon-free) holds.

## Install (on demand)

```bash
cd pi-repo/packages/self-learning/local-ml
npm install --no-fund --no-audit      # transformers.js 4.3.1 + onnxruntime-node 1.30 prebuilts
node lib/index.mjs --probe            # loads bge-small q8, prints latency + RSS
```

Model weights (Xenova/bge-small-en-v1.5 q8, ~35MB, MIT) download once into
`models/hf-cache/` here on first use — keyless. `NONLLM_HF_HOST` is the
mirror escape hatch (same as the bench).

## Platform support

onnxruntime-node 1.30 prebuilds: linux-x64/arm64, darwin-arm64, win32-x64.
**darwin-x64 (Intel Macs) has NO prebuild since ORT 1.23** — on those hosts
do not install this package; the engine degrades to symbolic-only lanes.

## Engine surface

`../src/localml.ts` probes this dir (`PI_LOCAL_ML_DIR` overrides the
location) with a guarded dynamic import; absence or load failure = the
embedder is null and every lane degrades — the dream never fails because of
this package.
