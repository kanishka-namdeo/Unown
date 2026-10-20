// Component test for src/components/landing/dex.tsx — the capability dex.
//
// The changed-line coverage gate (scripts/check_coverage.mjs) flags landing
// edits that no test exercises — this file pins the dex's interaction
// contract (docs/landing-research.md Part 15):
//   - the list is a WAI-ARIA listbox with roving tabindex, and arrow keys
//     move selection the way the handheld's cursor moves (selection follows
//     focus);
//   - the search box filters through fuse.js (the band's one real
//     dependency) with an N-of-ten counter and an esc-to-clear escape;
//   - the detail pane mounts all ten entries (inactive ones `hidden` — the
//     proof band's pane contract), each with a labelled cry control and its
//     receipt links.
//
// Rendered under the global happy-dom preload (bunfig.toml [test] preload →
// src/test-dom-setup.ts), same as the other landing component tests.

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DexSection } from "../dex";
import { DEX } from "../dex-data";

afterEach(async () => {
  // Settle framer-motion's mount animation (FadeUp) before unmounting —
  // cancelling it mid-flight makes happy-dom's Animation reject unhandled,
  // which bun reports as a suite error and the coverage gate treats as a
  // red suite. Same reason as loop.test.tsx.
  await new Promise((r) => setTimeout(r, 320));
  cleanup();
});

const articles = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("article[aria-label]"));

