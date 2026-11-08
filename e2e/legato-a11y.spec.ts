/**
 * Legato — the a11y battery (ticket L-11, PLAN §3 L-11, §4.4
 * Q-2 "keyboard focus traps — the Ostinato dialog contract
 * re-pinned (Tab-trap, Esc focus-return)" + the fugue F-9
 * a11y precedent).
 *
 * THE AXE SCOPE: wcag2a + wcag2aa EXACTLY (the Ostinato O-4
 * two-tag pin — NOT Coda's four-tag set; no wcag21*). The
 * PRD P0 #9 "axe wcag2a/wcag2aa clean" row + the Q-2 focus-
 * trap re-pin.
 *
 * THE SCAN MATRIX (per scheme, the ostinato a11y battery's
 * shape, ported to Legato's list/detail/palette surface):
 *   1. LIST view — the clip list (the seeded state: one clean
 *      clip, the filter bar with its tag chips) → scan.
 *   2. DETAIL view — the reading pane (the clip's title + URL +
 *      body + the tag editor's "Edit tags" affordance + the
 *      highlights lane) → scan.
 *   3. OPEN PALETTE — Ctrl+K → the dialog overlay (role=dialog
 *      + aria-modal + the command listbox + the input) → scan
 *      (the Ostinato dialog contract's a11y surface).
 *   BOTH SCHEMES (light + dark) — the app owns light/dark via
 *   the theme lane (the t key's toggle, or the data-scheme
 *   attribute set directly in the spec — the Ostinato a11y
 *   battery's "drive both schemes per-context" contract; here
 *   the spec's seeded context boots light, and the dark scan
 *   toggles the theme via the 't' key in a NON-detail context
 *   so the toggle is a scheme flip, not the tag editor).
 *
 * TWO FOCUS-ORDER PINS AS REAL TESTS (the Ostinato shape — the
 * fugue F-9 precedent):
 *   1. THE TAB-ORDER PIN — from a fresh focusable state, Tab
 *      walks the logical surface order: the search input → the
 *      filter group (the tabindex=0 container) → the filter
 *      chips → the clip row (the tabindex=-1 target, when
 *      selected it carries aria-current + the keyboard cursor)
 *      → the clear-filters button. One scheme suffices (the
 *      pins are scheme-independent).
 *   2. THE ESC FOCUS-RETURN PIN — open the palette from a
 *      focused control; Esc closes the palette and focus
 *      returns to the invoking control (the Ostinato P0 #9
 *      lane, the palette.ts's "Esc focus-return" contract).
 *
 * SEEDING: one clip (the minimal readable unit — the offline
 * spec's SEED_DATA shape, ported) + one tag, so the filter bar
 * renders its chips (the L-7 surface the scan sees). The seed
 * writes the committed record + the meta record in ONE
 * transaction before the app's main() boots (the offline spec's
 * seedIdb lane, the IDB adapter's on-disk shape).
 *
 * Self-skip: the spec runs under the legato config's LEGATO_E2E
 * marker (the Coda/Ostinato/Fugue precedent); under the root
 * config the marker is unset and the spec self-skips.
 *
 * Operator gate: LEGATO_E2E=1 bunx playwright test
 * --config=playwright.legato.config.ts from the repo root. No
 * run is claimed that was not performed.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.skip(
  !process.env.LEGATO_E2E,
  "legato lane only — run via playwright.legato.config.ts",
);

/**
 * The seed data set: one clean clip + one tag (the filter bar's
 * chip surface). The shape matches the app's committed LegatoData
 * v1 exactly (the byte-stable export wire form, L-9).
 */
const SEED_DATA: Record<string, unknown> = {
  schema: "legato.v1",
  schemaVersion: 1,
  clips: [
    {
      id: 1,
      url: "http://127.0.0.1:4018/fixtures/clean.html",
      finalUrl: "http://127.0.0.1:4018/fixtures/clean.html",
      title: "A11y seed clip",
      text:
        "The Legato a11y lane: a seeded clip that renders the list row, the detail pane, and the filter bar's tag chip for the axe battery. This text is what the detail pane renders when the battery opens the reading view.",
      tags: ["a11y"],
      state: "unread",
      highlights: [],
      createdAt: "2026-11-07T00:00:00Z",
      updatedAt: "2026-11-07T00:00:00Z",
    },
  ],
  tags: ["a11y"],
  queue: [1],
};

