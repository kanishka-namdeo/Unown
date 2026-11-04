/**
 * Ostinato — the UI shell (ticket O-3, P0 #3/#4/#5).
 *
 * The DOM wiring: boot → three states (loading / empty / error) →
 * the review runner screen (front → reveal → grade 1–4 → done) →
 * the command palette (Ctrl+K) → the key surface (Space/Enter
 * reveal, 1–4 grade, j/k/g/G navigate, / search, S skip, R
 * restart). The DOM-free semantics live in `runner-core.ts` +
 * `palette.ts`; this file owns the render + the event plumbing.
 *
 * What is DOM (and therefore lives here, not in the domain):
 *   - `document` / `window` global access
 *   - the localStorage adapter wiring (`createLocalStorageAdapter`)
 *   - the boot state renderers (loading / empty / error)
 *   - the card front/back render + the grade row
 *   - the palette open/close/filter/select/enter
 *   - the key handler (the `key` event → command dispatch)
 *   - the focus ring + the invoking-control return (P0 #9's a11y
 *     lane; O-4's axe battery verifies)
 *
 * What is NOT here (stays in the domain / runner-core):
 *   - the due-queue computation (runner-core's `computeDueQueue`)
 *   - the SM-2 grading math (the domain's `createScheduler`)
 *   - the session state machine (runner-core's `applyEvent`)
 *   - the byte-stable export (io's `exportData`)
 *   - the key → command table (palette.ts's `PALETTE_COMMANDS`)
 */
import type { OstinatoData, Clock, Grade } from "../domain/ports.js";
import { DomainInvariantError } from "../domain/ports.js";
import { createImportExport } from "../domain/io.js";
import { createLocalStorageAdapter } from "../storage/local-storage.js";
import {
  startSession,
  applyEvent,
  saveSession,
  readSession,
  deserializePersistedSession,
  gradeKeyToGrade,
  isRevealKey,
  SESSION_STORAGE_KEY,
  type ReviewSession,
  type SessionCtx,
} from "./runner-core.js";
import {
  PALETTE_BY_ID,
  filterCommands,
  isCommandEnabled,
  COMMAND_KEY_DISPATCH,
  GRADE_COMMAND_ID,
  type PaletteCommand,
} from "./palette.js";
import {
  selectQueuePosition,
  selectQueuePositionWithFilter,
  matchCardInFilter,
  type NavigateCmdId,
} from "./queue-nav.js";

// ─── The app's clock (the injected Clock; the browser edge reads the wall) ──

function appClock(): Clock {
  return () => new Date().toISOString();
}

// ─── The boot state machine (P0 #5: loading / empty / error, never blank) ──

type BootState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: OstinatoData; session: ReviewSession };

type AppState = {
  boot: BootState;
  /** The card/deck filter (the `/` search's query). */
  searchQuery: string;
  /** The focused card's id (the `/` lane's target; j/k/g/G move it, the filter narrows it). */
  focusedCardId: string | null;
  /** The search input's element (for re-focus after the palette). */
  searchInput: HTMLInputElement | null;
  /** The palette's state. */
  paletteOpen: boolean;
  paletteQuery: string;
  paletteSelection: number;
  /** The invoking control (P0 #9: `Esc` returns focus to it). */
  invokingEl: HTMLElement | null;
  /** Whether we're on the list surface (vs the review screen). The / command only applies on the list surface. */
  onListSurface: boolean;
};

// ─── The DOM helpers ──────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { text?: string; html?: string; class?: string; "aria-label"?: string; "aria-selected"?: string; "aria-current"?: string; "aria-controls"?: string; tabindex?: string; id?: string; role?: string; placeholder?: string; accept?: string; type?: string; download?: string; href?: string; [key: `data-${string}`]: string | undefined } = {},
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  const { text, html, class: className, ...rest } = props;
  if (text !== undefined) e.textContent = text;
  if (html !== undefined) e.innerHTML = html;
  if (className !== undefined) e.className = className;
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue;
    if (k.startsWith("data-")) {
      // data-* attrs must land as real attributes (dataset property
      // assignment sets the camelCase property, not the hyphenated
      // attribute the CSS/queries key on).
      e.setAttribute(k, v as string);
    } else {
      (e as any)[k] = v;
    }
  }
  return e;
}

