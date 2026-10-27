// Composition-root tests for the landing page (`src/app/page.tsx`).
//
// The folder contract says a section must be added in `page.tsx` AND be
// reachable, and that section order is the page's argument. Both are checked
// here against the rendered DOM, because a string comparison cannot see a
// missing anchor target (three links once pointed at an id no element had,
// and every gate stayed green).
//
//   - the ten bands are present, in the order the doc comment claims,
//     with the shipping rail between the FAQ and the finale;
//   - the hue walk matches the allocation paragraph in the landing AGENTS.md;
//   - every in-page anchor resolves to an element that exists.
//
// The band structure and the walk below are the 2026-10-20 redesign
// (eight bands) plus the capability dex (added the same day, Part 15), and the
// merge of 2026-10-23: the band five slot that joined as the split-view band and
// became the feature carousel folded back INTO the dex, so the catalog and its
// footage are one instrument again — see docs/landing-research.md.

import { describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";

mock.module("../../components/landing/star-count", () => ({
  StarCount: () => null,
  getStars: async () => 128,
}));

// Render the composition without the Web Animations backend. happy-dom's
// `Element.animate` shim rejects `finished` with an unhandled `AbortError` for
// every animation it cancels, and rendering the animated sections at once
// produces several of them, which fails the run. Without `animate`,
// framer-motion takes the same JS fallback path it takes on an old browser,
// and this file can assert structure. Per-section motion is exercised for
// real by `loop.test.tsx` and the browser gates (`landing_shots`,
// `contrast_audit`, the axe e2e test). Nothing is mocked at the library
// level, so no other test file sees this.
// @ts-expect-error deliberately removing a browser API for this run
Element.prototype.animate = undefined;

const LandingPage = (await import("../page")).default;

// No `cleanup()` here on purpose: unmounting the whole animated page makes
// happy-dom's Web-Animations shim reject every in-flight animation, and the
// errors it prints are its own, not the page's. Each test therefore queries
// only inside its own render container, so a tree left mounted cannot make
// another test's anchor check pass on a borrowed id.

const SECTION_COUNT = 10;

describe("landing composition root", () => {
  test(`renders ${SECTION_COUNT} bands with the rail between the FAQ and the finale`, () => {
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
    expect(rail).toBe(SECTION_COUNT - 2); // finale is the last band
    // the argument's order: mechanism before capability before proof before
    // identity before record
    expect(at("loop")).toBe(1);
    expect(at("dex")).toBe(2);
    expect(at("showcase")).toBe(3);
    expect(at("live-demo")).toBe(4);
    expect(at("proof")).toBe(5);
    expect(at("alphabet")).toBe(6);
    // The capture band is gone as a band of its own — its media lives in the
    // dex's panes now, and an orphan #features would fail the anchor test.
    expect(at("features")).toBe(-1);
    expect(at("showcase")).toBeLessThan(faq);
  });

  test("the hue walk matches the allocation paragraph: psychic reserved, no two neighbours share", () => {
    const { container } = render(<LandingPage />);
    const kids = [...(container.querySelector("main")?.children ?? [])];
    const hues = kids.map((k) => k.getAttribute("data-hue"));
    // `psychic` is reserved for the two bands about Unown itself (hero,
    // alphabet) and interrupts the cycle without disturbing it; the rest walk
    // the four Gen 3 hues with no two neighbours sharing one. The dex takes
    // magma — the Gen-3 red the actual dex device is — and sits between the
    // leaf loop and the gold showcase, so it never touches the proof band's
    // own magma. The live-demo band (2026-10-28) joins between the gold
    // showcase and the magma proof — aqua keeps its neighbours honest there
    // (the changelog's aqua is far away, the finale's leaf follows psychic).
    // The proof band's three panes carry their own data-hue wrappers (leaf,
    // magma, aqua) inside the magma section — the walk below is the top level.
    expect(hues).toEqual([
      "psychic", // hero
      "leaf", // loop — how it learns
      "magma", // dex — the capability catalog and its captures
      "gold", // showcase — mission control
      "aqua", // live demo — the agent-built app, running
      "magma", // proof — benchmarks | integrity | models
      "psychic", // alphabet — the identity (+ field notes)
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
    // The affordances the folder contract pins at the screenshots: the nav
    // and the footer "Dashboard" both land on #showcase.
    expect(anchors.filter((a) => a.getAttribute("href") === "#showcase").length)
      .toBeGreaterThanOrEqual(2);
    // The install anchor survives in the hero (the quickstart section it
    // pointed at was folded into the hero on 2026-10-20).
    expect(anchors.filter((a) => a.getAttribute("href") === "#quickstart").length)
      .toBeGreaterThanOrEqual(3);
  });
});