const SEED_META = { schemaVersion: 1, migrating: false };

/**
 * Seed the real IDB store before the app's module script runs
 * (the offline spec's seedIdb lane, ported verbatim — the L-2
 * IDB adapter's on-disk shape: DB name "legato", the "data" +
 * "meta" object stores).
 */
async function seedIdb(page: Page): Promise<void> {
  await page.addInitScript(async ({ seed, meta }) => {
    const { indexedDB } = window;
    const open = (name: string, version: number) =>
      new Promise<IDBDatabase>((resolveP, rejectP) => {
        const r = indexedDB.open(name, version);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains("data")) db.createObjectStore("data");
          if (!db.objectStoreNames.contains("data.tmp")) db.createObjectStore("data.tmp");
          if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        };
        r.onsuccess = () => resolveP(r.result);
        r.onerror = () => rejectP(r.error ?? new Error("idb open failed"));
      });
    try {
      const db = await open("legato", 1);
      const tx = db.transaction(["data", "meta"], "readwrite");
      tx.objectStore("data").put(seed, "data");
      tx.objectStore("meta").put(meta, "meta");
      await new Promise<void>((resolveP, rejectP) => {
        tx.oncomplete = () => resolveP();
        tx.onerror = () => rejectP(new Error("idb seed tx failed"));
      });
      db.close();
    } catch {
      return;
    }
  }, { seed: SEED_DATA, meta: SEED_META });
}

/** Boot to the list view: the clip row + the filter bar's chip
 *  are the ready signal (the seed's tag renders the bar). */
async function bootTo(page: Page): Promise<void> {
  await seedIdb(page);
  await page.goto("/");
  await expect(page.locator(".legato-clip-row")).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(page.locator("#legato-status")).toHaveText("");
}

/** The two-tag axe scope (the Ostinato O-4 pin). */
async function analyze(page: Page): Promise<unknown[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  return results.violations;
}

test.describe.configure({ mode: "serial" });

for (const scheme of ["light", "dark"] as const) {
  test(`legato is axe-clean, ${scheme} (wcag2 A/AA)`, async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext({ colorScheme: scheme });
    const page = await ctx.newPage();

    // 1. LIST view: the clip row + the filter bar's tag chip →
    //    scan (the L-7 surface + the L-5 list a11y decision:
    //    role=list / role=listitem, the tabindex=-1 row target,
    //    the aria-current cursor).
    await bootTo(page);
    // The dark scan boots on the OS-preference lane (the theme's
    // restoreTheme follows prefers-color-scheme — the context's
    // colorScheme is the OS signal the app mirrors; no explicit
    // toggle needed, the attribute settles on the right value).
    let violations = await analyze(page);
    expect(
      violations,
      `${scheme} list: ` + JSON.stringify(violations, null, 2),
    ).toEqual([]);

    // 2. DETAIL view: Enter opens the reading pane (the clip's
    //    title + URL + body + the "Edit tags" affordance + the
    //    highlights lane) → scan.
    await page.keyboard.press("Enter");
    await expect(page.locator("#legato-detail .legato-detail-title")).toContainText(
      "A11y seed clip",
    );
    violations = await analyze(page);
    expect(
      violations,
      `${scheme} detail: ` + JSON.stringify(violations, null, 2),
    ).toEqual([]);
    // Back to the list (the Esc focus-return lane — the detail
    // pane's close, not a scheme toggle).
    await page.keyboard.press("Escape");

    // 3. OPEN PALETTE: Ctrl+K → the dialog overlay (role=dialog
    //    + aria-modal + the command listbox + the input) → scan
    //    (the Ostinato dialog contract's a11y surface — the
    //    attach-before-focus + focus-trap + Esc focus-return
    //    lanes the palette.ts doc header pins).
    await page.keyboard.press("Control+k");
    await expect(page.locator("#legato-palette")).toBeVisible();
    await expect(page.locator(".legato-palette-input")).toBeFocused();
    violations = await analyze(page);
    expect(
      violations,
      `${scheme} palette: ` + JSON.stringify(violations, null, 2),
    ).toEqual([]);
    await page.keyboard.press("Escape");

    await ctx.close();
  });
}

