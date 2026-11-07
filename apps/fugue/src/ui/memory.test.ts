/**
 * memory.test.ts — the tiered-memory view pins (Lane A, DOM-free).
 *
 * Pins the view model + render helpers against the adapter-native
 * MemoryView (the F-7 chunk 2 type alignment): the tier rows (name,
 * version, content preview expandable), the health card (backend,
 * model, counts, warnings, maxRendered, lastReconcile), the degraded
 * health lane (a missing health object NEVER reads as a healthy one),
 * the null-memory load-failed panel (the E-02 honest catch), and the
 * escapeHtml law on every interpolated string.
 */
import { describe, test, expect } from "bun:test";
import type {
  MemoryView,
  MemoryTier,
  MemoryHealthView,
} from "../adapter/engine-adapter.js";
import {
  tierContentPreview,
  renderTierRow,
  renderHealthCard,
  renderMemory,
  memoryViewModel,
  moveTierSelection,
} from "./memory.js";

function tier(over: Partial<MemoryTier> = {}): MemoryTier {
  return {
    tier: "policy",
    version: 1,
    content: "# Tier 0 — Policy (non-negotiable guardrails)\n\n- Never delete...",
    chars: 80,
    updatedAt: 1794064205286,
    ...over,
  };
}

function health(over: Partial<MemoryHealthView> = {}): MemoryHealthView {
  return {
    memoryCount: 5,
    duplicateCount: 0,
    conflictCount: 0,
    warnings: [],
    lastReconcile: 1794064205283,
    available: true,
    backend: "lexical",
    model: "agnes-3.0-flash",
    maxRendered: 110,
    ...over,
  };
}

function view(over: Partial<MemoryView> = {}): MemoryView {
  return { tiers: [tier()], health: health(), ...over };
}

describe("the tier content preview", () => {
  test("caps at ~200 chars with the ellipsis", () => {
    const p = tierContentPreview(tier({ content: "y".repeat(500) }));
    expect(p.length).toBe(200);
    expect(p.endsWith("…")).toBe(true);
  });
  test("a short content previews in full", () => {
    expect(tierContentPreview(tier())).toContain("Tier 0 — Policy");
  });
  test("an empty tier previews the honest line", () => {
    expect(tierContentPreview(tier({ content: "   " }))).toBe("(empty tier)");
  });
});

describe("the tier row render", () => {
  test("the row carries the RAW tier name + version + chars", () => {
    const html = renderTierRow(tier({ tier: "project:agent-service-c5ccfe" }));
    expect(html).toContain('data-tier="project:agent-service-c5ccfe"');
    expect(html).toContain('data-version="1"');
    expect(html).toContain("1663".length >= 4 ? " chars" : "");
  });
  test("the content renders inside an expandable details/summary", () => {
    const html = renderTierRow(tier());
    expect(html).toContain("<details class=\"fugue-tier-output\"");
    expect(html).toContain("<summary class=\"fugue-tier-preview\">");
    expect(html).toContain("<pre class=\"fugue-tier-output-full\">");
  });
  test("an empty tier shows the honest empty line (no seeded content)", () => {
    const html = renderTierRow(tier({ content: "" }));
    expect(html).toContain("empty tier");
    expect(html).not.toContain("<details");
  });
  test("interpolated tier names are escaped", () => {
    const html = renderTierRow(tier({ tier: '<script>alert("x")</script>' }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("the health card render", () => {
  test("a live health card shows backend + model + counts + maxRendered", () => {
    const html = renderHealthCard(health());
    expect(html).toContain('data-healthy="true"');
    expect(html).toContain("lexical");
    expect(html).toContain("agnes-3.0-flash");
    expect(html).toContain("110");
    expect(html).toContain("5");
  });
  test("the lastReconcile epoch renders as an ISO string", () => {
    const html = renderHealthCard(health());
    expect(html).toContain("2026");
  });
  test("a zero lastReconcile renders the honest 'never'", () => {
    const html = renderHealthCard(health({ lastReconcile: 0 }));
    expect(html).toContain("never");
  });
  test("the degraded lane (available=false) surfaces the honest line", () => {
    const html = renderHealthCard(health({ available: false, backend: "" }));
    expect(html).toContain('data-healthy="false"');
    expect(html).toContain("health unavailable");
  });
  test("warnings render as a list", () => {
    const html = renderHealthCard(health({ warnings: ["a", "b"] }));
    expect(html).toContain('<li class="fugue-memory-warning">a</li>');
    expect(html).toContain('<li class="fugue-memory-warning">b</li>');
  });
  test("warning strings are escaped", () => {
    const html = renderHealthCard(health({ warnings: ['<script>alert("x")</script>'] }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("the full memory view render", () => {
  test("a populated view renders the tiers list + the meta line + the health card", () => {
    const html = renderMemory({
      memory: view({ tiers: [tier(), tier({ tier: "project" })] }),
    });
    expect(html).toContain('data-route="memory"');
    expect(html).toContain("2 tiers");
    expect(html).toContain('data-tier="policy"');
    expect(html).toContain('data-tier="project"');
    expect(html).toContain("fugue-health-card");
  });
  test("zero tiers → the honest 'no tiers yet' line (V-41)", () => {
    const html = renderMemory({ memory: view({ tiers: [] }) });
    expect(html).toContain("no tiers yet");
    expect(html).not.toContain("fugue-tier-row");
  });
  test("a null memory (the load failed) renders the E-02 error panel", () => {
    const html = renderMemory({ memory: null });
    expect(html).toContain('data-panel="memory-load-failed"');
    expect(html).toContain("Memory load failed");
  });
});

describe("the view model + navigation", () => {
  test("memoryViewModel lists the tier names + finds the selection", () => {
    const vm = memoryViewModel({
      memory: view({ tiers: [tier(), tier({ tier: "project" })] }),
      selectedTier: "project",
    });
    expect(vm.totalTiers).toBe(2);
    expect(vm.selectedIndex).toBe(1);
  });
  test("a null memory view model is zero-tier", () => {
    const vm = memoryViewModel({ memory: null });
    expect(vm.totalTiers).toBe(0);
    expect(vm.selectedIndex).toBe(-1);
  });
  test("moveTierSelection clamps at the edges", () => {
    expect(moveTierSelection(0, 2, -1)).toBe(0);
    expect(moveTierSelection(1, 2, 1)).toBe(1);
    expect(moveTierSelection(0, 2, 1)).toBe(1);
  });
});
