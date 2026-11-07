/**
 * app.ts — the Legato UI shell (ticket L-5, PLAN §1.1).
 *
 * Boots against an INJECTED StoragePort (the seam): main() takes a
 * StoragePort (FakeStorage in the unit lane, the IDB adapter in the
 * browser) so the shell is testable without real IDB. The browser
 * entry (index.html's module script) calls main(createIdbStorage(
 * indexedDB)); the unit lane calls main(new FakeStorage()).
 *
 * THE SHELL COMPOSES (PLAN §1.1's "j/k/list/detail composition"):
 *   - the '/' search focus lane (typing / focuses the clip
 *     search input; typing in the input runs the domain search)
 *   - j/k row movement (the clip list's keyboard cursor)
 *   - Enter opens the detail view for the focused row; Esc in the
 *     detail returns to the list with focus on the originating row
 *   - Ctrl+K opens the command palette (Ostinato dialog contract)
 *   - the state (Unread etc.) rendering (the badge on each row)
 *   - the empty state (no clips yet — the honest "clip your first
 *     URL" panel, never a blank)
 *
 * DOM-GUARD: this module names DOM globals only INSIDE function
 * bodies (the globalThis-seam convention, like storage/pipeline).
 * The boundary test's DOM_GLOBS law pins that — the module load is
 * side-effect-free, so Lane A's DOM-free runtime imports it clean.
 *
 * THE CLIP-URL SEAM (L-3/L-11): the palette's "Clip URL" command
 * calls deps.clipUrl(url). L-5 wires a placeholder; L-11 replaces
 * it with the RealFetcher + clip pipeline call.
 */
import { el } from "./el.js";
import { renderClipList, moveSelection, focusRow } from "./list.js";
import { renderDetailPane } from "./detail.js";
import {
  openPalette,
  renderPalette,
  type PaletteState,
} from "./palette.js";
import { restoreTheme, toggleTheme } from "./theme.js";
import { buildIndex, search, tokenize, type SearchIndex } from "../domain/search.js";
import {
  activeClips, allClips,
  markReading, markDone, archiveClip, restoreClip,
  queueEmptyKind, filteredEmptyKind,
  ConflictError, QueueTransitionError,
  type QueueEmptyKind as QEmptyKind,
} from "../domain/queue.js";
import {
  buildTagIndex, applyFilter, isFilterActive,
  emptyCombo, type FilterCombo,
} from "../domain/tags.js";
import type { TagIndex } from "../domain/tags.js";
import { renderFilterBar } from "./filterbar.js";
import {
  openTagEditor, closeTagEditor, renderTagEditor,
  type TagEditorState,
} from "./tag-editor.js";
import type { StoragePort } from "../storage/storage-port.js";
import type { LegatoData, Clip, ClipState } from "../domain/types.js";

export interface AppDeps {
  storage: StoragePort;
  /** the clip-URL action (L-5's placeholder; L-11 injects RealFetcher). */
  clipUrl?: (url: string) => void;
  /** root element to render into (default: #legato-root). */
  rootId?: string;
}

