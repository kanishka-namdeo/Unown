// Component test for the hero's quickstart expanders (src/components/landing/hero.tsx).
//
// The changed-line coverage gate (scripts/check_coverage.mjs) flags landing
// edits that no test exercises — this file pins the user-visible claims of
// the quickstart surface (install commands, the CLI-only binary lane, per-OS
// prerequisites incl. the sandbox ladder, command surface) so landing edits
// stay covered. The quickstart used to be its own section; the 2026-10-20
// merge folded it into the hero as collapsed <details> expanders, which is
// why these assertions now render <Hero />.
//
// Rendered under the global happy-dom preload (bunfig.toml [test] preload →
// src/test-dom-setup.ts), same as the dashboard component tests. FadeUp's
// whileInView animation is cosmetic — the DOM content exists regardless of
// IntersectionObserver behavior, so text assertions are stable. <details>
// content is in the DOM whether open or closed.
//
// The hero's install chip auto-detects the OS after mount, so the user agent
// is pinned first — the default must be a decision, not whatever the test
// runner's navigator happens to claim.

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";

// StarCount is an async server component whose fetch to api.github.com is
// both rate-limited (60/hr per IP — a shared CI or sandbox IP burns it) and
// latency-bound; either way the tree suspends past these synchronous
// assertions. Mocked to resolve immediately (same pattern as
// landing-copy.test.tsx) so the suite is deterministic and network-free.
mock.module("../star-count", () => ({
  StarCount: () => null,
  getStars: async () => 128,
}));

const { Hero } = await import("../hero");

const setUA = (ua: string) => {
  Object.defineProperty(window.navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
};

afterEach(() => {
  cleanup();
});

describe("landing quickstart (hero expanders)", () => {
  test("renders the clone-and-run install sequence behind the manual expander", () => {
    setUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36");
    const { container } = render(<Hero />);
    const expanders = [...container.querySelectorAll("details")];
    // three expanders: the delegation prompt, the manual sequence, the CLI surface
    expect(expanders.length).toBe(3);
    expect(container.textContent).toContain("Clone it, point it at a model, run it.");
    for (const line of [
      "git clone https://github.com/kanishka-namdeo/Unown.git",
      "cd Unown",
      "bun run agent:install",
      "unown setup",
      "bun run agent:start",
    ]) {
      const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(screen.getAllByText(new RegExp(escaped)).length).toBeGreaterThan(0);
    }
  });

  test("names the CLI-only binary lane as a separate install, not the chain", () => {
    setUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36");
    const { container } = render(<Hero />);
    const text = container.textContent ?? "";
    // The manual expander carries the binary lane as an instruction with the
    // two real invocations from public/install.sh and public/install.ps1.
    expect(text).toContain("cli only");
    expect(text).toContain("no git, no bun");
    expect(text).toContain("install.sh | sh -s -- --binary");
    expect(text).toContain("-OutFile install.ps1");
    expect(text).toContain(".\\install.ps1 -Binary");
    // and states the scope: the terminal agent alone. The engine/learning
    // stack stays on the source chain above (unown setup → agent:start → unown).
    expect(text).toContain("installs the terminal agent alone");
    expect(text).toContain("the engine and learning stack need the full install above");
    // the lane is prose plus inline <code>, not a second terminal block
    expect(container.querySelectorAll("pre")).toHaveLength(1);
  });

  test("states the three-OS prerequisite and the sandbox ladder", () => {
    setUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36");
    const { container } = render(<Hero />);
    const text = container.textContent ?? "";
    expect(text).toContain("Windows, macOS or Linux");
    expect(text).toContain("bubblewrap (Linux)");
    expect(text).toContain("Seatbelt (macOS)");
    expect(text).toContain("native Windows runs the in-process jail");
    expect(text).toContain("bun");
    expect(text).toContain("≥ 1.2");
  });

  test("lists the terminal command surface", () => {
    setUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36");
    const { container } = render(<Hero />);
    const text = container.textContent ?? "";
    for (const cmd of [
      "unown -p",
      "unown --plan",
      "unown --goal",
      "unown setup",
      "unown models",
      "unown doctor",
      "unown memory",
      "unown init",
      "unown mcp add",
      "unown note",
    ]) {
      expect(text).toContain(cmd);
    }
    // the MCP quickstart line: full invocation per mcp-cli.ts grammar
    // (`unown mcp add <name> <command> [args...]`) + its gloss
    expect(text).toContain("playwright npx @playwright/mcp@latest");
    expect(text).toContain("its tools join every session");
  });

  test("states the session surface and points the descriptions at the dex", () => {
    setUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36");
    const { container } = render(<Hero />);
    const text = container.textContent ?? "";
    // The tool names stay (the cli expander names the surface); the
    // capability DESCRIPTIONS moved to the capability dex with the
    // creatures (2026-10-20) — pinned there by dex.test.tsx, so this test
    // pins the pointer instead of the copy.
    expect(text).toContain("lsp");
    expect(text).toContain("web_search");
    expect(text).toContain("fetch_url");
    const dexLink = container.querySelector('a[href="#dex"]');
    expect(dexLink).toBeTruthy();
    expect(dexLink?.textContent).toContain("the capability dex");
    for (const command of ["/plan", "/review", "/goal", "/undo", "/receipts", "/mcp", "/lsp"]) {
      expect(text).toContain(command);
    }
    // the --goal line states the evidence contract
    expect(text).toContain("completion needs cited evidence");
  });
});