/** A markdown-lite renderer (the O-1/O-2 contract's "markdown source":
 *  the minimum honest subset — bold / italics / code / newlines. A
 *  full renderer is P1; the zero-dep law keeps this dep-free). */
function renderMarkdown(src: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc(src)
    .split("\n")
    .map((line) =>
      line
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*(.+?)\*/g, "$1<em>$2</em>")
        .replace(/`(.+?)`/g, "<code>$1</code>"),
    )
    .join("<br/>");
}

// ─── The main entry (the index.html's module script) ─────────────────────────

export async function main(): Promise<void> {
  const storage = createLocalStorageAdapter(window.localStorage);
  // P0 #6: the crash-recovery pass (an orphaned temp key from an
  // interrupted save is discarded; the committed key is last-good).
  await storage.recover();

  const app: AppState = {
    boot: { kind: "loading" },
    searchQuery: "",
    focusedCardId: null,
    searchInput: null,
    paletteOpen: false,
    paletteQuery: "",
    paletteSelection: 0,
    invokingEl: null,
    onListSurface: false,
  };
  let sessionNotice: string | null = null;

  const io = createImportExport();
  let data: OstinatoData;
  try {
    const loaded = await storage.load();
    if (loaded === null) {
      data = { decks: [], cards: [] }; // first boot: the honest empty state
    } else {
      data = io.importData(JSON.stringify(loaded)); // validate the shape
    }
  } catch (e) {
    app.boot = {
      kind: "error",
      message:
        e instanceof DomainInvariantError
          ? `Stored data is corrupt: ${e.message}`
          : `Failed to load stored data: ${(e as Error).message}`,
    };
    renderBoot(app, () => {}); // surface the error panel, never blank
    return;
  }

  let session: ReviewSession;
  const sessionRaw = readSession(window.localStorage);
  if (sessionRaw === null) {
    session = startSession(data, appClock()(), null);
  } else {
    try {
      session = startSession(data, appClock()(), deserializePersistedSession(sessionRaw));
    } catch {
      session = startSession(data, appClock()(), null);
      sessionNotice = "Stored review session was corrupt; started a fresh one.";
    }
  }
  app.boot = { kind: "ready", data, session };

  const persistAll = () => {
    if (app.boot.kind !== "ready") return;
    void storage.save(app.boot.data, io.exportData(app.boot.data));
    saveSession(window.localStorage, app.boot.session);
  };

  // The data/app group's key-driven actions (export / import / clear).
  const actions = {
    export: () => {
      if (app.boot.kind !== "ready") return;
      const json = io.exportData(app.boot.data);
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "ostinato-export.json";
      a.click();
      URL.revokeObjectURL(a.href);
    },
    import: () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const next = io.importData(await file.text());
          app.boot = {
            kind: "ready",
            data: next,
            session: startSession(next, appClock()(), app.boot.kind === "ready" ? app.boot.session : null),
          };
          persistAll();
          rerender();
        } catch (e) {
          sessionNotice = `Import failed: ${(e as Error).message}`;
          rerender();
        }
      };
      input.click();
    },
    clearSession: () => {
      if (app.boot.kind !== "ready") return;
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      app.boot = { ...app.boot, session: startSession(app.boot.data, appClock()(), null) };
      persistAll();
      rerender();
    },
  };

  function rerender() {
    renderBoot(app, persistAll);
  }

  // The key surface (P0 #3 + P0 #4: the keyboard-first contract).
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    onKey(e, app, actions, rerender);
  });

  renderBoot(app, persistAll);
}

// ─── The key handler (the command dispatch, P0 #3/#4) ────────────────────────

