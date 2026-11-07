/**
 * error-taxonomy.ts — the 7-entry ClipError classifier (PLAN §1.1,
 * §2 "The closed enums", §4.1 T-1..T-7).
 *
 * PURE, TABLE-DRIVEN: `(FetchOutcome, Extraction) -> ClipLane`.
 * The lanes, each producing its honest degraded Clip fields (PLAN §4.1):
 *
 *   T-1 `charset-unknown` — undecodable/unknown charset → error clip,
 *       NEVER mojibake text (the orchestrator feeds the flag in).
 *   T-2 `redirect-loop`   — a redirect chain that cycles → no
 *       infinite follow (the orchestrator's cycle detector feeds the
 *       flag in).
 *   T-3 `js-walled`       — 403/429/empty-but-200 wall → the
 *       FALLBACK lane: title+URL+flag, "open in browser" affordance
 *       (the product-strategist ruling, PLAN §3 L-3).
 *   T-4 `paywalled`       — clip the excerpt + link, NEVER bypass.
 *   T-5 `oversized`       — the 500 KB extract cap → retained
 *       first-N-KB prefix + flag (the solution-architect ruling).
 *   T-6 `empty-text`      — readable text empty (non-walled) →
 *       title+URL fallback + flag.
 *   T-7 `fetch-failed`    — network failure / fetch cap → error
 *       clip, never a silent hang.
 *
 * `clean` is the 8th shape: the happy path, no error.
 */
import type { ClipError } from "../domain/types.js";
import type { FetchOutcome } from "./fetcher.js";
import type { Extraction } from "./extractor.js";
import { EXTRACT_CAP_BYTES as CAP } from "./extractor.js";

/**
 * A taxonomy lane — the classifier's output. `error` is `undefined`
 * on the clean lane; every error lane names its ClipError entry
 * (closed set, PLAN §2).
 */
export type ClipLane = {
  /** the taxonomy outcome (undefined = clean) */
  error: ClipError | undefined;
  /** degraded clip fields, per lane (PLAN §4.1). Only the fields
   *  the lane produces are set; the orchestrator applies them on
   *  top of the base record. */
  degraded: {
    title?: string;
    text?: string;
    excerpt?: string;
    paywallExcerptOnly?: boolean;
    emptyText?: boolean;
    jsWalled?: boolean;
    finalUrl?: string;
  };
};

/**
 * The classifier's input. The orchestrator feeds the flags it has
 * already computed:
 *  - `undecodable` (T-1) — the charset sniff failed
 *  - `cycle` (T-2)       — the redirect chain re-entered a seen URL
 *  - `rejected` (T-7)    — the fetch threw (network or fetch cap)
 */
export type Classification = {
  outcome: FetchOutcome;
  extraction: Extraction | null;
  /** the charset lane's input: undecodable → charset-unknown */
  undecodable?: boolean;
  /** the redirect lane's input: a cycle detected → redirect-loop */
  cycle?: boolean;
  /** the network lane's input: the fetch rejected → fetch-failed */
  rejected?: boolean;
};

/**
 * The 7-entry table, keyed by priority — first match wins.
 *
 * Priority (highest → lowest):
 *   1. rejected        (T-7) — a network failure short-circuits all
 *   2. undecodable     (T-1) — no decode, no extraction
 *   3. cycle           (T-2) — the chain cycled before a terminal
 *   4. status 403/429  (T-3) — the status-code wall
 *   5. paywallMarker   (T-4) — the marker lane, extraction-based
 *   6. oversized       (T-5) — the extraction exceeded the cap
 *   7. empty-text      (T-6) — nothing readable, non-walled
 *   8. clean           — the happy path
 */
