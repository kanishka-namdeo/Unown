// Component tests for the shipping rail (src/components/landing/changelog.tsx).
//
// The rail is the landing page's only generated section — `changelog-data.ts`
// comes from CHANGELOG.md via scripts/landing_changelog.mjs — so these pin the
// things the generator cannot: that the component renders the data honestly, and
// that the horizontal band is actually operable rather than merely wide.
//
//   - every date printed is a `<time datetime>` from a release heading, and the
//     frontier stop prints NO date at all (an undated promise is the one thing
//     this page cannot check);
//   - no cadence claim: the repo has two releases cut on the same day, so any
//     "every week" phrasing here would be a fabrication;
//   - totals and overflow counts come from the data, never typed;
//   - the band is a keyboard-reachable region wrapping an ordered list, with
//     `role="list"` re-declared because the stylesheet removes the markers
//     (Safari drops list semantics when it does);
//   - the ▶ and `aria-current` mark the newest CUT stop, not the leftmost stop
//     — the frontier stop is ahead of the record, and confusing the two would
//     claim a release that has not happened;
//   - the ◀ ▶ buttons drive the scroller (asserted by stubbing `scrollBy`, so a
//     button that renders but does nothing cannot pass).

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { CHANGELOG_TOTAL_ENTRIES, CHANGELOG_STOPS } = await import("../changelog-data");
const { ChangelogRail, MAX_LISTED, latestCutIndex } = await import("../changelog");

afterEach(() => {
  cleanup();
});

const listedCount = (stop: (typeof CHANGELOG_STOPS)[number]) =>
  stop.groups
    .filter((g) => g.bucket === "Added" || g.bucket === "Behavior")
    .reduce((n, g) => n + g.items.length, 0);

const rail = () => render(<ChangelogRail />);

