/**
 * error-taxonomy.ts tests — the 7-entry classifier table pins
 * (PLAN §4.1 T-1..T-7). One test per taxonomy row: the
 * Classification in, the ClipLane out. The table is data-driven;
 * each row is one expect().
 */
import { test, expect } from "bun:test";
import { classify } from "./error-taxonomy.js";
import type { FetchOutcome } from "./fetcher.js";
import type { Extraction } from "./extractor.js";
import { toUtf8Bytes } from "./fetcher.js";

/** A minimal clean Extraction (text present, no paywall). */
function cleanExtraction(overrides: Partial<Extraction> = {}): Extraction {
  return {
    title: "T",
    text: "some readable body",
    paywallMarker: false,
    score: 0.9,
    inputBytes: 100,
    ...overrides,
  };
}

/** A minimal FetchOutcome with a clean 200 + UTF-8 body. */
function outcome(overrides: Partial<FetchOutcome> = {}): FetchOutcome {
  return {
    url: "http://x.test/",
    finalUrl: "http://x.test/",
    redirects: [],
    status: 200,
    headers: {},
    body: toUtf8Bytes("<html></html>"),
    ...overrides,
  };
}

test("T-7: a rejected fetch -> fetch-failed (never a silent hang)", () => {
  const lane = classify({
    outcome: outcome(),
    extraction: null,
    rejected: true,
  });
  expect(lane.error).toBe("fetch-failed");
  expect(lane.degraded.text).toBe("");
});

test("T-1: an undecodable charset -> charset-unknown (never mojibake)", () => {
  const lane = classify({
    outcome: outcome({ headers: { "content-type": "text/html; charset=x-x-mojibake" } }),
    extraction: null,
    undecodable: true,
  });
  expect(lane.error).toBe("charset-unknown");
  expect(lane.degraded.text).toBe("");
});

test("T-2: a redirect cycle -> redirect-loop (no infinite follow)", () => {
  const lane = classify({
    outcome: outcome({ finalUrl: "http://x.test/a", redirects: ["http://x.test/b", "http://x.test/a"] }),
    extraction: null,
    cycle: true,
  });
  expect(lane.error).toBe("redirect-loop");
  expect(lane.degraded.text).toBe("");
});

test("T-3: a 403 wall -> js-walled (title+URL+flag, the FALLBACK lane)", () => {
  const lane = classify({
    outcome: outcome({ status: 403 }),
    extraction: cleanExtraction({ title: "Blocked" }),
  });
  expect(lane.error).toBe("js-walled");
  expect(lane.degraded.jsWalled).toBe(true);
  expect(lane.degraded.title).toBe("Blocked");
  expect(lane.degraded.text).toBe("");
});

test("T-3: a 429 wall -> js-walled (same lane)", () => {
  const lane = classify({
    outcome: outcome({ status: 429 }),
    extraction: cleanExtraction(),
  });
  expect(lane.error).toBe("js-walled");
});

test("T-3: empty-but-200 (no text, no paywall marker, no structure) -> js-walled", () => {
  // The qa-architect fixture form: a JS app shell answers 200 with
  // zero readable body. The canned extraction is score-0 + no
  // title (unstructured) — the discriminator that separates it
  // from T-6 (a structured page whose body is empty).
  const lane = classify({
    outcome: outcome(),
    extraction: cleanExtraction({ text: "", title: "", score: 0 }),
  });
  expect(lane.error).toBe("js-walled");
  expect(lane.degraded.jsWalled).toBe(true);
});

test("T-6 vs T-3 discriminator: a structured empty body (title present) -> empty-text", () => {
  // A valid page with a <title> but no readable body: the
  // extractor reports a non-empty title, so the classifier routes
  // it to T-6 (empty-text), NOT T-3 (js-walled).
  const lane = classify({
    outcome: outcome(),
    extraction: cleanExtraction({ text: "", title: "A real title" }),
  });
  expect(lane.error).toBe("empty-text");
  expect(lane.degraded.emptyText).toBe(true);
});

test("T-4: paywall marker -> paywalled (excerpt + link, never bypass)", () => {
  const lane = classify({
    outcome: outcome(),
    extraction: cleanExtraction({ paywallMarker: true, excerpt: "the free part" }),
  });
  expect(lane.error).toBe("paywalled");
  expect(lane.degraded.paywallExcerptOnly).toBe(true);
  expect(lane.degraded.excerpt).toBe("the free part");
  expect(lane.degraded.text).toBe("the free part");
});

test("T-5: extraction above the 500 KB cap -> oversized (retained prefix)", () => {
  const bigText = "x".repeat(500 * 1024 + 100); // over the cap
  const lane = classify({
    outcome: outcome(),
    extraction: cleanExtraction({ text: bigText }),
  });
  expect(lane.error).toBe("oversized");
  expect(lane.degraded.text!.length).toBe(500 * 1024); // prefix retained
  expect(lane.degraded.text).toBe("x".repeat(500 * 1024));
});

test("T-6: empty text, non-walled, unstructured -> empty-text (title+URL fallback)", () => {
  // The T-6 lane requires a structured document; an unstructured
  // empty body (no title, score 0) is T-3's empty-but-200 form,
  // tested above. A title-bearing extraction with empty text is
  // T-6.
  const lane = classify({
    outcome: outcome(),
    extraction: cleanExtraction({ text: "", title: "The void" }),
  });
  expect(lane.error).toBe("empty-text");
  expect(lane.degraded.emptyText).toBe(true);
  expect(lane.degraded.title).toBe("The void");
});

test("clean: a readable body, no walls, under the cap -> no error", () => {
  const lane = classify({
    outcome: outcome(),
    extraction: cleanExtraction(),
  });
  expect(lane.error).toBeUndefined();
  expect(lane.degraded.text).toBe("some readable body");
  expect(lane.degraded.title).toBe("T");
});
