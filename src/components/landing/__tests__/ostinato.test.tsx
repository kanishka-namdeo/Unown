// ostinato.test.tsx — pins "the second user product" band's contracts
// (the Ostinato round's O-6 closeout: the Ostinato landing usage band).
//
// The band is Ostinato, the repo's second self-contained user-facing app
// (apps/ostinato/). What this suite pins:
//   - the section exists with the leaf hue and the #ostinato anchor;
//   - the exact title + kicker the band's contract named;
//   - the two stills (the identity pair): real paths that exist on disk, declared <img> dims
//     equal to the PNGs' real IHDR (2560×1600 — the dex-media gate's rule,
//     re-checked here), and the exact alt/caption text;
//   - the stills are framed statically (no link, no video, no iframe);
//   - the two receipt links are committed absolute GitHub docs (never a
//     blog route);
//   - the single figure the band carries (the O-4/O-5 hardening battery,
//     receipt run-20261104T181704Z) is present with its caveats;
//   - the drift pin: every number in the band's data re-extracted against
//     this file's literal set, and every number in the rendered DOM
//     belongs to that set (the Coda band's pattern — a figure cannot drift
//     without the pin going red).
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OstinatoSection } from "../ostinato";
import {
  OSTINATO_BATTERY_FIGURE,
  OSTINATO_LEDE,
  OSTINATO_LINKS,
  OSTINATO_STILLS,
} from "../ostinato-data";

// The composition root's animate shim (see landing-page.test.tsx).
// @ts-expect-error deliberately removing a browser API for this run
Element.prototype.animate = undefined;

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

/** PNG IHDR width/height reader — the dex-media trick, no image lib needed. */
function pngSize(buf: Buffer): [number, number] {
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

/** Extract the number tokens from rendered/data copy ("12 specs" → 12,
 *  "8.5 s" → 8.5; "2560" → 2560). */
function numbersIn(s: string): string[] {
  return (s.match(/\d[\d.,]*/g) ?? []).map((t) => t.replace(/[.,]+$/, ""));
}

/** The band's receipted figures — every number the band may render. A digit
 *  outside this set is a figure the mission did not receipt. Lane-name and
 *  token-class digits the extractor happens to catch are receipted here
 *  with their own comment, exactly like the Coda suite's "2" in "e2e". */
const EXPECTED_NUMBERS = new Set([
  "12", // 12 specs in the hardening battery (and the 12/12 verdict — the extractor reads "12" twice)
  "8.5", // the 8.5 s first run (the extractor's token: digits + decimal tail)
  "7.2", // the 7.2 s re-run (same token shape)
  "2", // "SM-2" in the lede — the scheduler's name, not a figure
]);

afterEach(() => {
  cleanup();
});

describe("ostinato band (the second user product)", () => {
  test("the exact title, the leaf hue, and the anchor", () => {
    const { container } = render(<OstinatoSection />);
    const section = container.querySelector("section#ostinato");
    expect(section).toBeTruthy();
    expect(section?.getAttribute("data-hue")).toBe("leaf");
    const h2 = container.querySelector("h2");
    expect(h2?.textContent).toContain("Ostinato");
    expect(container.textContent).toContain("The second user product");
    expect(container.textContent).toContain(OSTINATO_LEDE);
  });

  test("the two stills: real paths, true IHDR dims, exact alt and caption", () => {
    const { container } = render(<OstinatoSection />);
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs.length).toBe(OSTINATO_STILLS.length);
    expect(OSTINATO_STILLS.map((s) => s.src)).toEqual([
      "/landing/ostinato/02-palette.png",
      "/landing/ostinato/04-revealed.png",
    ]);
    OSTINATO_STILLS.forEach((s, i) => {
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

  test("the receipt links are the committed GitHub docs — absolute, new tab", () => {
    const { container } = render(<OstinatoSection />);
    expect(OSTINATO_LINKS.length).toBe(2);
    for (const l of OSTINATO_LINKS) {
      const a = container.querySelector(`a[href="${l.href}"]`);
      expect(a, `the band must link ${l.href}`).toBeTruthy();
      expect(a?.textContent).toBe(l.label);
      expect(a?.getAttribute("target")).toBe("_blank");
      expect(a?.getAttribute("rel")).toContain("noreferrer");
      expect(l.href.startsWith("/")).toBe(false);
    }
  });

  test("the band's one receipted figure is present with its caveats", () => {
    const { container } = render(<OstinatoSection />);
    expect(container.textContent).toContain(OSTINATO_BATTERY_FIGURE);
    // the caveats are the figure's own — an un-caveated "12/12" claim would
    // be red here
    expect(container.textContent).toContain("the external Playwright verifier");
  });

  test("every number the band renders belongs to the receipt set — the drift pin", () => {
    // The data may only carry receipted figures — an unexpected number in
    // the data module itself is red here (additions AND removals both flag).
    const dataNumbers = new Set(
      [
        OSTINATO_LEDE,
        OSTINATO_BATTERY_FIGURE,
        ...OSTINATO_STILLS.flatMap((s) => [s.alt, s.caption]),
        ...OSTINATO_LINKS.map((l) => l.label),
      ].flatMap(numbersIn),
    );
    // "12/12" is one occurrence of 12 in the figure (the set dedupes it)
    for (const n of dataNumbers) {
      expect(
        EXPECTED_NUMBERS.has(n),
        `"${n}" appears in the band's data but is not a receipted figure`,
      ).toBe(true);
    }

    // From the DOM: every rendered text token carries a subset of the same
    // set — a number hardcoded into the component (bypassing the data
    // file) is the one defect the first half cannot see.
    const { container } = render(<OstinatoSection />);
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
