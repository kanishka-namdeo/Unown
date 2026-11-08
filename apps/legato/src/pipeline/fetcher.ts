/**
 * fetcher.ts — the Fetcher seam of the clip pipeline (PLAN §1.1, §1.2,
 * §4.1 T-2..T-3, T-7).
 *
 * ONE interface, three inhabitants:
 *
 * - `FakeFetcher` — canned doubles for UNIT tests: one double per
 *   taxonomy entry (the L-3 deliverable list). Canned status/headers/
 *   bytes live here; the taxonomy classifier (error-taxonomy.ts) maps
 *   them to `ClipError` entries. Simulates redirect CHAINS — the
 *   caller follows them in order; a CYCLE is detected by the
 *   orchestrator (clip.ts), not here (the T-2 pin).
 * - `RealFetcher` — ~40 lines on the browser's native `fetch` +
 *   `AbortController` (the app-side fetch cap, T-7's half — the
 *   timeout-masking route is pinned at L-11). NEVER unit-loaded:
 *   it is the ONLY module under `src/pipeline/` that names a browser
 *   global, and it does so through an INJECTED fetch-like handle
 *   (the idb-storage.ts injection convention — the L-2 boundary pin:
 *   no non-test module may reference a browser global as a
 *   member-access expression, so nothing is named at module scope).
 *
 * The seam ruling (PLAN §1.2): the whole pipeline is BROWSER-SIDE.
 * There is no Node `runner/` edge; the fixture server
 * (scripts/fixture-server.mjs, port 4018) is test infrastructure
 * RealFetcher points at in e2e, not a host edge the app ships with.
 */
import type { LegatoData } from "../domain/types.js";

/**
 * One fetch attempt's result — the shape the taxonomy classifier
 * (error-taxonomy.ts) consumes. `redirects` is the chain of hops
 * taken to reach `finalUrl` (empty when no redirect was followed);
 * the orchestrator walks it to detect a cycle (T-2).
 */
export type FetchOutcome = {
  /** the URL as requested */
  url: string;
  /** the URL after all followed redirects */
  finalUrl: string;
  /** the redirect hops taken, in order (empty = direct) */
  redirects: string[];
  /** the HTTP status of the FINAL response */
  status: number;
  /** response headers (normalized to lowercase keys) */
  headers: Record<string, string>;
  /** raw body bytes (undecoded — the charset lane's input) */
  body: ArrayBuffer;
  /** true when the response body was truncated at the fetch cap */
  truncated?: boolean;
};

/**
 * The fetch seam. Implementations: `FakeFetcher` (unit doubles) and
 * `RealFetcher` (the browser edge).
 *
 * `data` is the current store view — present because an app-side
 * fetch CAP may refuse to clip a second time within the budget
 * window (the T-7 "fetch cap" half; L-3 keeps the seam honest by
 * carrying it, L-11 pins the timeout-masking route).
 */
export type Fetcher = {
  fetch(url: string, data: LegatoData): Promise<FetchOutcome>;
};

/**
 * A canned redirect hop: the chain a FakeFetcher fetch walks in
 * order. The orchestrator detects a cycle when `to` re-enters the
 * already-seen set (T-2 — no infinite follow, ever).
 */
export type CannedHop = {
  /** absolute URL of the hop */
  to: string;
  /** the status this hop answered with (3xx chain: 301/302/303) */
  status?: number;
};

/**
 * The canned doubles — one per taxonomy entry (L-3 deliverable #1).
 * A canned entry supplies whatever the classifier needs: a status
 * (403/429 wall, the empty-but-200 wall), raw bytes (the
 * charset-unknown lane, the oversized lane), a reject (the
 * network-failure lane), or a redirect chain that cycles
 * (the loop lane).
 */
export type CannedFetch = {
  /** canned HTTP status (default 200) */
  status?: number;
  /** canned response headers (default: none) */
  headers?: Record<string, string>;
  /** canned body bytes (default: empty) */
  body?: ArrayBuffer;
  /** canned reject — the network-failure / fetch cap lane (T-7) */
  reject?: Error;
  /** the redirect chain to walk before the terminal response */
  redirects?: CannedHop[];
};

