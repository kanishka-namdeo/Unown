// Component test for src/components/landing/feature-carousel.tsx.
//
// The changed-line coverage gate (scripts/check_coverage.mjs) flags landing
// edits that no test exercises — this file pins the feature carousel's
// user-visible contracts (the band that replaced the split-view band, same
// slot, same aqua): the gated command surface in its collapsed expander (each
// name is checked against splitview.ts's registerCommand calls by
// scripts/landing_claims.mjs, so the test pins that the table renders), the
// persist/regular-mode notes, the derived media counts being honest
// (video / still / empty slide kinds), the placeholder honesty, and the
// pane contract — all fifteen slides stay mounted with the inactive ones
// `hidden`, the same contract the proof band keeps for its generated numbers.
//
// Rendered under the global happy-dom preload (bunfig.toml [test] preload →
// src/test-dom-setup.ts), same as the other landing component tests.

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FeatureCarouselSection } from "../feature-carousel";

afterEach(() => {
  cleanup();
});

describe("landing FeatureCarouselSection", () => {
  test("renders the section, its command expander and the persist note", () => {
    const { container } = render(<FeatureCarouselSection />);
    const section = container.querySelector("section");
    expect(section?.getAttribute("data-hue")).toBe("aqua");
    expect(section?.id).toBe("features");
    const text = container.textContent ?? "";
    // The command names the claims gate resolves against splitview.ts.
    for (const cmd of [
      "/split",
      "/split-thinking",
      "/split-tools",
      "/files",
      "/split-diff",
      "/split-tools-view",
      "/split-height",
      "/split-tools-width",
      "/split-divider",
      "/split-trim-response",
      "/split-save",
    ]) {
      expect(text).toContain(cmd);
    }
    // The persist note: /split-save writes the config the extension reads.
    expect(text).toContain("~/.unown/agent/ui-panels.json");
    // The honest limits: fullscreen composes the band, /files overlays in
    // regular mode, and the response-only transcript mode is named.
    expect(text).toContain("falls back to an overlay");
    expect(text).toContain("responses only");
  });

  test("the lead reports the media mix the slides actually carry", () => {
    const { container } = render(<FeatureCarouselSection />);
    const text = container.textContent ?? "";
    // Derived, never typed: nine videos, one still-only lane, five empty
    // slots. If a slide's kind changes, this test fails until the numbers
    // drift-check passes again — the same "read off the data" rule the rail
    // keeps.
    expect(text).toContain("9 of 15 carry video");
    expect(text).toContain("1 is still-only");
    expect(text).toContain("5 slots stay empty");
  });

  test("the pane contract: fifteen slides mounted, inactive hidden", () => {
    const { container } = render(<FeatureCarouselSection />);
    const slides = [...container.querySelectorAll('[role="group"][aria-roledescription="slide"]')];
    expect(slides).toHaveLength(15);
    expect(slides.filter((s) => s.hasAttribute("hidden"))).toHaveLength(14);
    // The media mix renders where the data says it does: nine videos (muted,
    // looping, poster-first, eager on nothing), one still image, five
    // placeholder stages.
    const videos = [...container.querySelectorAll("video")];
    expect(videos).toHaveLength(9);
    for (const v of videos) {
      // Never an autoplay attribute — playback is an effect decision, so a
      // reduced-motion visitor is never handed one in the markup.
      expect(v.hasAttribute("autoplay")).toBe(false);
      expect(v.getAttribute("muted")).toBe("");
      expect(v.getAttribute("loop")).toBe("");
      expect(v.getAttribute("preload")).toBe("none");
      expect(v.getAttribute("poster")?.length).toBeGreaterThan(0);
      const sources = [...v.querySelectorAll("source[type]")];
      expect(sources.map((s) => s.getAttribute("type"))).toEqual(["video/webm", "video/mp4"]);
    }
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs).toHaveLength(1);
    for (const img of imgs) {
      expect(img.getAttribute("loading")).toBe("lazy");
      expect(img.getAttribute("alt")?.length).toBeGreaterThan(0);
    }
    // No capture was fabricated: the five empty slots say so on the stage.
    const stubs = [...container.querySelectorAll("p")].filter(
      (n) => n.textContent === "no capture yet",
    );
    expect(stubs).toHaveLength(5);
  });

  test("the controls flip slides and the counter announces them", () => {
    const { container } = render(<FeatureCarouselSection />);
    const counter = container.querySelector('[aria-live="polite"]');
    expect(counter?.textContent).toContain("01 / 15 — The fix loop");
    fireEvent.click(screen.getByRole("button", { name: "Show the next feature capture" }));
    expect(counter?.textContent).toContain("02 / 15 — Plan mode");
    // prev from slide 2 lands back on 1
    fireEvent.click(screen.getByRole("button", { name: "Show the previous feature capture" }));
    expect(counter?.textContent).toContain("01 / 15 — The fix loop");
    // the slides follow the state: slide 1 visible, the rest hidden
    const slides = [...container.querySelectorAll('[role="group"][aria-roledescription="slide"]')];
    expect(slides[0].hasAttribute("hidden")).toBe(false);
    expect(slides[1].hasAttribute("hidden")).toBe(true);
  });

  test("the split-view slide keeps its still and its writeup", () => {
    render(<FeatureCarouselSection />);
    // Split view is the photos-only lane: advance to its slide and the
    // writeup contradicts nothing the band used to argue.
    fireEvent.click(screen.getByRole("button", { name: "Show the next feature capture" }));
    for (let i = 0; i < 8; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Show the next feature capture" }));
    }
    const counter = document.querySelector('[aria-live="polite"]');
    expect(counter?.textContent).toContain("10 / 15 — Split view");
    expect(document.body.textContent).toContain("Stills only");
    // Split view IS the band's command expander home: its config file name
    // is on the slide's band (the expander block, band-level).
    expect(document.body.textContent).toContain("~/.unown/agent/ui-panels.json");
  });
});