export interface App {
  state: {
    data: LegatoData | null;
    bootError: string | null;
    /** the search query (the '/' lane) */
    searchQuery: string;
    searchIndex: SearchIndex;
    /** the j/k cursor index into the filtered view */
    selectedIdx: number;
    /** true when the detail pane is showing a clip */
    detailOpen: boolean;
    detailClipId: number | null;
    /** the originating row index (for Esc focus-return) */
    originRowIdx: number;
    /** queue toggle: "active" = the default reading queue, "all" = show every clip */
    queueView: "active" | "all";
    /** the L-6 concurrent-flip guard: a notice shown when a state
     *  flip conflicts (Q-1) or an illegal transition is attempted. */
    conflictNotice: string | null;
    /** the L-6 empty-state kind (Q-3): set by the queue lane */
    queueEmpty: QEmptyKind | null;
    /** L-7: the filter combo (tag AND-dimension + state filter +
     *  the text query). Composition law: the text query is the
     *  ranked lane (search.ts owns its ordering); the tag + state
     *  dimensions are the boolean predicate (applyFilter). */
    filterCombo: FilterCombo;
    /** L-7: the tag index (rebuilds on every re-render). */
    tagIndex: TagIndex;
    /** L-7: the tag editor's dialog state (Ostinato dialog
     *  contract: role=dialog, aria-modal, focus trap, Esc
     *  focus-return). */
    tagEditor: TagEditorState;
  };
  palette: PaletteState;
  /** the live DOM handles (set after the first render). */
  handles: {
    searchInput: HTMLInputElement | null;
    rowEls: HTMLElement[];
    detailPane: HTMLElement | null;
    /** the L-6 conflict notice panel (DOM element if mounted) */
    conflictNoticeEl: HTMLElement | null;
    /** L-7: the filter bar's live handles (the tag chips +
     *  active-combo display + clear-all affordance). */
    filterBar: {
      groupEl: HTMLElement;
      chipEls: HTMLButtonElement[];
      comboEl: HTMLElement;
      clearBtn: HTMLButtonElement;
    } | null;
  };
  /** the persist lane (Ostinato's every-transition rule). */
  persist: () => Promise<void>;
  /** the rerender lane (repaints list + detail). */
  rerender: () => void;
}

/**
 * The EMPTY-STORE factory — a fresh LegatoData with zero clips.
 * Exported so L-9's io.ts can import it for the empty-golden
 * without duplicating the shape.
 */
export function emptyDoc(): LegatoData {
  return { schema: "legato.v1", schemaVersion: 1, clips: [], tags: [], queue: [] };
}

function makeApp(deps: AppDeps): App {
  const state = {
    data: null as LegatoData | null,
    bootError: null as string | null,
    searchQuery: "",
    searchIndex: { byId: new Map(), now: "" },
    selectedIdx: 0,
    detailOpen: false,
    detailClipId: null as number | null,
    originRowIdx: 0,
    queueView: "active" as "active" | "all",
    conflictNotice: null as string | null,
    queueEmpty: null as QEmptyKind | null,
    filterCombo: emptyCombo() as FilterCombo,
    tagIndex: { tags: [], byTag: new Map() } as TagIndex,
    tagEditor: null as unknown as TagEditorState, // initialized after the app object is constructed
  };
  const app: App = {
    state,
    palette: {
      open: false,
      query: "",
      selection: 0,
      invokingEl: null,
      actions: {
        clipUrl: () => {
          const w = (globalThis as Record<string, unknown>)["window"] as Window | undefined;
          const url = w?.prompt?.("Clip URL:");
          if (url && url.trim() !== "") deps.clipUrl?.(url.trim());
        },
        focusSearch: () => app.handles.searchInput?.focus(),
        focusFilterBar: () => {
          app.handles.filterBar?.groupEl.focus();
        },
      },
    },
    handles: {
      searchInput: null,
      rowEls: [],
      detailPane: null,
      conflictNoticeEl: null,
      filterBar: null,
    },
    persist: async () => {
      if (state.data === null) return;
      await deps.storage.save(state.data);
    },
    rerender: () => {},
  };
  // L-7: the tag editor's dialog state — the app owns `onCommit`
  // (it persists through the StoragePort, the Ostinato
  // every-transition rule) + the re-render lane.
  state.tagEditor = {
    open: false,
    clipId: null,
    tags: [],
    draft: "",
    invokingEl: null,
    onCommit: (clipId: number, tags: string[]) => {
      const data = state.data;
      if (data === null) return;
      const clip = data.clips.find((c) => c.id === clipId);
      if (clip === undefined) return;
      clip.tags = tags;
      clip.updatedAt = new Date().toISOString();
      // L-7: the store's tag index re-derives (the domain's law).
      const union = new Set<string>();
      for (const c of data.clips) for (const t of c.tags) union.add(t);
      data.tags = [...union].sort();
      void deps.storage.save(data).catch(() => {});
      app.rerender();
    },
  };
  return app;
}

/**
 * Boot the shell: load the storage, mount the DOM, wire the key
 * handler, and paint the initial state. Call from the browser entry
 * AND from unit tests (with a FakeStorage + a detached document root).
 */