describe("landing DexSection", () => {
  test("the listbox renders ten options with roving tabindex, websearch first", () => {
    const { container } = render(<DexSection />);
    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox).toBeTruthy();
    const options = Array.from(
      listbox?.querySelectorAll('[role="option"]') ?? [],
    ) as HTMLElement[];
    expect(options.length).toBe(10);
    // Roving tabindex: exactly the selected option is tabbable.
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(options[0].getAttribute("tabIndex")).toBe("0");
    for (let i = 1; i < options.length; i++) {
      expect(options[i].getAttribute("aria-selected")).toBe("false");
      expect(options[i].getAttribute("tabIndex")).toBe("-1");
    }
    // The catalog's spine: numbered rows in dex order.
    expect(options[0].textContent).toContain("001");
    expect(options[0].textContent).toContain("Websearch");
    expect(options[9].textContent).toContain("010");
    expect(options[9].textContent).toContain("Parity");
    // The counter starts at a full dex.
    expect(screen.getByText("10/10")).toBeTruthy();
  });

  test("typing filters through fuse.js and snaps the cursor to the first match", () => {
    const { container } = render(<DexSection />);
    const input = screen.getByLabelText("search the dex");
    fireEvent.change(input, { target: { value: "mcp" } });
    const options = Array.from(
      container.querySelectorAll('[role="option"]'),
    ) as HTMLElement[];
    expect(options.length).toBe(1);
    expect(options[0].textContent).toContain("Mcp");
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("1/10")).toBeTruthy();
    // The detail pane followed the cursor.
    const shown = articles(container).filter((a) => !a.hasAttribute("hidden"));
    expect(shown.length).toBe(1);
    expect(shown[0].getAttribute("aria-label")).toContain("Mcp");
    // A nonsense query keeps the last selection and says so.
    fireEvent.change(input, { target: { value: "zzzzqqqq" } });
    expect(screen.getByText(/no form matches/i)).toBeTruthy();
    // Esc clears.
    fireEvent.keyDown(input, { key: "Escape" });
    expect(
      (container.querySelectorAll('[role="option"]') as NodeListOf<HTMLElement>).length,
    ).toBe(10);
    expect(screen.getByText("10/10")).toBeTruthy();
  });

  test("arrow keys walk the list and move the detail pane", () => {
    const { container } = render(<DexSection />);
    const listbox = container.querySelector('[role="listbox"]') as HTMLElement;
    const options = () =>
      Array.from(listbox.querySelectorAll('[role="option"]')) as HTMLElement[];
    options()[0].focus();
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(options()[1]);
    let shown = articles(container).filter((a) => !a.hasAttribute("hidden"));
    expect(shown[0].getAttribute("aria-label")).toContain("Mcp");
    // Home returns to the top; the list wraps at the end.
    fireEvent.keyDown(listbox, { key: "Home" });
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(listbox, { key: "End" });
    expect(options()[9].getAttribute("aria-selected")).toBe("true");
    shown = articles(container).filter((a) => !a.hasAttribute("hidden"));
    expect(shown[0].getAttribute("aria-label")).toContain("Parity");
  });

  test("every entry carries a labelled cry control — original synthesis, inert without audio", () => {
    const { container } = render(<DexSection />);
    const cries = Array.from(
      container.querySelectorAll('button[aria-label^="play the "]'),
    );
    expect(cries.length).toBe(10);
    for (const btn of cries) {
      expect(btn.getAttribute("aria-label")).toMatch(/play the \w+ cry/);
    }
    // happy-dom has no AudioContext — the handler must survive the click
    // rather than throw (the no-audio-lane path).
    fireEvent.click(cries[0]);
    expect(cries[0].getAttribute("aria-label")).toContain("Websearch");
  });

  test("the SDLC-parity entry lists the M1-M4 capabilities and links their sources", () => {
    // The 2026-10-19 sweep ported fifteen features; the loop bento's sixth
    // tile carried them until the dex round moved the catalog here. Each
    // ported capability links to a real source file under
    // pi-repo/packages/self-learning/src/ — the page cannot drift from the
    // parity doc. The entry is selected first: the inactive panes are
    // `hidden`, and a role query (rightly) does not reach into them.
    const { container } = render(<DexSection />);
    fireEvent.click(
      container.querySelectorAll('[role="option"]')[9] as HTMLElement,
    );
    const text = container.textContent ?? "";
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
      expect(text, `capability: ${cap}`).toContain(cap);
    }
    // The receipts link points at the parity doc on GitHub, not a dead route.
    const docLink = screen.getByRole("link", { name: /sdlc-feature-parity\.md/i });
    expect(docLink.getAttribute("href")).toContain("/blob/main/docs/sdlc-feature-parity.md");
    // Every SDLC-parity port links to a real src file (the receipt row).
    const SRC_PREFIX =
      "https://github.com/kanishka-namdeo/Unown/blob/main/pi-repo/packages/self-learning/src/";
    const src = (file: string) => `${SRC_PREFIX}${file}`;
    const srcLinks = container.querySelectorAll<HTMLAnchorElement>(
      'a[href*="/blob/main/pi-repo/packages/self-learning/src/"]',
    );
    const srcNames = new Set(
      Array.from(srcLinks).map((a) => a.getAttribute("href") ?? ""),
    );
    for (const file of [
      "hooks-config.ts",
      "adversary.ts",
      "subagent-routing.ts",
      "recipes.ts",
      "repo-wiki.ts",
      "init-agents.ts",
      "blame.ts",
      "auto-compact.ts",
    ]) {
      expect(srcNames.has(src(file)), `receipt: ${file}`).toBe(true);
    }
  });

  test("the router entry keeps the generated job sentence from the claims gate", () => {
    // JOB_SENTENCE moved here from the loop bento with the tile — it is
    // derived from ENGINE_JOB_COUNTS (router.ts via scripts/landing_claims.mjs),
    // so the rendered sentence must match the generated counts, not a
    // hand-typed one.
    const { container } = render(<DexSection />);
    const text = container.textContent ?? "";
    expect(text).toContain("Seven jobs keep the loop moving");
    expect(text).toContain("five on a timer, two on events");
    expect(text).toContain("A busy-mutex means the sandbox is never double-driven");
    // and the moved capability copy is here, not in the loop band
    for (const fragment of [
      "Four tiers — policy, project, user, local",
      "Guardrails at six layers",
    ]) {
      expect(text, `moved copy: ${fragment}`).toContain(fragment);
    }
  });

  test("every entry's name and number render in its detail pane", () => {
    const { container } = render(<DexSection />);
    const text = container.textContent ?? "";
    for (const e of DEX) {
      expect(text, `dex names: ${e.name}`).toContain(e.name);
      expect(text, `dex numbers: ${e.no}`).toContain(e.no);
    }
  });
});
