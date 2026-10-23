// Component test for src/components/landing/creature.tsx and its one home,
// the capability dex (dex.tsx + dex-data.ts).
//
// The changed-line coverage gate (scripts/check_coverage.mjs) flags landing
// edits that no test exercises — this file pins the creature contract:
// every id ships a file, decorative renders are alt="" + aria-hidden (the
// WAI decorative-image rule the axe scans enforce), and since 2026-10-20 the
// dex is the one canonical home — the hero's party strip and the loop
// bento's tile badges retired, so a creature sprite anywhere else on the
// page is a regression, not a feature.
//
// Rendered under the global happy-dom preload (bunfig.toml [test] preload →
// src/test-dom-setup.ts), same as the other landing component tests.

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CREATURE_IDS, Creature } from "../creature";
import { DEX, FORMS_BY_ID } from "../dex-data";

// The Hero's StarCount is an async server component; unauthenticated
// api.github.com is rate-limited from a shared sandbox IP, and the fetch
// suspends the whole tree past the assertions. Same mock as
// landing-copy.test.tsx (the creature assertions never touch the count).
mock.module("../star-count", () => ({
  StarCount: () => null,
  getStars: async () => 128,
}));

const { Hero } = await import("../hero");
const { LoopSection } = await import("../loop");
const { DexSection } = await import("../dex");

// The Hero renders SessionReplay, which autoplays a framer-motion typewriter
// on mount; cancelling it mid-flight at cleanup makes happy-dom's Web-Animations
// shim reject unhandled (same reason landing-page.test.tsx disables it — the
// creature assertions are static, so nothing here needs the animation).
// @ts-expect-error deliberately removing a browser API for this run
Element.prototype.animate = undefined;

afterEach(async () => {
  // Settle framer-motion's mount animation before unmounting (same reason
  // as loop.test.tsx: cancelling mid-flight makes happy-dom's Animation
  // reject unhandled and the coverage gate treats that as a red suite).
  await new Promise((r) => setTimeout(r, 320));
  cleanup();
});

const creatureImgs = (root: HTMLElement | Document = document) =>
  Array.from(root.querySelectorAll("img"))
    .map((el) => el as HTMLImageElement)
    .filter((el) => (el.getAttribute("src") ?? "").includes("/landing/creatures/"));

describe("landing Creature", () => {
  test("every creature id ships its sprite in public/landing/creatures", () => {
    // The pipeline (scripts/creature_sprites.mjs) writes these; a missing file
    // means someone added an id without running (or committing) the pipeline.
    for (const id of CREATURE_IDS) {
      const file = join(process.cwd(), "public/landing/creatures", `${id}.png`);
      expect(existsSync(file), `${file} missing — run node scripts/creature_sprites.mjs`).toBe(true);
    }
  });

  test("renders decorative by default: alt empty, aria-hidden, lazy, sized, pixelated", () => {
    const { container } = render(<Creature id="memory" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/landing/creatures/memory.png");
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("aria-hidden")).toBe("true");
    expect(img?.getAttribute("loading")).toBe("lazy");
    // The atlas ships every sprite on the full 64px logical canvas at 4×.
    expect(img?.getAttribute("width")).toBe("256");
    expect(img?.getAttribute("height")).toBe("256");
    // The pixel grid must never resample — a smoothed creature reads as
    // modern flat art, which is the look the page does not want.
    expect(img?.className).toContain("creature");
    expect(img?.className).toContain("h-16");
  });

  test("a labelled render is exposed to assistive tech instead of hidden", () => {
    const { container } = render(<Creature id="websearch" label="web search" />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("alt")).toBe("web search");
    expect(img?.getAttribute("aria-hidden")).toBe(null);
  });

  test("the dex data covers every creature exactly once, numbered 001-011", () => {
    // № 001-011 are the drawn forms; № 012-021 are the filmed behaviors,
    // which have no specimen — the forms must stay exactly the sprite set, or
    // the bestiary grew a hole.
    const forms = DEX.filter((e) => e.kind === "form");
    expect(forms.length).toBe(CREATURE_IDS.length);
    expect(FORMS_BY_ID.size).toBe(CREATURE_IDS.length);
    expect(new Set(forms.map((e) => e.id))).toEqual(new Set(CREATURE_IDS));
    expect(forms.map((e) => e.no)).toEqual([
      "001", "002", "003", "004", "005", "006", "007", "008", "009", "010", "011",
    ]);
    // A behavior id is never a creature id.
    for (const e of DEX.filter((x) => x.kind === "behavior")) {
      expect(CREATURE_IDS).not.toContain(e.id);
    }
    // Every entry links at least one receipt — the catalog keeps the page's
    // every-number-checkable contract.
    for (const e of DEX) {
      expect(e.receipts.length, `${e.name} has no receipts`).toBeGreaterThan(0);
      for (const [label, href] of e.receipts) {
        expect(label.length).toBeGreaterThan(0);
        expect(href.startsWith("https://github.com/kanishka-namdeo/Unown/"), `${e.name}:${label}`).toBe(true);
      }
    }
  });

  test("the dex is the one home: every form pane mounts a creature, decorative beside the name", () => {
    const { container } = render(<DexSection />);
    const imgs = creatureImgs(container);
    // Eleven forms, eleven sprites — the hidden panes still mount theirs (the
    // proof band's pane contract: crawlers and gates read every entry), and
    // the ten behaviors mount none — browser joined the forms, so eleven sprites.
    expect(imgs.length).toBe(11);
    for (const el of imgs) {
      expect(el.getAttribute("alt")).toBe("");
      expect(el.getAttribute("aria-hidden")).toBe("true");
      // h-48 = 3x the 64px logical grid: an integer multiple, never a resample
      expect(el.className).toContain("creature");
      expect(el.className).toContain("h-48");
    }
    // All twenty-one entries mount a pane; the visible one is the band's derived
    // default — the first entry with footage — and its article is named.
    const articles = container.querySelectorAll("article[aria-label]");
    expect(articles.length).toBe(DEX.length);
    expect(articles[2].getAttribute("aria-label")).toContain("Task");
    expect(articles[2].hasAttribute("hidden")).toBe(false);
  });

  test("no creature renders outside the dex — the hero party strip and the bento badges retired", () => {
    const hero = render(<Hero />);
    expect(creatureImgs(hero.container), "hero party moved to the dex 2026-10-20").toEqual([]);
    cleanup();
    const loop = render(<LoopSection />);
    expect(creatureImgs(loop.container), "bento badges moved to the dex 2026-10-20").toEqual([]);
  });
});
