/**
 * clip.ts — the orchestrator (PLAN §1.1, §3 L-3, §4.1 T-1..T-7).
 *
 * `clipUrl(url, deps)` -> a full `Clip` record per the grammar
 * (PLAN §2): id via ids.ts against the store, state unread,
 * timestamps ISO, every taxonomy lane producing its honest record
 * shape.
 *
 * The three lanes the orchestrator owns before delegating to the
 * classifier (error-taxonomy.ts):
 *
 *   REDIRECTION — follow the chain within the Fetcher (the fake
 *   simulates chains via `CannedHop[]`; a cycle -> redirect-loop,
 *   T-2). The cycle is detected here, in the orchestrator, not in
 *   the fetcher: the fetcher walks the hops, the orchestrator
 *   checks whether the terminal hop re-enters a seen URL.
 *
 *   CHARSET — sniff the `Content-Type` header's charset, then the
 *   document's meta-tag; undecodable -> charset-unknown (T-1).
 *   The decode is a best-effort UTF-8: the orchestrator reads the
 *   raw bytes into a string; if the bytes are not valid UTF-8 or
 *   the declared charset is a non-UTF-8 alias the pipeline cannot
 *   resolve, the undecodable flag is set and the extraction is
 *   skipped (no mojibake text ever lands in a Clip).
 *
 *   THE CAP — the 500 KB extract cap (T-5) is applied by the
 *   classifier, not here: the orchestrator hands the full
 *   extraction to `classify`, which returns the retained prefix +
 *   the `oversized` flag (the solution-architect ruling).
 *
 * The `deps` seam keeps the function pure-of-environment: a test
 * passes a `FakeFetcher` + a `FakeStorage`-backed `LegatoData` view;
 * the L-11 e2e lane passes a `RealFetcher` + the real storage.
 */
import type { Clip, ClipError, LegatoData } from "../domain/types.js";
import { nextId } from "../domain/ids.js";
import type { Fetcher, FetchOutcome } from "./fetcher.js";
import type { Extraction, ParseHtml } from "./extractor.js";
import { extractReadable, EXTRACT_CAP_BYTES } from "./extractor.js";
import type { Classification, ClipLane } from "./error-taxonomy.js";
import { classify } from "./error-taxonomy.js";

/** The dependencies the orchestrator needs — the seam. */
export type ClipDeps = {
  /** the fetch seam (FakeFetcher in the unit lane, RealFetcher in e2e) */
  fetcher: Fetcher;
  /** the parser seam (the DOMParser default in e2e, injectable for tests) */
  parseHtml?: ParseHtml;
  /** the current store view — ids.ts allocates against this */
  data: LegatoData;
  /** a clock override (tests pin ISO timestamps; default = now) */
  clock?: () => string;
};

/**
 * The redirect-follow budget — the max hops before a cycle is
 * declared (T-2). 8 is generous for the hostile fixtures
 * (`/redirect-loop` cycles at 2 hops); the point is NO infinite
 * follow, ever.
 */
const REDIRECT_BUDGET = 8;

/**
 * Charset aliases the pipeline CANNOT decode (the T-1 undecodable
 * set). A declared charset not in this set is treated as undecodable
 * — the pipeline's decode is UTF-8-only; a windows-1252 /
 * x-x-mojibake / unknown-charset declaration is the undecodable
 * signal, never a mojibake decode.
 */
const UNDECODABLE_CHARSETS: ReadonlySet<string> = new Set([
  // the hostile-fixture charset (wrong-charset.html's
  // windows-1252 bytes + the unknown-charset second form)
  "x-x-mojibake",
  // a foreign-charset alias the pipeline has no decoder for
  "windows-1252",
  "iso-8859-1",
  "latin1",
  "shift_jis",
  "euc-jp",
  "gb2312",
  "gbk",
  "big5",
  "utf-16",
  "utf-16be",
  "utf-16le",
  "euckr",
  "koi8-r",
  "macintosh",
  "x-mac-roman",
]);

/**
 * Clip a URL into a full `Clip` record. Every taxonomy lane is
 * honest: a failed clip still returns a `Clip` (with its
 * `error` set), never `null`/`undefined` — the orchestrator
 * produces a record for every lane (PLAN §4.1: "no silent
 * failures").
 *
 * `finalUrl` is set when the fetch followed at least one redirect
 * (even on the js-walled / paywalled / oversized lanes).
 */