export async function main(deps: AppDeps, root?: HTMLElement): Promise<App> {
  const app = makeApp(deps);
  const doc = (globalThis as Record<string, unknown>)["document"] as Document | undefined;
  const rootEl = root ?? doc?.getElementById(deps.rootId ?? "legato-root") ?? doc?.body;
  if (!rootEl || !doc) throw new Error("main(): no document (DOM-free runtime)");

  restoreTheme();

  try {
    await deps.storage.recover();
    const loaded = await deps.storage.load();
    if (loaded === null) {
      app.state.data = emptyDoc();
      app.state.searchIndex = buildIndex(app.state.data.clips);
    } else {
      app.state.data = loaded;
      app.state.searchIndex = buildIndex(loaded.clips);
    }
  } catch (e) {
    app.state.bootError = e instanceof Error ? e.message : String(e);
  }

  rootEl.replaceChildren();
  const header = el("header", { class: "legato-header" });
  header.append(
    el("h1", { class: "legato-title", text: "Legato" }),
    el("p", {
      class: "legato-header-hint",
      text: "j/k move · Enter open · Esc close · / search · Ctrl+K palette · t theme / edit tags",
    }),
  );
  rootEl.append(header);

  const mainGrid = el("div", { class: "legato-main" });
  rootEl.append(mainGrid);

  const detailRoot = el("div", { class: "legato-detail-host", "aria-label": "Detail" });
  mainGrid.append(detailRoot);

  const listRoot = el("div", { class: "legato-list-host", "aria-label": "Clip list" });
  mainGrid.append(listRoot);

  const statusEl = el("p", { id: "legato-status", class: "legato-status", role: "status" });
  rootEl.append(statusEl);

  app.rerender = () => {
    const st = app.state;
    if (st.bootError !== null) {
      statusEl.textContent = "Boot failed: " + st.bootError;
      return;
    }
    statusEl.textContent = "";
    const data = st.data!;
    const terms = st.searchQuery.trim() !== "" ? tokenize(st.searchQuery) : [];
    const results = terms.length > 0 ? search(st.searchIndex, st.searchQuery) : null;
    let clips: readonly Clip[];
    if (results !== null) {
      // L-5 search lane: the ranked results (the composition law —
      // the search lane owns its ordering; the tag + state
      // dimensions are composed OVER this set below, not instead).
      clips = results.map((r) => data.clips.find((c) => c.id === r.id)!).filter((c) => c);
    } else if (st.queueView === "all") {
      // L-6's "all" toggle: every clip, no state filter
      clips = allClips(data);
    } else {
      // L-6's default active queue: reading first, then unread
      clips = activeClips(data);
    }
    // L-7: the tag AND-dimension composes over the result set
    // (the composition law in tags.ts: the text query is the
    // ranked lane; the tag + state dimensions are the boolean
    // predicate applyFilter runs).
    st.filterCombo.query = st.searchQuery;
    clips = applyFilter(clips, st.filterCombo);
    if (st.selectedIdx >= clips.length) st.selectedIdx = Math.max(0, clips.length - 1);

    // L-7: the tag index re-derives on every re-render (the
    // domain's "the index derives from the store" ruling).
    st.tagIndex = buildTagIndex(data.clips);

    // L-6 Q-3: the empty-state discrimination runs BEFORE the paint
    // so the panel is correct when the list is empty.
    // L-7: a tag combo (or state filter) counts as a filter too.
    const filterActive = terms.length > 0 || isFilterActive(st.filterCombo);
    if (filterActive) {
      st.queueEmpty = filteredEmptyKind(clips as readonly Clip[], true);
    } else {
      st.queueEmpty = queueEmptyKind(data);
    }

    const handles = renderClipList(listRoot, {
      clips,
      searchTerms: terms,
      selectedIndex: st.selectedIdx,
      onOpen: (idx) => openDetail(app, idx, clips),
      onSearch: (q) => {
        st.searchQuery = q;
        st.filterCombo.query = q; // L-7: the text query rides in the combo too
        st.searchIndex = buildIndex(data.clips);
        st.selectedIdx = 0;
        st.detailOpen = false;
        app.rerender();
      },
      onClipFirst: () => app.palette.actions.clipUrl(),
      // L-6 Q-3: the queue empty-state kind + the panel affordances.
      queueEmpty: st.queueEmpty,
      // L-7: the tag dimension — the "no-matches" panel copy names
      // the active tag combo when it is active (the brief's item 5).
      tagFilterActive: st.filterCombo.tags.length > 0 || st.filterCombo.state !== null,
      onShowAll: () => {
        st.queueView = "all";
        st.selectedIdx = 0;
        app.rerender();
      },
      onClearFilters: () => {
        st.searchQuery = "";
        st.filterCombo = emptyCombo(); // L-7: clear the whole combo (tags + state + query)
        st.selectedIdx = 0;
        app.rerender();
      },
      idPrefix: "legato",
    });
    app.handles.searchInput = handles.searchInput;
    app.handles.rowEls = handles.rowEls;

    // L-7: the filter bar (the tag chips + active-combo display +
    // clear-all affordance) renders in the list host, above the
    // search input + list rows. Hidden when no clip has any tags
    // (an honest empty state: the bar only appears when there is
    // something to filter by).
    if (st.tagIndex.tags.length > 0) {
      const bar = renderFilterBar(listRoot, {
        index: st.tagIndex,
        combo: st.filterCombo,
        onToggleTag: (tag: string) => {
          const idx = st.filterCombo.tags.indexOf(tag);
          if (idx >= 0) {
            st.filterCombo.tags = st.filterCombo.tags.filter((_, i) => i !== idx);
          } else {
            st.filterCombo.tags = [...st.filterCombo.tags, tag].sort();
          }
          st.selectedIdx = 0;
          app.rerender();
        },
        onClearAll: () => {
          st.searchQuery = "";
          st.filterCombo = emptyCombo();
          st.selectedIdx = 0;
          app.rerender();
        },
        idPrefix: "legato",
      });
      // The bar must render ABOVE the search input + list rows:
      // move the group element to the front of listRoot's children.
      const groupEl = bar.groupEl;
      const searchInputEl = handles.searchInput!;
      // The bar's group is already in listRoot (renderFilterBar
      // appends it); reorder: the group goes before the search
      // input, the search input before the list rows.
      listRoot.insertBefore(groupEl, searchInputEl);
      listRoot.insertBefore(bar.comboEl, groupEl.nextSibling);
      listRoot.insertBefore(bar.clearBtn, bar.comboEl.nextSibling);
      app.handles.filterBar = bar;
    } else {
      // No tags at all — hide the bar (remove any stale instance).
      app.handles.filterBar?.groupEl.remove();
      app.handles.filterBar?.comboEl.remove();
      app.handles.filterBar?.clearBtn.remove();
      app.handles.filterBar = null;
    }

    // L-6 conflict notice (Q-1): if the state just threw a
    // ConflictError the app stores the notice and the panel
    // renders it (never silent). Otherwise hide it.
    if (st.conflictNotice !== null) {
      if (app.handles.conflictNoticeEl === null) {
        const notice = el("div", {
          class: "legato-conflict-notice",
          role: "alert",
        }) as unknown as HTMLElement;
        notice.setAttribute("aria-live", "assertive");
        rootEl.append(notice);
        app.handles.conflictNoticeEl = notice;
      }
      app.handles.conflictNoticeEl.style.display = "";
      app.handles.conflictNoticeEl.textContent = st.conflictNotice;
    } else if (app.handles.conflictNoticeEl !== null) {
      app.handles.conflictNoticeEl.style.display = "none";
    }

    const openClip =
      st.detailOpen && st.detailClipId !== null
        ? data.clips.find((c) => c.id === st.detailClipId) ?? null
        : null;
    const posLabel =
      st.detailOpen && clips.length > 0
        ? String(clips.findIndex((c) => c.id === st.detailClipId) + 1) + " of " + String(clips.length)
        : undefined;
    const detailHandles = renderDetailPane(detailRoot, {
      clip: openClip,
      positionLabel: posLabel,
      // L-7: the tag editor's visible affordance (the "Edit tags"
      // button in the detail pane — the 't' key shortcut's visible
      // twin; opens the Ostinato-contract dialog via the tag
      // editor's onCommit lane, which persists through the
      // StoragePort on every transition).
      onEditTags: openClip !== null ? () => {
        const c = st.data!.clips.find((x) => x.id === openClip.id);
        if (c !== undefined) {
          openTagEditor(st.tagEditor, c);
          renderTagEditor(st.tagEditor);
        }
      } : undefined,
      idPrefix: "legato",
    });
    app.handles.detailPane = detailHandles.paneEl;
  };

  doc.addEventListener("keydown", (e: KeyboardEvent) => {
    onKey(e, app, doc, deps);
  });

  app.rerender();
  return app;
}

