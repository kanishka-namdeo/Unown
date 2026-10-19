// Component tests for the landing sections whose user-visible copy and CTA
// targets are load-bearing for a first-time or skeptical visitor.
//
// The changed-line coverage gate (scripts/check_coverage.mjs) flags landing
// edits no test exercises. These tests pin the *decisions* those edits encode:
//   - the install path actually starts the engine (bun run agent:start), and the
//     hero copy carries no placeholder key that would paste into a broken command;
//   - the hero's install chip is tabbed per OS (the Bun/Deno/uv pattern): the
//     default tab shows the documented one-line installer plus the sandbox
//     backend the engine really resolves on that platform, Windows carries the
//     clone path (a fresh Windows box has no sh), exactly one <pre> stays on the
//     chip, and detectOS is pinned branch by branch — including the darwin/win
//     substring trap;
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
const { detectOS } = await import("../install-panel");
const { IntegrityPane } = await import("../integrity");
const { LoopSection } = await import("../loop");
const { ModelsPane } = await import("../models");
const { FaqSection } = await import("../faq");
const { ShowcaseSection } = await import("../showcase");
const { Footer, Nav } = await import("../shell");
const { LEXICON } = await import("../lexicon");

afterEach(() => {
  cleanup();
});

describe("landing hero", () => {
  // The install chip auto-detects the OS after mount, so every hero test pins
  // the user agent first — the default must be a decision, not whatever the
  // test runner's navigator happens to claim.
  const setUA = (ua: string) => {
    Object.defineProperty(window.navigator, "userAgent", {
      value: ua,
      configurable: true,
    });
  };
  const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

  test("states the category, keeps the gated H1, and offers a runnable install", () => {
    setUA(MAC_UA);
    const { container } = render(<Hero />);
    const text = container.textContent ?? "";
    expect(text).toContain("Open-source AI coding agent");
    // The deploy gate asserts the H1 verbatim — a copy edit must not drop it.
    expect(text).toContain("It reads what you write down.");
    // Install is runnable: it starts the engine and carries no placeholder key.
    expect(container.innerHTML).toContain("bun run agent:start");
    expect(container.innerHTML).not.toContain("sk-");
  });

  test("the install chip defaults to the visitor's OS: one command, its sandbox note, the chain", () => {
    // One command chip above the fold — per OS tab, not a five-command wall.
    // The full command-by-command sequence stays in the quickstart section,
    // which sits directly below the hero.
    setUA(MAC_UA);
    const { container } = render(<Hero />);
    const text = container.textContent ?? "";
    // macOS default tab: the documented one-line installer (docs/install.md),
    // and the sandbox backend the engine resolves on darwin (bwrap.ts).
    expect(text).toContain("curl -fsSL https://unown-nine.vercel.app/install.sh | sh");
    expect(text).toContain("Seatbelt");
    // the payoff chain: connect a model, boot the stack, start a session
    expect(text).toContain("then: unown setup");
    expect(text).toContain("bun run agent:start");
    expect(text).toContain("unown");
    expect(container.querySelectorAll("pre")).toHaveLength(1);
  });

  test("the tabs follow the WAI-ARIA pattern and exactly one is selected", () => {
    setUA(MAC_UA);
    const { container } = render(<Hero />);
    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist?.getAttribute("aria-label")).toBe("Operating system");
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(["macOS", "Linux", "Windows"]);
    const selected = tabs.filter((t) => t.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toBe("macOS");
    const panel = container.querySelector('[role="tabpanel"]');
    expect(panel?.getAttribute("aria-labelledby")).toBe(selected[0]?.id);
    // roving tabindex: the selected tab is the only one in the tab order
    expect(selected[0]?.getAttribute("tabindex")).toBe("0");
    expect(tabs.filter((t) => t.getAttribute("tabindex") === "0")).toHaveLength(1);
  });

  test("switching the OS tab swaps the command and the sandbox note", () => {
    setUA(MAC_UA);
    const { container } = render(<Hero />);
    const windowsTab = screen.getByRole("tab", { name: "Windows" });
    fireEvent.click(windowsTab);
    // Scoped to the chip's tabpanel: the page carries the full three-OS
    // sandbox ladder inside the collapsed manual expander (pinned by
    // quickstart.test.tsx), so the swap assertions must look at what the
    // CHIP shows, not the whole hero.
    const chip = () => container.querySelector('[role="tabpanel"]');
    let chipText = chip()?.textContent ?? "";
    // Windows has no sh on a fresh box, so its tab carries the clone path and
    // the bun prerequisite from docs/windows.md — the page's canonical one-liner.
    expect(chipText).toContain(
      "git clone https://github.com/kanishka-namdeo/Unown.git && cd Unown && bun run agent:install",
    );
    expect(chipText).toContain("irm bun.sh/install.ps1");
    expect(chipText).toContain("in-process jail");
    // one command at a time: the installer line left the chip with the tab
    expect(chipText).not.toContain("unown-nine.vercel.app/install.sh");
    expect(windowsTab.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelectorAll("pre")).toHaveLength(1);

    fireEvent.click(screen.getByRole("tab", { name: "Linux" }));
    chipText = chip()?.textContent ?? "";
    expect(chipText).toContain("curl -fsSL https://unown-nine.vercel.app/install.sh | sh");
    expect(chipText).toContain("bubblewrap");
    expect(chipText).not.toContain("Seatbelt");
  });

  test("auto-detection honours the user agent without gating the other tabs", () => {
    setUA("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    const { container } = render(<Hero />);
    const selected = [...container.querySelectorAll('[role="tab"]')].find(
      (t) => t.getAttribute("aria-selected") === "true",
    );
    expect(selected?.textContent).toBe("Windows");
  });

  test("detectOS: every branch, including the darwin/win substring trap", () => {
    // "darwin" contains "win" as a substring — the windows probe must match
    // whole tokens, or every Mac visitor gets the Windows tab.
    expect(detectOS(undefined, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("macos");
    expect(detectOS(undefined, "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(detectOS("macOS", "anything")).toBe("macos");
    expect(detectOS("Windows", "anything")).toBe("windows");
    expect(detectOS(undefined, "Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
    expect(detectOS(undefined, "Mozilla/5.0 (CrOS x86_64 14541.0.0)")).toBe("linux");
    expect(detectOS(undefined, "something unrecognised")).toBe("macos"); // SSR default
  });

  test("offers the delegation path: your agent installs Unown", () => {
    setUA(MAC_UA);
    const { container } = render(<Hero />);
    const details = container.querySelector("details");
    expect(details).toBeTruthy();
    const summary = details?.querySelector("summary");
    expect(summary?.textContent).toContain("have your agent install it");
    // The prompt is the documented install path, addressed to another agent —
    // and `unown doctor` is the verification step, not a marketing claim.
    const text = details?.textContent ?? "";
    expect(text).toContain("bun run agent:install");
    expect(text).toContain("unown setup");
    expect(text).toContain("unown doctor");
    expect(text).not.toContain("sk-");
  });
});

describe("landing loop (mechanisms bento)", () => {
  test("the SDLC-parity tile lists the M1-M4 capabilities and links their sources", () => {
    // The 2026-10-19 sweep ported fifteen features; the loop band's bento
    // surfaces them as its sixth tile so the page can't silently drop one.
    // Each ported capability links to a real source file under
    // pi-repo/packages/self-learning/src/.
    const { container } = render(<LoopSection />);
    const text = container.textContent ?? "";
    expect(text).toContain("SDLC parity");
    expect(text).toContain("Three pains, five answers.");
    // Every M1-M4 capability is named — the same set the parity doc Round 5
    // table describes, in the same vocabulary so the page cannot drift from
    // the doc.
    const capabilities = [
      "Multi-type hooks",
      "Adversary Mode + injection scanner",
      "Per-subagent routing",
      "Recipes",
      "Repo Wiki",
      "/init + /doctor",
      "/blame + /sessions",
      "Auto-compact",
    ];
    for (const cap of capabilities) {
      expect(text).toContain(cap);
    }
    // The receipts link points at the parity doc on GitHub, not a dead route.
    const docLink = screen.getByRole("link", { name: /sdlc-feature-parity\.md/i });
    expect(docLink.getAttribute("href")).toContain("/blob/main/docs/sdlc-feature-parity.md");
    // Every SDLC-parity port links to a real src file (the receipt chip row).
    const SRC_PREFIX =
      "https://github.com/kanishka-namdeo/Unown/blob/main/pi-repo/packages/self-learning/src/";
    const src = (file: string) => `${SRC_PREFIX}${file}`;
    const srcLinks = container.querySelectorAll<HTMLAnchorElement>(
      'a[href*="/blob/main/pi-repo/packages/self-learning/src/"]',
    );
    const srcNames = new Set(
      Array.from(srcLinks).map((a) => a.getAttribute("href") ?? ""),
    );
    expect(srcNames.has(src("hooks-config.ts"))).toBe(true);
    expect(srcNames.has(src("adversary.ts"))).toBe(true);
    expect(srcNames.has(src("subagent-routing.ts"))).toBe(true);
    expect(srcNames.has(src("recipes.ts"))).toBe(true);
    expect(srcNames.has(src("repo-wiki.ts"))).toBe(true);
    expect(srcNames.has(src("init-agents.ts"))).toBe(true);
    expect(srcNames.has(src("blame.ts"))).toBe(true);
    expect(srcNames.has(src("auto-compact.ts"))).toBe(true);
  });

  test("the merged band keeps the pair strip and the job schedule from the generator", () => {
    const { container } = render(<LoopSection />);
    const text = container.textContent ?? "";
    // origin's two-halves argument, absorbed 2026-10-20
    expect(text).toContain("The terminal agent");
    expect(text).toContain("The engine behind it");
    expect(text).toContain("notes → memory → a better next session");
    // the engine's generated job schedule renders (engine-data.ts ← router.ts)
    expect(text).toContain("harness-cycle");
    expect(text).toContain("auto-dream");
  });

  test("the FAQ 'What can it actually do?' answer names the M1-M4 capabilities", () => {
    // The FAQ is the page's only place to enumerate features in prose — this
    // assertion keeps the answer honest against drift from the parity doc.
    render(<FaqSection />);
    fireEvent.click(screen.getByRole("button", { name: "What can it actually do?" }));
    const text = document.body.textContent ?? "";
    for (const fragment of [
      "multi-type hooks",
      "Adversary Mode",
      "106-pattern prompt-injection scanner",
      "per-subagent",
      "Recipes",
      "Repo Wiki",
      "/init",
      "/doctor",
      "/blame",
      "sessions export",
      "auto-compact",
      "Round 5",
    ]) {
      expect(text).toContain(fragment);
    }
  });
});

describe("landing models", () => {
  test("the local lane is wired with the real env var, id scheme and one-liner", () => {
    const { container } = render(<ModelsPane />);
    const text = container.textContent ?? "";
    expect(text).toContain("BRIDGE_LOCAL_URL");
    expect(text).toContain("local-*");
    expect(text).toContain("node benchmarks/local-llm/runner.mjs serve");
    // The split the page promises: background learning goes local, sessions do not.
    expect(text).toContain("while sessions stay on the remote one");
  });

  test("the complementary-bench sentence carries the three measured mechanisms", () => {
    const { container } = render(<ModelsPane />);
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
    render(<IntegrityPane />);
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
