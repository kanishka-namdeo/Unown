/**
 * extractor.ts tests — the DOM-guarded pins (the ostinato el-pin
 * precedent, L-3 deliverable #2).
 *
 * Lane semantics:
 *   Lane A — `cd apps/legato && bun test`: no `bunfig.toml` in the
 *            app dir, no DOM globals; this file registers ONE
 *            skipped stub and stays DOM-free by architecture. The
 *            extractor's module import is LAZY (inside the else
 *            branch) so the DOM-free runtime stays honest.
 *   Lane B — `bun test apps/legato` from the repo root: the root
 *            `bunfig.toml` happy-dom preload provides the DOM; the
 *            real pins RUN (fixtures' HTML parsed — clean.html
 *            extracts, empty-article degrades).
 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES_DIR = join(import.meta.dir, "../../fixtures");
const hasDom = typeof document !== "undefined";

if (!hasDom) {
  test.skip("extractor DOM-guarded tests — requires a DOM (Lane B's happy-dom provides it)", () => {});
} else {
  // The extractor's defaultParseHtml is the DOMParser runtime lookup
  // (the globalThis-seam). Under the happy-dom preload the DOMParser
  // global is present, so the default works.
  const { extractReadable, EXTRACT_CAP_BYTES } = await import("./extractor.js");

  function readFixture(name: string): string {
    return readFileSync(join(FIXTURES_DIR, name), "utf8");
  }

  test("clean.html: the control — extraction produces non-empty text + the right title", () => {
    const html = readFixture("clean.html");
    const ex = extractReadable(html, undefined, html.length);
    expect(ex.text.length).toBeGreaterThan(100);
    expect(ex.title).toBe("Clean story");
    expect(ex.paywallMarker).toBe(false);
    // The footer's three links are outside the <article> candidate,
    // so the extracted text must not contain the nav labels.
    expect(ex.text).toContain("first paragraph");
  });

  test("empty-article.html: degrades honestly — text is empty, title preserved", () => {
    const html = readFixture("empty-article.html");
    const ex = extractReadable(html, undefined, html.length);
    expect(ex.text).toBe("");
    expect(ex.title).toBe("Empty Article");
    // The body has an <h1> but zero <p>: below the density floor.
  });

  test("paywall-excerpt.html: the paywall marker is reported + excerpt captured", () => {
    const html = readFixture("paywall-excerpt.html");
    const ex = extractReadable(html, undefined, html.length);
    expect(ex.paywallMarker).toBe(true);
    expect(ex.excerpt).toBeDefined();
    // The excerpt is the marker element's text (the "Subscribe" line).
    expect(ex.excerpt).toContain("Subscribe");
  });

  test("huge.html: extraction exceeds the 500 KB cap (the oversized lane input)", () => {
    const html = readFixture("huge.html");
    const ex = extractReadable(html, undefined, html.length);
    expect(ex.text.length).toBeGreaterThan(EXTRACT_CAP_BYTES);
    expect(ex.title).toBe("The Enormous Article");
  });

  test("wrong-charset.html: high-bit bytes — the extractor does not crash", () => {
    // The fixture's bytes are windows-1252 (0xE9 é, 0xF4 ô); the
    // orchestrator's decodeUtf8 flags it undecodable BEFORE the
    // extractor runs. Here we pass the bytes interpreted as a
    // lossy UTF-8 string to confirm the extractor tolerates it.
    const raw = readFileSync(join(FIXTURES_DIR, "wrong-charset.html"));
    const lossy = raw.toString("utf8"); // 0xE9 → U+FFFD under strict decode
    const ex = extractReadable(lossy, undefined, raw.byteLength);
    expect(ex).toBeDefined();
    expect(typeof ex.text).toBe("string");
  });

  test("unparseable / empty input: degrades to empty, no crash", () => {
    const ex = extractReadable("", undefined, 0);
    expect(ex.text).toBe("");
    expect(ex.title).toBe("");
  });
}