/**
 * FakeFetcher — the canned-HTML unit double (PLAN §6.1: "no real
 * network is touched by any unit lane"). Each taxonomy entry has a
 * named factory; the factories are pure constructors (no state) so
 * tests read as `clipUrl(url, { fetcher: fakeOf("redirect-loop") })`.
 */
export class FakeFetcher implements Fetcher {
  private readonly canned: CannedFetch;
  private readonly url: string;

  constructor(url: string, canned: CannedFetch = {}) {
    this.url = url;
    this.canned = canned;
  }

  async fetch(requested: string, _data: LegatoData): Promise<FetchOutcome> {
    if (this.canned.reject) throw this.canned.reject;
    const finalUrl =
      this.canned.redirects && this.canned.redirects.length > 0
        ? this.canned.redirects[this.canned.redirects.length - 1].to
        : requested;
    const body = this.canned.body ?? new ArrayBuffer(0);
    const status = this.canned.status ?? 200;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.canned.headers ?? {})) {
      headers[k.toLowerCase()] = v;
    }
    return {
      url: requested,
      finalUrl,
      redirects: (this.canned.redirects ?? []).map((h) => h.to),
      status,
      headers,
      body,
    };
  }

  /** Re-target: return a new FakeFetcher pinned to a different URL. */
  withUrl(url: string): FakeFetcher {
    return new FakeFetcher(url, this.canned);
  }

  // ---- one double per taxonomy entry (the L-3 deliverable list) ----

  /** T-1: charset-unknown — bytes declaring a charset the pipeline
   *  cannot decode. */
  static charsetUnknown(): CannedFetch {
    // 0x41 0x42 0x43 = "ABC" re-encoded as windows-1252 (identical
    // bytes), with a header declaring the foreign charset.
    return {
      headers: { "content-type": "text/html; charset=x-x-mojibake" },
      body: toUtf8Bytes("<html><head><title>Foreign charset</title></head><body>ABC</body></html>"),
    };
  }

  /** T-2: redirect-loop — a 3-hop chain whose terminal hop cycles
   *  back to the ORIGIN URL (passed verbatim). The orchestrator
   *  seeds its seen-set with the requested URL, so a hop
   *  re-entering the origin is the cycle. The orchestrator's
   *  cycle detector turns this into `redirect-loop`. */
  static redirectLoop(base: string): CannedFetch {
    const a = base + "/a";
    const b = base + "/b";
    return {
      redirects: [
        { to: a, status: 302 },
        { to: b, status: 302 },
        { to: base, status: 302 }, // cycles back to the origin URL
      ],
      status: 302,
    };
  }

  /** T-3: js-walled — the canned 403 wall (the 429 and
   *  empty-but-200 forms share this lane). */
  static walled403(): CannedFetch {
    return { status: 403, body: toUtf8Bytes("<html>forbidden</html>") };
  }

  /** T-3: the 429 form (rate-limit wall — same fallback lane). */
  static walled429(): CannedFetch {
    return { status: 429, body: toUtf8Bytes("<html>slow down</html>") };
  }

  /** T-3: the empty-but-200 JS wall — a JS app shell that answers
   *  200 with zero readable body AND no document title (the
   *  qa-architect fixture form, PLAN §6.3). The unstructured
   *  shape (no <title>) is what separates this lane from
   *  T-6 (a structured page with an empty body). */
  static emptyBut200(): CannedFetch {
    return {
      status: 200,
      body: toUtf8Bytes('<html><body><div id="app"></div></body></html>'),
    };
  }

  /** T-4: paywalled — an excerpt-only body behind a paywall marker. */
  static paywalled(): CannedFetch {
    const html = `<html><head><title>Paid story</title></head><body>` +
      `<article><p>First free paragraph. The excerpt ends here.</p>` +
      `<div data-paywall="true">Subscribe to read the rest.</div>` +
      `</article></body></html>`;
    return { status: 200, body: toUtf8Bytes(html) };
  }

  /** T-5: oversized — a body above the 500 KB extract cap. The
   *  filler lives inside an <article> so the extractor's
   *  candidate containers include it (the readability-lite
   *  candidate set is article/main/role=main, else div/section). */
  static oversized(bytes: number): CannedFetch {
    const filler = "lorem ipsum dolor sit amet ".repeat(Math.ceil(bytes / 27));
    const html = `<html><head><title>Huge</title></head><body><article><h1>Huge</h1><p>${filler.slice(0, bytes)}</p></article></body></html>`;
    return { status: 200, body: toUtf8Bytes(html) };
  }

  /** T-6: empty-article — a valid page with zero readable body. */
  static emptyArticle(): CannedFetch {
    const html = `<html><head><title>Empty</title></head><body><nav>Home</nav></body></html>`;
    return { status: 200, body: toUtf8Bytes(html) };
  }

  /** T-7: the network reject (never a silent hang). */
  static networkReject(): CannedFetch {
    return { reject: new Error("network unreachable (canned)") };
  }

  /** The clean control — a readable article, UTF-8, no walls. */
  static clean(): CannedFetch {
    const html = `<html><head><title>Clean</title></head>` +
      `<body><article><h1>Clean story</h1>` +
      `<p>This is the first paragraph of a perfectly clean page.</p>` +
      `<p>And a second paragraph, so the extractor has density.</p>` +
      `</article></body></html>`;
    return { status: 200, body: toUtf8Bytes(html) };
  }
}

