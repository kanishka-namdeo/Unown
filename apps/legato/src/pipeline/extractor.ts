/**
 * extractor.ts — readability-lite over the DOM parser (PLAN §1.1,
 * §1.2, §4.1 T-4..T-6).
 *
 * The classic heuristics, kept LITE:
 *   1. score candidate containers — the `<article>` / `<main>` /
 *      `role=main` element when present, else every `<div>`/`<p>`
 *      parent in the body
 *   2. paragraph density — paragraphs / (paragraphs + headings +
 *      anchors): more prose per block wins
 *   3. link-density penalty — the ratio of anchor text to total text
 *      in a candidate: nav/footers are link soup, articles are not
 *   4. heading proximity — a candidate adjacent to an `<h1>`-`<h3>`
 *      scores up (the title is near the body)
 *   5. the winner's text (block-tag line-breaks, whitespace
 *      collapsed) + the document title
 *
 * Degrade honestly: when NO candidate reaches the paragraph-density
 * floor, `text` comes back EMPTY and the caller classifies the
 * `empty-text` / js-walled lane (the T-6 / T-3 split is the
 * classifier's, not the extractor's — it only reports what it
 * found).
 *
 * DOM-GUARD DESIGN (the boundary test's DOM_GLOBS law, the
 * idb-storage.ts convention + the ostinato el-pin precedent):
 *
 * The DOM parser is an INJECTED dependency — `parseHtml` is passed
 * to `extractReadable` (and defaults to a runtime lookup through
 * the globalThis-seam, never a module-scope member-access
 * expression). No DOM global is named at module scope, so this
 * file loads clean in the DOM-free runtime.
 *
 * The test pattern (the ostinato el-pin precedent, verbatim):
 *   - Lane A (`cd apps/legato && bun test`): the DOM-guarded test
 *     registers ONE skipped stub; module import is LAZY (inside
 *     the else branch) so the DOM-free runtime stays honest.
 *   - Lane B (`bun test apps/legato` from the root): the root
 *     bunfig's happy-dom preload provides the DOM; the real pins
 *     RUN (fixtures' HTML parsed — clean.html extracts,
 *     empty-article degrades).
 */
import type { CannedFetch } from "./fetcher.js";

/**
 * The parser seam — a function that turns an HTML string into a
 * root element the extractor can walk. The browser default is
 * `new DOMParser().parseFromString(html, "text/html")`'s document
 * element; tests inject a DOMParser (Lane B) or a stub (Lane A's
 * skip). Declared structurally so this module stays import-graph
 * clean (no browser global named).
 */
export type ParseHtml = (html: string) => ParsedDocument;

/**
 * The structural parsed-document surface — the minimal shape the
 * extractor needs. Matches both `document` (the DOMParser result)
 * and any minimal test stub.
 */
export type ParsedDocument = {
  querySelector(selector: string): ParsedNode | null;
  querySelectorAll(selector: string): ArrayLike<ParsedNode>;
  /** the document's `<title>` text (empty when absent) */
  title: string;
};

/** The structural node surface the extractor walks. */
export type ParsedNode = {
  nodeName: string;
  textContent: string;
  getAttribute(name: string): string | null;
  /** parent (used for link-density walks — optional in stubs) */
  parentElement?: ParsedNode | null;
  /** direct children (used for candidate scoring) */
  childNodes?: ArrayLike<ParsedNode>;
};

/** The extraction result — the classifier's other input. */
export type Extraction = {
  /** the document title ("" when absent) */
  title: string;
  /** the extracted readable body (""). EMPTY is the honest
   *  degrade signal — the caller maps it to the empty-text lane. */
  text: string;
  /** the paywall excerpt, when the document carries the marker
   *  (T-4 — the extractor REPORTS the marker, the classifier
   *  decides the lane) */
  excerpt?: string;
  /** true when the document carries the paywall marker */
  paywallMarker: boolean;
  /** the winner's score (for the cap/oversized lane's reasoning) */
  score: number;
  /**
   * The byte size of the input HTML. Carried through for the
   * oversized lane: the 500 KB cap is applied to the extracted
   * TEXT, and an input above the cap that extracts to above the
   * cap is `oversized` with the retained prefix (T-5, the
   * solution-architect ruling).
   */
  inputBytes: number;
};

/** The 500 KB extract cap (PLAN §4.1 T-5, the L-3 law). */
export const EXTRACT_CAP_BYTES = 500 * 1024;

/** The paragraph-density floor: below this ratio, the candidate
 *  contributes nothing readable (the honest-degrade signal). */
const PARAGRAPH_DENSITY_FLOOR = 0.3;

/**
 * The runtime parser default — used when no parser is injected
 * (the L-11 e2e lane). Named through the globalThis-seam (the
 * idb-storage.ts convention): no DOM global at module scope.
 */
export const defaultParseHtml: ParseHtml = (html) => {
  const P = (globalThis as Record<string, unknown>)["DOMParser"] as
    | (new () => { parseFromString(s: string, type: string): ParsedDocument })
    | undefined;
  if (!P) throw new Error("no DOM parser available (browser-only module)");
  const doc = new P().parseFromString(html, "text/html");
  return doc;
};

