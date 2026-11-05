/**
 * R-2 — the deck-settings modal's unit pins (the D command's
 * renderer, D8's modal semantics).
 *
 * Lane semantics (the OSTINATO_E2E self-skip precedent, applied to
 * the unit lane — the el.test.ts pattern):
 *   Lane A — `cd apps/ostinato && bun test`: no `bunfig.toml` inside
 *            the app dir, so no DOM globals exist; this file
 *            registers ONE skipped stub and stays DOM-free by
 *            architecture. The pins' imports are LAZY (inside the
 *            else branch) because app.ts's module bootstrap runs
 *            `main().catch(...)` on load — touching `document` at
 *            module scope, which would throw between tests in a
 *            DOM-free runtime.
 *   Lane B — `bun test apps/ostinato` from the repo root: the root
 *            `bunfig.toml`'s happy-dom preload provides `document`,
 *            so the real pins RUN here.
 *
 * The pins (all through the app's own modal renderer + Esc handler):
 *   1. render: a minimal AppState (boot ready, one deck WITH a cap,
 *      one without) + a no-op rerender → the form lands in
 *      document.body with role=dialog + aria-modal + the h2 title +
 *      the deck select (2 options, first preselected) + the cap
 *      input preloaded with the first deck's cap.
 *   2. select-change: dispatching a change on the select to the
 *      second option reloads the cap input ("" for the uncapped
 *      deck).
 *   3. handleSettingsFormEscape: with unsaved input + no armed
 *      guard → arms the guard ("press Esc again" paints); with the
 *      guard armed → closes (overlay removed, settingsForm null);
 *      with an EMPTY input → closes directly.
 *   4. zero-deck honest empty state: decks: [] → the error lane
 *      shows "No decks yet — create a deck first (N).".
 *
 * The submit lane's persistence is pinned through the domain's own
 * tests + the e2e spec; the unit lane pins the RENDER + KEYBOARD
 * contract only.
 */
import { afterAll, test, expect } from "bun:test";

const hasDom = typeof document !== "undefined";

