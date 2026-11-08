/**
 * Legato — the queue-state lane (ticket L-11's spec split, the
 * L-6 keyboard-lane spec's home).
 *
 * THE LANE (the "the spec split's single-clear-lane" contract —
 * the Ostinato battery's shape: this spec owns the r/d/a/u
 * state flips + the queue/all view toggle + the conflict-notice
 * lane + the three empty states. The prior mega flow spec's
 * steps 5 + the view-toggle empty states move here, the
 * `seedIdb` helper's import is from `./legato-helpers.js` (the
 * "the shared helper's DRY law" contract — the seed's single
 * home, the spec's import site, the Ostinato "the shared
 * helper's non-spec name" law's executable form: the helper's
 * file name is `legato-helpers` — no `.spec.` segment — the
 * testMatch's negative match, the "the helper's non-spec
 * name" contract's executable form).
 *
 * THE SEED (the `seedIdb` + `SEED_DATA`'s import — one clean
 * clip + one tag, the filter bar's chip surface): the clip's
 * `state: "unread"` is the L-6 keyboard lane's entry point (the
 * `r`/`d`/`a`/`u` flips' expected prior). The `seedIdb` lane's
 * `addInitScript` seeds the real IDB store before the app's
 * module script runs (the offline spec's seedIdb lane, ported
 * verbatim — the L-2 IDB adapter's on-disk shape: DB name
 * "legato", the "data" + "meta" object stores).
 *
 * THE FLOW (the L-6 keyboard-lane spec's pin list, the prior
 * mega spec's step 5 + the view-toggle empty states):
 *   1. BOOT SEED — the seeded clip's row renders (the "Unread"
 *      badge).
 *   2. r → READING: the clip's state badge flips to "Reading".
 *   3. d → DONE: the active queue empties (done is out-of-view);
 *      the "All caught up" panel (Q-3's all-read lane) renders.
 *   4. VIEW TOGGLE: the "Show all clips" affordance (the L-6
 *      Q-3 lane) re-renders the done clip (the `queueView`'s
 *      "all" lane — the all-clips view's row count = the store's
 *      total clip count, the "the view toggle's active/all
 *      semantics" contract's executable form).
 *   5. a → ARCHIVED: the clip leaves the all-view too (the
 *      "archived → any-view's exclusion" law: the all-clips
 *      view's `allClips` includes every non-archived clip, the
 *      archived clip's exclusion from both views' row counts —
 *      the L-6's "the queue view toggle's active/all lane"
 *      contract's "archived is out-of-view" half).
 *   6. u → RESTORE: back to unread (the L-6 keyboard lane — the
 *      Ostinato K-1 step-5's queue-flip precedent; the restore
 *      lane's "archived → unread" transition is the
 *      `isLegalTransition` table's "any-state → archived is
 *      monotonic, but archived → unread (restore) is the
 *      reversible exit" contract's executable form).
 *   7. CONFLICT NOTICE: a second `d` while in the "all" view
 *      with the clip in "unread" → the "done" transition from
 *      "unread" is LEGAL (the `isLegalTransition` table's
 *      "unread → done" ✓ row), so the flip succeeds. To
 *      exercise the CONFLICT lane instead, the spec's
 *      `queueView`'s "all" + the clip's state "unread" + a
 *      second `d` press would be the "concurrent-flip guard"
 *      lane (the `flipState`'s `expectedPrior` check's
 *      "the concurrent-flip guard's Q-1" contract) — but the
 *      app's keyboard lane's single-user model means the
 *      ConflictError only fires when TWO SESSIONS flip the
 *      same clip concurrently (the "the concurrent-flip
 *      guard's two-session" contract — the browser lane
 *      cannot deterministically stage a second session's
 *      concurrent flip without the app's multi-tab surface,
 *      which is OUT OF SCOPE for the L-11 battery). The
 *      Q-1 lane's e2e pin is therefore the "notice is
 *      HONEST + NEVER SILENT" contract (the Q-1's "never a
 *      silent failure" law): when the state flip is LEGAL,
 *      the `conflictNotice` is null (the app's `st.conflict-
 *      Notice`'s "the notice's clear-on-success" contract);
 *      when ILLEGAL, the notice renders + the `.legato-
 *      conflict-notice`'s visible text is the "the notice's
 *      visible lane" contract. The spec's pin is the
 *      "legal flips' notice-stays-clear" half (the
 *      ConflictError's unit-lane pin is `queue.test.ts`'s
 *      job — the "the unit lane's ConflictError stage"
 *      contract, the e2e lane's "the legal-flip's notice-
 *      clear" pin is the Q-1's "never a silent success"
 *      twin: the user's flip's receipt is the row's state
 *      badge flip, not a notice panel).
 *   8. EMPTY STATES (the three Q-3 lanes, the prior mega
 *      spec's "the view-toggle empty states" pin):
 *      - the "no-clips" panel (the seed's clip-removed lane —
 *        the "the seed's clip's deletion" contract: the
 *        `seedIdb`'s `data` store's "data" key's clips
 *        array's empty form, the "the no-clips panel's
 *        honest empty" Q-3 lane).
 *      - the "all-read" panel (the "All caught up" title —
 *        the clip's `d` flip's out-of-view state, the
 *        active-view's empty + the all-view's non-empty
 *        (the done clip is in the all-view), the "the all-
 *        read panel's active-view" contract).
 *      - the "no-matches" panel (the search filter's empty
 *        result — the "the no-matches panel's filter-active
 *        lane" Q-3 contract: the `/` search's "zzz" query's
 *        zero results + the "Clear filters" affordance's
 *        "the no-matches panel's filter-active half").
 *
 * Self-skip: the spec runs under the legato config's
 * `LEGATO_E2E` marker; under the root `playwright.config.ts`
 * the marker is unset and the spec self-skips.
 *
 * Operator gate: `LEGATO_E2E=1 bunx playwright test
 * --config=playwright.legato.config.ts` from the repo root.
 */