function openDetail(app: App, rowIdx: number, clips: readonly Clip[]): void {
  const st = app.state;
  st.detailOpen = true;
  st.detailClipId = clips[rowIdx]?.id ?? null;
  st.originRowIdx = rowIdx;
  app.rerender();
  app.handles.detailPane?.focus();
}

function onKey(e: KeyboardEvent, app: App, doc: Document, deps: AppDeps): void {
  const st = app.state;
  const palette = app.palette;

  if (palette.open) return;
  // L-7: when the tag editor's dialog is open, the overlay's own
  // onkeydown handles the dialog keys (Esc, Tab trap, Enter in
  // the input); the document-level handler must NOT re-route
  // j/k/Enter/etc. over the dialog.
  if (st.tagEditor.open) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openPalette(palette);
    renderPalette(palette);
    return;
  }

  const inInput =
    doc.activeElement !== null &&
    (doc.activeElement.tagName === "INPUT" || doc.activeElement.tagName === "TEXTAREA");

  if (e.key === "t" && !e.ctrlKey && !e.metaKey && !e.altKey && !inInput) {
    e.preventDefault();
    // L-7: in the detail view, 't' opens the tag editor (the
    // Ostinato dialog contract); outside the detail, 't' toggles
    // the theme (the L-5 lane, unchanged).
    if (st.detailOpen && st.detailClipId !== null && st.data !== null) {
      const clip = st.data.clips.find((c) => c.id === st.detailClipId);
      if (clip !== undefined) {
        openTagEditor(st.tagEditor, clip);
        renderTagEditor(st.tagEditor);
      }
    } else {
      toggleTheme();
    }
    return;
  }

  if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !inInput) {
    e.preventDefault();
    app.handles.searchInput?.focus();
    return;
  }

  if (e.key === "Escape" && st.detailOpen) {
    e.preventDefault();
    st.detailOpen = false;
    st.detailClipId = null;
    app.rerender();
    focusRow(app.handles.rowEls, st.originRowIdx);
    return;
  }

  if (inInput) return;

  // L-6 queue state flips (the keyboard lane, PLAN §3 L-6):
  //   r → mark reading · d → mark done · a → archive · u → restore
  // The guard: expectedPrior = the clip's CURRENT stored state
  // (read just before the flip). A conflict surfaces an honest
  // notice — never silent (Q-1). The current row is identified by
  // selectedIdx (the j/k cursor, the L-5 law).
  // the conflict lane: when a key press threw a ConflictError / QueueTransitionError
  // the notice is stored; otherwise the flip succeeded and the notice clears.
  const queueKey = e.key.toLowerCase();
  if ((queueKey === "r" || queueKey === "d" || queueKey === "a" || queueKey === "u") && !e.ctrlKey && !e.metaKey && !e.altKey && st.data !== null) {
    e.preventDefault();
    const data = st.data;
    const clips: readonly Clip[] =
      st.queueView === "all" ? allClips(data) : activeClips(data);
    if (clips.length === 0) return;
    const clip = clips[st.selectedIdx];
    if (clip === undefined) return;
    const prior: ClipState = clip.state;
    const now = new Date().toISOString();
    let flipped: Clip | null = null;
    let conflictMsg: string | null = null;
    try {
      switch (queueKey) {
        case "r": flipped = markReading(data, clip.id, prior, now); break;
        case "d": flipped = markDone(data, clip.id, prior, now); break;
        case "a": flipped = archiveClip(data, clip.id, prior, now); break;
        case "u": flipped = restoreClip(data, clip.id, prior, now); break;
      }
    } catch (err) {
      if (err instanceof ConflictError) {
        conflictMsg =
          "Conflicting state flip: clip “" + clip.title +
          "” is now “" + err.actual +
          "” (you expected “" + err.expected +
          "”). Try the flip again from the current state.";
      } else if (err instanceof QueueTransitionError) {
        conflictMsg =
          "Cannot move clip “" + clip.title +
          "” from “" + err.from + "” to “" + err.to +
          "” — that transition is not allowed.";
      } else {
        conflictMsg = "State flip failed: " + String(err);
      }
    }
    if (conflictMsg !== null) {
      st.conflictNotice = conflictMsg;
      app.rerender();
    } else if (flipped !== null) {
      st.conflictNotice = null;
      // Persist every transition (the Ostinato law).
      void deps.storage.save(data).catch(() => {});
      // The flipped clip may no longer be in the active view
      // (archived/done are out-of-view): re-render recomputes the
      // view and focus. If the current row was removed, focus
      // lands on the next row (Q-2).
      app.rerender();
      refocusAfterFlip(app, clip.id);
    }
    return;
  }

  if ((e.key === "j" || e.key === "k") && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    const dir: 1 | -1 = e.key === "j" ? 1 : -1;
    const n = app.handles.rowEls.length;
    st.selectedIdx = moveSelection(n, st.selectedIdx, dir);
    app.rerender();
    focusRow(app.handles.rowEls, st.selectedIdx);
    return;
  }

  if (e.key === "Enter" && !st.detailOpen) {
    e.preventDefault();
    openDetail(app, st.selectedIdx, st.data?.clips ?? []);
    return;
  }
}