function onKey(
  e: KeyboardEvent,
  app: AppState,
  actions: { export: () => void; import: () => void; clearSession: () => void },
  rerender: () => void,
) {
  // The palette's own keys (when open, the palette owns the event).
  if (app.paletteOpen) {
    if (e.key === "Escape") {
      closePalette(app);
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      movePaletteSelection(app, e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      runSelectedPaletteCommand(app, actions, rerender);
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      app.paletteQuery = app.paletteQuery.slice(0, -1);
      app.paletteSelection = 0;
      rerender();
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      app.paletteQuery += e.key;
      app.paletteSelection = 0;
      rerender();
      return;
    }
    return; // a modal surface: the palette swallows other keys
  }

  // The ctrl/meta modifiers (the data + app groups' keys + the palette).
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === "k") {
      e.preventDefault();
      openPalette(app);
      rerender();
      return;
    }
    if (k === "e") {
      e.preventDefault();
      actions.export();
      return;
    }
    if (k === "o") {
      e.preventDefault();
      actions.import();
      return;
    }
    if (k === "x") {
      e.preventDefault();
      actions.clearSession();
      return;
    }
    return;
  }

  // The command dispatch (the palette.ts's COMMAND_KEY_DISPATCH table —
  // the DOM-free core's key map; the UI routes `e.key` through it).
  const cmdId = COMMAND_KEY_DISPATCH[e.key];
  if (cmdId !== undefined) {
    e.preventDefault();
    dispatchCommand(cmdId, app, actions, rerender);
    return;
  }

  // The reveal + grade keys (the P0 #3's runner surface, owned by
  // the runner-core's `GRADE_KEYS` + `REVEAL_KEYS`, not the
  // palette's dispatch table — the review loop's own keys).
  if (isRevealKey(e.key)) {
    e.preventDefault();
    dispatchCommand("reveal", app, actions, rerender);
    return;
  }
  const grade = gradeKeyToGrade(e.key);
  if (grade !== null) {
    e.preventDefault();
    dispatchCommand(GRADE_COMMAND_ID[grade], app, actions, rerender);
    return;
  }
}

// ─── The command dispatch (every palette command, the P0 #4's rows) ─────────

function dispatchCommand(
  id: string,
  app: AppState,
  actions: { export: () => void; import: () => void; clearSession: () => void },
  rerender: () => void,
) {
  const phase = app.boot.kind === "ready" ? app.boot.session.phase : "done";
  const cmd: PaletteCommand | undefined = PALETTE_BY_ID[id];
  if (cmd && !isCommandEnabled(cmd, phase)) return; // disabled in this phase
  switch (id) {
    case "reveal":
    case "grade-again":
    case "grade-hard":
    case "grade-good":
    case "grade-easy":
    case "skip":
      advanceSession(app, idToEvent(id), rerender);
      return;
    case "restart":
      restartQueue(app);
      rerender();
      return;
    case "next-card":
    case "prev-card":
    case "first-card":
    case "last-card":
      navigateQueue(app, id);
      rerender();
      return;
    case "search":
      focusSearch(app);
      return;
    case "export":
      actions.export();
      return;
    case "import":
      actions.import();
      return;
    case "clear-session":
      actions.clearSession();
      return;
  }
}

function idToEvent(id: string): Parameters<typeof applyEvent>[1] {
  const g = {
    "grade-again": 1,
    "grade-hard": 2,
    "grade-good": 3,
    "grade-easy": 4,
  } as Record<string, Grade>;
  if (id === "reveal") return { type: "reveal" };
  if (id === "skip") return { type: "skip" };
  return { type: "grade", grade: g[id] };
}

// The "every transition persists" rule (P0 #6): the data set + the
// session are written through their storage lanes NOW.
function advanceSession(app: AppState, event: Parameters<typeof applyEvent>[1], rerender: () => void) {
  if (app.boot.kind !== "ready") return;
  const { data, session } = app.boot;
  const result = applyEvent(session, event, { data, clock: appClock() });
  app.boot = { ...app.boot, session: result.session, data: result.data };
  rerender(); // the render's persistAll writes both lanes
}

