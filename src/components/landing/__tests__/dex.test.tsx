// Component test for src/components/landing/dex.tsx — the capability dex,
// which since 2026-10-23 is also the band that plays the feature captures,
// and since 2026-10-24 is browsed a screen at a time.
//
// The changed-line coverage gate (scripts/check_coverage.mjs) flags landing
// edits that no test exercises — this file pins the band's contracts:
//   - the list is a WAI-ARIA listbox with roving tabindex over ONE numbered
//     spine (the eleven drawn forms, then the ten filmed behaviors), and arrow
//     keys move selection the way the handheld's cursor moves (selection follows
//     focus);
//   - the numbers on the spine are DERIVED from array position — no entry
//     types one, so appending the twenty-second capability cannot misnumber
//     it, and reordering is the only edit that renumbers;
//   - the screen selector (the Gen-3 mode select, returned) renders `all` plus
//     one button per category with counts derived from the data, filters the
//     list to its pool, snaps the cursor to the pool's first filmed entry, and
//     walks with the same roving-tabindex arrows as the listbox;
//   - every entry is addressable as `#dex-<id>` (URLs are UI): a cold deep
//     link selects the entry, lands on its screen, and walking the list keeps
//     the hash in step through replaceState — never pushState;
//   - the search box filters through fuse.js (the band's one real dependency)
//     with an N-of-pool counter and an esc-to-clear escape, intersecting the
//     active screen's pool;
//   - the detail pane mounts all entries (inactive ones `hidden` — the
//     proof band's pane contract), each with its capture stage or its honest
//     empty plate, its cry (forms) and its receipt links — and only the SHOWN
//     pane mounts real `poster` attributes (hidden panes carry `data-poster`),
//     so a growing catalog does not grow its up-front poster fetches;
//   - the media is exactly the TUI-capture lane's audited set, playback is an
//     effect decision and never an `autoPlay` attribute, and every figure in
//     the lead is read off DEX — the rules the feature carousel brought with it
//     when the bands merged (docs/landing-research.md).
//
// Rendered under the global happy-dom preload (bunfig.toml [test] preload →
// src/test-dom-setup.ts), same as the other landing component tests.

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DexSection } from "../dex";
import {
  CATEGORY_DEFS,
  DEX,
  DEX_BY_CATEGORY,
  DEFAULT_INDEX,
  poolFor,
  SCREENS,
  screenOf,
  TALLY,
  isFilmed,
} from "../dex-data";
import { ENGINE_JOB_COUNTS } from "../engine-data";

afterEach(async () => {
  // Settle framer-motion's mount animation (FadeUp) before unmounting —
  // cancelling it mid-flight makes happy-dom's Animation reject unhandled,
  // which bun reports as a suite error and the coverage gate treats as a
  // red suite. Same reason as loop.test.tsx.
  await new Promise((r) => setTimeout(r, 320));
  // The band writes the selected entry into the URL hash (replaceState), and
  // the deep-link effect reads it on mount — without this reset, one test's
  // walk would select the next test's opening pane.
  window.location.hash = "";
  cleanup();
});

const articles = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>("article[aria-label]"));

const optionsIn = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('[role="option"]')) as HTMLElement[];

const shownPane = (root: HTMLElement) =>
  articles(root).filter((a) => !a.hasAttribute("hidden"));

const bySrc = (root: HTMLElement, part: string) =>
  Array.from(root.querySelectorAll("img")).filter((i) =>
    (i.getAttribute("src") ?? "").includes(part),
  );

