// built-improved.test.tsx — pins the "Built & Improved With Unown" band's
// contracts (the SOTA round's showcase, 2026-10-29).
//
// The band shows what the learning loop produced while the agent built the
// gallery's latest app. What this suite pins:
//   - the exact title (the mission named it precisely) + the gold hue and
//     the #built-improved anchor the nav and the scrollspy key on;
//   - the gallery derivation: the lede's "fifth app" reads LIVE_DEMO_APPS
//     (never a duplicated constant — the next gallery app re-numbers the
//     lede automatically, and `ordinalOf` is pinned branch by branch);
//   - all six tally rows render their figure AND their body — a row whose
//     receipt body went missing is a claim without its proof;
//   - the four Mission Control stills: real paths that exist on disk,
//     declared <img> dims equal to the PNGs' real IHDR (1792×1042 — the
//     dex-media gate's rule, re-checked here), and the exact alt/caption
//     text the mission specified;
//   - the band is STATIC: no video, no iframe, no decode/settle spans —
//     the finished state is what SSR ships and what the budget gates
//     measure;
//   - the three receipt links are the committed docs (learning report /
//     benchmark report / the round's validation log), absolute links in a
//     new tab — never a /blog route;
//   - the drift pin: every number in the band's data is re-extracted and
//     compared against this file's literal receipt set, and every number
//     in the rendered DOM belongs to that set (the live-demo pattern — a
//     figure cannot drift without the pin going red).
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BuiltImprovedSection, ordinalOf } from "../built-improved";
import {
  LOOP_RECEIPTS,
  MISSION_CONTROL_STILLS,
  RECEIPT_LINKS,
  IMPROVEMENT_RECEIPTS,
} from "../built-improved-data";
import { LIVE_DEMO_APPS } from "../live-demo-data";

// The composition root's animate shim (see landing-page.test.tsx) —
// framer-motion's fallback path, same as every landing component suite.
// @ts-expect-error deliberately removing a browser API for this run
Element.prototype.animate = undefined;

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

