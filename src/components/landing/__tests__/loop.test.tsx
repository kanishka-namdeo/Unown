// Component test for src/components/landing/loop.tsx.
//
// The changed-line coverage gate (scripts/check_coverage.mjs) flags landing
// edits that no test exercises — this file pins the Loop section's
// beat structure and the keyboard accessibility of its session-transcript
// terminal (scrollable <pre> regions must be focusable: wcag 2.1.1, the
// scrollable-region-focusable rule the landing axe scan enforces in the e2e
// suite).
//
// Rendered under the global happy-dom preload (bunfig.toml [test] preload →
// src/test-dom-setup.ts), same as the other landing component tests.

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { LoopSection } from "../loop";

afterEach(async () => {
  // Settle framer-motion's mount animation (the beat panel fades in over
  // 0.26s) BEFORE unmounting — cancelling it mid-flight makes happy-dom's
  // Animation reject unhandled, which bun reports as a suite error and the
  // coverage gate treats as a red suite. Same reason as the dashboard page
  // shell test.
  await new Promise((r) => setTimeout(r, 320));
  cleanup();
});

describe("landing LoopSection", () => {
  test("renders the three beat tabs and the active beat's content", () => {
    // Static scope on purpose: switching beats animates the panel through
    // framer-motion's WAAPI path, which happy-dom does not implement — the
    // beat-switching behaviour is covered end-to-end by the e2e suite in a
    // real browser instead.
    render(<LoopSection />);
    // The three tab triggers (WAI-ARIA tabs pattern, roving tabindex).
    for (const label of [/you chat/, /it mines/, /it dreams/]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    // Only the ACTIVE beat's panel content is mounted — beat 0 first; its
    // claim, its file path and the note template it renders.
    expect(screen.getByText("The session ends by writing something down.")).toBeTruthy();
    expect(screen.getByText("~/.unown/notes/outbox/1757...-checkout.md")).toBeTruthy();
  });

  test("the session-transcript terminal is a keyboard-scrollable region", () => {
    render(<LoopSection />);
    const term = screen.getByLabelText("terminal — session transcript");
    expect(term).toBeTruthy();
    expect(term.getAttribute("tabindex")).toBe("0");
  });
});