// ─── L-6 queue state flip helpers ────────────────────────────────

/**
 * After a state flip that removes the focused clip from the active
 * view (archived / done when the view is "active"), re-focus the
 * NEXT row (Q-2: focus never lands on a non-focusable element).
 * If the clip stayed in the view (e.g. unread→reading in active
 * view) the same row index is still valid.
 */
function refocusAfterFlip(app: App, flippedClipId: number): void {
  const st = app.state;
  const data = st.data;
  if (data === null) return;
  const view: readonly Clip[] = st.queueView === "all" ? allClips(data) : activeClips(data);
  const idx = view.findIndex((c) => c.id === flippedClipId);
  if (idx >= 0) {
    // still in view — the rerender kept it in place; re-focus that row
    st.selectedIdx = idx;
    app.rerender();
    focusRow(app.handles.rowEls, idx);
  } else {
    // the clip left the active view — focus the next row by
    // content position (the row that was at the flipped clip's
    // ordinal, not a stale index into the shorter view).
    const prevIdx = st.selectedIdx;
    st.selectedIdx = Math.min(prevIdx, Math.max(0, view.length - 1));
    app.rerender();
    if (app.handles.rowEls.length > 0) {
      focusRow(app.handles.rowEls, st.selectedIdx);
    }
  }
}

// ─── The browser entry (the Ostinato bootstrap pattern) ──────────────────

function browserEntry(): void {
  const w = (globalThis as Record<string, unknown>)["window"] as Window | undefined;
  if (!w) return;
  const idb = w["indexedDB"] as
    | (import("../storage/idb-storage.js").IDBFactoryLike & object)
    | undefined;
  if (idb) {
    import("../storage/idb-storage.js")
      .then(({ createIdbStorage }) =>
        main({ storage: createIdbStorage(idb), clipUrl: (url) => clipUrlBrowser(url) }),
      )
      .catch((err) => {
        const s = w.document?.getElementById("legato-status");
        if (s) s.textContent = "Boot failed: " + String(err);
      });
  } else {
    import("../storage/fake-storage.js").then(({ FakeStorage }) => {
      void main({ storage: new FakeStorage(), clipUrl: (url) => clipUrlBrowser(url) });
    });
  }
}

function clipUrlBrowser(url: string): void {
  const w = (globalThis as Record<string, unknown>)["window"] as Window | undefined;
  const log = (globalThis as Record<string, unknown>)["console"] as { info: (s: string) => void } | undefined;
  log?.info("[legato] clip pipeline lands at L-11 — URL queued: " + url);
}

void browserEntry();