if (!hasDom) {
  // Lane A (DOM-free by architecture): one skipped stub — the pins
  // run only where a DOM exists (Lane B's happy-dom preload).
  test.skip(
    "settings-modal pin — requires a DOM (Lane B's happy-dom provides it)",
    () => {},
  );
} else {
  /** Build a minimal AppState for the modal renderer + escape handler.
   * settingsForm starts in the OPEN state (the app's keydown lane flips
   * it before renderSettingsForm runs — the executor does it). */
  function makeApp(data: {
    decks: { id: string; name: string; settings?: { newCardsPerSession: number } }[];
    cards: unknown[];
    reviews: unknown[];
  }): unknown {
    return {
      boot: {
        kind: "ready",
        data,
        session: { deckId: data.decks[0]?.id ?? null, cardIds: [], cursor: 0, phase: "front" as const },
      },
      searchQuery: "",
      focusedCardId: null,
      searchInput: null,
      paletteOpen: false,
      paletteQuery: "",
      paletteSelection: 0,
      invokingEl: null,
      onListSurface: false,
      createForm: null,
      settingsForm: { discardArmed: false },
      statsOpen: false,
      createActions: null,
      settingsActions: null,
      notice: null,
    };
  }

  /** Import the app's real renderer + handler + type (lazy — the
   * module bootstrap runs main().catch(...) at import time). */
  async function importApp() {
    const mod = await import("./app.js");
    return mod as {
      renderSettingsForm: (app: unknown, rerender: () => void) => void;
      handleSettingsFormEscape: (app: unknown) => void;
      el: (tag: string, props?: Record<string, string | number | undefined>) => HTMLElement;
    };
  }

  /** Reset the document body between tests (the overlay lives there). */
  function cleanBody(): void {
    document.body.innerHTML = "";
  }

  test("render: two decks (one capped, one not) → dialog + preselected select + loaded cap", async () => {
    const { renderSettingsForm } = await importApp();
    cleanBody();

    const app = makeApp({
      decks: [
        { id: "d1", name: "Alpha", settings: { newCardsPerSession: 3 } },
        { id: "d2", name: "Beta" },
      ],
      cards: [],
      reviews: [],
    }) as never;

    let rerenderCalled = 0;
    renderSettingsForm(app, () => {
      rerenderCalled++;
    });

    // The overlay + form landed in document.body.
    const overlay = document.getElementById("ostinato-settings-overlay");
    expect(overlay).not.toBeNull();

    const form = document.getElementById("ostinato-settings-form") as HTMLElement;
    expect(form).not.toBeNull();
    expect(form.getAttribute("role")).toBe("dialog");
    expect(form.getAttribute("aria-modal")).toBe("true");
    expect(form.getAttribute("aria-labelledby")).toBe("ostinato-settings-title");

    // The h2 title.
    const title = form.querySelector("h2#ostinato-settings-title");
    expect(title?.textContent).toBe("Deck settings");

    // The deck select: 2 options, first preselected.
    const select = form.querySelector("#ostinato-settings-deck") as HTMLSelectElement;
    expect(select).not.toBeNull();
    const options = Array.from(select.querySelectorAll("option"));
    expect(options.length).toBe(2);
    expect(options[0].textContent).toBe("Alpha");
    expect(options[1].textContent).toBe("Beta");
    expect(select.selectedIndex).toBe(0);
    expect(select.value).toBe("d1");

    // The cap input carries the first deck's cap ("3").
    const cap = form.querySelector("#ostinato-settings-cap") as HTMLInputElement;
    expect(cap).not.toBeNull();
    expect(cap.value).toBe("3");
  });

  test("select-change to the second (uncapped) deck → cap input reloads to ''", async () => {
    const { renderSettingsForm } = await importApp();
    cleanBody();

    const app = makeApp({
      decks: [
        { id: "d1", name: "Alpha", settings: { newCardsPerSession: 3 } },
        { id: "d2", name: "Beta" },
      ],
      cards: [],
      reviews: [],
    }) as never;

    renderSettingsForm(app, () => {});

    const form = document.getElementById("ostinato-settings-form") as HTMLElement;
    const select = form.querySelector("#ostinato-settings-deck") as HTMLSelectElement;
    const cap = form.querySelector("#ostinato-settings-cap") as HTMLInputElement;

    // Switch to the second deck (uncapped) and fire the change event.
    select.value = "d2";
    select.dispatchEvent(new Event("change"));

    // The cap input reloaded with the second deck's cap (empty — no
    // settings on d2).
    expect(cap.value).toBe("");
  });

  test("handleSettingsFormEscape: unsaved input + no guard → arms the guard; second Esc closes", async () => {
    const { renderSettingsForm, handleSettingsFormEscape } = await importApp();
    cleanBody();

    const app = makeApp({
      decks: [{ id: "d1", name: "Alpha", settings: { newCardsPerSession: 3 } }],
      cards: [],
      reviews: [],
    }) as never;

    renderSettingsForm(app, () => {});

    const form = document.getElementById("ostinato-settings-form") as HTMLElement;
    const cap = form.querySelector("#ostinato-settings-cap") as HTMLInputElement;
    cap.value = "7"; // unsaved input present

    // (a) First Esc: guard not armed → arm it + paint the message.
    handleSettingsFormEscape(app);
    const guard = form.querySelector(".ostinato-settings-guard") as HTMLParagraphElement;
    expect(guard.textContent).toBe("You have unsaved input — press Esc again to discard.");
    // The form is still open (the overlay is still in the DOM).
    expect(document.getElementById("ostinato-settings-overlay")).not.toBeNull();

    // (b) Second Esc: guard armed → close.
    handleSettingsFormEscape(app);
    expect(document.getElementById("ostinato-settings-overlay")).toBeNull();
  });

  test("handleSettingsFormEscape: empty input → closes directly (no arming)", async () => {
    const { renderSettingsForm, handleSettingsFormEscape } = await importApp();
    cleanBody();

    const app = makeApp({
      decks: [{ id: "d1", name: "Alpha", settings: { newCardsPerSession: 3 } }],
      cards: [],
      reviews: [],
    }) as never;

    renderSettingsForm(app, () => {});

    // The cap input is empty (no unsaved data on this deck's value)
    // — wait, loadCap() runs on mount and d1 HAS a cap of 3. Let us
    // use a deck WITHOUT settings so the input is empty.
    cleanBody();
    const app2 = makeApp({
      decks: [{ id: "d1", name: "Alpha" }],
      cards: [],
      reviews: [],
    }) as never;
    renderSettingsForm(app2, () => {});
    const form2 = document.getElementById("ostinato-settings-form") as HTMLElement;
    const cap2 = form2.querySelector("#ostinato-settings-cap") as HTMLInputElement;
    expect(cap2.value).toBe(""); // confirmed empty

    handleSettingsFormEscape(app2);
    // Closed directly — the overlay is gone.
    expect(document.getElementById("ostinato-settings-overlay")).toBeNull();
  });

  test("zero-deck honest empty state: decks [] → error lane shows the N hint", async () => {
    const { renderSettingsForm } = await importApp();
    cleanBody();

    const app = makeApp({
      decks: [],
      cards: [],
      reviews: [],
    }) as never;

    renderSettingsForm(app, () => {});

    const form = document.getElementById("ostinato-settings-form") as HTMLElement;
    expect(form).not.toBeNull();
    const error = form.querySelector(".ostinato-create-error") as HTMLParagraphElement;
    expect(error.textContent).toBe("No decks yet — create a deck first (N).");
  });

  /** A2H-9 isolation: every pin renders the settings form into the
   * shared happy-dom document.body WITHOUT RTL (and RTL's cleanup does
   * not run in this file), so the overlay + its <h2> title outlive the
   * suite and pollute the one-process battery — the encore Finale's
   * `getByRole("heading", { level: 2 })` then finds this leftover
   * heading alongside its own. Each pin's cleanBody() resets between
   * tests, so this afterAll removes only the residue the LAST pin
   * leaves behind. Lane A (DOM-free) skips it. */
  afterAll(() => {
    document.body.innerHTML = "";
  });
}
