/**
 * empty.test.ts — the four honest panels (the O-1 never-blank law,
 * Lane A DOM-free).
 */
import { describe, test, expect } from "bun:test";
import { renderEmptyPanel, type EmptyPanelKind } from "./empty.js";

const kinds: EmptyPanelKind[] = [
  "no-jobs",
  "no-runs",
  "engine-down",
  "engine-locked",
  "no-dreams",
];

describe("honest panels", () => {
  test("every kind renders a non-blank panel with its heading", () => {
    for (const k of kinds) {
      const html = renderEmptyPanel(k);
      expect(html.length).toBeGreaterThan(0);
      expect(html).toContain(`data-panel="${k}"`);
    }
  });

  test("the engine-down panel carries the reason + a retry hint", () => {
    const html = renderEmptyPanel("engine-down", "engine 503 on GET /api/overview");
    expect(html).toContain("fugue-panel-reason");
    expect(html).toContain("engine 503 on GET /api/overview");
    expect(html).toContain("refresh");
  });

  test("the reason is HTML-escaped (no injection)", () => {
    const html = renderEmptyPanel("engine-down", '<script>alert(1)</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("no-reason panel renders no reason line", () => {
    const html = renderEmptyPanel("no-dreams");
    expect(html).not.toContain("fugue-panel-reason");
  });
});