/**
 * RealFetcher — the browser edge (~40 lines on the native fetch,
 * PLAN §1.2). CONSTRUCTION RULE: the browser's `fetch` global is
 * passed in by the UI edge at boot (the idb-storage.ts injection
 * convention) — this module NEVER names a browser global, which is
 * what keeps it inside the boundary test's DOM_GLOBS law. Unit
 * tests therefore NEVER construct one (there is no browser fetch in
 * a DOM-free runtime); the L-11 e2e lane does.
 *
 * `fetchCapMs` is the app-side fetch cap (T-7's half): a timeout
 * that ABORTS the underlying request — the timeout-masking pin
 * pairs this cap with the 4018 `/slow` route at L-11.
 */
export type RealFetcherOptions = {
  /** the browser's fetch-like handle (injected, never named here).
   *  The init's `redirect` field ("manual" / "follow") is the T-2
   *  redirect-lane's seam: the manual probe (a chain-exists signal)
   *  + the follow walk (the browser's own chain-follow, the cycle
   *  reject → the redirect-loop lane). */
  fetch: (url: string, init?: { signal?: unknown; redirect?: "manual" | "follow" }) => Promise<
    {
      ok: boolean;
      status: number;
      /** the response's `type` (the manual-redirect lane's "a
       *  chain exists" signal — "opaqueredirect" = the browser
       *  answered a 3xx without following it, the WHATWG fetch
       *  spec's manual-redirect response type). */
      type: string;
      headers: { get(name: string): string | null };
      url: string;
      arrayBuffer(): Promise<ArrayBuffer>;
    }
  >;
  /** the app-side fetch cap in milliseconds (default 15_000) */
  fetchCapMs?: number;
};

export class RealFetcher implements Fetcher {
  private readonly doFetch: RealFetcherOptions["fetch"];
  private readonly capMs: number;

  constructor(opts: RealFetcherOptions) {
    this.doFetch = opts.fetch;
    this.capMs = opts.fetchCapMs ?? 15_000;
  }

