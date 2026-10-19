// Composition-root tests for the landing page (`src/app/page.tsx`).
//
// The folder contract says a section must be added in `page.tsx` AND be
// reachable, and that section order is the page's argument. Until now both were
// prose: `landing-copy.test.tsx` asserts that the Dashboard affordances carry
// `href="#showcase"`, but nothing asserted that anything answers to
// `#showcase` — and it did not. Three links on the shipped page pointed at an
// id no element had, and every gate stayed green, because a string comparison
// cannot see a missing target. So this file checks the two things only the
// composition root can check, against the rendered DOM:
//
//   - the fourteen sections are present, in the order the doc comment claims,
//     with the shipping rail between the FAQ and the finale;
//   - every in-page anchor resolves to an element that exists.

import { describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";

mock.module("../../components/landing/star-count", () => ({
  StarCount: () => null,
  getStars: async () => 128,
}));

// Render the composition without the Web Animations backend. happy-dom's
// `Element.animate` shim rejects `finished` with an unhandled `AbortError` for
// every animation it cancels, and rendering fourteen animated sections at once
// produces 16 of them, which fails the run. Without `animate`, framer-motion
// takes the same JS fallback path it takes on an old browser, and this file can
// assert structure. Per-section motion is exercised for real by `loop.test.tsx`
// and the browser gates (`landing_shots`, `contrast_audit`, the axe e2e test).
// Nothing is mocked at the library level, so no other test file sees this.
// @ts-expect-error deliberately removing a browser API for this run
Element.prototype.animate = undefined;

const LandingPage = (await import("../page")).default;

// No `cleanup()` here on purpose: unmounting the whole animated page makes
// happy-dom's Web-Animations shim reject every in-flight animation, and the
// errors it prints are its own, not the page's. Each test therefore queries
// only inside its own render container, so a tree left mounted cannot make
// another test's anchor check pass on a borrowed id.

const SECTION_COUNT = 14;

describe("landing composition root", () => {
  test("renders fourteen sections with the rail between the FAQ and the finale", () => {
    const { container } = render(<LandingPage />);
    const main = container.querySelector("main");
    expect(main).toBeTruthy();
    const kids = [...(main?.children ?? [])];
    expect(kids.length).toBe(SECTION_COUNT);

    const at = (id: string) => kids.findIndex((k) => k.id === id || k.querySelector(`#${id}`));
    const faq = at("faq");
    const rail = at("changelog");
    expect(faq).toBeGreaterThan(-1);
    expect(rail).toBe(faq + 1);
    expect(rail).toBe(SECTION_COUNT - 2); // finale is the last section
    expect(at("showcase")).toBeLessThan(faq);

    // Field notes (position 8, moved from 11 in 2026-10-19) breaks the
    // technical run loop → mechanisms → showcase into two runs of exactly
    // three — the folder's three-at-zero lore rule — by sitting between "what
    // the engine looks like" and the proof path that answers the objections.
    const fieldNotes = at("field-notes");
    expect(fieldNotes).toBe(at("showcase") + 1);
    // The models band carries no anchor id (it is the page's one unanchored
    // section), so it is asserted by position: the aqua band right after
    // field notes, then the proof path — benchmarks → integrity, one scroll.
    expect(kids[fieldNotes + 1]?.getAttribute("data-hue")).toBe("aqua");
    expect(kids[fieldNotes + 1]?.id).toBe("");
    expect(kids[fieldNotes + 2]?.id).toBe("benchmarks");
    expect(kids[fieldNotes + 3]?.id).toBe("integrity");
  });

  test("the hue walk matches the allocation paragraph: one cycle from quickstart, psychic reserved, no exceptions", () => {
    const { container } = render(<LandingPage />);
    const kids = [...(container.querySelector("main")?.children ?? [])];
    const hues = kids.map((k) => k.getAttribute("data-hue"));
    // The cycle runs gold → aqua → leaf → magma from quickstart straight
    // through the finale; `psychic` is reserved for the three sections about
    // Unown itself (hero, alphabet, field-notes) and interrupts it without
    // disturbing it. No two neighbours share a hue, and since field-notes
    // moved to position 8 the walk needs no exception paragraphs at all.
    expect(hues).toEqual([
      "psychic", // hero
      "gold", // quickstart — the walk starts here
      "aqua", // origin
      "psychic", // alphabet
      "leaf", // loop
      "magma", // mechanisms
      "gold", // showcase
      "psychic", // field-notes
      "aqua", // models
      "leaf", // benchmarks
      "magma", // integrity
      "gold", // faq
      "aqua", // changelog
      "leaf", // finale
    ]);
    for (let i = 1; i < hues.length; i++) {
      expect(hues[i]).not.toBe(hues[i - 1]);
    }
  });

  test("no in-page anchor points at an element that does not exist", () => {
    const { container } = render(<LandingPage />);
    const anchors = [...container.querySelectorAll('a[href^="#"]')];
    const dead = anchors
      .map((a) => ({
        href: a.getAttribute("href") ?? "",
        text: (a.textContent ?? "").trim().slice(0, 40),
      }))
      .filter((a) => a.href.length > 1 && !container.querySelector(`[id="${a.href.slice(1)}"]`));
    expect(dead, JSON.stringify(dead)).toEqual([]);
    // The three affordances the folder contract pins at the screenshots.
    expect(anchors.filter((a) => a.getAttribute("href") === "#showcase").length)
      .toBeGreaterThanOrEqual(3);
  });
});
