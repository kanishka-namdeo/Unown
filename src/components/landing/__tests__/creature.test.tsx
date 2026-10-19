// Component test for src/components/landing/creature.tsx and its two homes
// (the hero's session party, the loop bento's tile badges).
//
// The changed-line coverage gate (scripts/check_coverage.mjs) flags landing
// edits that no test exercises — this file pins the creature contract:
// every id ships a file, decorative renders are alt="" + aria-hidden (the
// WAI decorative-image rule the axe scans enforce), and the party/bento
// placements keep a text label beside every creature so none is the sole
// carrier of meaning.
//
// Rendered under the global happy-dom preload (bunfig.toml [test] preload →
// src/test-dom-setup.ts), same as the other landing component tests.

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CREATURE_IDS, Creature } from "../creature";
import { LoopSection } from "../loop";

// The Hero's StarCount is an async server component; unauthenticated
// api.github.com is rate-limited from a shared sandbox IP, and the fetch
// suspends the whole tree past the assertions. Same mock as
// landing-copy.test.tsx (the creature assertions never touch the count).
mock.module("../star-count", () => ({
  StarCount: () => null,
  getStars: async () => 128,
}));

const { Hero } = await import("../hero");

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
    expect(img?.getAttribute("width")).toBe("228");
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

  test("the hero's session party chips label every creature with its tool name", () => {
    render(<Hero />);
    // Not getByText on the tool names — "web_search" and "task" also appear
    // in the cli expander's prose, so traverse from the strip's own kicker.
    const kicker = screen.getByText("the session party");
    const party = kicker.parentElement as HTMLElement;
    const chips = Array.from(party.querySelectorAll("ul > li"));
    expect(chips.length).toBe(4);
    const tools = chips.map((c) => c.textContent ?? "");
    for (const tool of ["web_search", "mcp", "task", "lsp"]) {
      expect(tools.some((t) => t.includes(tool)), `chip for ${tool}`).toBe(true);
    }
    for (const chip of chips) {
      const img = chip.querySelector("img");
      // Labelled by the adjacent tool name, so the creature stays decorative.
      expect(img, "chip carries a creature").not.toBeNull();
      expect(img?.getAttribute("alt")).toBe("");
      expect(img?.getAttribute("aria-hidden")).toBe("true");
    }
  });

  test("the loop bento badges every mechanism tile, one creature each", () => {
    render(<LoopSection />);
    const imgs = Array.from(document.querySelectorAll("img"))
      .map((el) => el as HTMLImageElement)
      .filter((el) => (el.getAttribute("src") ?? "").includes("/landing/creatures/"));
    // 6 tiles, 6 sprites: memory, harness, router, dream, hooks, sdlc
    // (one per tile — a dream+skills pair was tried and read as clutter,
    // so tile 04 carries dream and argues skills in prose).
    expect(imgs.length).toBe(6);
    const srcs = imgs.map((el) => el.getAttribute("src") ?? "");
    expect(srcs).toContain("/landing/creatures/memory.png");
    expect(srcs).toContain("/landing/creatures/harness.png");
    expect(srcs).toContain("/landing/creatures/router.png");
    expect(srcs).toContain("/landing/creatures/dream.png");
    expect(srcs).toContain("/landing/creatures/hooks.png");
    expect(srcs).toContain("/landing/creatures/sdlc.png");
    // Every bento creature is decorative — the tile's title is the label.
    for (const el of imgs) {
      expect(el.getAttribute("alt")).toBe("");
      expect(el.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