// The queue navigation (P0 #4's j/k/g/G — the cursor moves WITHOUT
// grading; the card's SM-2 state is untouched, the position
// persists through the storage seam like every other transition).
// Uses the queue-nav module's DOM-free math (the wrap + bounds
// rules the hardening row pins; j/k WRAP, g/G are absolute bounds).
function navigateQueue(app: AppState, id: string) {
  if (app.boot.kind !== "ready") return;
  const s = app.boot.session;
  if (s.phase === "done" || s.cardIds.length === 0) return;
  // On the list surface, the move respects the active search filter
  // (selection survives filtering — the hardening row).
  let nextIndex: number;
  if (app.searchQuery.trim() !== "") {
    const data = app.boot.data; // the narrowed union (ready here)
    const filter = (cardId: string) => {
      const card = data.cards.find((c) => c.id === cardId);
      return card !== undefined && matchCardInFilter(app.searchQuery, card);
    };
    nextIndex = selectQueuePositionWithFilter(s.cardIds, s.index, id as NavigateCmdId, filter);
  } else {
    nextIndex = selectQueuePosition(s.cardIds, s.index, id as NavigateCmdId);
  }
  const current = app.boot.data.cards.find((c) => c.id === s.cardIds[nextIndex]);
  if (!current) return;
  app.focusedCardId = current.id; // the visible selection ring follows the cursor
  app.boot = {
    ...app.boot,
    session: {
      ...s,
      index: nextIndex,
      phase: "front", // navigation resets to the front view
      currentCardId: current.id,
      currentDeckId: current.deckId,
    },
  };
}

function restartQueue(app: AppState) {
  if (app.boot.kind !== "ready") return;
  app.boot = { ...app.boot, session: startSession(app.boot.data, appClock()(), null) };
}

function focusSearch(app: AppState) {
  app.searchInput?.focus();
}

// ─── The palette (Ctrl+K, the filter-as-you-type + arrow/wrap select) ───────

