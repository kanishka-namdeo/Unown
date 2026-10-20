// Component test for src/components/landing/split-view.tsx.
//
// The changed-line coverage gate (scripts/check_coverage.mjs) flags landing
// edits that no test exercises — this file pins the SplitView section's
// user-visible claims: the gated command surface (each name is checked
// against splitview.ts's registerCommand calls by scripts/landing_claims.mjs,
// so the test pins that the table renders them), the persist/regular-mode
// notes, and the stills viewer's pane contract — all four captures stay
// mounted with the inactive ones `hidden`, the same contract the proof band
// keeps for its generated numbers.
//
// Rendered under the global happy-dom preload (bunfig.toml [test] preload →
// src/test-dom-setup.ts), same as the other landing component tests.

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SplitViewSection } from "../split-view";

afterEach(() => {
  cleanup();
});

describe("landing SplitViewSection", () => {
  test("renders the section, its command table and the persist note", () => {
    const { container } = render(<SplitViewSection />);
    const section = container.querySelector("section");
    expect(section?.getAttribute("data-hue")).toBe("aqua");
    expect(section?.id).toBe("split");
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

  test("the stills follow the tabs pattern and every pane stays mounted", () => {
    const { container } = render(<SplitViewSection />);
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
      "false",
    ]);
    // Roving tabindex: the selected tab is the only one in the tab order.
    expect(tabs.filter((t) => t.getAttribute("tabindex") === "0")).toHaveLength(1);
    // The pane contract (the proof band's): all four stills render into the
    // DOM, inactive ones hidden, so the captures stay crawlable.
    const panes = [...container.querySelectorAll('[role="tabpanel"]')];
    expect(panes).toHaveLength(4);
    expect(panes.filter((p) => p.hasAttribute("hidden"))).toHaveLength(3);
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs).toHaveLength(4);
    for (const img of imgs) {
      expect(img.getAttribute("loading")).toBe("lazy");
      expect(img.getAttribute("alt")?.length).toBeGreaterThan(0);
    }
  });

  test("switching tabs reveals the next still and its caption", () => {
    render(<SplitViewSection />);
    fireEvent.click(screen.getByRole("tab", { name: "Live thinking" }));
    const panel = document.getElementById("split-panel-thinking");
    expect(panel).toBeTruthy();
    expect(panel?.hasAttribute("hidden")).toBe(false);
    expect(panel?.textContent).toContain("Model reasoning streaming");
  });
});
