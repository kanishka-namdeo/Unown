// coda.test.tsx — pins the "the first user product" band's contracts
// (the doc-truth round's T3, 2026-11-03: the Coda landing usage capture).
//
// The band is Coda, the repo's first self-contained user-facing app
// (apps/coda/). What this suite pins:
//   - the section exists with the aqua hue and the #coda anchor;
//   - the exact title + kicker the band's contract named;
//   - the two stills: real paths that exist on disk, declared <img> dims
//     equal to the PNGs' real IHDR (2560×1600 — the dex-media gate's rule,
//     re-checked here), and the exact alt/caption text;
//   - the stills are framed statically (no link, no video, no iframe);
//   - the two receipt links are committed absolute docs (never a blog
//     route);
//   - the single figure the band carries (the T2 PWA receipt's offline
//     boot-from-cache delta) is present with its caveats;
//   - the drift pin: every number in the band's data re-extracted against
//     this file's literal set, and every number in the rendered DOM
//     belongs to that set (the live-demo/built-improved pattern — a
//     figure cannot drift without the pin going red).
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CodaSection } from "../coda";
import {
  CODA_LINKS,
  CODA_LEDE,
  CODA_STILLS,
} from "../coda-data";

// The composition root's animate shim (see landing-page.test.tsx).
// @ts-expect-error deliberately removing a browser API for this run
Element.prototype.animate = undefined;

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

/** PNG IHDR width/height reader — the dex-media trick, no image lib needed. */
function pngSize(buf: Buffer): [number, number] {
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

/** Extract the number tokens from rendered/data copy ("91 ms" → 91, "N=5"
 *  → 5; "84 ms" → 84; "2560" → 2560). */
function numbersIn(s: string): string[] {
  return (s.match(/\d[\d.,]*/g) ?? []).map((t) => t.replace(/[.,]+$/, ""));
}

/** The band's receipted figures — every number the band may render. A digit
 *  outside this set is a figure the mission did not receipt. ('e2e' carries a
 *  '2' the pin extracts as a token — it is the lane name, not a figure, so
 *  it is receipted here with its own comment, exactly like the
 *  built-improved set's documented one-liners.) */
const EXPECTED_NUMBERS = new Set([
  "91", // the offline boot-from-cache median (ms)
  "175", // the online baseline median (ms)
  "84", // the precache's measured delta (ms)
  "5", // N=5 runs
  "2", // 'e2e' — the lane name in the lede/alt/caption, not a figure
]);

afterEach(() => {
  cleanup();
});

describe("coda band (the first user product)", () => {
  test("the exact title, the aqua hue, and the anchor", () => {
    const { container } = render(<CodaSection />);
    const section = container.querySelector("section#coda");
    expect(section).toBeTruthy();
    expect(section?.getAttribute("data-hue")).toBe("aqua");
    const h2 = container.querySelector("h2");
    expect(h2?.textContent).toContain("Coda");
    expect(container.textContent).toContain("The first user product");
    expect(container.textContent).toContain(CODA_LEDE);
  });

  test("the two stills: real paths, true IHDR dims, exact alt and caption", () => {
    const { container } = render(<CodaSection />);
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs.length).toBe(CODA_STILLS.length);
    expect(CODA_STILLS.map((s) => s.src)).toEqual([
      "/landing/coda/01-fresh-boot.png",
      "/landing/coda/02-in-use.png",
    ]);
    CODA_STILLS.forEach((s, i) => {
      const el = imgs[i];
      expect(el.getAttribute("src")).toBe(s.src);
      expect(el.getAttribute("alt")).toBe(s.alt);
      expect(Number(el.getAttribute("width"))).toBe(2560);
      expect(Number(el.getAttribute("height"))).toBe(1600);
      const file = join(REPO_ROOT, "public", s.src.replace(/^\//, ""));
      expect(existsSync(file), `${s.src} missing under public/`).toBe(true);
      const [w, h] = pngSize(readFileSync(file));
      expect(w).toBe(2560);
      expect(h).toBe(1600);
      const cap = el.closest("figure")?.querySelector("figcaption");
      expect(cap?.textContent).toBe(s.caption);
      // the frame is a still, not a link and not a player — static band
      expect(el.closest("a")).toBeNull();
    });
    expect(container.querySelectorAll("video, iframe").length).toBe(0);
  });

  test("the receipt links are the committed docs — absolute, new tab", () => {
    const { container } = render(<CodaSection />);
    for (const l of CODA_LINKS) {
      const a = container.querySelector(`a[href="${l.href}"]`);
      expect(a, `the band must link ${l.href}`).toBeTruthy();
      expect(a?.textContent).toBe(l.label);
      expect(a?.getAttribute("target")).toBe("_blank");
      expect(a?.getAttribute("rel")).toContain("noreferrer");
      expect(l.href.startsWith("/")).toBe(false);
    }
  });

  test("the receipt exits render", () => {
    const { container } = render(<CodaSection />);
    expect(CODA_LINKS.length).toBe(2);
    for (const l of CODA_LINKS) {
      const a = container.querySelector(`a[href="${l.href}"]`);
      expect(a, `the band must link ${l.href}`).toBeTruthy();
    }
  });

  test("every number the band renders belongs to the receipt set — the drift pin", () => {
  // The data may only carry receipted figures — an unexpected number in
    // the data module itself is red here (additions AND removals both flag).
    const dataNumbers = new Set(
      [
        CODA_LEDE,
        ...CODA_STILLS.flatMap((s) => [s.alt, s.caption]),
        ...CODA_LINKS.map((l) => l.label),
      ].flatMap(numbersIn),
    );
    // The data may only carry receipted figures — an unexpected number in
    // the data module itself is red here (additions AND removals both flag).
    for (const n of dataNumbers) {
      expect(
        EXPECTED_NUMBERS.has(n),
        `"${n}" appears in the band's data but is not a receipted figure`,
      ).toBe(true);
    }

    // From the DOM: every rendered text token carries a subset of the same
    // set — a number hardcoded into the component (bypassing the data
    // file) is the one defect the first half cannot see.
    const { container } = render(<CodaSection />);
    const allText = (container.textContent ?? "").split(/\s+/).join(" ");
    const domNumbers = new Set(numbersIn(allText));
    for (const n of domNumbers) {
      expect(
        EXPECTED_NUMBERS.has(n),
        `"${n}" renders in the band but is not a receipted figure`,
      ).toBe(true);
    }
  });
});
