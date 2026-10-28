// Component + pure-function tests for the presence round's effects
// (`src/components/landing/effects.tsx` and the bands that wire them).
//
// The changed-line coverage gate flags landing edits no test exercises. These
// pin the *decisions* the round encodes:
//   - the decode wave's shape is a contract: left-to-right locks, a bounded
//     scramble window, non-letters never scramble, decoys come from the
//     letters of UNOWN, and the whole wave finishes inside ~1.4s;
//   - DecodeText and CountUp ship the FINISHED value in their first render
//     (the SSR/no-JS/honesty contract — the server render, the crawler and
//     the landing gates all read the final figure, never a frame);
//   - the spotlight writes pointer-scoped vars (relative to the card, never
//     inherited globals), and the provider renders its children untouched;
//   - the scrollspy picks the LAST section in document order when two
//     straddle the eyeline band, and marks nothing when none do;
//   - the nav marks nothing before the reader reaches a banded section, and
//     the cursor it will light carries the `nav-cursor` hook the CSS keys on;
//   - the hero wires the wave to the kicker and the settle to the h1 words,
//     without changing either line's text content;
//   - the proof panes and the dex detail panes carry `pane-swap` + the
//     spotlight opt-in, and the demo chrome carries the Live chip's one word.
//
// Rendered under the global happy-dom preload. `IntersectionObserver` is not
// implemented by happy-dom, which is itself a pinned behaviour: the scrollspy
// and the count-up must no-op (not throw) when the API is missing — that is
// the same fallback an old browser takes.

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

mock.module("../star-count", () => ({
  StarCount: () => null,
  getStars: async () => 128,
}));

const {
  CountUp,
  DecodeText,
  SpotlightProvider,
  decodeCharAt,
  decodeLockTick,
  decodeTotalTicks,
  formatCount,
  pickCurrentSection,
  writeSpotlightVars,
} = await import("../effects");
const { Hero } = await import("../hero");
const { Nav } = await import("../shell");
const { ProofSection } = await import("../proof");
const { LiveDemoSection } = await import("../live-demo");

afterEach(() => {
  cleanup();
});

const KICKER = "Open-source AI coding agent · built on pi";

describe("the decode wave (pure scheduling)", () => {
  test("locks run left to right and stay inside the wave's span", () => {
    const total = KICKER.length;
    const locks = Array.from({ length: total }, (_, i) => decodeLockTick(i, total));
    // Monotonic, never regressing — several characters may share a lock tick
    // on a long line (the wave stays ~1s), but the order never reverses.
    for (let i = 1; i < locks.length; i++) {
      expect(locks[i]).toBeGreaterThanOrEqual(locks[i - 1]);
    }
    // First char locks before the last, always.
    expect(locks[0]).toBeLessThan(locks[locks.length - 1]);
    // The whole wave resolves inside ~1.4s at 45ms/tick — pinned so a "make
    // it slower" edit has to move this number consciously.
    expect(decodeTotalTicks(total)).toBeLessThanOrEqual(32);
    // A long line and a short one are both one gesture, not a crawl: the
    // 41-glyph kicker may not take longer than 32 ticks end to end.
    expect(decodeTotalTicks(41)).toBeLessThanOrEqual(32);
    expect(decodeTotalTicks(8)).toBeLessThanOrEqual(32);
  });

  test("a null tick (SSR, finished, reduced motion) always shows the final glyph", () => {
    expect(decodeCharAt("a", 0, null, 40)).toBe("a");
    expect(decodeCharAt(" ", 5, null, 40)).toBe(" ");
  });

  test("before the window: final; inside: a UNOWN decoy; after the lock: final", () => {
    const total = 40;
    const lock = decodeLockTick(3, total);
    // Before the window opens the char is untouched (the wave is a ripple,
    // not a wholesale scramble — the line is legible the whole time).
    expect(decodeCharAt("e", 3, lock - 5, total)).toBe("e");
    // Inside the window the decoy is one of the five brand letters.
    const decoy = decodeCharAt("e", 3, lock - 1, total);
    expect("UNOWN").toContain(decoy);
    // And it is not the final glyph (that is what makes it a scramble).
    expect(decoy).not.toBe("e");
    // Locked is locked.
    expect(decodeCharAt("e", 3, lock, total)).toBe("e");
    expect(decodeCharAt("e", 3, lock + 3, total)).toBe("e");
  });

  test("spaces and punctuation never scramble — the rhythm stays legible", () => {
    const total = KICKER.length;
    for (let tick = 0; tick < decodeTotalTicks(total); tick++) {
      for (let i = 0; i < total; i++) {
        const ch = KICKER[i];
        if (!/[a-z]/i.test(ch)) {
          expect(decodeCharAt(ch, i, tick, total)).toBe(ch);
        }
      }
    }
  });
});

describe("DecodeText (the component)", () => {
  test("first render ships the finished line — SSR, crawlers and the copy suites read it", () => {
    const { container } = render(<DecodeText text={KICKER} />);
    expect(container.textContent).toBe(KICKER);
  });

  test("renders one span per glyph so the wave can move through them", () => {
    const { container } = render(<DecodeText text={KICKER} />);
    const spans = container.querySelectorAll("span > span");
    expect(spans.length).toBe(KICKER.length);
  });
});

