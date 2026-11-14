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
  LEGATO_PALETTE_COMMANDS,
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
  /** the clip-URL action. Wired in TWO stages by main(): the
   *  honest not-booted stub first (the 2026-11-14 CI-receipt
   *  cure — a submit racing the pipeline boot gets the "try
   *  again" notice + re-kicks the boot, never a silent no-op),
   *  then the L-11 RealFetcher pipeline once the dynamic-import
   *  boot lands. */
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
          // THE CLIP AFFORDANCE (L-11 upgrade from the L-5
          // placeholder): a keyboard-only URL form — an input + a
          // submit button, the Ostinato attach-before-focus +
          // Tab-trap + Esc focus-return contract (the same lane
          // the palette already ships). The form's on-submit calls
          // `deps.clipUrl(url)` (the L-11 pipeline closure — the
          // RealFetcher + the clip orchestrator + the Ostinato
          // every-transition persist lane).
          const w = (globalThis as Record<string, unknown>)["window"] as Window | undefined;
          const doc = (globalThis as Record<string, unknown>)["document"] as Document | undefined;
          if (!w || !doc) return;
          // Build the form inline into the document body (the
          // Ostinato attach-before-focus + Tab-trap convention —
          // the form is in the DOM BEFORE the input is focused,
          // and the input's `keydown` for Tab wraps within the
          // form (the focus-trap lane)).
          const form = doc.createElement("form");
          form.className = "legato-clip-form";
          const input = doc.createElement("input");
          input.className = "legato-clip-input";
          input.setAttribute("aria-label", "Clip URL (press Enter to submit)");
          input.setAttribute("type", "text");
          input.setAttribute("autocomplete", "off");
          const submit = doc.createElement("button");
          submit.type = "submit";
          submit.className = "legato-clip-submit";
          submit.textContent = "Clip";
          form.append(input, submit);
          form.addEventListener("submit", (e) => {
            e.preventDefault();
            const url = input.value.trim();
            form.remove();
            // THE STATUS-LANE'S ORDERING (the L-11 lane's "the
            // status line's post-clip copy is the lane's ready
            // signal" contract): the form's submit must NOT
            // clear the status line before the pipeline's
            // "Clipping …" write lands — the pipeline's
            // `deps.clipUrl`'s "Clipping " + url + "…" write
            // (the L-11 lane's "the status line's post-clip copy
            // is the lane's ready signal" contract's first
            // half) is the lane's ready signal; a form-side
            // status-clear BEFORE the pipeline's write would
            // erase the "Clipping …" lane, the Ostinato Q-1's
            // "never silent" law's violation (a status write
            // failure must land in the status line, not be
            // cleared by a form-lane race). The status line's
            // clear is the pipeline's own lane (the "Clip
            // failed: …" / "Clipped — …" / "Clipped (degraded:
            // …) — …" post-pipeline writes, the Ostinato
            // every-transition rule's status-lane half).
            if (url !== "") deps.clipUrl?.(url);
          });
          // THE FOCUS TRAP: Tab / Shift+Tab wrap within the form
          // (the input → the submit button → the input).
          form.addEventListener("keydown", (e) => {
            if (e.key !== "Tab") return;
            e.preventDefault();
            const stops: (HTMLInputElement | HTMLButtonElement)[] = [input, submit];
            const idx = stops.indexOf(doc.activeElement as HTMLInputElement | HTMLButtonElement);
            const next = e.shiftKey
              ? (idx - 1 + stops.length) % stops.length
              : (idx + 1) % stops.length;
            stops[next].focus();
          });
          // Esc closes the form + returns focus to the invoking
          // element (the palette's Esc focus-return lane — the
          // Ostinato P0 #9).
          form.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            form.remove();
            const target = (app.palette.invokingEl ?? doc.body);
            target.focus();
            const statusEl = doc.getElementById("legato-status");
            if (statusEl) statusEl.textContent = "";
          });
          doc.body.append(form);
          input.focus();
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
      // THE TAB-ORDER'S DOM INSERTION LANE (the Ostinato "the
      // '/'-focused search is the home position" contract's
      // executable form — the L-5/L-7 lane's documented "the
      // search-first tab order" law: the tab walk's logical
      // order is the DOM's source order, so the search input
      // must precede the filter bar in the DOM. The visual
      // layout's "the bar's above-the-search" lane is the CSS's
      // job (the `legato.css`'s flex/grid ordering, NOT the DOM
      // order — the Ostinato "the tab order's DOM-source
      // contract" law's "the visual layout's CSS-order lane"
      // half: the DOM order drives the tab order, the CSS order
      // drives the visual layout, the two lanes are INDEPENDENT
      // [the `display: flex` + `order` property's "the CSS
      // order's visual-reorder-without-DOM-reorder" contract]).
      // The L-11 sessions' "the bar's moved to the front of
      // listRoot's children" lane's bug: the `insertBefore`
      // calls' DOM-reorder moved the filter group BEFORE the
      // search input in the DOM, breaking the pinned tab order
      // [search → filter group → chip → row → clear, the "the
      // '/'-focused search is the home position" contract's
      // executable form]. The cure: the search input's DOM
      // insertion is FIRST (the `renderClipList`'s "the
      // search input's append" lane — the `root.append(searchInput)`
      // call, the list.ts's "the list exposes a search input"
      // contract's DOM-order half), the filter bar's DOM
      // insertion is AFTER the search input (the "the bar's
      // DOM-order-after-the-search" contract: the filter
      // group's `root.append` + the combo display + the clear
      // button's appends all follow the search input in the DOM,
      // the tab order's source-order's "search → filter group →
      // chip → clear" executable form). The visual layout's
      // "the bar's above-the-search" lane is the CSS's
      // `legato.css`'s `display: flex; flex-direction: column` +
      // the filter group's `order: -1`'s "the CSS order's
      // visual-reorder" contract (the "the visual layout's CSS-
      // order lane" — the DOM order stays search-first, the
      // CSS order flips the visual layout to bar-above-search,
      // the two lanes' independence, the Ostinato "the tab
      // order's DOM-source contract" law's "the visual layout's
      // CSS-order" half).
      const groupEl = bar.groupEl;
      // NO DOM REORDER (the `insertBefore` calls' "the bar's
      // moved to the front of listRoot's children" lane's bug —
      // the DOM-reorder broke the pinned tab order). The filter
      // bar's group/combo/clear are APPENDED to listRoot AFTER
      // the search input (the `renderFilterBar`'s "the bar's
      // DOM-order-after-the-search" contract: the `root.append`
      // calls' natural order — the search input is already in
      // the DOM [the `renderClipList`'s "the search input's
      // append" lane], the filter bar's appends follow it, the
      // tab order's source-order's "search → filter group →
      // chip → clear" executable form). The visual layout's
      // "the bar's above-the-search" lane is the CSS's job
      // (the `legato.css`'s `flex-direction: column-reverse` or
      // the filter group's `order` property — the "the visual
      // layout's CSS-order lane" contract: the DOM order stays
      // search-first [the tab order's source-order], the CSS
      // order flips the visual layout [the bar's visually above
      // the search], the two lanes' independence, the Ostinato
      // "the tab order's DOM-source contract" law's "the
      // visual layout's CSS-order" half). The `renderFilterBar`
      // has ALREADY appended the group/combo/clear to listRoot
      // (the `root.append` calls in the `renderFilterBar`'s
      // create-lanes), so no further DOM manipulation is needed
      // — the natural append order IS the "search → filter
      // group → chip → clear" tab order's source-order.
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
      // L-8: the highlight create/delete persist lane (Ostinato
      // every-transition rule — persist through the StoragePort
      // on every mutation, then re-render).
      onHighlightCreated: openClip !== null ? (clipId: number) => {
        const c = st.data!.clips.find((x) => x.id === clipId);
        if (c !== undefined) {
          c.updatedAt = new Date().toISOString();
          void deps.storage.save(st.data!).catch(() => {});
          app.rerender();
        }
      } : undefined,
      onHighlightDeleted: openClip !== null ? (clipId: number) => {
        const c = st.data!.clips.find((x) => x.id === clipId);
        if (c !== undefined) {
          c.updatedAt = new Date().toISOString();
          void deps.storage.save(st.data!).catch(() => {});
          app.rerender();
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

  // ── THE L-11 IO PALETTE LANE (PLAN §3 L-11, §6.2 I-1 I-2) ──
  // The export/import palette commands are wired here (the L-9 io
  // module was pure domain — no UI surface; L-11's brief names
  // "export via the palette → import round-trip" as a flow step,
  // so this lane lands the UI edge that calls io.exportData /
  // io.importData + the download / file-chooser event paths
  // (the Ostinato O-4 download-lane + file-chooser-lane
  // precedent, the idb-storage.ts injection convention for the
  // browser edge)).
  const wireExport = (): void => {
    const data = app.state.data;
    if (data === null) return;
    import("../domain/io.js").then(({ exportData }) => {
      const bytes = exportData(data);
      const blob = new Blob([bytes], { type: "application/json" });
      const objectUrl = URL.createObjectURL(blob);
      const a = doc.createElement("a");
      a.href = objectUrl;
      a.download = "legato-export.json";
      a.click();
      // Release the object URL after the download is kicked off
      // (the Blob stays alive until the anchor's click resolves;
      // the revoke is best-effort + deferred to the next tick so
      // the download has its handle).
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      const statusEl = doc.getElementById("legato-status");
      statusEl!.textContent = "Exported " + data.clips.length + " clip(s) to the JSON bundle.";
    });
  };
  const wireImport = (): void => {
    // The file-chooser lane: a hidden <input type=file> that the
    // palette's import command opens, the Ostinato precedent.
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file === undefined) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? "");
        import("../domain/io.js").then(({ importData }) => {
          try {
            const loaded = importData(text);
            // Replace the store view + persist (the Ostinato
            // every-transition rule — the import is a STORE
            // REPLACEMENT, not an in-place mutation).
            app.state.data = loaded;
            app.state.searchIndex = buildIndex(loaded.clips);
            deps.storage.save(loaded).catch(() => {});
            app.rerender();
            const s = doc.getElementById("legato-status");
            s!.textContent = "Imported " + loaded.clips.length + " clip(s) from the JSON bundle.";
          } catch (err) {
            const s = doc.getElementById("legato-status");
            s!.textContent = "Import refused: " + (err instanceof Error ? err.message : String(err));
          }
        });
      };
      reader.readAsText(file);
    });
    input.click();
  };
  // The palette's `export` / `import` commands dispatch through
  // `dispatchPaletteCmd` (palette.ts) — the app wires the
  // ENABLED state here (the L-11 lane supersedes L-9's stub:
  // the brief's "export via the palette" step needs the
  // ENABLED row). The commands are in the `LEGATO_PALETTE_COMMANDS`
  // table (palette.ts) — the enabled flag is read at dispatch
  // time, so the app's wiring is a STATE mutation on the command
  // table (the dispatch checks `enabled` first).
  const commands = LEGATO_PALETTE_COMMANDS;
  const exportCmd = commands.find((c) => c.id === "export");
  const importCmd = commands.find((c) => c.id === "import");
  if (exportCmd !== undefined) {
    exportCmd.enabled = true;
    // Override the command's dispatch (the palette's
    // `dispatchPaletteCmd` switch falls through to the default
    // lane for `export` / `import` — the app injects its own
    // handler through the palette state's `actions`).
    // The palette's dispatch table is closed (`switch (cmd.id)`),
    // so the lane's extension point is the `actions` object
    // (palette.ts's PaletteState.actions). The app's palette
    // state owns the `actions.clipUrl` / `actions.focusSearch`
    // / `actions.focusFilterBar` — L-11 adds `export` / `import`
    // as new action entries.
    (app.palette.actions as unknown as Record<string, unknown>)["export"] = wireExport;
  }
  if (importCmd !== undefined) {
    importCmd.enabled = true;
    (app.palette.actions as unknown as Record<string, unknown>)["import"] = wireImport;
  }

  // ── THE L-11 CLIP PIPELINE (PLAN §3 L-11, §4.1 T-1..T-7) ──
  // The RealFetcher + the clip orchestrator, wired HERE: this
  // closure captures the live `App` handle (its `state.data` +
  // `persist` + `rerender`) + the `StoragePort` — the browser
  // edge's only place where all of it is in scope. The
  // pipeline's fetch is the browser's native fetch, injected
  // through the globalThis-seam exactly like the idb-storage.ts
  // + fetcher.ts convention: the module NEVER names a browser
  // global at module scope.
  //
  // THE APP-SIDE FETCH CAP (T-7's half — the timeout-masking pin):
  // the RealFetcher is built with the 15 s AbortController cap
  // (the default — the 4018 /slow route's 5 s delay clears it, so
  // a clean clip of the slow page succeeds in the e2e lane; a
  // shorter cap makes the abort fire the fetch-failed lane, never
  // a silent hang). The /slow e2e spec pairs the short cap with
  // the route to pin T-7 live (the qa-architect's named hardest
  // e2e, PLAN §4.1 T-7).
  //
  // PERSIST LANE (the Ostinato every-transition rule): each
  // clipped clip is appended to the store view + the queue, and
  // `deps.storage.save(data)` persists it through the StoragePort
  // (real IDB in the browser lane). A save failure surfaces in the
  // status line (the Q-1 honest-notice lane) — never silent.
  const w = (globalThis as Record<string, unknown>)["window"] as Window | undefined;
  // ── THE PIPELINE BOOT'S RETRY + NEVER-SILENT CURE (the
  //    2026-11-14 CI receipts: runs 43614723332 + 43632794835) ──
  //    Both runs failed the clip lane with the SAME signature:
  //    the submit fired, the status line stayed EMPTY for the
  //    whole 30 s budget — `deps.clipUrl` was still undefined
  //    (the dynamic-import boot below had failed, and NOTHING
  //    surfaced it). A one-shot `import()` never retries: a
  //    single transient module-fetch failure (serve.mjs's
  //    tryFile returns null → 404 on ANY transient read error)
  //    permanently and SILENTLY killed clipping for the page's
  //    lifetime — the exact "silent hang" T-7's manifest
  //    outlaws, one lane up (in the boot, not the fetch). The
  //    cure is three lanes:
  //      1. THE BOUNDED RETRY — the boot re-attempts (three
  //         tries, 400 ms apart): a transient blip converges
  //         before the user can even open the palette.
  //      2. THE NEVER-SILENT CATCH — a final failure surfaces to
  //         the status line + console.error (the Q-1 "never
  //         silent" law — the same shape as the pipeline's own
  //         reject lane below).
  //      3. THE NOT-BOOTED STUB — `deps.clipUrl` is wired
  //         IMMEDIATELY with the honest-notice stub (the
  //         store-not-loaded guard's twin), so a submit that
  //         races (or outlives) the boot gets words in the
  //         status line instead of the silent `?.` no-op — and
  //         the stub's call RE-KICKS the boot (a submit is a
  //         fresh demand: the transient failure gets another
  //         chance to converge).
  const PIPELINE_BOOT_TRIES = 3;
  const PIPELINE_BOOT_RETRY_MS = 400;
  let pipelineWired = false;
  const bootClipPipeline = (attempt: number): void => {
    if (pipelineWired) return;
    if (!w || typeof w["fetch"] !== "function") return;
    import("../pipeline/fetcher.js").then(({ RealFetcher }) => {
      // The inner promise is RETURNED — the outer .catch below
      // sees the inner import's reject AND any throw inside the
      // wiring body. (The fire-and-forget form left an inner
      // rejection unhandled — silent forever, the receipt's
      // other half.)
      return import("../pipeline/clip.js").then(({ clipUrl }) => {
        if (pipelineWired) return; // idempotent: a retry racing the re-kick wires once
        pipelineWired = true;
        // THE FETCH CAP (T-7's app-side half — the timeout-masking
        // pin): the default is 15 s (the 4018 /slow route's 5 s
        // delay clears it → a clean clip of the slow page). The
        // override seam (the `__legatoFetchCapMs` window property)
        // lets the L-11
        // e2e lane pair the /slow route with a SHORTER cap (the
        // manifest's "T-7 (paired with a short cap)" row): when the
        // override is set, it wins — the abort fires before the
        // deferred response → the orchestrator's T-7 reject lane →
        // the fetch-failed clip record in bounded time (never a
        // silent hang). The seam is test-only surface (documented
        // on the window, never a product affordance).
        const wAny = w as unknown as Record<string, unknown>;
        // THE CAP LANE (the manifest's "T-7 (paired with a short
        // cap)" row): the boot-time override is read from the
        // `__legatoFetchCapMs` window property — the hostile-clip
        // spec sets it on the page's `window` object via
        // `page.evaluate` (the in-page seam, the Ostinato storage-
        // seam precedent — the app's module-scope `w` and the
        // page's `window` are the SAME object in the browser,
        // so the property set in the spec is visible to the
        // app's boot-time read). The default (no override) is
        // 15 s (the 4018 /slow route's 5 s delay clears it → a
        // clean clip of the slow page; the /slow + short-cap
        // pairing is the e2e lane's fetch-failed pin).
        const bootCapOverride = wAny["__legatoFetchCapMs"] as number | undefined;
        const fetcher = new RealFetcher({
          fetch: w.fetch.bind(w) as never,
          fetchCapMs: bootCapOverride ?? 15_000,
        });
        // THE PIPELINE'S BOOT DIANOSTIC (the L-11 lane's "never
        // a silent failure" diagnostic): the console log fires
        // when the RealFetcher is constructed + the __legatoRead-
        // Store / __legatoFetchCapMs seams are wired — the
        // spec's failure receipt's diagnostic (the Ostinato O-4
        // / Fugue F-8 error-context precedent: the spec's
        // `pageErrors` capture picks up this lane's log).
        const log = (globalThis as Record<string, unknown>)["console"] as
          | { log: (...args: unknown[]) => void }
          | undefined;
        log?.log("[legato] L-11 pipeline closure booted (RealFetcher + " +
          "the clip orchestrator; the __legatoFetchCapMs override " +
          "is " + (bootCapOverride !== undefined ? "set (" + String(bootCapOverride) + " ms)" : "absent (default 15 s cap)") +
          "; __legatoReadStore seam wired");

        // THE STORAGE READ SEAM (test-only surface, documented on
        // the window): the L-11 hostile-clip spec reads the live
        // store view after each clip (the "store's post-clip shape
        // is read through the in-page storage seam" lane — zero
        // pointer events). It returns a COPY of the store's clips
        // array (plain JSON, the grammar's law — no live refs).
        wAny["__legatoReadStore"] = () =>
          Promise.resolve(JSON.parse(JSON.stringify(app.state.data?.clips ?? [])));

        deps.clipUrl = (url: string) => {
          const statusEl = doc.getElementById("legato-status");
          const data = app.state.data;
          if (data === null) {
            statusEl!.textContent = "Clip: the store has not loaded yet — try again.";
            return;
          }
          statusEl!.textContent = "Clipping " + url + "…";
          const statusId = "legato-status";
          void (async () => {
            try {
              // THE CAP LANE: the RealFetcher's own AbortController cap
              // (the constructor-time `fetchCapMs` — the default 15 s,
              // or the override's value when `__legatoFetchCapMs` was set
              // at boot). The orchestrator's T-7 reject lane turns a
              // cap-abort into the fetch-failed clip (never a silent
              // hang); no per-clip override — the cap is boot-time
              // (the manifest's "T-7 (paired with a short cap)" row is
              // the per-context boot override).
              const clip = await clipUrl(url, { fetcher, data });
              data.clips.push(clip);
              data.queue.push(clip.id);
              await deps.storage.save(data);
              // THE STATUS-LANE'S ORDERING (the L-11 lane's "the
              // status line's post-clip copy is the lane's ready
              // signal" contract + the app's `rerender`'s
              // "statusEl.textContent = """ first-line (the
              // rerender's "the status lane's clear is the
              // rerender's first action" contract)): the
              // pipeline's `app.rerender()`'s first line clears
              // the status line (the "the rerender's status-
              // clear" contract — the "the status lane's
              // post-clip copy is the lane's ready signal" +
              // the "the status lane's clear is the rerender's
              // first action" contract's executable form). The
              // pipeline's "Clipped — …" / "Clipped (degraded:…)
              // — …" write must land AFTER the rerender's
              // status-clear (the Ostinato "the status lane's
              // post-clip copy is the lane's ready signal"
              // contract's executable form: the final status
              // write is the last action, not the first).
              app.rerender();
              const s = doc.getElementById(statusId);
              s!.textContent = clip.error
                ? "Clipped (degraded: " + clip.error + ") — " + clip.title
                : "Clipped — " + clip.title;
            } catch (err) {
              const s = doc.getElementById(statusId);
              const log = (globalThis as Record<string, unknown>)["console"] as
                | { error: (...args: unknown[]) => void }
                | undefined;
              log?.error("[legato] clip pipeline rejected:", err);
              // THE ERROR-LANE'S STATUS (the "the status lane's
              // post-clip copy is the lane's ready signal"
              // contract's error half: a pipeline reject lands
              // in the status line, not in an unhandled
              // rejection — the Ostinato Q-1's "never silent"
              // law's executable form). The "Clip failed: …"
              // write is the last action (the error-lane's
              // status write is the final ready signal, the
              // "the status lane's post-clip copy is the lane's
              // ready signal" contract's error half).
              s!.textContent =
                "Clip failed: " + (err instanceof Error ? err.message : String(err));
            }
          })();
        };
      });
    }).catch((err: unknown) => {
      // THE NEVER-SILENT CATCH (cure lane 2): a boot reject
      // lands in the status line + console.error, never in an
      // unhandled rejection — the Ostinato Q-1 "never silent"
      // law's executable form, the pipeline's own reject lane
      // ("Clip failed: …") applied to the boot itself.
      const log = (globalThis as Record<string, unknown>)["console"] as
        | { error: (...args: unknown[]) => void }
        | undefined;
      log?.error(
        "[legato] clip pipeline boot failed (attempt " +
          String(attempt + 1) + "/" + String(PIPELINE_BOOT_TRIES) + "):",
        err,
      );
      // Cure lane 1 — the bounded retry: a transient
      // module-fetch blip gets another chance (the one-shot
      // import never retries on its own — the receipt's root).
      if (attempt + 1 < PIPELINE_BOOT_TRIES) {
        setTimeout(() => bootClipPipeline(attempt + 1), PIPELINE_BOOT_RETRY_MS);
        return;
      }
      // The budget is spent — the FINAL failure surfaces (cure
      // lane 2's terminal write; the stub below keeps answering
      // later submits with the honest "try again" + a re-kick).
      const s = doc.getElementById("legato-status");
      if (s) s.textContent = "Clip unavailable: the pipeline failed to load — reload the page and try again.";
    });
  };
  // THE NOT-BOOTED STUB (cure lane 3): wired BEFORE the boot
  // lands, so the form's `deps.clipUrl?.(url)` submit lane
  // always finds a function — the silent no-op lane is gone.
  // The url is intentionally unused: the notice IS the lane
  // (the real pipeline takes the url once the boot lands; a
  // submit that raced the boot re-submits after the notice —
  // the store-not-loaded guard's "try again" shape, its twin).
  deps.clipUrl = (_url: string): void => {
    const s = doc.getElementById("legato-status");
    if (s) s.textContent = "Clip: the pipeline has not booted yet — try again.";
    bootClipPipeline(0);
  };
  bootClipPipeline(0);

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
    // THE BUTTON-ACTIVATION LANE (the Ostinato K-1 zero-pointer
    // law's "the keyboard-first affordance's activation fires
    // the same callback as the click lane" contract): when the
    // focused element is a <button> (the empty-state panel's
    // "Show all clips" / "Clear filters" affordances, the
    // filter bar's tag chips, the detail pane's "Edit tags"
    // button, the tag editor's "Add" / "Cancel" buttons), the
    // Enter key's activation is the BUTTON's native "Enter key
    // activates" contract (the <button>'s built-in form-
    // submission / button-activation lane, the Ostinato
    // "keyboard-first" law's executable form). The document-
    // level Enter handler must NOT open the detail view when
    // the active element is a button (the button's activation
    // lane is the "the affordance's keyboard lane's activation
    // fires the same callback as the click lane" contract —
    // the button's `click()` is the activation's target, not
    // the detail view's `openDetail`). The `activeElement`'s
    // tag check is the "the focused element is a button"
    // discriminator (the Ostinato "never a color-only cue"
    // law's twin: the button's tag is the DOM's own signal,
    // not a class or color cue).
    const activeEl = doc.activeElement;
    if (activeEl !== null && activeEl.tagName === "BUTTON") {
      // THE BUTTON'S ACTIVATION (the <button>'s native "Enter
      // key activates" contract — the button's `click()` is
      // the activation's target, the "the keyboard-first
      // affordance's zero-pointer contract" executable form:
      // the button's click lane + its keyboard lane are the
      // SAME action — the affordance's `onShowAll` /
      // `onClearAll` / `onToggleTag` / `onEditTags` /
      // `onCommit` callback). The `preventDefault` is the
      // "the document-level Enter handler's activation lane
      // does NOT fall through to the detail-view's `openDetail`"
      // contract (the button's activation is the Enter key's
      // target, not the detail view's open).
      e.preventDefault();
      (activeEl as HTMLButtonElement).click();
      return;
    }
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
  if (idb && "open" in idb) {
    // THE L-11 WIRED PIPELINE: the browser edge boots the RealFetcher
    // (the native fetch injection, the idb-storage.ts convention —
    // the module NEVER names a browser global) + the DOMParser default
    // extraction, and the clipUrl seam lands every clip through the
    // orchestrator (clip.ts) into the store view, persisted through
    // the StoragePort on every transition (the Ostinato every-
    // transition rule), then re-renders.
    import("../storage/idb-storage.js")
      .then(({ createIdbStorage }) =>
        main({ storage: createIdbStorage(idb) }),
      )
      .catch((err) => {
        const s = w.document?.getElementById("legato-status");
        if (s) s.textContent = "Boot failed: " + String(err);
        const log = (globalThis as Record<string, unknown>)["console"] as
          | { error: (...args: unknown[]) => void }
          | undefined;
        log?.error("[legato] boot failed:", err);
      });
  } else {
    import("../storage/fake-storage.js").then(({ FakeStorage }) => {
      void main({ storage: new FakeStorage() });
    });
  }
}

// ─── The service-worker registration (L-10 offline lane; the Ostinato
// O-4 / Coda main.ts pattern — fail-soft, relative scope, never a boot
// dependency) ────────────────────────────────────────────────────────────
function registerServiceWorker(): void {
  const n = (globalThis as Record<string, unknown>)["navigator"] as Navigator | undefined;
  if (!n || !("serviceWorker" in n)) return;
  const w = (globalThis as Record<string, unknown>)["window"] as Window | undefined;
  w?.addEventListener("load", () => {
    n.serviceWorker
      .register("./sw.js", { scope: "./" })
      .catch((err) => {
        const log = (globalThis as Record<string, unknown>)["console"] as
          | { warn: (...args: unknown[]) => void }
          | undefined;
        log?.warn("[legato] service worker registration failed:", err);
      });
  });
}
registerServiceWorker();

void browserEntry();
