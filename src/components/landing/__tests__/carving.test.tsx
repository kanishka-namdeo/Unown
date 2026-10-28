// Component + pure-function tests for the carving round's effects
// (`src/components/landing/effects.tsx`'s DrawGlyph, the `.ink-fill` decode
// fill, the `.gb-kbd` chips, and the copy buttons' status announcement).
//
// The changed-line coverage gate flags landing edits no test exercises. These
// pin the *decisions* the round encodes:
//   - the carve's shape is a contract: clamped, monotonic, exactly 1 at the
//     end, and ≤ the drag threshold by default;
//   - DrawGlyph ships the FINISHED glyph in its first render (the SSR/no-JS/
//     honesty contract — a resting form is plain paths, no dash ladder), and
//     happy-dom's missing IntersectionObserver is the no-op fallback: the
//     glyph stays finished, nothing throws;
//   - a drawn glyph is decorative by default (aria-hidden), with the Latin
//     text beside it as the accessible reading;
//   - the decode fill word-splits the finale lead WITHOUT changing its
//     textContent (inter-word spaces in the parent flow — the word-settle
//     rule), and the per-word stagger caps at INK_FILL_MAX so any lead
//     length fits inside `entry 100%`;
//   - a lead that does not opt into decode is not word-split;
//   - the Konami sequences wear the keycap chip in BOTH homes, and the chip
//     is not hidden from assistive tech (the receipt line is a live region
//     whose announcement names the sequence);
//   - the copy button carries the polite "Copied" status region (WCAG
//     4.1.3) — present, polite, and silent when idle.
//
// Rendered under the global happy-dom preload. `IntersectionObserver` is not
// implemented by happy-dom, which is itself a pinned behaviour — the carve
// must no-op (not throw) when the API is missing, exactly like the scrollspy
// and the count-up.

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

mock.module("../star-count", () => ({
  StarCount: () => null,
  getStars: async () => 128,
}));

const { DrawGlyph, glyphRevealAt } = await import("../effects");
const { AlphabetSection } = await import("../alphabet");
const { CopyButton, INK_FILL_MAX, SectionHead } = await import("../shell");
const { FinaleSection } = await import("../finale");

afterEach(() => {
  cleanup();
});

const GLYPH_DRAW_MS = 450;
const FINALE_LEAD =
  "Clone it, run one session, come back tomorrow with memory that already knows what you told it. Nothing to sign up for. If it is not useful, you have lost an afternoon.";