/**
 * Extract the readable copy from an HTML document.
 *
 * @param html - the document text (already charset-decoded by the
 *  orchestrator; this function is encoding-agnostic by contract).
 * @param parseHtml - the parser seam (default: the runtime
 *  DOMParser lookup, browser-only).
 * @param inputBytes - the undecoded byte length, carried through
 *  for the oversized lane's reasoning.
 */
export function extractReadable(
  html: string,
  parseHtml: ParseHtml = defaultParseHtml,
  inputBytes: number = html.length,
): Extraction {
  let doc: ParsedDocument;
  try {
    doc = parseHtml(html);
  } catch {
    // Unparseable document — degrade honestly (the caller maps the
    // failure to its own lane).
    return { title: "", text: "", paywallMarker: false, score: 0, inputBytes };
  }

  const title = (doc.title ?? "").trim();
  const paywallMarker = doc.querySelector('[data-paywall]') !== null;
  // The paywall excerpt: when the marker is present, the marker
  // element's text is the clipable copy. The extractor REPORTS it;
  // the classifier decides the lane (T-4: excerpt + link, never
  // bypass).
  const excerpt = paywallMarker
    ? (doc.querySelector('[data-paywall]')?.textContent ?? "").trim() || undefined
    : undefined;

  // Candidate containers: <article>, <main>, role=main, then
  // every <div>/<section> in the body.
  const candidates: ParsedNode[] = [];
  for (const sel of ["article", "main", '[role="main"]']) {
    const n = doc.querySelector(sel);
    if (n) candidates.push(n);
  }
  if (candidates.length === 0) {
    const divs = doc.querySelectorAll("div, section");
    for (let i = 0; i < divs.length; i++) candidates.push(divs[i]);
  }

  let best: { text: string; score: number } = { text: "", score: 0 };

  for (const cand of candidates) {
    const { text, score } = scoreCandidate(cand);
    if (score > best.score) best = { text, score };
  }

  // The paragraph-density floor: a candidate below the floor is
  // link soup, not an article — degrade to empty (T-6).
  const text = best.score >= PARAGRAPH_DENSITY_FLOOR ? best.text : "";

  return { title, text, excerpt, paywallMarker, score: best.score, inputBytes };
}

/**
 * Score a candidate container and return its extracted text.
 *
 * Heuristics (all LITE — the classic set, no ML):
 *   - paragraph density: paragraphs / blocks (higher wins)
 *   - link-density penalty: anchor-text / total-text (lower wins)
 *   - heading proximity: a heading ancestor/descendant bumps up
 */
function scoreCandidate(node: ParsedNode): { text: string; score: number } {
  const blocks: ParsedNode[] = [];
  collectChildren(node, blocks);

  let paragraphs = 0;
  let anchors = 0;
  let headings = 0;
  let linkTextLen = 0;
  let totalTextLen = 0;

  for (const b of blocks) {
    const tag = b.nodeName.toLowerCase();
    const text = (b.textContent ?? "").trim();
    totalTextLen += text.length;
    if (tag === "p") paragraphs += 1;
    else if (tag === "a") {
      anchors += 1;
      linkTextLen += text.length;
    } else if (tag.startsWith("h")) {
      headings += 1;
    }
  }

  const textBlocks = totalTextLen + 1; // +1: no divide-by-zero on an empty node
  const paragraphDensity = paragraphs / (paragraphs + anchors + headings || 1);
  const linkDensity = linkTextLen / textBlocks;
  const headingBoost = headings > 0 ? 0.1 : 0;

  // The extractor's text: every block's text, newlines between
  // blocks, whitespace collapsed.
  const text = blocks
    .map((b) => (b.textContent ?? "").trim())
    .filter((t) => t.length > 0)
    .join("\n\n");

  // The score: density wins, link-density penalizes, headings bump.
  const score = paragraphDensity - linkDensity * 0.5 + headingBoost;

  return { text, score };
}

/** Collect all leaf-level block descendants of a node. */
function collectChildren(node: ParsedNode, out: ParsedNode[]): void {
  const kids = node.childNodes;
  if (!kids) {
    // Leaf node: include self
    out.push(node);
    return;
  }
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i] as ParsedNode;
    if (!c.nodeName) continue;
    const tag = c.nodeName.toLowerCase();
    // Block tags: include + recurse. Skip <script>/<style>.
    if (tag === "script" || tag === "style") continue;
    out.push(c);
    collectChildren(c, out);
  }
}

/**
 * The canned-HTML convenience: build an Extraction from a
 * FakeFetcher's `CannedFetch` body (the L-3 test glue — keeps the
 * fixture doubles and the extractor in one place).
 */
export function extractFromCanned(canned: CannedFetch): Extraction {
  const bytes = new Uint8Array(canned.body ?? new ArrayBuffer(0));
  const enc =
    (globalThis as Record<string, unknown>)["TextDecoder"] as
      | (new () => { decode(buf: ArrayBuffer | ArrayBufferView): string })
      | undefined;
  const html = enc ? new enc().decode(bytes) : String(bytes);
  return extractReadable(html, defaultParseHtml, bytes.byteLength);
}
