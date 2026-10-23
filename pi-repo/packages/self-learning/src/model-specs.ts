// model-specs.ts — the known-model spec catalog.
//
// Every path that seeds a models.json record from a model id ALONE (the
// first-run bridge seeding in term.ts, the engine's sandbox agent dir in
// runner.ts, the registry upsert and the live catalog refresh in
// providers.ts) used to stamp the same conservative defaults on every id:
// contextWindow 131072, maxTokens 8192. For a model whose real limits are
// smaller that over-promises (compaction fires too late, output gets
// upstream-truncated); for a model with officially larger limits it
// under-delivers — pi keeps compacting at 128K and caps answers at 8K when
// the endpoint actually serves 512K/65K, which is a silent capability cut
// on every Agnes upstream (measured 2026-10-23: agnes-3.0-flash documented
// at 524,288 context / 65,536 output, seeded at 131,072 / 8,192).
//
// The catalog closes that gap for models with OFFICIALLY PUBLISHED limits;
// unknown ids keep the historical conservative defaults — guessing there is
// worse than under-promising. Entries are exact ids only (no prefixes: a
// matching prefix is a coincidence, not a spec).
//
// Sources (verified 2026-10-23 against official model cards; keep this
// table in sync with the vendor docs when models change):
//   agnes-3.0-flash, agnes-2.5-flash — Agnes AI docs (wiki.agnes-ai.com):
//     context window 512K (524,288), max output 65,536; text+image input.
//   kimi-k2.5 — Alibaba Model Studio card: context 262,144, max output
//     16,384 (max input 229,376); text+image(+video) input.
//   qwen3.7-plus — Alibaba Model Studio card: context 1,000,000 (decimal,
//     NOT 1,048,576), max output 131,072.
//   qwen3.6-plus — Alibaba Model Studio card: context 1,000,000, max
//     output 65,536.

export interface ModelSpec {
        contextWindow: number;
        maxTokens: number;
}

/** Historical conservative defaults for ids with no published spec. */
export const DEFAULT_MODEL_SPEC: ModelSpec = { contextWindow: 131072, maxTokens: 8192 };

/** Verified specs for well-known model ids. Exact ids only. */
export const KNOWN_MODEL_SPECS: Readonly<Record<string, ModelSpec>> = {
        "agnes-3.0-flash": { contextWindow: 524288, maxTokens: 65536 },
        "agnes-2.5-flash": { contextWindow: 524288, maxTokens: 65536 },
        "kimi-k2.5": { contextWindow: 262144, maxTokens: 16384 },
        "qwen3.7-plus": { contextWindow: 1000000, maxTokens: 131072 },
        "qwen3.6-plus": { contextWindow: 1000000, maxTokens: 65536 },
};

/** The verified spec for a known model id; the conservative defaults otherwise. */
export function modelSpec(id: string): ModelSpec {
        return KNOWN_MODEL_SPECS[id] ?? DEFAULT_MODEL_SPEC;
}