export async function clipUrl(url: string, deps: ClipDeps): Promise<Clip> {
  const { fetcher, data, parseHtml } = deps;
  const now = (deps.clock ?? (() => new Date().toISOString()))();

  // ---- fetch (may reject — the T-7 fetch-failed lane) ----
  let outcome: FetchOutcome;
  let rejected = false;
  try {
    outcome = await fetcher.fetch(url, data);
  } catch {
    rejected = true;
    // The rejected lane still returns a Clip (T-7: never a silent
    // hang). The fetcher's reject IS the fetch-failed signal; no
    // body to walk, no extraction to run.
    outcome = {
      url,
      finalUrl: url,
      redirects: [],
      status: 0,
      headers: {},
      body: new ArrayBuffer(0),
    };
  }

  // ---- redirect cycle detection (T-2) ----
  // The Fetcher simulates chains: `outcome.redirects` is the hop
  // list. A cycle = a terminal hop that re-enters a URL already in
  // the chain. The budget caps the walk (no infinite follow).
  let cycle = false;
  if (!rejected) {
    const seen = new Set<string>([url]);
    // Check each hop against the seen set, which is seeded with
    // the ORIGIN url: a hop re-entering the origin (or any earlier
    // hop) is the cycle — no infinite follow, ever.
    for (const hop of outcome.redirects.slice(0, REDIRECT_BUDGET)) {
      if (seen.has(hop)) {
        cycle = true;
        break;
      }
      seen.add(hop);
    }
    if (!cycle && outcome.redirects.length > REDIRECT_BUDGET) {
      cycle = true; // over budget: treat as a loop
    }
  }

  // ---- charset sniff (T-1) ----
  // Sniff order: (1) the Content-Type header's charset param,
  // (2) the document's <meta> tag. Undecodable = a declared charset
  // in the UNDECODABLE set OR no charset declared + non-UTF-8 bytes.
  let undecodable = false;
  let extraction: Extraction | null = null;

  if (!rejected && !cycle) {
    const declared = sniffCharset(outcome.headers);
    undecodable = declared !== null && UNDECODABLE_CHARSETS.has(declared.toLowerCase());

    if (!undecodable) {
      // Decode the body as UTF-8 (the pipeline's only decode).
      // If the bytes are not valid UTF-8 the decode yields U+FFFD
      // replacement characters — the undecodable signal.
      const html = decodeUtf8(outcome.body);
      if (html.includes("\uFFFD")) {
        undecodable = true;
      } else {
        extraction = extractReadable(html, parseHtml, outcome.body.byteLength);
      }
    }
  }

  // ---- classify (T-1..T-7) ----
  const classification: Classification = {
    outcome,
    extraction,
    undecodable,
    cycle,
    rejected,
  };
  const lane: ClipLane = classify(classification);

  // ---- build the Clip record ----
  const id = nextId(data);
  const title = lane.degraded.title ?? "";
  const text = lane.degraded.text ?? "";
  const finalUrl = lane.degraded.finalUrl;

  const clip: Clip = {
    id,
    url,
    title,
    text,
    tags: [],
    state: "unread",
    highlights: [],
    createdAt: now,
    updatedAt: now,
  };

  // Set finalUrl only when the fetch actually followed a redirect
  // (the clean + all degraded lanes that reach a terminal response).
  if (finalUrl !== undefined && finalUrl !== url) {
    clip.finalUrl = finalUrl;
  }

  // The taxonomy's degraded fields — only set when the lane says so.
  if (lane.error !== undefined) {
    clip.error = lane.error;
  }
  if (lane.degraded.jsWalled) clip.jsWalled = true;
  if (lane.degraded.paywallExcerptOnly) clip.paywallExcerptOnly = true;
  if (lane.degraded.emptyText) clip.emptyText = true;
  if (lane.degraded.excerpt !== undefined) clip.excerpt = lane.degraded.excerpt;

  return clip;
}

/**
 * Sniff the declared charset from a FetchOutcome's headers.
 * Returns the charset string (lowercased) or `null` when no
 * charset is declared.
 */
function sniffCharset(headers: Record<string, string>): string | null {
  const ct = headers["content-type"];
  if (!ct) return null;
  const m = ct.match(/charset=([^\s;]+)/i);
  return m ? m[1] : null;
}

/**
 * Decode a byte buffer as UTF-8. The decode is a best-effort
 * runtime lookup through the globalThis-seam (the idb-storage.ts
 * convention — no module-scope DOM/Web global). A missing decoder
 * (the DOM-free Lane A, where this function is unreachable —
 * the orchestrator only runs under a fetcher, which only runs in
 * a browser or a test with a real fetch) falls back to a
 * byte-wise string.
 */
function decodeUtf8(buf: ArrayBuffer): string {
  const D =
    (globalThis as Record<string, unknown>)["TextDecoder"] as
      | (new (label?: string, opts?: { fatal?: boolean }) => {
          decode(input?: ArrayBuffer | ArrayBufferView): string;
        })
      | undefined;
  if (!D) {
    // No TextDecoder available (the DOM-free Lane A, where this
    // function is only reached via FakeFetcher's canned bodies,
    // which are UTF-8 by construction). Fall back to a byte-wise
    // string: each byte is mapped to its code point 1:1. No
    // U+FFFD characters are produced on this path, so the
    // undecodable check in clipUrl is not triggered.
    const u8 = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return s;
  }
  try {
    // `fatal: true` makes a non-UTF-8 byte throw; we CATCH that
    // and fall through to the replacement-character path below.
    return new D("utf-8", { fatal: true }).decode(buf);
  } catch {
    // The buffer is not valid UTF-8: map each byte to a printable
    // ASCII character or U+FFFD (the undecodable signal that
    // clipUrl checks). Bytes in the 0x20–0x7e range are printable
    // ASCII; all other bytes (including high-bit windows-1252
    // bytes like 0xE9) become U+FFFD.
    const u8 = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < u8.length; i++) {
      s += u8[i] >= 0x20 && u8[i] <= 0x7e ? String.fromCharCode(u8[i]) : "\uFFFD";
    }
    return s;
  }
}
