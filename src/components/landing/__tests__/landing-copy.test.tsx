// Component tests for the landing sections whose user-visible copy and CTA
// targets are load-bearing for a first-time or skeptical visitor.
//
// The changed-line coverage gate (scripts/check_coverage.mjs) flags landing
// edits no test exercises. These tests pin the *decisions* those edits encode:
//   - the install path actually starts the engine (bun run agent:start), and the
//     hero copy carries no placeholder key that would paste into a broken command;
//   - the H1 the deploy gate asserts verbatim ("It reads what you write down") is
//     still present, so a copy edit cannot silently break verify-deploy;
//   - every "Dashboard" affordance points at the in-page screenshots, not at the
//     live /dashboard route that has no engine behind it on the hosted marketing page;
//   - the integrity section gives a reviewer something to click (SECURITY.md, the
//     sandbox and hook sources) and names the macOS sandbox backend;
//   - the models band's local lane is wired with the real env var, id scheme and
//     one-liner, and both it and the FAQ's which-models answer keep the split
//     honest: background learning goes local, coding sessions stay remote.
//
// Rendered under the global happy-dom preload (bunfig.toml [test] preload →
// src/test-dom-setup.ts). StarCount is an async RSC and cannot render inside a
// synchronous test, so it is mocked to a no-op; everything else is real.

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

mock.module("../star-count", () => ({
  StarCount: () => null,
  getStars: async () => 128,
}));

const { Hero } = await import("../hero");
const { IntegritySection } = await import("../integrity");
const { MechanismsSection } = await import("../mechanisms");
const { ModelsBand } = await import("../models");
const { FaqSection } = await import("../faq");
const { ShowcaseSection } = await import("../showcase");
const { Footer, Nav } = await import("../shell");
const { LEXICON } = await import("../lexicon");

afterEach(() => {
  cleanup();
});

describe("landing hero", () => {
  test("states the category, keeps the gated H1, and offers a runnable install", () => {
    const { container } = render(<Hero />);
    const text = container.textContent ?? "";
    expect(text).toContain("Open-source AI coding agent");
    // The deploy gate asserts the H1 verbatim — a copy edit must not drop it.
    expect(text).toContain("It reads what you write down.");
    // Install is runnable: it starts the engine and carries no placeholder key.
    expect(container.innerHTML).toContain("bun run agent:start");
    expect(container.innerHTML).not.toContain("sk-");
  });
});

describe("landing mechanisms", () => {
  test("the dashboard tile links to the in-page screenshots, not the live route", () => {
    render(<MechanismsSection />);
    const dash = screen.getByRole("link", { name: /see it in screenshots/i });
    expect(dash.getAttribute("href")).toBe("#showcase");
    expect(
      screen.getByRole("heading", { name: /What goes wrong without persistent memory/i }),
    ).toBeTruthy();
  });
});

describe("landing models", () => {
  test("the local lane is wired with the real env var, id scheme and one-liner", () => {
    const { container } = render(<ModelsBand />);
    const text = container.textContent ?? "";
    expect(text).toContain("BRIDGE_LOCAL_URL");
    expect(text).toContain("local-*");
    expect(text).toContain("node benchmarks/local-llm/runner.mjs serve");
    // The split the page promises: background learning goes local, sessions do not.
    expect(text).toContain("while sessions stay on the remote one");
  });

  test("the complementary-bench sentence carries the three measured mechanisms", () => {
    const { container } = render(<ModelsBand />);
    const text = container.textContent ?? "";
    // All three headline numbers are receipts from benchmarks/complementary/results/REPORT.md
    // (H18 KV reuse 54.5% prefill cut, H19 remote-input compression 47.2% median,
    // H22 local vision at $0) — pinned so the paragraph cannot silently rot.
    expect(text).toContain("benchmarks/complementary");
    expect(text).toContain("54% faster");
    expect(text).toContain("47%");
    expect(text).toContain("vision tokens");
  });
});

describe("landing faq", () => {
  test("the which-models answer keeps the local lane scoped to background learning", () => {
    // Radix unmounts closed answers, so the item has to be opened before its
    // copy is assertable — which is also how a visitor reads it.
    render(<FaqSection />);
    fireEvent.click(screen.getByRole("button", { name: "Which models does it work with?" }));
    expect(screen.getByText(/fully local and offline/)).toBeTruthy();
    expect(screen.getByText(/while coding sessions stay on the remote model/)).toBeTruthy();
  });
});

describe("landing showcase", () => {
  test("the call-to-action installs the engine rather than opening a dead app", () => {
    render(<ShowcaseSection />);
    const cta = screen.getByRole("link", { name: /Install it and open the dashboard/i });
    expect(cta.getAttribute("href")).toBe("#quickstart");
  });
});

describe("landing integrity", () => {
  test("links the receipts a skeptic would go verify", () => {
    render(<IntegritySection />);
    const security = screen.getByRole("link", { name: /SECURITY\.md/i });
    expect(security.getAttribute("href")).toContain("/blob/main/SECURITY.md");
    expect(screen.getByRole("link", { name: /hook layer/i })).toBeTruthy();
    expect(screen.getByText(/Seatbelt/i)).toBeTruthy();
  });
});

describe("landing shell", () => {
  test("nav and footer Dashboard point at the screenshots, not /dashboard", () => {
    render(<Nav />);
    const navLinks = screen.getAllByRole("link", { name: /^Dashboard$/i });
    expect(navLinks.length).toBeGreaterThan(0);
    for (const l of navLinks) expect(l.getAttribute("href")).toBe("#showcase");
    cleanup();
    render(<Footer />);
    const footLinks = screen.getAllByRole("link", { name: /^Dashboard$/i });
    for (const l of footLinks) expect(l.getAttribute("href")).toBe("#showcase");
  });
});

describe("landing lexicon", () => {
  test("self-improvement proofs name a directory that exists", () => {
    for (const entry of LEXICON) {
      expect(entry.proof).not.toContain("self-improvement");
    }
    expect(LEXICON.some((e) => e.proof === "benchmarks/selfimprove")).toBe(true);
  });
});