export function classify(c: Classification): ClipLane {
  const { outcome, extraction } = c;

  // T-7: a rejected fetch is the fetch-failed lane — an error clip,
  // never a silent hang. Extraction is null (no body to walk).
  if (c.rejected) {
    return lane("fetch-failed", {
      title: fallbackTitle(outcome),
      text: "",
    });
  }

  // T-1: an undecodable charset — the error clip, never mojibake.
  if (c.undecodable) {
    return lane("charset-unknown", {
      title: fallbackTitle(outcome),
      text: "",
    });
  }

  // T-2: a redirect cycle — no infinite follow.
  if (c.cycle) {
    return lane("redirect-loop", {
      title: fallbackTitle(outcome),
      text: "",
      finalUrl: outcome.finalUrl,
    });
  }

  // T-3: the status-code wall (403/429). The js-walled FALLBACK
  // lane: title+URL+flag.
  if (outcome.status === 403 || outcome.status === 429) {
    const title = extraction?.title || fallbackTitle(outcome);
    return lane("js-walled", {
      title,
      text: "",
      jsWalled: true,
      finalUrl: outcome.finalUrl,
    });
  }

  const hasText = (extraction?.text ?? "").length > 0;
  const hasPaywall = extraction?.paywallMarker ?? false;

  // T-3's third form: empty-but-200 — status 200 + no readable text
  // + no paywall marker. The qa-architect fixture form. This is
  // ALWAYS the js-walled lane when the body is empty and the status
  // is 200 — the document is a JS shell (zero readable content).
  // T-6 (empty-text) is distinguished from T-3 by the extraction's
  // structure: when the extractor finds an <article> or <h1>
  // structure (score > 0 or a title) but zero readable text, it is
  // T-6. When the extractor finds NO structure at all (score 0, no
  // title), it is T-3's empty-but-200 JS-wall form.
  const isStructured =
    (extraction?.score ?? 0) > 0 || (extraction?.title ?? "").length > 0;

  // T-3's empty-but-200 form: 200 + empty text + no paywall marker
  // + no document structure (the JS shell).
  if (
    outcome.status === 200 &&
    !hasText &&
    !hasPaywall &&
    extraction !== null &&
    !isStructured
  ) {
    return lane("js-walled", {
      title: fallbackTitle(outcome),
      text: "",
      jsWalled: true,
      finalUrl: outcome.finalUrl,
    });
  }

  // T-4: the paywall marker lane — excerpt + link, never bypass.
  if (hasPaywall) {
    const excerpt = extraction?.excerpt ?? "";
    return lane("paywalled", {
      title: extraction?.title || fallbackTitle(outcome),
      text: excerpt,
      excerpt,
      paywallExcerptOnly: true,
      finalUrl: outcome.finalUrl,
    });
  }

  // T-5: the oversized lane — the 500 KB cap. The extracted text
  // exceeds the cap → retain the first-N-KB prefix.
  if (hasText && extraction!.text.length > CAP) {
    const prefix = extraction!.text.slice(0, CAP);
    return lane("oversized", {
      title: extraction!.title || fallbackTitle(outcome),
      text: prefix,
      finalUrl: outcome.finalUrl,
    });
  }

  // T-6: empty-text — readable text empty, non-walled. The
  // title+URL fallback lane.
  if (!hasText && !hasPaywall) {
    return lane("empty-text", {
      title: extraction?.title || fallbackTitle(outcome),
      text: "",
      emptyText: true,
      finalUrl: outcome.finalUrl,
    });
  }

  // The clean lane — the happy path.
  return {
    error: undefined,
    degraded: {
      title: extraction?.title || fallbackTitle(outcome),
      text: extraction?.text ?? "",
      finalUrl: outcome.finalUrl,
    },
  };
}

/**
 * A lane constructor — pairs an error with its degraded fields.
 * The table is data: every lane is one row, one call.
 */
function lane(error: ClipError, degraded: ClipLane["degraded"]): ClipLane {
  return { error, degraded };
}

/**
 * The title fallback when the extraction has none: the hostname of
 * the outcome's final URL (the PLAN §1.1 "fallback: host name"
 * rule). Pure string work — no `new URL` (the domain stays
 * Node-free).
 */
function fallbackTitle(outcome: FetchOutcome): string {
  const s = outcome.finalUrl || outcome.url;
  // A crude hostname split: `scheme://host[:port]/…` → host.
  const m = s.match(/^https?:\/\/([^\/:?#]+)/);
  return m ? m[1] : s;
}
