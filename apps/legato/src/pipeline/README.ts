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
 * L-1 placeholder: the layer contract lives in this comment; the
 * seam lands at L-3.
 */
export {};