function openPalette(app: AppState) {
  app.paletteOpen = true;
  app.paletteQuery = "";
  app.paletteSelection = 0;
  app.invokingEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function closePalette(app: AppState) {
  app.paletteOpen = false;
  app.paletteQuery = "";
  document.getElementById("ostinato-palette")?.remove();
  // P0 #9: focus returns to the invoking control.
  (app.invokingEl ?? document.body).focus();
  app.invokingEl = null;
}

function movePaletteSelection(app: AppState, dir: 1 | -1) {
  const cmds = filterCommands(app.paletteQuery);
  if (cmds.length === 0) return;
  app.paletteSelection = (((app.paletteSelection + dir) % cmds.length) + cmds.length) % cmds.length;
}

function runSelectedPaletteCommand(
  app: AppState,
  actions: { export: () => void; import: () => void; clearSession: () => void },
  rerender: () => void,
) {
  const cmds = filterCommands(app.paletteQuery);
  const cmd = cmds[app.paletteSelection];
  if (!cmd) return;
  closePalette(app);
  dispatchCommand(cmd.id, app, actions, rerender);
}

// ─── The DOM render (the three boot states + the runner screen + the palette) ─

function renderBoot(app: AppState, persistAll: () => void) {
  const root = document.getElementById("ostinato-root") as HTMLElement;
  root.replaceChildren();

  const header = el("header", { class: "ostinato-header" });
  header.append(
    el("h1", { text: "Ostinato", class: "ostinato-title" }),
    el("span", { text: "Ctrl+K · commands", class: "ostinato-palette-hint" }),
  );
  root.append(header);

  if (app.boot.kind === "loading") {
    root.append(renderLoading());
    return;
  }
  if (app.boot.kind === "error") {
    root.append(renderError(app.boot.message));
    return;
  }

  const { data, session } = app.boot;
  if (data.decks.length === 0) {
    root.append(renderEmpty("No decks yet. Create one to start reviewing."));
    return;
  }
  if (data.cards.length === 0) {
    root.append(renderEmpty("No cards yet. Add one to start reviewing."));
    return;
  }

  root.append(renderReviewScreen(data, session, app, persistAll));

  if (app.paletteOpen) renderPalette(app);
}

function renderLoading(): HTMLElement {
  const d = el("div", { class: "ostinato-state", role: "status" });
  d.append(el("p", { text: "Loading your decks…", class: "ostinato-state-copy" }));
  return d;
}

function renderEmpty(copy: string): HTMLElement {
  const d = el("div", { class: "ostinato-state", role: "status" });
  d.append(el("p", { text: copy, class: "ostinato-state-copy" }));
  return d;
}

function renderError(message: string): HTMLElement {
  const d = el("div", { class: "ostinato-state ostinato-error", role: "alert" });
  d.append(
    el("h2", { text: "Storage error", class: "ostinato-state-title" }),
    el("p", { text: message, class: "ostinato-state-copy" }),
    el("p", {
      text: "Your last good state was kept. Clear the corrupt data to start fresh.",
      class: "ostinato-state-copy",
    }),
  );
  const clear = el("button", { text: "Clear and start fresh", class: "ostinato-action" });
  clear.onclick = () => {
    window.localStorage.removeItem("ostinato.data");
    window.localStorage.removeItem("ostinato.tmp");
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    location.reload();
  };
  d.append(clear);
  return d;
}

function renderReviewScreen(
  data: OstinatoData,
  session: ReviewSession,
  app: AppState,
  persistAll: () => void,
): HTMLElement {
  const wrap = el("div", { class: "ostinato-review" });

  // The queue progress (P0 #3's "the queue advances" — the
  // honest "i of n" + the remaining count).
  const remaining = Math.max(session.cardIds.length - session.index, 0);
  const progress = el("div", {
    class: "ostinato-progress",
    role: "status",
    text:
      session.phase === "done"
        ? "All cards reviewed this session."
        : `${session.index + 1} of ${session.cardIds.length} · ${remaining} remaining`,
  });
  wrap.append(progress);

  const card = data.cards.find((c) => c.id === session.currentCardId);
  if (card) {
    const cardEl = el("article", { class: "ostinato-card" });
    const front = el("div", { class: "ostinato-card-front", html: renderMarkdown(card.front) });
    front.setAttribute("tabindex", "0");
    cardEl.append(front);
    if (session.phase === "revealed") {
      cardEl.append(el("div", { class: "ostinato-card-back", html: renderMarkdown(card.back) }));
    } else {
      // The front-only view: a hint that Space/Enter reveals (the
      // P0 #3's "answer hidden" step, honest copy).
      cardEl.append(
        el("div", { class: "ostinato-card-hint", text: "Press Space or Enter to reveal", role: "note" }),
      );
    }
    // The grade row (the four keys, honest labels — no color-only
    // cues, P0 #9; the visible focus ring is the a11y lane).
    const gradeRow = el("div", {
      class: "ostinato-grade-row",
      role: "group",
      "aria-label": "Grade the card",
    });
    for (const grade of [1, 2, 3, 4] as Grade[]) {
      const b = el("button", {
        text: `${grade} · ${gradeLabel(grade)}`,
        class: "ostinato-grade-key",
      });
      b.onclick = () => {
        advanceSession(app, { type: "grade", grade }, () => renderBoot(app, persistAll));
      };
      gradeRow.append(b);
    }
    cardEl.append(gradeRow);
    wrap.append(cardEl);

    // The card-list surface (P0 #4: j/k/g/G + / + visible selection).
    // The review queue (session.cardIds) shown as a list with a visible
    // selection ring on the current card. The / filter narrows the
    // list live; selection survives the filter (the queue-nav module's
    // filtered-view math).
    const updateList = () => {
      const queue = data.cards
        .filter((c) => session.cardIds.includes(c.id))
        .filter((c) => matchCardInFilter(app.searchQuery, c));
      listEl.replaceChildren();
      if (queue.length === 0) {
        listEl.append(
          el("li", { class: "ostinato-card-row ostinato-card-empty", text: "No cards match this filter" }),
        );
        return;
      }
      for (const c of queue) {
        const li = el("li", { class: "ostinato-card-row", "data-card-id": c.id });
        if (c.id === session.currentCardId || c.id === app.focusedCardId) {
          li.classList.add("ostinato-card-selected");
          li.setAttribute("aria-current", "true");
          li.setAttribute("tabindex", "0");
        }
        li.append(
          el("span", { text: c.front.slice(0, 40), class: "ostinato-card-row-front" }),
          el("span", { text: c.deckId, class: "ostinato-card-row-deck" }),
        );
        listEl.append(li);
      }
    };
    const listEl = el("ol", { class: "ostinato-card-list", role: "list", id: "ostinato-card-list" });
    updateList();
    wrap.append(listEl);

    // The search filter (the `/` lane; the visible focus ring is the
    // P0 #4's "visible selection states" — the input's focus + the
    // filter's result count. The list is narrowed by the active
    // query; an empty query shows the full queue).
    const search = el("input", {
      class: "ostinato-search",
      placeholder: "Search cards ( / )",
      "aria-label": "Search cards",
      "aria-controls": "ostinato-card-list",
    });
    if (app.searchQuery) search.value = app.searchQuery;
    search.oninput = () => {
      app.searchQuery = search.value;
      updateList(); // narrow the list view live
    };
    search.onblur = () => {
      // Focus returns to the card face on blur (P0 #9's focus recovery).
      const focusEl = wrap.querySelector(".ostinato-card-front");
      if (focusEl instanceof HTMLElement) focusEl.focus();
    };
    app.searchInput = search;
    app.onListSurface = true; // the / lane is on the list surface
    wrap.append(search);
  } else {
    // The done state (P0 #3's terminal phase — an honest "all done",
    // not a blank panel).
    wrap.append(
      el("div", {
        class: "ostinato-state",
        text: "Review complete. Press R to restart.",
        role: "status",
      }),
    );
  }

  return wrap;
}

function gradeLabel(grade: Grade): string {
  const labels: Record<Grade, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };
  return labels[grade];
}

