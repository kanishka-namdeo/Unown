# Vendored tree-sitter grammars (WASM)

Prebuilt grammar `.wasm` files for the repo-map context provider
(`src/repomap/`). Vendored — not fetched at runtime — so the repo map is
offline-safe and supply-chain-pinned. These track the tree-sitter ABI of
`web-tree-sitter` 0.27.x (ABI 15): grammars from the older
`tree-sitter-wasms` builds (ABI ≤13) are NOT interchangeable — a mismatched
ABI fails inside the emscripten dylink loader.

| file | upstream repo | release | sha256 |
|------|---------------|---------|--------|
| tree-sitter-javascript.wasm | tree-sitter/tree-sitter-javascript | v0.25.0 | 5fb488d0cabb4775a594bab85682de5ad6ce83c0d6ac997a9f82dd084d571240 |
| tree-sitter-typescript.wasm | tree-sitter/tree-sitter-typescript | v0.23.2 | 778025db5a8be0e70f8ccc3671e486dfeddd048c25d9e8a70c26de2e1bf6f97d |
| tree-sitter-tsx.wasm | tree-sitter/tree-sitter-typescript | v0.23.2 | 79e5da75ea62855a0cd67177685f0164eac87d5f630b3cbe1e0a099751ad30f8 |
| tree-sitter-python.wasm | tree-sitter/tree-sitter-python | v0.25.0 | 16108b50df4ee9a30168794252ab55e7c93bfc5765d7fa0aa3e335752c515f47 |

All four upstream grammars are MIT-licensed. Refresh procedure: download
from the release assets (`https://github.com/tree-sitter/tree-sitter-<repo>/releases/download/<tag>/<file>`),
bump the table above (tag + sha256), and bump `REPOMAP_CACHE_VERSION` in
`src/repomap/cache.ts` when the grammar or query files change shape.
