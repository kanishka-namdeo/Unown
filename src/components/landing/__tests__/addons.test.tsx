// Component test for the showcase band's TUI-addons strip
// (src/components/landing/showcase.tsx + addons-data.ts).
//
// The changed-line coverage gate (scripts/check_coverage.mjs) flags landing
// edits no test exercises. These tests pin the decisions those edits encode:
//   - the three addons render inside the EXISTING showcase band (no tenth
//     band — the nine-band composition is pinned by landing-page.test.tsx),
//     each with its name, its pitch's load-bearing clauses, and a receipt
//     link straight at the file that ships it;
//   - the config-surface copy states the real file, the real /addons command
//     and the DERIVED key count — the number is read off ADDON_KEYS, never
//     typed into the copy;
//   - the drift gate: ADDON_KEYS is re-derived here from
//     pi-repo/packages/self-learning/src/addons/config.ts itself, so a key
//     added to the engine without the landing data (or vice versa) is a red
//     test, not a stale caption on a page whose argument is that its numbers
//     are checkable.
//
// Rendered under the global happy-dom preload (bunfig.toml [test] preload →
// src/test-dom-setup.ts), same as the other landing tests. The settle wait
// before cleanup follows dex.test.tsx: ShowcaseSection carries FadeUp
// (framer-motion whileInView) and cancelling it mid-flight makes happy-dom's
// Animation reject unhandled, which bun reports as a suite error.

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ShowcaseSection } from "../showcase";
import {
  ADDONS,
  ADDON_KEYS,
  ADDON_KEY_COUNT,
  ADDONS_SURFACE_RECEIPTS,
} from "../addons-data";

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 320));
  cleanup();
});

/* ------------------------------------------------------------------ */
/* the drift gate: addons-data.ts ↔ addons/config.ts                    */
/* ------------------------------------------------------------------ */

const CONFIG_TS = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "pi-repo",
  "packages",
  "self-learning",
  "src",
  "addons",
  "config.ts",
);

/** Field names of one `export interface X { … }` block in addons/config.ts.
 *  Comment lines never start with a bare identifier, so a `^\s*name?:` scan
 *  over the block body is the whole parser this gate needs. */
function interfaceFields(src: string, name: string): string[] {
  const m = src.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`no \`export interface ${name}\` in addons/config.ts`);
  return [...m[1].matchAll(/^[ \t]*([a-zA-Z_]\w*)\??:/gm)].map((f) => f[1]);
}

describe("the addons config drift gate", () => {
  const src = readFileSync(CONFIG_TS, "utf8");
  // guidance is one field in each tool addon's interface but three keys in
  // the file a user writes — expand it exactly the way ADDON_KEYS does.
  const guidanceKeys = interfaceFields(src, "AddonGuidance");
  const expand = (fields: string[]) =>
    fields.flatMap((f) =>
      f === "guidance" ? guidanceKeys.map((g) => `guidance.${g}`) : [f],
    );

  test("ADDON_KEYS mirrors the addon-config interfaces, leaf key by leaf key", () => {
    const map: readonly (readonly [string, string])[] = [
      ["askUserQuestion", "AskUserQuestionAddonConfig"],
      ["todo", "TodoAddonConfig"],
      ["advisor", "AdvisorAddonConfig"],
    ];
    for (const [addon, iface] of map) {
      expect(
        ADDON_KEYS.get(addon),
        `ADDON_KEYS[${addon}] drifted from ${iface} in addons/config.ts`,
      ).toEqual(expand(interfaceFields(src, iface)));
    }
  });

  test("the key count derives from the list — and is pinned, so a config edit fails loudly", () => {
    // The page prints ADDON_KEY_COUNT, so data and copy cannot disagree. This
    // literal is the loud version: a key added to or removed from config.ts
    // turns the next run red here and forces the change through ADDON_KEYS,
    // never around it.
    expect(ADDON_KEY_COUNT).toBe(21);
    expect(ADDON_KEYS.size).toBe(3);
  });
});

/* ------------------------------------------------------------------ */
/* the strip                                                            */
/* ------------------------------------------------------------------ */

/** The checkable clauses of each pitch. Copy may be tightened without
 *  weakening a fact; a fact that leaves is a regression. */
const PITCH_FRAGMENTS: Record<string, string[]> = {
  ask_user_question: [
    "Up to four structured questions",
    "free-text row on every question",
    "submit-review tab",
    "The session blocks until you answer",
  ],
  todo: [
    "four-state task machine",
    "blockedBy dependencies that reject cycles",
    "live panel above the editor",
    "/todos",
  ],
  advisor: [
    "A second model watches the session",
    "nits queue as asides",
    "steer immediately",
    "Read-only verification tools",
    "off by default",
  ],
};

describe("landing showcase addons strip", () => {
  test("the three addons render inside the showcase band, each with its pitch and receipt", () => {
    const { container } = render(<ShowcaseSection />);
    const strip = container.querySelector('ul[aria-label="the three TUI addons"]');
    expect(strip).toBeTruthy();
    const tiles = [...(strip?.querySelectorAll("li") ?? [])];
    expect(tiles.length).toBe(ADDONS.length);
    expect(ADDONS.length).toBe(3);

    const text = strip?.textContent ?? "";
    for (const a of ADDONS) {
      expect(text).toContain(a.name);
      for (const fragment of PITCH_FRAGMENTS[a.name] ?? []) {
        expect(text, `pitch clause: ${fragment}`).toContain(fragment);
      }
      // each tile links the file that ships the addon, on GitHub
      const link = screen.getByRole("link", { name: a.receipt[0] });
      expect(link.getAttribute("href")).toBe(a.receipt[1]);
    }
  });

  test("the config-surface copy: real file, real command, derived count, cross-platform", () => {
    const { container } = render(<ShowcaseSection />);
    const text = container.textContent ?? "";
    expect(text).toContain("~/.unown/agent/addons.json");
    expect(text).toContain("/addons");
    // the count is the derived one, not a typed figure
    expect(text).toContain(`${ADDON_KEY_COUNT} user-tunable keys`);
    // the stack claim: pi-tui, no native modules, the three OSes
    expect(text).toContain("pi-tui");
    expect(text).toContain("no native modules");
    expect(text).toContain("Windows, macOS and Linux");
  });

  test("the config surface and the /addons configurator link their receipts", () => {
    render(<ShowcaseSection />);
    for (const [label, href] of ADDONS_SURFACE_RECEIPTS) {
      const link = screen.getByRole("link", { name: label });
      expect(link.getAttribute("href")).toBe(href);
      expect(href).toContain(
        "/blob/main/pi-repo/packages/self-learning/src/addons/",
      );
    }
  });

  test("the band's dashboard story is intact — ten tabs, the CTA, no new band", () => {
    const { container } = render(<ShowcaseSection />);
    const text = container.textContent ?? "";
    expect(text).toContain("Ten tabs");
    expect(text).toContain("What the running engine looks like.");
    const cta = screen.getByRole("link", { name: /Install it and open the dashboard/i });
    expect(cta.getAttribute("href")).toBe("#quickstart");
    // the strip lives inside the section, not beside it: the nine-band
    // composition (landing-page.test.tsx) must not have grown a tenth band,
    // and the band's two lists are the dashboard tabs and the addons.
    expect(container.querySelectorAll("section").length).toBe(1);
    expect(container.querySelectorAll("#showcase ul").length).toBe(2);
  });
});
