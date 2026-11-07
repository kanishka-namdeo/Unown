// fugue.test.tsx — pins "the fourth user product" band's contracts
// (the Sonata round's F-10 closeout: the Fugue landing usage band).
//
// The band is Fugue, the repo's fourth self-contained user-facing app
// (apps/fugue/). What this suite pins:
//   - the section exists with the gold hue and the #fugue anchor;
//   - the exact title + kicker the band's contract named;
//   - the two stills (the identity pair): real paths that exist on disk,
//     declared <img> dims equal to the PNGs' real IHDR (2560×1600 — the
//     dex-media gate's rule, re-checked here), and the exact alt/caption
//     text;
//   - the stills are framed statically (no link, no video, no iframe);
//   - the two exit links are committed absolute GitHub docs (never a
//     blog route);
//   - the honest-scope clause (Chromium-desktop-only, the fixture
//     lane) is in the lede;
//   - the NO-FIGURE pin: by decision the band carries no receipted
//     numbers (the Sonata battery is F-11's CI gate, not a committed
//     receipt) — every number rendered in the band's data or DOM must
//     belong to a documented token-class set (the ostinato suite's
//     drift-pin shape, with a deliberately small, receipted literal set).
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FugueSection } from "../fugue";
import { FUGUE_LEDE, FUGUE_LINKS, FUGUE_STILLS } from "../fugue-data";

// The composition root's animate shim (see landing-page.test.tsx).
// @ts-expect-error deliberately removing a browser API for this run
Element.prototype.animate = undefined;

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

/** PNG IHDR width/height reader — the dex-media trick, no image lib needed. */
function pngSize(buf: Buffer): [number, number] {
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

/** Extract the number tokens from rendered/data copy ("2560" → 2560,
 *  "1280×800" → 1280/800). */
function numbersIn(s: string): string[] {
  return (s.match(/\d[\d.,]*/g) ?? []).map((t) => t.replace(/[.,]+$/, ""));
}

/**
 * The token-class pin — the band carries NO receipted figure by decision
 * (the Sonata battery is F-11's CI gate, not a committed receipt, so an
 * un-receipted number is an invention and this pin goes red for it).
 * Every digit token that DOES render is a documented token class:
 */
const EXPECTED_NUMBERS = new Set([
  // Token classes the extractor happens to catch — receipted here with
  // their own comment, exactly like the Ostinato/Chaconne suites:
  "4", // "fourth user-facing app" — the product's ordinal in the house pattern (Coda 1st, Ostinato 2nd, Chaconne 3rd), a claim, not a figure
  "0", // "zero pointer events" / "zero new dependencies" honesty clauses
  // Still-declaration dims (the files' real IHDR, re-checked below):
  "2560", // the stills' width (1280x800 @ deviceScaleFactor 2)
  "1600", // the stills' height (same)
]);

afterEach(() => {
  cleanup();
});

describe("fugue band (the fourth user product)", () => {
  test("the exact title, the gold hue, and the anchor", () => {
    const { container } = render(<FugueSection />);
    const section = container.querySelector("section#fugue");
    expect(section).toBeTruthy();
    expect(section?.getAttribute("data-hue")).toBe("gold");
    const h2 = container.querySelector("h2");
    expect(h2?.textContent).toContain("Fugue");
    expect(container.textContent).toContain("The fourth user product");
    expect(container.textContent).toContain(FUGUE_LEDE);
  });

  test("the two stills: real paths, true IHDR dims, exact alt and caption", () => {
    const { container } = render(<FugueSection />);
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs.length).toBe(FUGUE_STILLS.length);
    expect(FUGUE_STILLS.map((s) => s.src)).toEqual([
      "/landing/fugue/08-palette-light.png",
      "/landing/fugue/04-dreams-light.png",
    ]);
    FUGUE_STILLS.forEach((s, i) => {
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

  test("the exit links are the committed GitHub docs — absolute, new tab", () => {
    const { container } = render(<FugueSection />);
    expect(FUGUE_LINKS.length).toBe(2);
    for (const l of FUGUE_LINKS) {
      const a = container.querySelector(`a[href="${l.href}"]`);
      expect(a, `the band must link ${l.href}`).toBeTruthy();
      expect(a?.textContent).toBe(l.label);
      expect(a?.getAttribute("target")).toBe("_blank");
      expect(a?.getAttribute("rel")).toContain("noreferrer");
      expect(l.href.startsWith("/")).toBe(false);
    }
  });

  test("the honest-scope clause is the lede's (Chromium-desktop, the fixture lane)", () => {
    const { container } = render(<FugueSection />);
    expect(container.textContent).toContain("Chromium-desktop");
    // fixture honesty: the band's own words, not a measurement claim
    expect(container.textContent).toContain("Fixture-verified");
    expect(container.textContent).toContain("the one hand-edit lane");
  });

  test("every number the band renders belongs to the token-class set — the no-figure pin", () => {
    // The data may only carry documented token classes — an unexpected
    // number in the data module itself is red here (additions AND
    // removals both flag).
    const dataNumbers = new Set(
      [
        FUGUE_LEDE,
        ...FUGUE_STILLS.flatMap((s) => [s.alt, s.caption]),
        ...FUGUE_LINKS.map((l) => l.label),
      ].flatMap(numbersIn),
    );
    for (const n of dataNumbers) {
      expect(
        EXPECTED_NUMBERS.has(n),
        `"${n}" appears in the band's data but is not a receipted figure or documented token class`,
      ).toBe(true);
    }

    // From the DOM: every rendered text token carries a subset of the
    // same set — a number hardcoded into the component (bypassing the
    // data file) is the one defect the first half cannot see.
    const { container } = render(<FugueSection />);
    const allText = (container.textContent ?? "").split(/\s+/).join(" ");
    const domNumbers = new Set(numbersIn(allText));
    for (const n of domNumbers) {
      expect(
        EXPECTED_NUMBERS.has(n),
        `"${n}" renders in the band but is not a receipted figure or documented token class`,
      ).toBe(true);
    }
  });
});