describe("landing DexSection", () => {
  test("the listbox renders twenty-two options on one spine with roving tabindex", () => {
    const { container } = render(<DexSection />);
    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox).toBeTruthy();
    const options = optionsIn(container);
    expect(options.length).toBe(TALLY.total);
    expect(options.length).toBe(22);
    // Roving tabindex: exactly the selected option is tabbable — and the
    // cursor opens on the first entry that has footage, so a reader who does
    // nothing still sees a capture rather than an empty stage.
    for (const [i, el] of options.entries()) {
      expect(el.getAttribute("aria-selected")).toBe(i === DEFAULT_INDEX ? "true" : "false");
      expect(el.getAttribute("tabIndex")).toBe(i === DEFAULT_INDEX ? "0" : "-1");
    }
    expect(DEX[DEFAULT_INDEX].name).toBe("Task");
    // The spine's numbers are derived from position, so the literals below
    // pin the DERIVATION (forms first, then behaviors, three-digit padded),
    // not hand-typed values that could drift from the data.
    expect(DEX.map((e) => e.no)).toEqual(
      Array.from({ length: DEX.length }, (_, i) => String(i + 1).padStart(3, "0")),
    );
    expect(options[0].textContent).toContain("001");
    expect(options[0].textContent).toContain("Websearch");
    expect(options[9].textContent).toContain("010");
    expect(options[9].textContent).toContain("Parity");
    expect(options[19].textContent).toContain("020");
    expect(options[19].textContent).toContain("Routines");
    expect(options[20].textContent).toContain("021");
    expect(options[20].textContent).toContain("Skills");
    // Every row states its footage state in words, not only as a glyph.
    for (const [i, el] of options.entries()) {
      const want = isFilmed(DEX[i]) ? "filmed" : "pending";
      expect(el.textContent, `row ${DEX[i].no} mark`).toContain(want);
    }
    // The counter starts at a full dex.
    expect(screen.getByText(`${TALLY.total}/${TALLY.total}`)).toBeTruthy();
  });

  test("typing filters through fuse.js and snaps the cursor to the first match", () => {
    const { container } = render(<DexSection />);
    const input = screen.getByLabelText("search the dex");
    fireEvent.change(input, { target: { value: "checkpoints" } });
    const options = optionsIn(container);
    expect(options.length).toBe(1);
    expect(options[0].textContent).toContain("Checkpoints");
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(`1/${TALLY.total}`)).toBeTruthy();
    // The detail pane followed the cursor.
    const shown = shownPane(container);
    expect(shown.length).toBe(1);
    expect(shown[0].getAttribute("aria-label")).toContain("Checkpoints");
    // A nonsense query keeps the last selection and says so.
    fireEvent.change(input, { target: { value: "zzzzqqqq" } });
    expect(screen.getByText(/no entry matches/i)).toBeTruthy();
    // Esc clears.
    fireEvent.keyDown(input, { key: "Escape" });
    expect(optionsIn(container).length).toBe(TALLY.total);
    expect(screen.getByText(`${TALLY.total}/${TALLY.total}`)).toBeTruthy();
  });

  test("arrow keys walk the list and move the detail pane", () => {
    const { container } = render(<DexSection />);
    const listbox = container.querySelector('[role="listbox"]') as HTMLElement;
    const options = () => optionsIn(listbox);
    // The walk starts where the band opened — on the first filmed entry.
    options()[DEFAULT_INDEX].focus();
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    expect(options()[DEFAULT_INDEX + 1].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(options()[DEFAULT_INDEX + 1]);
    expect(shownPane(container)[0].getAttribute("aria-label")).toContain("Lsp");
    // Home returns to the top; End lands on the last entry, a behavior.
    fireEvent.keyDown(listbox, { key: "Home" });
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(listbox, { key: "End" });
    expect(options()[TALLY.total - 1].getAttribute("aria-selected")).toBe("true");
    expect(shownPane(container)[0].getAttribute("aria-label")).toContain("The parity round");
    // And the walk wraps past the end back to the top.
    fireEvent.keyDown(listbox, { key: "ArrowRight" });
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
  });

  /* ------------------------------------------------------------------ */
  /* the screens — the category taxonomy and the mode select            */
  /* ------------------------------------------------------------------ */

  test("the taxonomy covers every entry exactly once, forms by their type", () => {
    // The data-level contract the selector reduces over: every entry maps to
    // exactly one declared category, a form's screen is its type, and the
    // four pools partition the spine — so a taxonomy edit that strands an
    // entry (or double-books it) fails here before it ships a broken screen.
    for (const e of DEX) {
      const cat = screenOf(e);
      expect(CATEGORY_DEFS.some((c) => c.id === cat), `${e.name} → ${cat}`).toBe(true);
      if (e.kind === "form") expect(screenOf(e)).toBe(e.type);
      else expect(["workflow", "extend"]).toContain(e.screen);
    }
    const pooled = CATEGORY_DEFS.reduce(
      (n, c) => n + (DEX_BY_CATEGORY.get(c.id)?.length ?? 0),
      0,
    );
    expect(pooled).toBe(TALLY.total);
    // Every entry id is unique and URL-safe — it is the deep-link handle.
    const ids = DEX.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  test("the selector renders one button per screen with counts read off the data", () => {
    const { container } = render(<DexSection />);
    const group = container.querySelector('[role="group"][aria-label="dex screens"]');
    expect(group).toBeTruthy();
    const buttons = Array.from(group!.querySelectorAll("button"));
    expect(buttons.length).toBe(SCREENS.length);
    // Walk order: `all` first, then the categories in the order the lead
    // names them. The counts are derived — a new entry moves them by itself.
    for (const [i, s] of SCREENS.entries()) {
      const def = CATEGORY_DEFS.find((c) => c.id === s);
      const count = poolFor(s).length;
      expect(buttons[i].textContent).toContain(def ? def.label : "all");
      expect(buttons[i].textContent).toContain(String(count));
      expect(buttons[i].getAttribute("aria-pressed")).toBe(s === "all" ? "true" : "false");
      // Roving tabindex: only the active screen is a tab stop.
      expect(buttons[i].getAttribute("tabIndex")).toBe(s === "all" ? "0" : "-1");
      // No aria-label override (WCAG 2.5.3 label-in-name: the visible text is
      // the accessible name), and the gloss rides in the name as an sr-only
      // tail — so a screen reader hears the whole line.
      expect(buttons[i].hasAttribute("aria-label")).toBe(false);
      expect(buttons[i].textContent).toContain(def ? def.gloss : "the whole spine");
    }
  });

  test("a screen filters the list to its pool and snaps the cursor to its first footage", () => {
    const { container } = render(<DexSection />);
    const engineBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="group"] button'),
    ).find((b) => b.textContent?.includes("engine"))!;
    fireEvent.click(engineBtn);
    const pool = DEX_BY_CATEGORY.get("engine")!;
    const options = optionsIn(container);
    expect(options.length).toBe(pool.length);
    // Every visible row belongs to the screen — and keeps its spine number,
    // which is why the numbers on a category screen are not contiguous: the
    // spine is arrival order, the screen is a lens over it.
    for (const [i, o] of options.entries()) {
      expect(o.textContent).toContain(pool[i].no);
      expect(o.textContent).toContain(pool[i].name);
    }
    // The cursor snapped to the pool's first FILMED entry (memory-learn made
    // Memory the engine's first footage — № 005, before Hooks № 009), never
    // to a row the screen cannot show.
    expect(shownPane(container)[0].getAttribute("aria-label")).toContain("Memory");
    // The tally reads against the pool, not the whole spine.
    expect(screen.getByText(`${pool.length}/${pool.length}`)).toBeTruthy();
    // And switching back to `all` keeps the walkable spine.
    const allBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="group"] button'),
    )[0];
    fireEvent.click(allBtn);
    expect(optionsIn(container).length).toBe(TALLY.total);
  });

  test("arrow keys walk the screens with the same roving-tabindex contract", () => {
    const { container } = render(<DexSection />);
    const group = container.querySelector('[role="group"]') as HTMLElement;
    const buttons = () =>
      Array.from(group.querySelectorAll<HTMLButtonElement>("button"));
    buttons()[0].focus();
    // Selection follows focus, wrapping, exactly like the listbox below it.
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(buttons()[1].getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(buttons()[1]);
    expect(optionsIn(container).length).toBe(DEX_BY_CATEGORY.get("session")!.length);
    fireEvent.keyDown(group, { key: "End" });
    expect(buttons()[SCREENS.length - 1].getAttribute("aria-pressed")).toBe("true");
    // The extend screen has no footage yet — its honest empty stage IS the
    // point, so the cursor snaps to the pool's first entry, not past it.
    expect(shownPane(container)[0].getAttribute("aria-label")).toContain("Goals");
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(buttons()[SCREENS.length - 2].getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(buttons()[SCREENS.length - 2]);
  });

  test("search intersects the active screen's pool", () => {
    const { container } = render(<DexSection />);
    // On `all` the search behaves exactly as it did before the screens.
    const input = screen.getByLabelText("search the dex");
    fireEvent.change(input, { target: { value: "checkpoints" } });
    expect(optionsIn(container).length).toBe(1);
    fireEvent.keyDown(input, { key: "Escape" });
    // On a category screen, the query narrows WITHIN the screen — a search
    // for a session tool on the engine screen says so, honestly, instead of
    // reaching across the filter the reader chose.
    const engineBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="group"] button'),
    ).find((b) => b.textContent?.includes("engine"))!;
    fireEvent.click(engineBtn);
    fireEvent.change(input, { target: { value: "browser" } });
    expect(screen.getByText(/no entry matches/i)).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(optionsIn(container).length).toBe(DEX_BY_CATEGORY.get("engine")!.length);
  });

  /* ------------------------------------------------------------------ */
  /* deep links — URLs are UI                                            */
  /* ------------------------------------------------------------------ */

  test("a cold #dex-<id> arrival selects the entry and lands on its screen", () => {
    window.location.hash = "#dex-review";
    const { container } = render(<DexSection />);
    // № 015 Review is a workflow behavior: the pane shows it, the screen is
    // its own, and the list the reader then walks is the workflow pool.
    expect(shownPane(container)[0].getAttribute("aria-label")).toContain("Review");
    const options = optionsIn(container);
    expect(options.length).toBe(DEX_BY_CATEGORY.get("workflow")!.length);
    expect(
      options.some((o) => o.getAttribute("aria-selected") === "true" && o.textContent?.includes("Review")),
    ).toBe(true);
    // The mount deep link owns the hash: the first render must not rewrite
    // it away (the replaceState sync exists to write CHANGES, not echoes).
    expect(window.location.hash).toBe("#dex-review");
  });

  test("walking the list keeps the URL in step through replaceState", () => {
    const { container } = render(<DexSection />);
    expect(window.location.hash).toBe(""); // the first render writes nothing
    fireEvent.click(optionsIn(container)[10]); // № 011 Browser
    expect(window.location.hash).toBe("#dex-browser");
    // The pane followed, and the URL now names what the reader is looking at.
    expect(shownPane(container)[0].getAttribute("aria-label")).toContain("Browser");
    fireEvent.click(optionsIn(container)[20]); // № 021 Skills
    expect(window.location.hash).toBe("#dex-skills");
  });

  test("the pane contract: twenty-two entries mounted, the inactive ones hidden", () => {
    const { container } = render(<DexSection />);
    const panes = articles(container);
    expect(panes.length).toBe(TALLY.total);
    expect(panes.filter((a) => a.hasAttribute("hidden"))).toHaveLength(TALLY.total - 1);
    for (const e of DEX) {
      const pane = panes.find((a) => (a.getAttribute("aria-label") ?? "").startsWith(e.name));
      expect(pane, `pane for ${e.name}`).toBeTruthy();
      expect(pane?.getAttribute("aria-label")).toContain(e.no);
    }
  });

  test("every form's specimen mounts in its own pane, decorative beside the name", () => {
    const { container } = render(<DexSection />);
    const creatures = bySrc(container, "/landing/creatures/");
    expect(creatures.length).toBe(TALLY.forms);
    for (const img of creatures) {
      expect(img.getAttribute("alt")).toBe("");
      expect(img.getAttribute("aria-hidden")).toBe("true");
      expect(img.className).toContain("creature");
    }
  });

  test("the media is the harness's audited set — twelve movies, three stills, nothing invented", () => {
    const { container } = render(<DexSection />);
    const videos = Array.from(container.querySelectorAll("video"));
    expect(videos.length).toBe(TALLY.videos);
    expect(videos.length).toBe(12);
    for (const v of videos) {
      // Never an autoplay attribute — playback is an effect decision, so a
      // reduced-motion visitor is never handed one in the markup.
      expect(v.hasAttribute("autoplay")).toBe(false);
      expect(v.getAttribute("muted")).toBe("");
      expect(v.getAttribute("loop")).toBe("");
      expect(v.getAttribute("playsinline")).toBe("");
      expect(v.getAttribute("preload")).toBe("none");
      // loading="lazy" belongs to images: on a <video> it delays the poster.
      expect(v.hasAttribute("loading")).toBe(false);
      const sources = Array.from(v.querySelectorAll("source[type]"));
      expect(sources.map((s) => s.getAttribute("type"))).toEqual(["video/webm", "video/mp4"]);
      for (const s of sources) {
        expect(s.getAttribute("src")).toContain("/landing/tui/");
      }
    }
    // Posters are a live-pane attribute: a `poster` on a hidden pane still
    // fetches (display:none does not stop it — measured: 9 eager fetches,
    // ~1 MB, for one visible stage), so only the pane the reader can see
    // mounts the real attribute and the hidden panes carry `data-poster`,
    // swapped in by React the moment a pane is shown. Every movie still
    // names its poster in the DOM — the pane contract holds.
    const shown = shownPane(container)[0];
    for (const v of Array.from(shown.querySelectorAll("video"))) {
      expect(v.getAttribute("poster")?.length).toBeGreaterThan(0);
    }
    const hidden = videos.filter((v) => !shown.contains(v));
    expect(hidden.length).toBe(TALLY.videos - shown.querySelectorAll("video").length);
    for (const v of hidden) {
      expect(v.getAttribute("poster")).toBeNull();
      expect(v.getAttribute("data-poster")?.length).toBeGreaterThan(0);
    }
    const captures = bySrc(container, "/landing/tui/");
    expect(captures.length).toBe(TALLY.stills);
    expect(captures.length).toBe(3);
    expect(captures[0].getAttribute("loading")).toBe("lazy");
    expect(captures[0].getAttribute("alt")?.length).toBeGreaterThan(0);
    // No capture was fabricated: every unfilmed entry says so on its stage.
    const stubs = Array.from(container.querySelectorAll("p")).filter(
      (n) => n.textContent === "no capture yet",
    );
    expect(stubs.length).toBe(TALLY.pending);
    expect(stubs.length).toBe(10);
    // …and the band states who makes them, once, not once per empty stage.
    expect(container.textContent).toContain("scripts/tui-capture/");
    expect(
      Array.from(container.querySelectorAll("p")).filter((n) =>
        (n.textContent ?? "").includes("Nothing here was captured by hand"),
      ).length,
    ).toBe(0);
  });

  test("the lead's media mix is read off the data, never typed", () => {
    const { container } = render(<DexSection />);
    const text = container.textContent ?? "";
    expect(text).toContain(`${TALLY.filmed} of ${TALLY.total} carry a capture`);
    expect(text).toContain(`${TALLY.videos} movies`);
    expect(text).toContain(`${TALLY.stills} still set`);
    expect(text).toContain(`${TALLY.pending} pending`);
    // The same figures appear in the provenance line, so they cannot drift.
    expect(text).toContain(`The ${TALLY.videos} movies and the ${TALLY.stills} still set`);
    // And the tallies are internally derived, not two separate assertions:
    expect(TALLY.filmed + TALLY.pending).toBe(TALLY.total);
    expect(TALLY.forms + TALLY.behaviors).toBe(TALLY.total);
  });

  test("the visible pane's stage plays and the band keeps one selection readout", () => {
    const { container } = render(<DexSection />);
    // Exactly two live regions in the whole band: the search tally and this
    // readout. Every pane shouting its own name is how a listbox turns into
    // announcement spam.
    const live = Array.from(container.querySelectorAll("[aria-live]"));
    expect(live.length).toBe(2);
    const readout = live[live.length - 1];
    expect(readout.textContent).toContain("№ 003");
    expect(readout.textContent).toContain("Task");
    expect(readout.textContent).toContain("reel 1/2");
    // The chrome starts unpaused; the button is the reader's brake.
    const pause = container.querySelector('button[aria-label^="Pause the "]') as HTMLElement;
    expect(pause).toBeTruthy();
    expect(pause.getAttribute("aria-label")).toBe("Pause the Task capture");
    fireEvent.click(pause);
    expect(pause.getAttribute("aria-label")).toBe("Play the Task capture");
    expect(readout.textContent).toContain("paused");
  });

  // Entries named with a leading article ("The fix loop", "The wiki") used to
  // compose labels like "Pause the The fix loop capture" — a stutter every
  // screen-reader user heard. The accessible names carry one article, the
  // visible terminal title keeps the full name.
  test("stage and cry labels never double the article in an entry's own name", () => {
    const { container } = render(<DexSection />);
    for (const a of Array.from(container.querySelectorAll("button[aria-label], a[aria-label]"))) {
      const label = a.getAttribute("aria-label") ?? "";
      expect(label, `"${label}" must not stutter the article`).not.toMatch(/\bthe\s+the\b/i);
    }
    // Walk to № 012 "The fix loop" and read its stage button both ways.
    // All twenty-two panes stay mounted (the inactive ones `hidden`), so the
    // button must be read from the SHOWN pane — the first match in the DOM
    // belongs to № 003.
    const opt = optionsIn(container).find((o) => o.textContent?.includes("012"));
    fireEvent.click(opt!);
    const pane = shownPane(container)[0];
    expect(pane.getAttribute("aria-label")).toContain("The fix loop");
    const pause = pane.querySelector('button[aria-label^="Pause the "]') as HTMLElement;
    expect(pause.getAttribute("aria-label")).toBe("Pause the fix loop capture");
    fireEvent.click(pause);
    expect(pause.getAttribute("aria-label")).toBe("Play the fix loop capture");
    // The cry button composes the same way (forms only — 012 is a behavior,
    // so walk back to a form named with an article if one exists; none does,
    // and the generic no-stutter sweep above is the guard for the cry too).
  });

  test("an entry with two reels flips the stage without moving the cursor", () => {
    const { container } = render(<DexSection />);
    const pane = shownPane(container)[0];
    const boxes = Array.from(pane.querySelectorAll('[hidden]')).filter((el) =>
      el.querySelector("video"),
    );
    // Both of Task's movies mount; only the active reel is shown.
    const stage = pane.querySelectorAll("video");
    expect(stage.length).toBe(2);
    expect(boxes.length).toBe(1);
    const chip = Array.from(pane.querySelectorAll("button")).find(
      (b) => b.textContent === "fleet",
    ) as HTMLElement;
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(shownPane(container)[0].getAttribute("aria-label")).toContain("Task");
    expect(container.textContent).toContain("reel 2/2");
  });

  test("a behavior pane is filmed, not drawn: no specimen, no game flavor", () => {
    const { container } = render(<DexSection />);
    fireEvent.click(optionsIn(container)[17]); // № 018 Split view
    const pane = shownPane(container)[0];
    expect(pane.getAttribute("aria-label")).toContain("Split view");
    expect(bySrc(pane, "/landing/creatures/").length).toBe(0);
    expect(pane.querySelectorAll("blockquote").length).toBe(0);
    expect(pane.textContent).not.toContain("weakness");
    // Its portrait is the capture itself.
    expect(bySrc(pane, "/landing/tui/").length).toBe(1);
    expect(pane.textContent).toContain("pi-split-view 1.1.0");
  });

  test("every form carries a labelled cry control — original synthesis, inert without audio", () => {
    const { container } = render(<DexSection />);
    const cries = Array.from(
      container.querySelectorAll('button[aria-label^="play the "]'),
    );
    // Forms only: a behavior is filmed, so it has nothing to cry with.
    expect(cries.length).toBe(TALLY.forms);
    for (const btn of cries) {
      expect(btn.getAttribute("aria-label")).toMatch(/play the \w+ cry/);
    }
    // happy-dom has no AudioContext — the handler must survive the click
    // rather than throw (the no-audio-lane path).
    fireEvent.click(cries[0]);
    expect(cries[0].getAttribute("aria-label")).toContain("Websearch");
  });

  test("the /split* display commands keep this band as their one home", () => {
    const { container } = render(<DexSection />);
    const text = container.textContent ?? "";
    // Each name is a literal the claims gate resolves against splitview.ts's
    // registerCommand calls — a command the extension does not register turns
    // the page red, so the rows have to be here and in this shape.
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
      expect(text, `command: ${cmd}`).toContain(cmd);
    }
    expect(text).toContain("~/.unown/agent/ui-panels.json");
    expect(text).toContain("falls back to an overlay");
    expect(text).toContain("responses only");
    // Collapsed: the expander is the pattern, not a laid-out table.
    const details = container.querySelector("details");
    expect(details).toBeTruthy();
    expect(details?.hasAttribute("open")).toBe(false);
  });

  test("the SDLC-parity entry lists the M1-M4 capabilities and links their sources", () => {
    // The 2026-10-19 sweep ported fifteen features; the loop bento's sixth
    // tile carried them until the dex round moved the catalog here. Each
    // ported capability links to a real source file under
    // pi-repo/packages/self-learning/src/ — the page cannot drift from the
    // parity doc. The entry is selected first: the inactive panes are
    // `hidden`, and a role query (rightly) does not reach into them.
    const { container } = render(<DexSection />);
    fireEvent.click(optionsIn(container)[9]);
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
    // The counts come from ENGINE_JOB_COUNTS (generated from router.ts's
    // JOB_DEFS) — assert against the same generated numbers, not literals,
    // so a new job (M9's db-retention: 7→8) updates this test with the data
    // instead of failing on a stale pin.
    const words = ["zero","one","two","three","four","five","six","seven","eight","nine","ten"];
    const totalWord = words[ENGINE_JOB_COUNTS.total] ?? String(ENGINE_JOB_COUNTS.total);
    const intervalWord = words[ENGINE_JOB_COUNTS.interval] ?? String(ENGINE_JOB_COUNTS.interval);
    const eventWord = words[ENGINE_JOB_COUNTS.event] ?? String(ENGINE_JOB_COUNTS.event);
    expect(text).toContain(`${totalWord.replace(/^./, (c) => c.toUpperCase())} jobs keep the loop moving`);
    expect(text).toContain(`${intervalWord} on a timer, ${eventWord} on events`);
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

  test("the band declares the anchor and hue the composition test walks", () => {
    const { container } = render(<DexSection />);
    const section = container.querySelector("section");
    // #dex is the single anchor now that the capture band has merged into it,
    // and magma is the Gen-3 red the dex device is (AGENTS.md's hue walk).
    expect(section?.id).toBe("dex");
    expect(section?.getAttribute("data-hue")).toBe("magma");
    expect(container.querySelector("#features")).toBe(null);
    // The heading carries no digit: Pixelify Sans renders 57 as S7.
    const h2 = section?.querySelector("h2");
    expect(h2?.textContent ?? "").not.toMatch(/\d/);
  });
});