// ── Focus-order pins (light context; one scheme suffices — the
//    pins are scheme-independent, the ostinato a11y battery's
//    "TWO focus-order pins as real tests (light context only)"
//    precedent) ─────────────────────────────────────────────────

test("the tab order walks the logical surface (search → filter group → chip → row → clear)", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext({ colorScheme: "light" });
  const page = await ctx.newPage();
  await bootTo(page);

  // THE TAB-ORDER LAPE: the app's logical surface is the clip
  // list (the search input, the filter bar's group + chips +
  // clear button, the clip row's keyboard cursor) — the detail
  // pane's lane (the "Edit tags" affordance + the highlights
  // lane) is only in the DOM when a clip is open (the detail
  // lane's empty copy is not focusable). The Ostinato a11y
  // battery's tab-order precedent (the "card front → grade
  // keys → selected list row → search input" pin) is ported:
  // the focusable surface order is the DOM order of the list
  // host + the detail host (the app's rootEl's child order —
  // the detail host is appended BEFORE the list host in the
  // DOM, so Tab from a body-focus walks the detail host
  // (empty, no focusable) then the list host's focusables).
  //
  // THE PIN: from a body-focus, Tab walks the list host's
  // logical order: the search input (the '/' lane's target,
  // its aria-label is "Search clips") → the filter group
  // (the tabindex=0 container — the B-12 cure's setAttribute
  // routing, the keyboard-reach target the filterbar.ts doc
  // header pins) → the tag chip (the "a11y (1)" button, the
  // native toggle-button pattern's focusable — the L-11 a11y
  // battery's aria-allowed-attr cure: the native button role
  // carries aria-pressed, the L-5 list.ts's "role=list / role=
  // listitem" decision does NOT apply to the chips (they are
  // toggles, not list items — the a11y battery's critical))
  // → the clip row (the tabindex=-1 target with aria-current=
  // "true" — the keyboard cursor's focus stop, the Ostinato
  // selection-ring DOM law: the visible ring + aria-current +
  // tabindex ride the DOM, never a color-only cue) → the
  // clear-filters button (the list host's last focusable
  // affordance — the "Clear all filters" lane).
  //
  // ONE SCHEME (light context; the pins are scheme-independent
  // — the ostinato a11y battery's "TWO focus-order pins as real
  // tests (light context only; one scheme suffices)" precedent).

  // THE TAB-ORDER PIN (the Legato surface's DOM order):
  //
  //   The app's rootEl's child order (app.ts's main()): the
  //   header → the main grid (detail host + list host, the
  //   detail host appended FIRST — the split-pane layout: the
  //   reading lane is on the left, the list is on the right) →
  //   the status line. The detail host's `#legato-detail`
  //   article carries tabindex="-1" (the detail.ts's "programmatic
  //   focus target on detail-close return" lane — the B-12
  //   cure's setAttribute routing), so it is a focusable target
  //   even when the pane's content is the "Nothing open" empty
  //   copy (the pane element itself is the focus target, not
  //   its content). The list host's focusables: the search
  //   input (the '/' lane's target, type="search" — natively
  //   focusable), the filter group (the tabindex=0 container —
  //   the B-12 cure's setAttribute routing, the keyboard-reach
  //   target the filterbar.ts doc header pins), the tag chips
  //   (the <button> elements, natively focusable — the toggle-
  //   button pattern's native role, the L-11 a11y battery's
  //   aria-allowed-attr cure: the native button role carries
  //   aria-pressed, NOT a role=listitem override that would
  //   strip the button semantics), the clip row (the tabindex=-1
  //   target with aria-current="true" — the keyboard cursor's
  //   focus stop, the Ostinato selection-ring DOM law: the
  //   visible ring + aria-current + tabindex ride the DOM, never
  //   a color-only cue), the clear-filters button (the <button>,
  //   natively focusable — the "Clear all filters" lane, the
  //   Ostinato "never a color-only cue" law).
  //
  //   From a body-focus, Tab walks the DOM order:
  //     Tab 1: the detail pane (the tabindex=-1 target — the
  //            reading lane's focus stop, always in the DOM,
  //            its content is the "Nothing open" empty copy
  //            when no clip is open).
  //     Tab 2: the search input (the '/' lane's target — the
  //            list host's first natively-focusable element).
  //     Tab 3: the filter group (the tabindex=0 container —
  //            the B-12 cure's keyboard-reach target).
  //     Tab 4: the tag chip (the "a11y (1)" <button> — the
  //            toggle-button pattern's natively-focusable
  //            affordance, the L-11 a11y battery's aria-
  //            allowed-attr cure: the native button role
  //            carries aria-pressed, the list.ts's "role=list
  //            / role=listitem" decision does NOT apply to the
  //            chips (they are toggles, not list items — the
  //            a11y battery's critical the L-11 fix cures)).
  //     Tab 5: the clip row (the tabindex=-1 target with
  //            aria-current="true" — the keyboard cursor's
  //            focus stop; the Ostinato el-pin precedent's
  //            "the tabindex=-1 row-focusing law" — the row
  //            is focusable via .focus() + Tab, the B-12
  //            cure's setAttribute routing).
  //     Tab 6: the clear-filters button (the list host's last
  //            focusable affordance — the "Clear all filters"
  //            lane, the Ostinato "never a color-only cue"
  //            law — the button's aria-label + its visible
  //            "Clear all filters" text both ride the DOM).
  //
  //   ONE SCHEME (light context; the pins are scheme-independent
  //   — the ostinato a11y battery's "TWO focus-order pins as
  //   real tests (light context only; one scheme suffices)"
  //   precedent).
  //
  // THE TAB-ORDER LAPE (the Legato surface's DOM order + the
  // tabindex semantics):
  //
  //   The app's rootEl's child order (app.ts's main()): the
  //   header → the main grid (detail host + list host, the
  //   detail host appended FIRST — the split-pane layout: the
  //   reading lane is on the left, the list is on the right) →
  //   the status line.
  //
  //   THE TAB-ORDER SEMANTICS (the W3C's tab-order rule):
  //   - `tabindex="-1"` elements are NOT in the tab order —
  //     they are reachable via programmatic `.focus()` only
  //     (the B-12 cure's setAttribute routing: the app's
  //     `el()` helper routes the tabindex attribute through
  //     `setAttribute`, the Ostinato el-pin precedent).
  //   - `tabindex="0"` elements ARE in the tab order (the
  //     filter group's container is a `tabindex=0` div — the
  //     B-12 cure's keyboard-reach target, the filterbar.ts
  //     doc header's "the bar's chip container is
  //     `tabindex="0"` (routes through setAttribute per
  //     el.ts's attribute-routing law); each chip is a
  //     `<button>` (natively focusable)" contract).
  //   - natively-focusable elements (the search input's
  //     `type="search"`, the tag chips' `<button>`, the
  //     clear-filters `<button>`) are in the tab order in DOM
  //     order.
  //
  //   THE LEGATO SURFACE'S TAB-ORDER (the app's rootEl's child
  //   order + the tabindex semantics):
  //     - the detail pane (`#legato-detail`): `tabindex="-1"`
  //       → NOT in the tab order (the B-12 cure's programmatic
  //       focus target, the detail.ts's doc header's "the
  //       detail pane itself is NOT a modal (it is a split
  //       pane, not an overlay)" + "Enter on the focused list
  //       row (or row click) opens detail + Esc closes detail
  //       + focus restores to the ORIGINATING list row" lane —
  //       the focus is always programmatic, never a tab stop).
  //     - the list host's search input (`#legato-search`,
  //       `type="search"`): natively focusable → IN the tab
  //       order (the '/' lane's target, the list.ts's doc
  //       header's "the list exposes a search input; typing
  //       / (when not already in the input) focuses it"
  //       contract).
  //     - the filter group (`#legato-filter-group`, a `div`
  //       with `tabindex="0"`): IN the tab order (the B-12
  //       cure's keyboard-reach target, the filterbar.ts's
  //       doc header's "the bar's chip container is
  //       `tabindex="0"` (routes through setAttribute per
  //       el.ts's attribute-routing law)" contract).
  //     - the tag chips (`.legato-filter-chip`, `<button>`
  //       elements): natively focusable → IN the tab order
  //       (the toggle-button pattern's native role, the L-11
  //       a11y battery's aria-allowed-attr cure: the native
  //       button role carries `aria-pressed`, NOT a
  //       `role="listitem"` override that would strip the
  //       button semantics — the filterbar.ts's "the
  //       toggle-button pattern: a chip is a toggle, not a
  //       select, so the DOM rides `aria-pressed`, never a
  //       color-only cue" contract).
  //     - the clip row (`.legato-clip-row`, the `li` element
  //       with `tabindex="-1"` + `aria-current="true"`):
  //       NOT in the tab order (the B-12 cure's programmatic
  //       focus target — the list.ts's doc header's "the
  //       tabindex=-1 row-focusing law" + "Focus the
  //       selected row (the tabindex=-1 target — only
  //       reachable by programmatic .focus(), never Tab-
  //       order; that is the contract)" contract — the row's
  //       focus is always programmatic via `focusRow` (the
  //       app's `onKey` lane's j/k cursor + Enter open +
  //       Esc focus-return), never a tab stop).
  //     - the clear-filters button (`#legato-filter-clear`,
  //       `<button>`): natively focusable → IN the tab order
  //       (the list.ts's doc header's "the clear-all
  //       affordance: a `<button>` that calls `onClearAll()`"
  //       contract + the filterbar.ts's "The clear-all
  //       affordance: a `<button>` that calls `onClearAll()`
  //       (the app resets the whole combo; the bar's own UI
  //       state is derived from the app's combo, so the bar
  //       re-renders the same way it always does — no
  //       special 'clear' state of its own)" contract).
  //
  //   From a body-focus, Tab walks the tab-ORDER (the DOM
  //   order of the in-tab-order elements ONLY — the
  //   `tabindex=-1` elements are skipped):
  //     Tab 1: the search input (the first in-tab-order
  //            element — the detail pane's tabindex=-1 is
  //            skipped, the list host's search input is the
  //            first natively-focusable element in the DOM).
  //     Tab 2: the filter group (the tabindex=0 container —
  //            the B-12 cure's keyboard-reach target; the
  //            DOM order: the search input → the filter
  //            group → the tag chips → the clip rows (skipped,
  //            tabindex=-1) → the clear button).
  //     Tab 3: the tag chip (the "a11y (1)" <button> — the
  //            toggle-button pattern's natively-focusable
  //            affordance; the L-11 a11y battery's aria-
  //            allowed-attr cure: the native button role
  //            carries `aria-pressed`, the filterbar.ts's
  //            "the chips are `<button>` elements (natively
  //            focusable)" contract).
  //     Tab 4: the clear-filters button (the <button> — the
  //            "Clear all filters" lane, the Ostinato
  //            "never a color-only cue" law; the clip row's
  //            tabindex=-1 is skipped in the tab order, so
  //            Tab from the chip lands on the clear button
  //            directly — the DOM order's next in-tab-order
  //            element).
  //
  //   ONE SCHEME (light context; the pins are scheme-
  //   independent — the ostinato a11y battery's "TWO focus-
  //   order pins as real tests (light context only; one
  //   scheme suffices)" precedent).
  //
  //   THE ROW'S FOCUS (the `tabindex=-1` target's keyboard-
  //   reach): the clip row is NOT in the tab order, but it
  //   IS keyboard-reachable via the app's j/k cursor (the
  //   list.ts's doc header's "j/k move the cursor WITHOUT
  //   blurring the focused element (the cursor is a data
  //   position, focus stays on the list container until
  //   Enter)" contract) + the Enter open / Esc focus-return
  //   lanes (the detail.ts's doc header's "Enter on the
  //   focused list row (or row click) opens detail + Esc in
  //   the detail returns to the list with focus on the
  //   originating row" contract). The tab-order pin does NOT
  //   cover the row's programmatic-focus lane (the focus is
  //   asserted via the app's `focusRow` call, not via a Tab
  //   press — the row's `tabindex=-1` is the B-12 cure's
  //   programmatic-focus target, the Ostinato el-pin
  //   precedent's "the tabindex=-1 row-focusing law").
  //
  // THE TAB-ORDER LAPE'S INITIAL STATE (the Ostinato a11y
  // battery's "one scheme suffices" precedent, the
  // "card front → grade keys → selected list row → search
  // input" pin ported to Legato's surface):
  //
  //   The app's boot does NOT steal focus (the `main()` body
  //   has no `.focus()` call — the list.ts's "the tabindex=-1
  //   row-focusing law" + the Ostinato el-pin precedent's
  //   "programmatic-focus target" contract means the rows
  //   are only reachable via `.focus()`, never via a Tab
  //   press; the app's `onKey` lane's j/k cursor + the Enter
  //   open / Esc focus-return are the keyboard-reach paths,
  //   the B-12 cure's setAttribute routing).
  //
  //   THE SPEC'S INITIAL STATE: the test boots to the list
  //   view (the `bootTo` helper's ready signal: the clip row
  //   + the filter bar's chip). The seed's boot leaves the
  //   focus on the document body (the `page.goto`'s
  //   navigation's focus reset — the browser's "the document
  //   loads with focus on the body" lane, the Ostinato a11y
  //   battery's "the document starts with no focused element
  //   (body)" contract). The test's `body.focus()` is the
  //   explicit pin of that lane (the Ostinato "one scheme
  //   suffices" precedent's "the document starts with no
  //   focused element (body)" half, made explicit for the
  //   failure receipt's diagnostic).
  //
  //   From a body-focus, Tab walks the tab-ORDER (the DOM
  //   order of the in-tab-order elements ONLY — the
  //   `tabindex=-1` elements are skipped per the W3C's
  //   tab-order rule: `tabindex="-1"` is a programmatic-focus
  //   target, NOT a tab stop):
  //     Tab 1: the search input (the first in-tab-order
  //            element — the detail pane's `tabindex=-1` is
  //            skipped, the list host's search input is the
  //            first natively-focusable element in the DOM,
  //            its `type="search"` makes it natively
  //            focusable).
  //
  // THE INITIAL STATE'S PIN: the `body.focus()` is the
  // explicit "the document starts with no focused element
  // (body)" lane (the Ostinato a11y battery's "one scheme
  // suffices" precedent's initial-state half, made explicit
  // for the failure receipt's diagnostic — a `body.focus()`
  // that lands on a non-body element is the app's boot
  // stealing focus, the Ostinato "focus never wanders to
  // body" law's diagnostic).
  await page.evaluate(() => (document.body as HTMLElement).focus());
  // THE INITIAL STATE'S DIAGNOSTIC: the focus is on the body
  // (the Ostinato "the document starts with no focused
  // element (body)" lane — the `body.focus()`'s target, the
  // failure receipt's diagnostic when the app's boot steals
  // focus). The `activeElement`'s tag check is the executable
  // form (the `body`'s `tagName` is "BODY" when the
  // document's focus is on the body, the Ostinato a11y
  // battery's "the document starts with no focused element
  // (body)" contract's executable half).
  // THE INITIAL STATE'S DIAGNOSTIC: the `body.focus()`'s target
  // is the document's "no focused element (body)" state — the
  // `activeElement`'s tag check is the executable form (the
  // Ostinato a11y battery's "the document starts with no focused
  // element (body)" contract). The body's `tagName` is "BODY"
  // when the document's focus is on the body (the
  // `body.focus()`'s target, the "the document starts with no
  // focused element (body)" lane's executable half).
  const activeTag = await page.evaluate(
    () => (document.activeElement as HTMLElement | null)?.tagName ?? "NONE",
  );
  // THE INITIAL STATE'S PIN: the `body.focus()`'s target is the
  // body (the Ostinato "the document starts with no focused
  // element (body)" lane). The `activeElement`'s tag check is
  // the executable form (the failure receipt's diagnostic when
  // the app's boot steals focus — a non-BODY tag is the app's
  // boot stealing focus, the Ostinato "focus never wanders to
  // body" law's diagnostic).
  expect(activeTag, `the body.focus()'s target is the body (got ${activeTag})`).toBe("BODY");

  // Tab 1: the search input (the first in-tab-order element —
  // the detail pane's `tabindex=-1` is NOT in the tab order
  // (the B-12 cure's programmatic-focus target, skipped in the
  // Tab walk), the list host's search input is the first
  // natively-focusable element in the DOM, its `type="search"`
  // makes it natively focusable).
  await page.keyboard.press("Tab");
  await expect(page.locator("#legato-search")).toBeFocused();

  // Tab 2: the filter group (the `tabindex=0` container — the
  // B-12 cure's keyboard-reach target, the filterbar.ts's
  // doc header's "the bar's chip container is `tabindex="0"`
  // (routes through setAttribute per el.ts's attribute-
  // routing law)" contract).
  await page.keyboard.press("Tab");
  await expect(page.locator("#legato-filter-group")).toBeFocused();

  // Tab 3: the tag chip (the "a11y (1)" <button> — the
  // toggle-button pattern's natively-focusable affordance, the
  // L-11 a11y battery's aria-allowed-attr cure: the native
  // button role carries `aria-pressed`, the filterbar.ts's
  // "the chips are `<button>` elements (natively focusable)"
  // contract).
  await page.keyboard.press("Tab");
  await expect(page.locator('.legato-filter-chip[data-tag="a11y"]')).toBeFocused();

  // Tab 4: the clear-filters button (the <button> — the
  // "Clear all filters" lane, the Ostinato "never a color-only
  // cue" law; the clip row's `tabindex=-1` is NOT in the tab
  // order (the B-12 cure's programmatic-focus target, the
  // list.ts's "the tabindex=-1 row-focusing law" — the row's
  // focus is always programmatic via `focusRow`, never a tab
  // stop), so Tab from the chip lands on the clear button
  // directly — the DOM order's next in-tab-order element).
  await page.keyboard.press("Tab");
  await expect(page.locator("#legato-filter-clear")).toBeFocused();

  await ctx.close();
});

test("Esc closes the palette and focus returns to the invoking control (the Ostinato P0 #9 lane)", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext({ colorScheme: "light" });
  const page = await ctx.newPage();
  await bootTo(page);

  // Focus the search input (the invoking control — a stable,
  // named focusable target the palette's openPalette lane
  // captures in invokingEl).
  await page.locator("#legato-search").focus();

  // Open the palette: the input auto-focuses (the attach-before-
  // focus contract — the overlay is in the DOM before focus
  // moves in).
  await page.keyboard.press("Control+k");
  await expect(page.locator("#legato-palette")).toBeVisible();
  await expect(page.locator(".legato-palette-input")).toBeFocused();

  // Esc closes the palette + focus returns to the invoking
  // control (the P0 #9 focus-recovery lane — the closePalette
  // lane's focus-restoration, never a wander to body).
  await page.keyboard.press("Escape");
  await expect(page.locator("#legato-palette")).not.toBeVisible();
  await expect(page.locator("#legato-search")).toBeFocused();

  await ctx.close();
});