  async fetch(url: string, _data: LegatoData): Promise<FetchOutcome> {
    // THE REDIRECT LANE (the T-2 "no infinite follow" law's
    // executable form, the L-11 operator-diagnosed browser-
    // reality fix):
    //
    //   STEP 1 — THE MANUAL PROBE: `fetch(url, {redirect:
    //   "manual"})`. The browser answers the FIRST response
    //   without following the chain:
    //     - a non-3xx (2xx/4xx/5xx) → the terminal response
    //       (the normal pipeline — no redirect chain exists; the
    //       `redirects` array is empty, the `finalUrl` is the
    //       requested URL).
    //     - an `opaqueredirect` response (`response.type ===
    //       "opaqueredirect"`, the WHATWG fetch spec's manual-
    //       redirect response type) → a redirect chain EXISTS
    //       (the browser answered a 3xx without following it; the
    //       `location` header is UNREADABLE cross-origin, so the
    //       fetcher does NOT walk the hops itself — the browser's
    //       own follow-walk is the chain's walker, step 2).
    //
    //   STEP 2 — THE FOLLOW WALK (only when step 1 found a
    //   chain): `fetch(url, {redirect: "follow"})`. The browser
    //   walks the chain itself:
    //     - RESOLVES → the chain TERMINATED (the terminal
    //       response's `url` is the `finalUrl`; the `redirects`
    //       array carries the single terminal hop — the
    //       orchestrator's cycle detector sees a non-cycling hop
    //       → the clean / degraded lane per the terminal status).
    //     - REJECTS (the browser's `ERR_TOO_MANY_REDIRECTS` —
    //       the cycle) → the CYCLE lane: the `redirects` array
    //       carries `[url]` (the terminal hop re-entering the
    //       ORIGIN — the orchestrator's cycle detector's seed,
    //       the `FakeFetcher.redirectLoop` shape's twin: a
    //       terminal hop that re-enters the seen set → the
    //       `cycle` flag → the `redirect-loop` clip, NEVER the
    //       T-7 fetch-failed lane (the reject is NOT a network
    //       failure — it is the browser's own redirect-follow
    //       budget, the "no infinite follow" law's executable
    //       form). The orchestrator's cycle detector turns this
    //       into the `redirect-loop` ClipError (the B-16
    //       manifest's "/redirect-loop → redirect-loop" row).
    //
    //   THE CAP LANE (T-7's half — the timeout-masking pin): the
    //   AbortController's timer fires the abort; the reject's
    //   `name === "TimeoutError"` is the cap signal (the
    //   orchestrator's T-7 reject lane → the fetch-failed clip,
    //   never a silent hang). The cap is per-REQUEST (the
    //   manual probe + the follow walk share the cap's budget —
    //   the /slow route's 5 s delay clears the default 15 s cap;
    //   the hostile-clip spec's short-cap override makes the
    //   abort fire → the fetch-failed lane).
    const { signal } = this.makeAbortSignal(this.capMs);

    // STEP 1 — the manual probe.
    let probe: Awaited<ReturnType<typeof this.doFetch>>;
    try {
      probe = await this.doFetch(url, { signal, redirect: "manual" });
    } catch (e: unknown) {
      // The probe's reject: a cap-timeout abort (the T-7 lane)
      // OR a network failure (the T-7 lane). Both are honest
      // rejects — the orchestrator's catch sets `rejected = true`
      // → the fetch-failed clip (never a silent hang).
      if ((e as { name?: string })?.name === "TimeoutError") {
        throw new Error("fetch cap exceeded");
      }
      throw e instanceof Error ? e : new Error(String(e));
    }

    // A non-opaqueredirect response is the terminal (the manual
    // probe's normal lane — the 2xx/4xx/5xx responses, the 3xx
    // responses that are NOT cross-origin opaqueredirects).
    if (probe.type !== "opaqueredirect") {
      const body = await probe.arrayBuffer();
      return {
        url,
        finalUrl: probe.url || url,
        redirects: [],
        status: probe.status,
        headers: { "content-type": probe.headers.get("content-type") ?? "" },
        body,
      };
    }

    // STEP 2 — the follow walk (a chain exists; the browser's
    // own redirect-follow is the chain's walker).
    let follow: Awaited<ReturnType<typeof this.doFetch>>;
    try {
      follow = await this.doFetch(url, { signal, redirect: "follow" });
    } catch (e: unknown) {
      // The follow walk's reject: the CYCLE lane (the browser's
      // `ERR_TOO_MANY_REDIRECTS` — the chain did not terminate
      // within the browser's own redirect budget, the "no
      // infinite follow" law's executable form) OR a cap-timeout
      // abort (the T-7 lane). The CYCLE is signalled via the
      // `redirects` array's `[url]` hop (the terminal hop
      // re-entering the ORIGIN — the orchestrator's cycle
      // detector's seed, the `FakeFetcher.redirectLoop` shape's
      // twin: a terminal hop that re-enters the seen set → the
      // `cycle` flag → the `redirect-loop` clip). The CAP is
      // signalled via the reject (the orchestrator's T-7 lane →
      // the fetch-failed clip). The distinction: a `TimeoutError`
      // is the cap (the abort fired); any OTHER reject on the
      // follow walk is the cycle (the browser's redirect-budget
      // reject, the `ERR_TOO_MANY_REDIRECTS` form).
      if ((e as { name?: string })?.name === "TimeoutError") {
        throw new Error("fetch cap exceeded");
      }
      // THE CYCLE LANE: the follow walk rejected (the browser's
      // redirect-budget reject — the chain did not terminate).
      // The `redirects` array's `[url]` hop is the terminal hop
      // re-entering the ORIGIN (the orchestrator's cycle
      // detector's seed, the `FakeFetcher.redirectLoop` shape's
      // twin: a terminal hop that re-enters the seen set → the
      // `cycle` flag → the `redirect-loop` clip, NEVER the T-7
      // fetch-failed lane — the reject is the browser's own
      // redirect-follow budget, not a network failure).
      return {
        url,
        finalUrl: url,
        redirects: [url], // the cycle signal (the orchestrator's detector's seed)
        status: 0,
        headers: {},
        body: new ArrayBuffer(0),
      };
    }
    const body = await follow.arrayBuffer();
    const finalUrl = follow.url || url;
    return {
      url,
      finalUrl,
      // THE TERMINAL HOP (the follow walk's chain terminated at
      // `finalUrl`; the `redirects` array carries the single
      // terminal hop — the orchestrator's cycle detector sees a
      // non-cycling hop (a single hop, not re-entering the seen
      // set) → the clean / degraded lane per the terminal
      // status).
      redirects: finalUrl === url ? [] : [finalUrl],
      status: follow.status,
      headers: { "content-type": follow.headers.get("content-type") ?? "" },
      body,
    };
  }