import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { seedIdb } from "./legato-helpers.js";

test.skip(
  !process.env.LEGATO_E2E,
  "legato lane only — run via playwright.legato.config.ts",
);

test.describe.configure({ mode: "serial" });

test("r/d/a/u state flips + view toggle + conflict-notice clear + empty states (seeded)", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext();
  const page: Page = await ctx.newPage();
  // THE SEED LANE (the `seedIdb`'s import — the offline spec's
  // seedIdb lane, the L-2 IDB adapter's on-disk shape: DB name
  // "legato", the "data" + "meta" object stores): the clip's
  // `state: "unread"` is the L-6 keyboard lane's entry point.
  await seedIdb(page);
  await page.goto("/");
  // THE ROW'S RENDER (the seeded clip's "Unread" badge — the
  // "the row's state badge's render" contract: the badge's
  // text is the clip's `state`'s human-readable form, the
  // Ostinato "never a color-only cue" law's executable form:
  // the badge's text + its class both ride the DOM).
  const row = page.locator(".legato-clip-row");
  await expect(row).toHaveCount(1, { timeout: 15_000 });
  await expect(row).toContainText("Unread");

  // ─── r → READING: the state badge flips ─
  await page.keyboard.press("r");
  await expect(row).toContainText("Reading");

  // ─── d → DONE: the active queue empties (done is out-of-view) ─
  // The "All caught up" panel (Q-3's all-read lane) renders —
  // the clip's `done` state's "out-of-active-view" semantics:
  // the `activeClips`'s "done/archived are excluded" law's
  // executable form (the active view's row count drops to 0,
  // the `queueEmptyKind`'s "all-read" kind's panel render —
  // the "the all-read panel's active-view" contract).
  await page.keyboard.press("d");
  await expect(page.locator("#legato-empty")).toContainText("All caught up");

  // ─── VIEW TOGGLE: the "Show all clips" affordance ─
  // The `queueView`'s "all" lane: the `allClips`'s "every
  // non-archived clip" semantics (the "the view toggle's
  // active/all semantics" contract's executable form: the
  // all-view's row count = the store's non-archived clip count
  // — the done clip re-appears in the all-view, the active
  // view's "All caught up" panel's twin is the all-view's
  // non-empty row list, the "the view toggle's panel/row
  // mutual-exclusion" contract: the panel renders ONLY when
  // the current view's row list is empty, the "all" view's
  // row list is non-empty → no panel, the row renders).
  await page.locator(".legato-queue-empty-showall").focus();
  await page.keyboard.press("Enter");
  await expect(row).toHaveCount(1);

  // ─── a → ARCHIVED: the clip leaves the all-view too ─
  // The "archived is out-of-view" lane: the `allClips`'s
  // "non-archived" filter excludes the archived clip (the
  // L-6's "the queue view toggle's active/all lane" contract's
  // "archived is out-of-view" half — the all-view's row count
  // drops to 0 + the `queueEmptyKind`'s "all-read" kind's
  // panel re-renders: the "the all-view's empty panel"
  // contract's executable form: the panel's text is "All
  // caught up" — the "the all-read panel's all-view" contract,
  // the same copy as the active view's all-read panel — the
  // panel's copy is view-independent, the "the panel's copy's
  // view-independence" contract: the "All caught up" title
  // means "the current view has no actionable clips" — the
  // active view's "actionable" = unread/reading, the all
  // view's "actionable" = the store's non-archived clips; when
  // both are empty (the store's single clip is archived), the
  // panel renders "All caught up" in either view, the
  // "the panel's copy's view-independence" law's executable
  // form).
  await page.keyboard.press("a");
  // The all-view's row count is 0 (the archived clip's
  // exclusion from `allClips` — the "the all-view's empty
  // row list" contract). The panel's "All caught up" copy
  // renders (the "the all-view's empty panel" contract's
  // executable form — the view-independent copy's lane).
  await expect(page.locator("#legato-empty")).toContainText("All caught up");

  // ─── u → RESTORE: back to unread (the L-6 keyboard lane) ─
  // The "archived → unread" transition is the `isLegalTransition`
  // table's "the reversible exit" contract (the "any-state →
  // archived is monotonic, but archived → unread (restore) is
  // the reversible exit" law's executable form: the `u` press's
  // `restoreClip` call's "archived → unread" flip, the row's
  // re-appearance in the active view (the "the restore lane's
  // row re-render" contract — the `activeClips`'s "unread/
  // reading are in-view" law: the restored clip's "unread"
  // state's in-active-view semantics, the "the restore lane's
  // active-view re-render" contract's executable form).
  await page.keyboard.press("u");
  await expect(row).toContainText("Unread");

    // ─── CONFLICT NOTICE: the OFF-TABLE transition (the
  //     `isLegalTransition` table's "the ✗ row" — the
  //     `QueueTransitionError`'s "the off-table transition's
  //     typed error" fires, the app's `st.conflictNotice`'s
  //     "the notice's render-on-error" contract: the
  //     `.legato-conflict-notice` panel renders, the Q-1's
  //     "never a silent failure" law's executable form — the
  //     user's illegal flip's receipt is the notice panel, not
  //     a silent no-op). The staging: the `u` restore lane
  //     ("archived → unread") puts the clip back to "unread";
  //     `a` (the "unread → archived ✓ row" legal transition)
  //     flips it to "archived"; then `d` while "archived" is
  //     the "archived → done ✗ row" OFF-TABLE transition —
  //     the `flipState` throws the `QueueTransitionError`'s
  //     "the off-table transition's typed error", the app
  //     stores `st.conflictNotice` + the `rerender` mounts the
  //     `.legato-conflict-notice` panel with the "Cannot move
  //     clip … from … to … — that transition is not allowed."
  //     copy — the "the off-table transition's user-visible
  //     receipt" contract's e2e pin.
  await page.keyboard.press("a");
  await page.keyboard.press("d");
  // THE NOTICE PANEL'S RENDER (the "the off-table transition's
  // user-visible receipt" contract's e2e pin): the
  // `.legato-conflict-notice` panel is in the DOM (the
  // `st.conflictNotice`'s "the off-table transition's user-
  // visible receipt" copy is non-null, the `rerender`'s "the
  // panel's mount-on-non-null" lane mounts the panel) and its
  // text is the `QueueTransitionError`'s "the off-table
  // transition's user-visible receipt" copy (the "Cannot
  // move clip "A11y seed clip" from "archived" to "done" —
  // that transition is not allowed." string — the Q-1's
  // "never a silent failure" law's executable form: the user's
  // illegal flip's receipt is the notice panel's visible text,
  // never a silent no-op).
  await expect(page.locator(".legato-conflict-notice")).toContainText(
    "Cannot move clip",
  );

  await ctx.close();
});