// ─── The palette's DOM (the overlay + the filter-as-you-type rows) ───────────

function renderPalette(app: AppState) {
  let overlay = document.getElementById("ostinato-palette");
  if (!overlay) {
    overlay = el("div", { id: "ostinato-palette", class: "ostinato-palette" });
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Command palette");
    document.body.append(overlay);
  }
  const cmds = filterCommands(app.paletteQuery);
  const list = el("ul", { class: "ostinato-palette-list", role: "listbox" });
  let group: string | null = null;
  cmds.forEach((cmd, i) => {
    if (cmd.group !== group) {
      group = cmd.group;
      list.append(el("li", { class: "ostinato-palette-group", text: group, role: "presentation" }));
    }
    const li = el("li", {
      class: `ostinato-palette-row${i === app.paletteSelection ? " ostinato-selected" : ""}`,
      "data-cmd": cmd.id,
      role: "option",
      "aria-selected": i === app.paletteSelection ? "true" : "false",
    });
    li.append(
      el("span", { text: cmd.label, class: "ostinato-palette-label" }),
      el("kbd", { text: cmd.hint, class: "ostinato-palette-hint" }),
    );
    if (!isCommandEnabled(cmd, app.boot.kind === "ready" ? app.boot.session.phase : "done")) {
      li.classList.add("ostinato-disabled");
    }
    list.append(li);
  });
  const input = el("input", {
    class: "ostinato-palette-input",
    "aria-label": "Filter commands",
    value: app.paletteQuery,
  });
  input.oninput = () => {
    app.paletteQuery = input.value;
    app.paletteSelection = 0;
    renderPalette(app);
  };
  overlay.replaceChildren(input, list);
  input.focus();
}

// ─── The bootstrap (the module's own start — P0 #5's boot lane) ──────────
// index.html loads this module as `<script type="module" src="/src/
// ui/app.ts">`; the module DEFINES `main` but nothing called it, so the
// page sat on the "Booting…" placeholder forever (the operator's
// browser-console diagnosis: the module graph loads clean, zero errors,
// no render). The bootstrap runs `main` on load; the catch lane writes
// the failure into the root's status line — never a blank panel.
void main().catch((err) => {
  const el = document.getElementById("ostinato-status");
  if (el) el.textContent = `Boot failed: ${String(err)}`;
});
