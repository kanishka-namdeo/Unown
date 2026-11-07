/**
 * Clip-pipeline seam — the ONE extension seam (PLAN §1.1, §1.2).
 *
 * `Fetcher` + `Extractor` interfaces, and — the seam ruling — the
 * whole pipeline is BROWSER-SIDE: RealFetcher is ~40 lines on the
 * browser's native fetch + DOMParser + a readability-lite extractor
 * (extractor.ts, the 500 KB cap law, L-3), running inside the PWA
 * closure. Legato has NO Node runner/ edge (the Chaconne precedent,
 * deliberately reshaped — first app in the house to need none).
 * FakeFetcher + canned-HTML unit doubles live here too, one double
 * per ClipError taxonomy entry (the 7-entry map lands as
 * error-taxonomy.ts, L-3).
 *
 * The fixture server (scripts/fixture-server.mjs, port 4018) is
 * test infrastructure RealFetcher points at in e2e — not a host
 * edge the app ships with.
 *
 * Landed at L-3 (the clip pipeline ticket):
 *   fetcher.ts          — the Fetcher interface + FetchOutcome,
 *                         FakeFetcher (one canned double per
 *                         taxonomy entry), RealFetcher (injected
 *                         fetch handle, the idb-storage.ts
 *                         injection convention)
 *   extractor.ts        — readability-lite over DOMParser (the
 *                         parser injected through the
 *                         globalThis-seam; the 500 KB cap law)
 *   error-taxonomy.ts   — the 7-entry classifier, pure +
 *                         table-driven
 *   clip.ts             — the orchestrator: clipUrl(url, deps) ->
 *                         a full Clip record per the grammar, every
 *                         taxonomy lane honest
 *   co-located tests    — classifier table pins, orchestrator pins
 *                         over FakeFetcher (DOM-guarded extraction
 *                         lanes per the ostinato el-pin precedent),
 *                         the extractor's DOM-guarded fixture pins
 * The B-16 holdout is frozen at fixtures/ (B16-HOLDOUT.md).
 */
export {};