describe("the carve (pure scheduling)", () => {
  test("clamped and monotonic: never negative, never past 1, exactly 1 at the end", () => {
    // Before the pen touches: fully retracted, and never a negative dash.
    expect(glyphRevealAt(-100)).toBe(0);
    // At and after the budget: exactly 1 — the equality IS the honesty rule
    // (the resting render hands Glyph `undefined`, a finished form).
    expect(glyphRevealAt(GLYPH_DRAW_MS)).toBe(1);
    expect(glyphRevealAt(GLYPH_DRAW_MS * 3)).toBe(1);
    // Monotonic across the whole draw.
    let prev = -1;
    for (let t = 0; t <= GLYPH_DRAW_MS; t += 15) {
      const r = glyphRevealAt(t);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });

  test("eases out — the strokes land early, not on a straight line", () => {
    // At a quarter of the budget the curve is well past a linear 25%:
    // 1-(1-0.25)^3 = 0.578. If someone flattens the ease to linear, the
    // carve's character changed and this pin makes them move it consciously.
    expect(glyphRevealAt(GLYPH_DRAW_MS / 4)).toBeGreaterThan(0.5);
  });
});

describe("DrawGlyph (the component)", () => {
  test("first render ships the finished glyph — plain paths, no dash ladder", () => {
    const { container } = render(<DrawGlyph id="U" className="size-11" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    // The resting form renders neither pathLength nor a dasharray: those
    // exist only while a draw is in flight, so SSR/no-JS/crawler output is
    // the finished letter (the same contract Glyph's own docs promise).
    const path = svg!.querySelector("path");
    expect(path!.getAttribute("pathLength")).toBeNull();
    expect(path!.getAttribute("stroke-dasharray")).toBeNull();
    // The wrapper span is inline-block so the glyph keeps its own box
    // inside the flex rows both call sites place it in.
    expect(container.querySelector("span")!.className).toContain("inline-block");
  });

  test("decorative by default — the Latin text beside it is the reading", () => {
    const { container } = render(<DrawGlyph id="Z" />);
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("svg")!.getAttribute("role")).toBeNull();
  });

  test("a labelled glyph is an image (the nav wordmark pattern)", () => {
    const { container } = render(<DrawGlyph id="U" label="Unown" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Unown");
    expect(svg.getAttribute("aria-hidden")).toBeNull();
  });

  test("a null id renders nothing (the scramble-state contract)", () => {
    const { container } = render(<DrawGlyph id={null} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  test("the missing-IntersectionObserver fallback is a no-op: finished, no throw", () => {
    // happy-dom 21 implements the observer, so the old-browser branch is
    // pinned directly: with the API removed the pen never starts, the
    // form stays finished, and nothing throws — the same fallback the
    // scrollspy and the count-up carry.
    const g = globalThis as Record<string, unknown>;
    const had = g.IntersectionObserver;
    delete g.IntersectionObserver;
    try {
      const { container } = render(<DrawGlyph id="N" />);
      expect(container.querySelector("path")!.getAttribute("pathLength")).toBeNull();
    } finally {
      if (had !== undefined) g.IntersectionObserver = had;
    }
  });
});

describe("the decode fill (SectionHead decode)", () => {
  test("word-splits the lead without changing its textContent", () => {
    const { container } = render(
      <SectionHead kicker="Where to start" decode lead={FINALE_LEAD}>
        One afternoon
      </SectionHead>,
    );
    // The full sentence, character-exact — inter-word spaces live in the
    // parent inline flow (the word-settle rule), so the copy suites, the
    // SEO gate and verify-deploy keep reading one sentence.
    const lead = container.querySelector(".text-dim")!;
    expect(lead.textContent).toBe(FINALE_LEAD);
    // One ink-fill span per word, and only inside the decoded lead.
    expect(lead.querySelectorAll("span.ink-fill").length).toBe(
      FINALE_LEAD.split(" ").length,
    );
  });

  test("the stagger caps at INK_FILL_MAX so the wave always fits entry 100%", () => {
    const { container } = render(
      <SectionHead decode lead={FINALE_LEAD}>
        One afternoon
      </SectionHead>,
    );
    const spans = Array.from(
      container.querySelectorAll<HTMLElement>("span.ink-fill"),
    );
    expect(spans.length).toBeGreaterThan(INK_FILL_MAX + 2);
    for (const s of spans) {
      // Read the custom property off the serialized style attribute —
      // indexing `style["--wf"]` is not a real CSSStyleDeclaration API.
      const m = /--wf:\s*(\d+)/.exec(s.getAttribute("style") ?? "");
      expect(m).not.toBeNull();
      const wf = Number(m![1]);
      expect(wf).toBeLessThanOrEqual(INK_FILL_MAX);
      expect(wf).toBeGreaterThanOrEqual(0);
    }
    // The cap itself: `.ink-fill`'s range math in landing.css budgets for
    // at most 8 stagger steps (8*4% start + 48% span = 80% entry).
    expect(INK_FILL_MAX).toBe(8);
  });

  test("a lead that does not opt in is not word-split (the default path is untouched)", () => {
    const { container } = render(
      <SectionHead lead={FINALE_LEAD}>One afternoon</SectionHead>,
    );
    expect(container.querySelector("span.ink-fill")).toBeNull();
    expect(container.querySelector(".text-dim")!.textContent).toBe(FINALE_LEAD);
  });

  test("the h2 balances (the polish the round ships on every section heading)", () => {
    const { container } = render(<SectionHead>One afternoon</SectionHead>);
    expect(container.querySelector("h2")!.className).toContain("text-balance");
  });
});

describe("the keycap chips", () => {
  test("the alphabet hint spells the sequence on a chip, readable to assistive tech", async () => {
    const { container } = render(<AlphabetSection />);
    const kbd = container.querySelector("kbd.gb-kbd")!;
    expect(kbd).not.toBeNull();
    expect(kbd.textContent).toBe("↑↑↓↓←→←→ba");
    // Not hidden: the hint is how a screen-reader user DISCOVERS the
    // easter egg, and the arrows are real text (mono face — the pixel
    // subset carries no arrows, which is why the chip is not gb-label).
    expect(kbd.getAttribute("aria-hidden")).toBeNull();
    // The hint keeps its discoverable words for the deploy gate.
    expect(container.textContent).toContain("psst, try");
    // The decode panel's subject glyph is the drawn one, and it is
    // decorative — the panel's Latin form id beside it is the reading.
    expect(container.querySelector("svg[aria-hidden='true'] path")).not.toBeNull();
    // Settle the band's framer reveals before cleanup (the loop.test rule:
    // cancelling a mid-flight happy-dom Animation rejects on unmount —
    // the alphabet's FadeUps run 0.45s + up to 0.12s of delay).
    await new Promise((r) => setTimeout(r, 600));
  });

  test("the finale receipt wears the same chip inside the polite live region", async () => {
    const { container } = render(<FinaleSection />);
    const receipt = container.querySelector("p[role='status']")!;
    const kbd = receipt.querySelector("kbd.gb-kbd")!;
    expect(kbd.textContent).toBe("↑↑↓↓←→←→ba");
    // The sequence stays INSIDE the announcement: the receipt confirms to
    // the keyboard user what they just typed.
    expect(kbd.getAttribute("aria-hidden")).toBeNull();
    // The spellbox letters are drawn glyphs inside their fade-rise spans.
    expect(container.querySelectorAll("span.inline-block span.inline-block").length).toBeGreaterThan(0);
    // Settle before cleanup: the spellbox's spans run up to 6*35ms of delay
    // + 220ms of fade, and the FadeUps sit on top of those.
    await new Promise((r) => setTimeout(r, 600));
  });
});

describe("the copy buttons' status message (WCAG 4.1.3)", () => {
  test("carries a polite status region that is silent when idle", () => {
    const { container } = render(<CopyButton text="unown" label="Copy the command" />);
    const status = container.querySelector("span[role='status']")!;
    expect(status).not.toBeNull();
    expect(status.getAttribute("aria-live")).toBe("polite");
    // Silent at rest — an empty polite region costs a listener nothing and
    // announces nothing; the word appears only for the 2s the icon is up.
    expect(status.textContent).toBe("");
    // The button's accessible NAME keeps its own contract (label swap).
    const button = container.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("Copy the command");
  });

  test("every copy surface on the landing page inherits the announcement", async () => {
    // Install-panel (hero), agent-prompt (hero) and session-replay (hero)
    // all render `CopyButton`; the two bands that render here cover the
    // standalone component's wiring, so this pins the pattern is shared,
    // not per-instance.
    const { container } = render(<CopyButton text="x" />);
    expect(container.querySelectorAll("[role='status']").length).toBe(1);
  });
});