describe("landing changelog rail", () => {
  test("renders dated stops only — an uncut [Unreleased] tile never reaches the page", () => {
    const { container } = rail();
    const times = [...container.querySelectorAll("time")].map((t) => t.getAttribute("datetime"));

    const cut = CHANGELOG_STOPS.filter((s) => s.date);
    for (const stop of cut) {
      expect(times).toContain(stop.date);
      expect(stop.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // One <time> per cut stop, and nothing else: the rail no longer renders an
    // uncut tile. Its chrome (`UNCUT`, `no tag yet`, a tally, and a headline for
    // work that has not shipped) bought the band no part of its argument — the
    // record reads as live because the stops carry dates — and it cost the page
    // ~20 words of the scroll budget at every changelog entry. The in-flight
    // record stays one click away at the exit's CHANGELOG.md link.
    expect(times.length).toBe(cut.length);
    expect(container.textContent).not.toContain("UNCUT");
    expect(container.textContent).not.toContain("no tag yet");
  });

  test("makes no promise about how often the project ships", () => {
    const { container } = rail();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/every (week|month|day|release)/i);
    expect(text).not.toMatch(/\b(weekly|monthly|continuously)\b/i);
  });

  test("the heading number is the data's number, and never a display-face digit", () => {
    const { container } = rail();
    expect(container.textContent).toContain(`${CHANGELOG_TOTAL_ENTRIES} entries`);
    // Pixelify Sans reads `57` as `S7`: no digit may sit in the h2.
    const h2 = container.querySelector("h2")?.textContent ?? "";
    expect(h2).not.toMatch(/\d/);
    expect(h2.length).toBeGreaterThan(0);
  });

  test("the band is a focusable region around an ordered list", () => {
    const { container } = rail();
    const region = container.querySelector('[role="region"]');
    expect(region).toBeTruthy();
    expect(region?.getAttribute("tabindex")).toBe("0");
    expect(region?.getAttribute("aria-label")).toContain("Release rail");
    const ol = region?.querySelector("ol[role='list']");
    expect(ol).toBeTruthy();
    expect(ol?.hasAttribute("reversed")).toBe(true);
    // Markers are removed by the stylesheet, so the role must be re-declared.
    // One list per rendered stop, and the rendered stops are the cut ones.
    expect(region?.querySelectorAll("ul[role='list']").length).toBe(
      CHANGELOG_STOPS.filter((s) => s.date).length,
    );
    expect(container.innerHTML).not.toMatch(/<ul[^>]*>\s*<div/);
  });

  test("the current marker sits on the newest CUT stop (the frontier when a release is just cut)", () => {
    const { container } = rail();
    // Release-aware: mid-flight the frontier stop is the uncut [Unreleased]
    // and the marker must sit further back; right after a cut the newest CUT
    // release IS the frontier (index 0) until the next Unreleased opens.
    const idx = latestCutIndex(CHANGELOG_STOPS);
    expect(idx).toBeGreaterThanOrEqual(0);
    const current = container.querySelectorAll('[aria-current="date"]');
    expect(current.length).toBe(1);
    const label = current[0]?.textContent ?? "";
    const latest = CHANGELOG_STOPS[idx];
    expect(label).toContain(`v${latest.label}`);
    expect(label).toContain("latest");
    expect(label).not.toContain("UNCUT");
  });

  test("the ◀ ▶ buttons actually scroll the band, in opposite directions", () => {
    const { container } = rail();
    // The scroll container is the region div (.gb-rail carries overflow-x in
    // landing.css), NOT the <ol> track — a `width: max-content` flex row
    // cannot scroll. The nudge originally called scrollBy on the track, which
    // scrolls a non-scrollable element by exactly zero: the buttons shipped
    // dead while this test passed, because the mock below was attached to the
    // same wrong element the code targeted. The mock now pins the real
    // contract — the region is the thing that must move.
    const region = container.querySelector("div[role='region']") as HTMLDivElement & {
      scrollBy: (o: ScrollToOptions) => void;
    };
    expect(region).toBeTruthy();
    expect(region.getAttribute("aria-label")).toBe("Release rail, newest stop first");
    const calls: ScrollToOptions[] = [];
    region.scrollBy = (o: ScrollToOptions) => calls.push(o);

    fireEvent.click(screen.getByRole("button", { name: /older stops$/i }));
    fireEvent.click(screen.getByRole("button", { name: /newer stops$/i }));

    expect(calls.length).toBe(2);
    expect(calls[0].left! > 0).toBe(true);
    expect(calls[1].left! < 0).toBe(true);
    // The magnitude is measured from the tile box, and happy-dom performs no
    // layout, so the real "one tile plus its gap" step is asserted in the
    // browser probe instead — see download/rail_shots.mjs and the folder's
    // Verification section.
  });

  test("counts and links the entries a tile does not print", () => {
    const { container } = rail();
    const overflow = CHANGELOG_STOPS.map(listedCount).filter((n) => n > MAX_LISTED);
    expect(overflow.length).toBeGreaterThan(0); // at least one stop exceeds MAX_LISTED
    const text = container.textContent ?? "";
    for (const n of overflow) expect(text).toContain(`+${n - MAX_LISTED} more`);

    const links = screen.getAllByRole("link", { name: /CHANGELOG\.md/i });
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l.getAttribute("href")).toContain("/blob/main/CHANGELOG.md");
  });

  test("links each cut release to its GitHub release, which exists", () => {
    rail();
    for (const stop of CHANGELOG_STOPS.filter((s) => s.date)) {
      const link = screen.getByRole("link", { name: new RegExp(`v${stop.label} release`, "i") });
      expect(link.getAttribute("href")).toBe(
        `https://github.com/kanishka-namdeo/Unown/releases/tag/v${stop.label}`,
      );
    }
  });

  test("declares its own anchor and the section hue the palette gate expects", () => {
    const { container } = rail();
    const section = container.querySelector("section");
    expect(section?.id).toBe("changelog");
    expect(section?.getAttribute("data-hue")).toBe("aqua");
  });

  test("no markdown survives from the changelog into the rendered copy", () => {
    const { container } = rail();
    const text = container.textContent ?? "";
    expect(text).not.toContain("**");
    expect(text).not.toContain("`");
    expect(text).not.toMatch(/\]\(https?:/);
  });
});
