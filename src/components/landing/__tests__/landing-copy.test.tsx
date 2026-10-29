// Component tests for the landing sections whose user-visible copy and CTA
// targets are load-bearing for a first-time or skeptical visitor.
//
// The changed-line coverage gate (scripts/check_coverage.mjs) flags landing
// edits no test exercises. These tests pin the *decisions* those edits encode:
//   - the full-stack source lane actually starts the engine (bun run
//     agent:start), and the hero copy carries no placeholder key that would
//     paste into a broken command;
//   - the install chip is the CLI-only binary lane by default: its one-liner
//     installs the newest stable release archive (no git, no bun), its chain
//     does not boot an engine, and the full-stack lane lives in the expander;
//   - the hero's install chip is tabbed per OS (the Bun/Deno/uv pattern): the
//     default tab shows the documented one-line installer plus the sandbox
//     backend the engine really resolves on that platform, Windows carries the
//     PowerShell one-liner, exactly one <pre> stays on the chip, and detectOS
//     is pinned branch by branch — including the darwin/win substring trap;
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

  test("states the category, keeps the gated headline, and offers a runnable install", () => {
    setUA(MAC_UA);
    const { container } = render(<Hero />);
    const text = container.textContent ?? "";
    expect(text).toContain("Open-source AI coding agent");
    // The deploy gate asserts the signature line verbatim — a copy edit must
    // not drop it. It moved from the h1 into the subhead (2026-10-24) so the
    // h1 could carry the search phrases; the sentence survives, gates green.
    expect(text).toContain("It reads what you write down");
    // The h1 is the strongest on-page relevance signal, so it — not only the
    // meta title — carries the product category. Pinned by e2e/seo.spec.ts
    // against the served page too.
    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toContain("The terminal coding agent that remembers.");
    // Install is runnable: it starts the engine and carries no placeholder key.
    expect(container.innerHTML).toContain("bun run agent:start");
    expect(container.innerHTML).not.toContain("sk-");
  });

  test("states its beta stage in the badge + plain-language pair the research settled on", () => {
    setUA(MAC_UA);
    const { container } = render(<Hero />);
    // The badge half: the chip in the kicker row, the same component the
    // header wordmark carries. "Beta" is a real status — plain text a screen
    // reader announces, never aria-hidden.
    expect(container.textContent).toContain("Beta");
    // The plain-language half: a badge states the stage, a sentence says what
    // it means. The exact wording is pinned so a copy edit cannot quietly
    // turn the honest sentence into marketing (the page's honesty rule: a
    // status claim must be defensible — 0.0.x line, moving formats, issues).
    expect(container.textContent).toContain("Unown is in beta");
    expect(container.textContent).toContain("expect rough edges and moving formats");
    // The badge is non-interactive: a status, not a control.
    const badge = [...container.querySelectorAll("span")].find((s) => s.textContent === "Beta");
    expect(badge?.querySelector("a, button")).toBeNull();
  });

  test("the install chip defaults to the visitor's OS: the binary one-liner, its note, the CLI-only chain", () => {
    // One command chip above the fold — per OS tab, not a five-command wall.
    // The full-stack source sequence stays in the manual expander below.
    setUA(MAC_UA);
    const { container } = render(<Hero />);
    const chipText = container.querySelector(".gb-panel")?.textContent ?? "";
    // macOS default tab: the documented one-line installer (docs/install.md),
    // whose default lane is the verified release binary, and the sandbox
    // backend the engine resolves on darwin (bwrap.ts).
    expect(chipText).toContain("curl -fsSL https://unown-nine.vercel.app/install.sh | sh");
    expect(chipText).toContain("Seatbelt");
    expect(chipText).toContain("CLI only");
    expect(chipText).toContain("no git or bun");
    // the binary lane's payoff chain: connect a model, start a session
    expect(chipText).toContain("then: unown setup");
    expect(chipText).toContain("unown");
    // no engine boot on this chip — that is the source lane's chain
    expect(chipText).not.toContain("bun run agent:start");
    expect(container.querySelectorAll("pre")).toHaveLength(1);
  });

  test("the chip names its default-version policy without a version literal", () => {
    setUA(MAC_UA);
    render(<Hero />);
    // Both one-liners install the newest STABLE release. The label says so; a
    // version number would go stale.
    const label = screen.getByText("install · latest stable release");
    expect(label).toBeTruthy();
    const chip = label.closest(".gb-panel");
    expect(chip?.textContent ?? "").not.toMatch(/\bv?\d+\.\d+\.\d+\b/);
    // the chip is the CLI-only binary lane; the full-stack source lane is a
    // different install and lives in the manual expander (quickstart test)
    expect(chip?.textContent ?? "").toContain("CLI only");
    expect(chip?.textContent ?? "").not.toContain("--binary");
    expect(chip?.textContent ?? "").not.toContain("--source");
    expect(chip?.textContent ?? "").not.toContain("bun run agent:start");
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
    // Windows ships its own one-liner installer (public/install.ps1 — the
    // irm|iex twin of the POSIX script; its default lane is the release
    // binary). One command at a time on the chip.
    expect(chipText).toContain("irm https://unown-nine.vercel.app/install.ps1 | iex");
    expect(chipText).toContain("refuses elevation");
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

describe("landing loop (the process band)", () => {
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

  test("the capability copy moved out — the mechanisms live in the dex, not here", () => {
    // The five-mechanism bento and its SDLC tile moved to the capability dex
    // (dex.tsx) when the creatures got their one canonical home (2026-10-20).
    // This pins the move: a copy re-added here is a second home, which is the
    // exact facts-stated-exactly-once violation the folder contract forbids.
    const { container } = render(<LoopSection />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("Three pains, five answers");
    expect(text).not.toContain("Four tiers — policy, project, user, local");
    expect(text).not.toContain("Guardrails at six layers");
    expect(text).not.toContain("SDLC parity");
    expect(container.querySelectorAll("img").length).toBe(0);
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

  // The affordance contract: every question shows its ▶ cursor while CLOSED.
  // The cursor used to be opacity-0 until open — a closed list of seven
  // identical boxes with no marker reads as plain text, and no visitor could
  // tell the FAQ was expandable (aria-expanded covers screen readers, not
  // eyes). happy-dom cannot compute the rendered opacity, so this pins the
  // class-level regression: the trigger's cursor must not carry opacity-0.
  test("every FAQ trigger shows its cursor affordance while closed", () => {
    const { container } = render(<FaqSection />);
    const triggers = Array.from(container.querySelectorAll("button[aria-expanded]"));
    expect(triggers.length).toBe(7);
    for (const t of triggers) {
      const cursor = t.querySelector("svg");
      expect(cursor, "each trigger carries its ▶ cursor").toBeTruthy();
      expect(cursor!.getAttribute("class")).not.toContain("opacity-0");
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
    expect(text).toContain("while sessions stay remote");
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
    const cta = screen.getByRole("link", { name: /Install it and run unown dashboard/i });
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
  // The desktop bar's own contract, and the reason it exists: four argument
  // links and one disclosure, where eight labels in a row competed with the
  // single gold CTA. The record surfaces are still reachable — they are the
  // "More" panel's whole content — they just no longer share the row.
  const PRIMARY = ["How it learns", "Capability dex", "Proof", "FAQ"];
  const MORE = ["Dashboard", "Live demo", "Built & Improved", "Alphabet", "Changelog", "Blog"];
  const barText = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('nav[aria-label="Main"] > a')).map((a) =>
      a.textContent?.trim(),
    );
  const moreText = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("#nav-more a")).map((a) => a.textContent?.trim());

  test("the bar carries four links and a More disclosure, not eight", () => {
    const { container } = render(<Nav />);
    expect(barText(container)).toEqual(PRIMARY);
    expect(moreText(container)).toEqual(MORE);
    // Nothing framed inside the nav row: the one filled action in the header is
    // the gold CTA, and the disclosure must not compete with it.
    expect(container.querySelectorAll('nav[aria-label="Main"] .gb-btn').length).toBe(0);
    const trigger = screen.getByRole("button", { name: /^more/i });
    expect(trigger.getAttribute("aria-controls")).toBe("nav-more");
    expect(trigger.className).not.toContain("gb-btn");
  });

  test("the More disclosure opens, jumps, and closes on Escape, click and blur", () => {
    const { container } = render(<Nav />);
    const trigger = screen.getByRole("button", { name: /^more/i });
    const panel = document.getElementById("nav-more");
    expect(panel).toBeTruthy();
    // Closed: in the DOM so aria-controls resolves and the SSR HTML keeps the
    // links, out of the tree so a screen reader is not read a hidden menu.
    expect(panel!.hasAttribute("hidden")).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: /^Changelog$/i })).toBeNull();

    fireEvent.click(trigger);
    expect(panel!.hasAttribute("hidden")).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    for (const label of MORE) {
      expect(screen.getByRole("link", { name: new RegExp(`^${label}$`, "i") })).toBeTruthy();
    }

    // Escape closes and hands focus back to the trigger — the panel is about to
    // leave the tab order, so a keyboard visitor needs somewhere to land.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(panel!.hasAttribute("hidden")).toBe(true);
    expect(document.activeElement).toBe(trigger);

    // A jump closes it too: an open panel over the band the visitor asked for
    // is a panel in the way.
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("link", { name: /^Blog$/i }));
    expect(panel!.hasAttribute("hidden")).toBe(true);

    // And so does a pointer-down anywhere outside the disclosure.
    fireEvent.click(trigger);
    expect(panel!.hasAttribute("hidden")).toBe(false);
    fireEvent.pointerDown(document.body);
    expect(panel!.hasAttribute("hidden")).toBe(true);
    cleanup();
  });

  test("nav and footer Dashboard point at the screenshots, not /dashboard", () => {
    const { container } = render(<Nav />);
    // The bar's Dashboard sits in the closed More panel, which the `hidden`
    // attribute keeps out of role queries — the pin is on the rendered href.
    const navDashboards = Array.from(container.querySelectorAll('nav[aria-label="Main"] a')).filter(
      (a) => a.textContent?.trim() === "Dashboard",
    );
    expect(navDashboards.length).toBeGreaterThan(0);
    for (const l of navDashboards) expect(l.getAttribute("href")).toBe("#showcase");
    cleanup();
    render(<Footer />);
    const footLinks = screen.getAllByRole("link", { name: /^Dashboard$/i });
    for (const l of footLinks) expect(l.getAttribute("href")).toBe("#showcase");
  });

  test("the beta stage rides the wordmark in the header and the note in the footer", () => {
    // Three homes, one component: the header wordmark badge, the hero kicker
    // badge, the footer sentence. The header is pinned here because it is the
    // one every page view starts from — a badge only the hero carried would
    // vanish the moment a visitor scrolls.
    const { container } = render(<Nav />);
    // The wordmark link is the one that goes home — the GitHub link and the
    // CTA are the other <a>s in the header.
    const wordmark = container.querySelector('a[href="/"]');
    expect(wordmark?.textContent).toContain("Beta");
    // The Blog access point: the one non-anchor nav entry, a real route. It is
    // in the More panel, which is inside the main nav and always rendered.
    const blogLink = container.querySelector('nav[aria-label="Main"] a[href="/blog"]');
    expect(blogLink?.textContent?.trim()).toBe("Blog");
    cleanup();
    render(<Footer />);
    expect(screen.getByText("Currently in beta.")).toBeTruthy();
    // The footer's eighth link fills the grid and routes absolutely.
    expect(screen.getByRole("link", { name: /^Blog$/i }).getAttribute("href")).toBe("/blog");
  });

  // Below lg the whole list lives behind the section menu — flat, all eight,
  // because a phone visitor gets one menu rather than a menu inside a menu.
  // These pin the disclosure contract: the panel exists (aria-controls
  // resolves), starts closed and out of the accessibility tree (the `hidden`
  // attribute), opens on the button, carries every entry the desktop bar and
  // the More disclosure have, plus the two header actions that no longer fit
  // the bar, and closes on link click and Escape.
  test("the section menu is a closed disclosure below lg, then opens with every anchor", () => {
    render(<Nav />);
    const button = screen.getByRole("button", { name: /open the section menu/i });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBe("site-menu");
    // Closed: the panel is in the DOM (aria-controls must resolve) but the
    // `hidden` attribute keeps it out of the tree and the tab order.
    const panel = document.getElementById("site-menu");
    expect(panel).toBeTruthy();
    expect(panel!.hasAttribute("hidden")).toBe(true);
    expect(screen.queryByRole("navigation", { name: "Main menu" })).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(panel!.hasAttribute("hidden")).toBe(false);
    const menu = screen.getByRole("navigation", { name: "Main menu" });
    // The ten entries the page has: the nine in-page anchors plus Blog —
    // the one real route, pinned here with the rest since the menu is the
    // phone visitor's only navigation.
    for (const label of ["How it learns", "Capability dex", "Dashboard", "Live demo", "Built & Improved", "Proof", "Alphabet", "FAQ", "Changelog", "Blog"]) {
      const links = menu.querySelectorAll("a");
      expect(
        [...links].some((a) => a.textContent?.trim() === label),
        `menu must carry the "${label}" anchor`,
      ).toBe(true);
    }
    // The two actions that left the bar below lg ride the panel.
    expect(screen.getAllByRole("link", { name: /^get started$/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("link", { name: /unown on github/i }).length).toBeGreaterThanOrEqual(1);
    // Every in-page jump the menu offers resolves to a real target.
    for (const a of menu.querySelectorAll("a[href^='#']")) {
      const id = a.getAttribute("href")!.slice(1);
      expect(id.length).toBeGreaterThan(0);
    }
  });

  test("the section menu closes on a link click and on Escape", () => {
    render(<Nav />);
    const button = screen.getByRole("button", { name: /open the section menu/i });
    fireEvent.click(button);
    const panel = document.getElementById("site-menu")!;
    expect(panel.hasAttribute("hidden")).toBe(false);
    // Scope to the panel: the desktop nav renders its own FAQ link, and
    // happy-dom applies no CSS, so a global role query would match it first.
    const menuFaq = Array.from(panel.querySelectorAll("a")).find(
      (a) => a.textContent?.trim() === "FAQ",
    ) as HTMLElement;
    expect(menuFaq).toBeTruthy();

    // A link click navigates AND closes.
    fireEvent.click(menuFaq);
    expect(panel.hasAttribute("hidden")).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");

    // Escape closes from anywhere while open.
    fireEvent.click(button);
    expect(panel.hasAttribute("hidden")).toBe(false);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(panel.hasAttribute("hidden")).toBe(true);
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