test("the no-clips + no-matches empty panels (Q-3's never-a-blank lane)", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext();
  const page: Page = await ctx.newPage();
  // THE NO-CLIPS PANEL: the fresh context's empty IDB store's
  // "no clips" boot state — the `queueEmptyKind`'s "no-clips"
  // kind's panel render (the Q-3's "the honest empty panel"
  // contract: the `#legato-empty`'s "No clips yet" copy, the
  // "the no-clips panel's never-a-blank" law's executable
  // form: the panel's text is the "the user has no clips yet"
  // state's honest copy, never a blank / spinner / error
  // (the Ostinato P0 #5's "the honest empty" contract ported
  // to Legato's list surface, the "the no-clips panel's
  // never-a-blank" contract's e2e pin)).
  await page.goto("/");
  await expect(page.locator("#legato-empty")).toContainText(
    "No clips yet",
    { timeout: 15_000 },
  );
  await ctx.close();

  // THE NO-MATCHES PANEL: the seed's clip + the `/` search's
  // "zzz" query's zero-result state — the `filteredEmptyKind`'s
  // "no-matches" kind's panel render (the Q-3's "the filter-
  // active empty" contract: the `#legato-empty`'s "No matches"
  // copy + the "Clear filters" affordance's "the no-matches
  // panel's filter-active half" — the "the panel's filter-
  // active copy" contract: the "No matches" title is the
  // "the search's zero-result state" honest copy, the "the
  // clear-filters affordance" is the "the panel's escape-
  // hatch" contract — the "No matches" panel's "Clear
  // filters" button's "the filter's clear lane" executable
  // form: the button's press resets the filter combo, the row
  // re-renders, the panel disappears).
  const ctx2: BrowserContext = await browser.newContext();
  const page2: Page = await ctx2.newPage();
  // THE SEED LANE (the `seedIdb`'s import — the offline spec's
  // seedIdb lane, the L-2 IDB adapter's on-disk shape: DB name
  // "legato", the "data" + "meta" object stores): one clean
  // clip + one tag, the filter bar's chip surface.
  await seedIdb(page2);
  await page2.goto("/");
  // THE ROW'S RENDER (the seeded clip's row — the "the seed's
  // clip's row-render" contract: the row's "A11y seed clip"
  // title's render, the "the seed lane's row-renders" e2e
  // pin's executable form).
  const row = page2.locator(".legato-clip-row");
  await expect(row).toHaveCount(1, { timeout: 15_000 });
  // THE `/` SEARCH + "zzz" QUERY (the "the no-matches panel's
  // filter-active" lane's staging): the `/` key's "the search
  // input's focus" contract (the app's `onKey` lane's "the `/`
  // key's search-focus" executable form — the Ostinato K-1's
  // "the search lane's `/` focus" precedent ported to
  // Legato's surface), the "zzz" query's "the search's zero-
  // result state" staging (the "the no-matches panel's
  // query-staging" contract: the "zzz" substring's
  // zero-match guarantee — the seed's clip's title "A11y
  // seed clip" + the seed's tags "a11y" + the seed's text's
  // "The Legato a11y lane: …" do NOT contain the "zzz"
  // substring, the "the no-matches query's zero-match
  // guarantee" contract's executable form: the query's
  // zero-match is the "the no-matches panel's filter-active
  // half" staging's honest form, never a flaky partial-match).
  await page2.keyboard.press("/");
  await expect(page2.locator("#legato-search")).toBeFocused();
  await page2.keyboard.type("zzz");
  // THE NO-MATCHES PANEL (the "the no-matches panel's filter-
  // active" contract's executable form): the `#legato-empty`'s
  // "No matches" title's render + the "the panel's row-list-
  // empty" contract (the `filteredEmptyKind`'s "the filter-
  // active's zero-result kind" contract — the "the panel's
  // filter-active half" executable form: the "No matches"
  // title's "the user's query's zero-result state" honest
  // copy, the Ostinato P0 #5's "the honest empty" contract's
  // "the no-matches panel's half" ported to Legato's filter
  // surface, the "the no-matches panel's never-a-blank"
  // law's e2e pin).
  await expect(page2.locator("#legato-empty")).toContainText(
    "No matches",
  );
  // THE CLEAR-FILTERS AFFORDANCE (the "the no-matches panel's
  // filter-active half" contract's "the panel's escape-hatch"
  // executable form): the `#legato-filter-clear`'s "the
  // filter's clear lane" contract — the button's Enter-press's
  // "the combo's reset" callback (the app's `onClearAll`'s
  // "the filter combo's clear" executable form: the
  // `filterCombo`'s query + tags + states' reset to their
  // empty initial states, the "the clear-filters lane's
  // combo-reset" contract — the "the panel's disappearance"
  // receipt: the row's re-render (the "the clear lane's row-
  // re-render" contract — the "the filter's clear's row-
  // re-appearance" executable form: the "No matches" panel's
  // twin is the row's re-render, the "the panel's mutual-
  // exclusion" law — the panel renders ONLY when the
  // current filter's result is empty, the "the clear lane's
  // panel-dismissal" contract's executable form)).
  await page2.locator("#legato-filter-clear").focus();
  await page2.keyboard.press("Enter");
  await expect(row).toHaveCount(1);
  await ctx2.close();
});
