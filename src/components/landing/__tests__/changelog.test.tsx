// Component tests for the shipping rail (src/components/landing/changelog.tsx).
//
// The rail is the landing page's only section whose content is generated —
// `changelog-data.ts` comes from CHANGELOG.md via scripts/landing_changelog.mjs.
// So these tests pin the two things the generator cannot: that the component
// renders the data honestly, and that it keeps the semantics.
//
//   - every date printed is a `<time datetime>` taken from a release heading,
//     and the in-flight stop prints NO date at all (an undated promise is the
//     one thing this page cannot check);
//   - no cadence claim: the repo has two releases cut on the same day, so any
//     "every week" phrasing on this section would be a fabrication;
//   - totals come from the data, so an appended changelog entry cannot leave a
//     stale number in the heading;
//   - list semantics survive (`role="list"` on both the rail and its entries,
//     because Safari drops list structure when markers are hidden);
//   - the overflow is honest: entries the rail does not print are counted and
//     linked to the file that holds them.

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";

const { CHANGELOG_TOTAL_ENTRIES, CHANGELOG_STOPS } = await import("../changelog-data");
const { ChangelogRail, MAX_LISTED } = await import("../changelog");

afterEach(() => {
  cleanup();
});

const listedCount = (stop: (typeof CHANGELOG_STOPS)[number]) =>
  stop.groups.filter((g) => g.bucket === "Added" || g.bucket === "Behavior").reduce((n, g) => n + g.items.length, 0);

describe("landing changelog rail", () => {
  test("prints release dates as <time>, and prints no date for the uncut stop", () => {
    const { container } = render(<ChangelogRail />);
    const times = [...container.querySelectorAll("time")].map((t) => t.getAttribute("datetime"));

    for (const stop of CHANGELOG_STOPS.filter((s) => s.date)) {
      expect(times).toContain(stop.date);
      expect(stop.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    const uncut = CHANGELOG_STOPS.filter((s) => !s.date);
    expect(uncut.length).toBeGreaterThan(0);
    for (const stop of uncut) {
      const li = [...container.querySelectorAll("li")].find((el) =>
        (el.textContent ?? "").includes("Not cut yet"),
      );
      expect(li).toBeTruthy();
      expect(li?.querySelector("time")).toBeNull();
      expect(li?.textContent).toContain("no tag yet");
    }
  });

  test("makes no promise about how often the project ships", () => {
    const { container } = render(<ChangelogRail />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/every (week|month|day|release)/i);
    expect(text).not.toMatch(/\b(weekly|monthly|continuously)\b/i);
  });

  test("the heading number is the data's number, and never a display-face digit", () => {
    const { container } = render(<ChangelogRail />);
    expect(container.textContent).toContain(`${CHANGELOG_TOTAL_ENTRIES} entries`);
    // Pixelify Sans reads `57` as `S7`: no digit may sit in the h2.
    const h2 = container.querySelector("h2")?.textContent ?? "";
    expect(h2).not.toMatch(/\d/);
    expect(h2.length).toBeGreaterThan(0);
  });

  test("keeps list semantics on the rail and on each stop's entries", () => {
    const { container } = render(<ChangelogRail />);
    const rail = container.querySelector("ol[role='list']");
    expect(rail).toBeTruthy();
    expect(rail?.getAttribute("aria-label")).toContain("newest first");
    expect(container.querySelectorAll("ul[role='list']").length).toBe(CHANGELOG_STOPS.length);
    // No <ul><div><li> breakage: every entry is a direct <li> child.
    expect(container.innerHTML).not.toMatch(/<ul[^>]*>\s*<div/);
  });

  test("counts and links the entries it does not print", () => {
    const { container } = render(<ChangelogRail />);
    const overflow = CHANGELOG_STOPS.map(listedCount).filter((n) => n > MAX_LISTED);
    expect(overflow.length).toBeGreaterThan(0); // 2.1.0 ships 20 additions
    const text = container.textContent ?? "";
    for (const n of overflow) {
      expect(text).toContain(`${n - MAX_LISTED} more in`);
    }
    const links = screen.getAllByRole("link", { name: /CHANGELOG\.md/i });
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l.getAttribute("href")).toContain("/blob/main/CHANGELOG.md");
  });

  test("links each cut release to its GitHub release, which exists", () => {
    render(<ChangelogRail />);
    for (const stop of CHANGELOG_STOPS.filter((s) => s.date)) {
      const link = screen.getByRole("link", { name: new RegExp(`v${stop.label} release`, "i") });
      expect(link.getAttribute("href")).toBe(
        `https://github.com/kanishka-namdeo/Unown/releases/tag/v${stop.label}`,
      );
    }
  });

  test("declares its own anchor and the section hue the palette gate expects", () => {
    const { container } = render(<ChangelogRail />);
    const section = container.querySelector("section");
    expect(section?.id).toBe("changelog");
    expect(section?.getAttribute("data-hue")).toBe("magma");
  });

  test("no markdown survives from the changelog into the rendered copy", () => {
    const { container } = render(<ChangelogRail />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("**");
    expect(text).not.toContain("`");
    expect(text).not.toMatch(/\]\(https?:/);
  });
});