describe("the spotlight", () => {
  test("writes pointer-scoped vars relative to the card, rounded to the pixel", () => {
    const el = {
      style: { setProperty: mock((k: string, v: string) => {}) },
      getBoundingClientRect: () => ({ left: 100, top: 50 }),
    } as unknown as HTMLElement;
    writeSpotlightVars(el, 160, 90);
    expect(el.style.setProperty).toHaveBeenCalledWith("--mx", "60px");
    expect(el.style.setProperty).toHaveBeenCalledWith("--my", "40px");
  });

  test("the provider renders its children and installs exactly one passive listener", () => {
    const add = mock(() => {});
    const remove = mock(() => {});
    const origAdd = document.addEventListener;
    const origRemove = document.removeEventListener;
    document.addEventListener = add as typeof document.addEventListener;
    document.removeEventListener = remove as typeof document.removeEventListener;
    try {
      const { container, unmount } = render(
        <SpotlightProvider>
          <p>the page</p>
        </SpotlightProvider>,
      );
      expect(container.textContent).toBe("the page");
      expect(add).toHaveBeenCalledWith("pointermove", expect.any(Function), { passive: true });
      unmount();
      expect(remove).toHaveBeenCalledWith("pointermove", expect.any(Function));
    } finally {
      document.addEventListener = origAdd;
      document.removeEventListener = origRemove;
    }
  });
});

describe("the scrollspy", () => {
  test("picks the last section in document order when two straddle the band", () => {
    const ids = ["loop", "dex", "proof"];
    expect(pickCurrentSection(ids, new Set(["loop", "dex"]))).toBe("dex");
    expect(pickCurrentSection(ids, new Set(["dex", "loop"]))).toBe("dex");
    expect(pickCurrentSection(ids, new Set(["proof"]))).toBe("proof");
  });

  test("marks nothing when the band sits in an unbanded stretch", () => {
    expect(pickCurrentSection(["loop", "dex"], new Set())).toBeNull();
  });

  test("the nav renders no aria-current before any section is reached, and carries the nav-cursor hook", () => {
    const { container } = render(<Nav />);
    const marked = container.querySelectorAll('a[aria-current="true"]');
    expect(marked.length).toBe(0);
    // Every section link's cursor carries the class the CSS keys on — the
    // marker cannot ship broken in one bar and working in another. (The two
    // `#quickstart` CTAs are raw anchors by design: they are actions, not
    // section links, so they carry no cursor at all.)
    const links = [...container.querySelectorAll('a[href^="#"]')].filter(
      (a) => a.getAttribute("href") !== "#quickstart",
    );
    expect(links.length).toBe(16);
    for (const link of links) {
      expect(link.querySelector(".nav-cursor")).toBeTruthy();
    }
  });
});

describe("the count-up", () => {
  test("formatCount: sign, magnitude, fixed decimals — the final frame equals the receipt figure", () => {
    expect(formatCount(52)).toBe("52");
    expect(formatCount(98.1, 1)).toBe("98.1");
    expect(formatCount(-35)).toBe("−35");
    expect(formatCount(0)).toBe("0");
    expect(formatCount(-4.25, 2)).toBe("−4.25");
  });

  test("the DOM ships the final figure on first render (no frame is ever a claim)", () => {
    const { container } = render(<CountUp value={98.1} suffix="%" decimals={1} />);
    expect(container.textContent).toBe("98.1%");
  });

  test("negative deltas render their sign from the first frame", () => {
    const { container } = render(<CountUp value={-35} suffix="%" />);
    expect(container.textContent).toBe("−35%");
  });
});

describe("the wiring", () => {
  test("the hero: the kicker carries the wave, the h1 words carry the settle, the text is unchanged", () => {
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      configurable: true,
    });
    const { container } = render(<Hero />);
    // The h1's text is the sentence, character for character — the settle
    // moves words, it does not change one.
    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toBe("The terminal coding agent that remembers.");
    // Every word is a settling span with its wave index.
    const words = h1?.querySelectorAll(".word-settle") ?? [];
    expect(words.length).toBe(6);
    // The kicker renders the category line synchronously (the wave starts
    // after mount; the copy suite's assertion must not know about it).
    expect(container.textContent).toContain("Open-source AI coding agent");
  });

  test("the proof panes carry the swap + the spotlight opt-in", () => {
    const { container } = render(<ProofSection />);
    const panes = container.querySelectorAll('[role="tabpanel"]');
    expect(panes.length).toBe(3);
    for (const pane of panes) {
      expect(pane.className).toContain("pane-swap");
    }
    // The panes' shared frame is the spotlight surface.
    expect(container.querySelector("[data-spotlight]")).toBeTruthy();
  });

  test("the demo chrome states the one honest word the round adds", () => {
    const { container } = render(<LiveDemoSection />);
    const chip = [...container.querySelectorAll("span")].find(
      (s) => s.textContent === "Live",
    );
    expect(chip).toBeTruthy();
    // The blinking square is decorative and unannounced.
    expect(chip?.querySelector("[aria-hidden='true']")).toBeTruthy();
    // Nothing in this band carries the spotlight: the frame is interactive
    // surface, and a tint that follows the cursor into a live app is not
    // feedback. (In happy-dom the IO never mounts the iframe, so the check
    // runs over the chrome panel that would host it — the decision, not the
    // mount state.)
    expect(container.querySelector("#live-demo [data-spotlight]")).toBeNull();
  });
});