/** PNG IHDR width/height reader — the dex-media trick, no image lib needed. */
function pngSize(buf: Buffer): [number, number] {
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

/** The round's receipt figures — every number the band may render. A digit
 *  outside this set is a number the mission did not receipt. */
const EXPECTED_NUMBERS = new Set([
  // the parley-round improvement receipts (carried into the band):
  "0", // 0-byte result envelopes (the envelope fix's before-state)
  "4", // pinned by 4 tests (the envelope fix's pin count)
  "11", // shipped to project memory v11 (the first patch's after-state)
  "1", "3", "6", "8", "24", "26", "32", "46", "50", "58", "62",
  "99.5", "103", "106", "108", "112", "174", "640", "2,343",
]);

/** Extract the number tokens from rendered/data copy ("103/106" → 103,
 *  106; "v46" → 46; "−32%" → 32; "~640" → 640; "2,343" stays one figure). */
function numbersIn(s: string): string[] {
  return (s.match(/\d[\d.,]*/g) ?? []).map((t) => t.replace(/[.,]+$/, ""));
}

/** The band's rendered runs, one string per TEXT NODE — the unit a reader
 *  (and innerText) actually sees. textContent would weld sibling blocks
 *  without separators: "Project memory v46" + "58 memory versions" would
 *  forge a phantom "4658" that no gate and no visitor ever reads. */
function textNodeValues(root: Node): string[] {
  const out: string[] = [];
  for (const child of root.childNodes) {
    if (child.nodeType === 3 /* TEXT_NODE */) out.push(child.nodeValue ?? "");
    else out.push(...textNodeValues(child));
  }
  return out;
}

afterEach(() => {
  cleanup();
});

describe("built-improved band (the SOTA round's showcase)", () => {
  test("the exact title, the gold hue, the anchor, and the derived gallery ordinal", () => {
    const { container } = render(<BuiltImprovedSection />);
    const section = container.querySelector("section#built-improved");
    expect(section).toBeTruthy();
    expect(section?.getAttribute("data-hue")).toBe("gold");
    // The mission named the band precisely; the nav label and the hue walk
    // key on the same casing.
    const h2 = container.querySelector("h2");
    expect(h2?.textContent).toBe("Built & Improved With Unown");
    expect(container.textContent).toContain("The SOTA round");
    // The lede derives its app count from the gallery's own data — the
    // gallery is the single source for what was built (no duplicate 5).
    expect(LIVE_DEMO_APPS.length).toBe(5);
    expect(LIVE_DEMO_APPS[LIVE_DEMO_APPS.length - 1]?.id).toBe("fugue");
    expect(LIVE_DEMO_APPS[LIVE_DEMO_APPS.length - 1]?.name).toBe("Fugue");
    expect(container.textContent).toContain("(the gallery's fifth app)");
  });

  test("ordinalOf: the word form through ninth, the bare Nth after", () => {
    expect(ordinalOf(1)).toBe("first");
    expect(ordinalOf(5)).toBe("fifth");
    expect(ordinalOf(9)).toBe("ninth");
    expect(ordinalOf(10)).toBe("10th");
    expect(ordinalOf(0)).toBe("0th");
  });

  test("all six tally rows render their key figure AND their receipt body", () => {
    const { container } = render(<BuiltImprovedSection />);
    const text = container.textContent ?? "";
    expect(LOOP_RECEIPTS.length).toBe(6);
    for (const r of LOOP_RECEIPTS) {
      expect(text).toContain(r.figure);
      expect(text).toContain(r.body);
    }
    // Spot pins on the figures the mission dictated, so a data edit cannot
    // silently restate one (the drift pin below catches the rest).
    for (const key of [
      "3 skills minted → verified → promoted",
      "Project memory v46",
      "50 dreams consolidated",
      "3 tasks minted, 3 discarded by the solvability gate",
      "Honest nulls kept",
      "26 sessions · ~640 tool calls · 99.5% tool success",
      "62 tests / 2,343 expects",
      "24 entries merged, 108 added, 112 pruned",
      "−32% task duration",
      "103/106 both sides",
      "174 tests green",
    ]) {
      expect(text).toContain(key);
    }
  });

  test("the four Mission Control stills: real paths, true IHDR dims, exact alt and caption", () => {
    const { container } = render(<BuiltImprovedSection />);
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs.length).toBe(4);
    expect(MISSION_CONTROL_STILLS.map((s) => s.src)).toEqual([
      "/landing/tui/sota-round/stills/01-skills.png",
      "/landing/tui/sota-round/stills/02-memory.png",
      "/landing/tui/sota-round/stills/03-dreams.png",
      "/landing/tui/sota-round/stills/04-overview.png",
    ]);
    MISSION_CONTROL_STILLS.forEach((s, i) => {
      const el = imgs[i];
      expect(el.getAttribute("src")).toBe(s.src);
      expect(el.getAttribute("alt")).toBe(s.alt);
      // declared dims vs the PNG's real IHDR (1792×1042 — the files' own)
      expect(Number(el.getAttribute("width"))).toBe(1792);
      expect(Number(el.getAttribute("height"))).toBe(1042);
      const file = join(REPO_ROOT, "public", s.src.replace(/^\//, ""));
      expect(existsSync(file), `${s.src} missing under public/`).toBe(true);
      const [w, h] = pngSize(readFileSync(file));
      expect(w).toBe(1792);
      expect(h).toBe(1042);
      // the caption is the figcaption, exactly
      const cap = el.closest("figure")?.querySelector("figcaption");
      expect(cap?.textContent).toBe(s.caption);
      // the frame is a still, not a link and not a player — static band
      expect(el.closest("a")).toBeNull();
    });
    expect(container.querySelectorAll("video, iframe").length).toBe(0);
  });

  test("the three receipt links are the committed docs — absolute, new tab, never a blog route", () => {
    const { container } = render(<BuiltImprovedSection />);
    expect(RECEIPT_LINKS).toEqual([
      {
        label: "the learning report",
        href: "https://github.com/kanishka-namdeo/Unown/blob/main/docs/unown-learning-report.md",
      },
      {
        label: "the benchmark report",
        href: "https://github.com/kanishka-namdeo/Unown/blob/main/docs/benchmark-improvement-report.md",
      },
      {
        label: "the validation log",
        href: "https://github.com/kanishka-namdeo/Unown/blob/main/benchmarks/sota-round/validation-log.md",
      },
    ]);
    const text = container.textContent ?? "";
    expect(text).toContain("Receipts:");
    for (const l of RECEIPT_LINKS) {
      const a = container.querySelector(`a[href="${l.href}"]`);
      expect(a, `the band must link ${l.href}`).toBeTruthy();
      expect(a?.textContent).toBe(l.label);
      expect(a?.getAttribute("target")).toBe("_blank");
      expect(a?.getAttribute("rel")).toContain("noreferrer");
      expect(l.href.startsWith("/")).toBe(false);
    }
  });

  test("every number the band renders belongs to the receipt set — the drift pin", () => {
    // From the data: every number token in every string the band renders
    // must be exactly the receipt set below — additions AND removals both
    // go red, so a figure cannot drift without this pin noticing.
    const dataNumbers = new Set(
      [
        ...LOOP_RECEIPTS.flatMap((r) => [r.figure, r.body]),
        ...IMPROVEMENT_RECEIPTS.flatMap((r) => [
          r.title,
          r.before,
          r.after,
          r.loop,
        ]),
        ...MISSION_CONTROL_STILLS.flatMap((s) => [s.alt, s.caption]),
        ...RECEIPT_LINKS.map((l) => l.label),
      ].flatMap(numbersIn),
    );
    expect([...dataNumbers].sort()).toEqual([...EXPECTED_NUMBERS].sort());

    // From the DOM: every rendered text RUN carries a subset of the same
    // set — a number hardcoded into the component (bypassing the data file)
    // is the one defect the first half cannot see. Extracted per text node
    // (see textNodeValues) so sibling blocks never weld.
    const { container } = render(<BuiltImprovedSection />);
    const domNumbers = [
      ...new Set(textNodeValues(container).flatMap(numbersIn)),
    ];
    expect(domNumbers.length).toBeGreaterThan(0);
    for (const n of new Set(domNumbers)) {
      expect(
        EXPECTED_NUMBERS.has(n),
        `"${n}" renders in the band but is not a receipted figure`,
      ).toBe(true);
    }
  });

  test("the before/after improvement receipts render (the parley round's closed fixes, kept)", () => {
    const { container } = render(<BuiltImprovedSection />);
    const text = container.textContent ?? "";
    for (const r of IMPROVEMENT_RECEIPTS) {
      expect(text).toContain(r.title);
      expect(text).toContain(r.before);
      expect(text).toContain(r.after);
      expect(text).toContain(r.loop);
    }
    expect(text).toContain("The first shipped memory patch");
    expect(text).toContain("0-byte result envelopes");
  });
});