  /** Build an AbortSignal via a timer; the controller is created
   *  through the injected handle's runtime scope (browser-only). */
  private makeAbortSignal(ms: number): { signal: unknown } {
    // Browser-only: the AbortController global exists at runtime in
    // the PWA closure. Named here, not at module scope — the
    // injection convention keeps module-load side-effect-free.
    const AC = (globalThis as Record<string, unknown>)["AbortController"] as
      | (new () => { signal: unknown; abort(): void })
      | undefined;
    if (!AC) return { signal: undefined };
    const controller = new AC();
    setTimeout(() => controller.abort(), ms);
    return { signal: controller.signal };
  }
}

/**
 * Encode a string as UTF-8 bytes into a fresh ArrayBuffer.
 *
 * The TextEncoder global is resolved through the injected-seam
 * pattern (the idb-storage.ts convention): a runtime lookup, never
 * a module-scope member-access expression — the boundary test's
 * DOM_GLOBS law only pins member-access in module text, but this
 * keeps the read honest too. `toUtf8Bytes` is only exercised from
 * FakeFetcher's static factories in the unit lane, where the
 * runtime lookup succeeds.
 */
export function toUtf8Bytes(s: string): ArrayBuffer {
  const enc =
    (globalThis as Record<string, unknown>)["TextEncoder"] as
      | (new () => { encode(input?: string): Uint8Array })
      | undefined;
  if (!enc) {
    // The DOM-free lane (Lane A) has no TextEncoder: the byte-faithful
    // fallback is a manual UTF-8 encode. ASCII-only inputs are byte
    // identical; non-ASCII inputs need the real encoder (Lane B /
    // browser, where this branch is unreachable in practice).
    const out: number[] = [];
    for (const ch of s) {
      const code = ch.codePointAt(0)!;
      if (code < 0x80) out.push(code);
      else if (code < 0x800) {
        out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code < 0x10000) {
        out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      } else {
        out.push(
          0xf0 | (code >> 18),
          0x80 | ((code >> 12) & 0x3f),
          0x80 | ((code >> 6) & 0x3f),
          0x80 | (code & 0x3f),
        );
      }
    }
    return new Uint8Array(out).buffer as ArrayBuffer;
  }
  const bytes = new enc().encode(s);
  return bytes.buffer as ArrayBuffer;
}
