/**
 * list.ts — the clip list surface (ticket L-5, PLAN §1.1 "Keyboard-
 * first list/detail: j/k nav, / search, Ctrl+K command palette").
 *
 * THE A11Y DECISION (the brief's "pick one and document" ruling):
 * the list renders as **`role="list"` / `role="listitem"` (honest
 * list/li shape)**, NOT a listbox. Rationale: a listbox implies a
 * SELECTING control whose selection has no native meaning here —
 * the clip list is a BROWSE surface, not a picker; the keyboard
 * cursor (j/k) is a position, not a choice. list/listitem is the
 * honest role: a11y tree readers announce "list, N items" and each
 * row announces its content. The keyboard interaction is carried
 * by the row's `tabindex="-1"` focusable target + `aria-current="true"`
 * on the focused row (the Ostinato selection-ring DOM law: the
 * visible ring + aria-current + tabindex ride the DOM, never
 * color-only).
 *
 * FOCUS MANAGEMENT (the tabindex=-1 row-focusing law, the B-12
 * cure applied): each row element is created via `el()` with
 * `tabindex: "-1"` — which routes through setAttribute per el.ts's
 * attribute-routing law. The list owns a single logical cursor
 * (`selectedIndex`); Enter (or the palette's "open" command) moves
 * focus onto the selected row via `.focus()`; Esc in the detail
 * view returns focus to the originating row. j/k move the cursor
 * WITHOUT blurring the focused element (the cursor is a data
 * position, focus stays on the list container until Enter).
 *
 * THE SEARCH LANE ('/'): the list exposes a search input; typing
 * `/` (when not already in the input) focuses it. The query is
 * held by the app (see app.ts); the list itself is a PURE RENDERER
 * — it receives `clips` + `selectedIndex` + `searchResults` and
 * paints rows. The snippet source is `search.ts`'s `snippetFor`
 * when a search is active, else the clip's head (first ~200 chars).
 *
 * EMPTY STATE (PLAN §4.4 Q-3: "never a blank"): an empty clip set
 * renders an honest panel with a "clip your first URL" affordance
 * (the palette's "Clip URL" command, wired to the pipeline seam at
 * L-11; L-5 leaves a documented placeholder action the app binds).
 */
import { el } from "./el.js";
import { snippetFor } from "../domain/search.js";
import type { Clip, ClipState } from "../domain/types.js";

/**
 * The row's visual state badge (the fugue accent-ink trap cured —
 * the badge text is scheme-paired in the stylesheet; the DOM here
 * only carries the class + aria-label, never the color).
 */
export const STATE_LABELS: Record<ClipState, string> = {
  unread: "Unread",
  reading: "Reading",
  done: "Done",
  archived: "Archived",
};

/**
 * The "j/k" cursor math (the DOM-free half — pinned in list.test.ts
 * without a DOM): move the selected index by `dir` (1 = j, -1 = k)
 * over `n` rows, wrapping at both ends (the Ostinato j/k-wrap law).
 */
export function moveSelection(n: number, index: number, dir: 1 | -1): number {
  if (n === 0) return 0;
  const cur = index < 0 ? 0 : index >= n ? n - 1 : index;
  return dir === 1 ? (cur + 1) % n : (cur - 1 + n) % n;
}

/**
 * The snippet for a list row: when `searchTerms` is non-empty, the
 * domain `snippetFor` centers the first match region; otherwise the
 * clip's head (bounded, never the full body — the list is a scan
 * surface, the detail view is the read surface).
 */
export function rowSnippet(clip: Clip, searchTerms: readonly string[]): string {
  if (searchTerms.length > 0) {
    // The domain snippet centers the first match region (the app
    // already imported search.ts for the search lane; static import
    // keeps the module graph simple).
    return snippetFor(clip, searchTerms);
  }
  const head = clip.text.slice(0, 200);
  return clip.text.length > 200 ? head + "…" : head;
}

export interface ListRenderOpts {
  /** the clips to render (already filtered by the app's search lane) */
  clips: readonly Clip[];
  /** the active search terms (snippet centering; [] = browse mode) */
  searchTerms: readonly string[];
  /** the cursor position (j/k); -1 = none yet */
  selectedIndex: number;
  /** called when a row receives Enter / activation */
  onOpen: (index: number) => void;
  /** called when the search input's value changes */
  onSearch: (query: string) => void;
  /** the empty-state's "clip your first URL" affordance (L-3 seam
   *  hook — L-5 binds it to the palette's clip command) */
  onClipFirst: () => void;
  /** L-6: the queue empty-state kind (Q-3): "no-clips" | "all-read" |
   *  "no-matches" | null. When set AND clips is empty, the panel
   *  is chosen by this kind (not the L-5 blanket "No clips yet").
   *  L-7: when `tagFilterActive` is true, the "no-matches" copy
   *  names the active tag combo (the tag dimension, the brief's
   *  item 5: the filtered-empty state gains the tag dimension). */
  queueEmpty?: "no-clips" | "all-read" | "no-matches" | null;
  /** L-7: true when a tag filter combo is active — the "no-matches"
   *  panel copy then names the combo (honest: it says WHICH filter
   *  found nothing, not just that a filter found nothing). */
  tagFilterActive?: boolean;
  /** L-6: called when the user clicks the "Show all clips" button
   *  (the "all-read" panel). */
  onShowAll?: () => void;
  /** L-6: called when the user clicks the "Clear filters" button
   *  (the "no-matches" panel). */
  onClearFilters?: () => void;
  /** id prefix (multiple list instances in tests) */
  idPrefix?: string;
}

/**
 * Render (or re-render) the clip list into `root`. Idempotent: the
 * first call attaches the structure, subsequent calls repaint the
 * rows. Returns the live DOM handles the app wires its key handler
 * to.
 */
export function renderClipList(root: HTMLElement, opts: ListRenderOpts): {
  listEl: HTMLElement;
  rowEls: HTMLElement[];
  searchInput: HTMLInputElement;
  emptyPanel: HTMLElement | null;
} {
  const P = opts.idPrefix ?? "legato";
  const { clips, searchTerms, selectedIndex, onOpen, onSearch, onClipFirst } = opts;

  // The search input (the '/' focus target — the app holds its value).
  let searchInput = root.querySelector<HTMLInputElement>("#" + P + "-search");
  if (searchInput === null) {
    const si = el("input", {
      id: P + "-search",
      class: "legato-search",
      placeholder: "Search clips…  (press / to focus)",
      "aria-label": "Search clips",
      type: "search",
      autocomplete: "off",
    }) as HTMLInputElement;
    si.oninput = () => onSearch(si.value);
    root.append(si);
    searchInput = si;
  }

  // The list container (role=list — the a11y decision above).
  let listEl = root.querySelector<HTMLElement>("#" + P + "-clips");
  if (!listEl) {
    listEl = el("ul", {
      id: P + "-clips",
      class: "legato-clip-list",
      role: "list",
      "aria-label": "Clips",
    }) as unknown as HTMLElement;
    root.append(listEl);
  }
  // The empty-state panel (Q-3: honest, never a blank).
  let emptyPanel = root.querySelector<HTMLElement>("#" + P + "-empty");
  if (!emptyPanel) {
    emptyPanel = el("div", {
      id: P + "-empty",
      class: "legato-empty",
    }) as unknown as HTMLElement;
    const affordance = el("button", {
      class: "legato-clip-first",
      text: "Clip your first URL",
    });
    affordance.addEventListener("click", () => onClipFirst());
    emptyPanel.append(
      el("h2", { class: "legato-empty-title", text: "No clips yet" }),
      el("p", {
        class: "legato-empty-copy",
        text: "Press Ctrl+K and choose “Clip URL” to save a page for offline reading.",
      }),
      affordance,
    );
    root.append(emptyPanel);
  }

  // L-6: re-paint the panel contents for the active queue empty-kind.
  // The panel element is the SAME node (idempotent); only the text
  // and the button's action change.
  const queueKind = opts.queueEmpty ?? null;
  const showPanel = clips.length === 0;
  if (showPanel && emptyPanel !== null) {
    emptyPanel.replaceChildren();
    if (queueKind === "all-read") {
      emptyPanel.append(
        el("h2", { class: "legato-empty-title", text: "All caught up" }),
        el("p", {
          class: "legato-empty-copy",
          text: "Every clip is done or archived — the active queue is empty.",
        }),
      );
      const showAllBtn = el("button", {
        class: "legato-queue-empty-showall",
        text: "Show all clips",
      });
      showAllBtn.addEventListener("click", () => opts.onShowAll?.());
      emptyPanel.append(showAllBtn);
    } else if (queueKind === "no-matches") {
      // L-7: the tag dimension — when a tag combo is active the copy
      // names it (the active-combo display lives in the filter bar;
      // the panel echoes it so the state is never a bare "No matches").
      const noMatchCopy = opts.tagFilterActive
        ? "Nothing in the library matches the active tag filter."
        : "Nothing in the library matches the current filter.";
      emptyPanel.append(
        el("h2", { class: "legato-empty-title", text: "No matches" }),
        el("p", {
          class: "legato-empty-copy",
          text: noMatchCopy,
        }),
      );
      const clearBtn = el("button", {
        class: "legato-queue-empty-clear",
        text: "Clear filters",
      });
      clearBtn.addEventListener("click", () => opts.onClearFilters?.());
      emptyPanel.append(clearBtn);
    } else {
      // "no-clips" or null: the L-5 affordance (or the default panel)
      emptyPanel.append(
        el("h2", { class: "legato-empty-title", text: "No clips yet" }),
        el("p", {
          class: "legato-empty-copy",
          text: "Press Ctrl+K and choose “Clip URL” to save a page for offline reading.",
        }),
      );
      const clipFirstBtn = el("button", {
        class: "legato-clip-first",
        text: "Clip your first URL",
      });
      clipFirstBtn.addEventListener("click", () => onClipFirst());
      emptyPanel.append(clipFirstBtn);
    }
  }
  listEl.replaceChildren();
  const rowEls: HTMLElement[] = [];

  if (clips.length === 0) {
    listEl.style.display = "none";
    if (emptyPanel) emptyPanel.style.display = "";
    return { listEl, rowEls, searchInput, emptyPanel };
  }
  if (emptyPanel) emptyPanel.style.display = "none";
  listEl.style.display = "";

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const snippet = rowSnippet(clip, searchTerms);
    const row = el("li", {
      class:
        "legato-clip-row" + (i === selectedIndex ? " legato-clip-selected" : ""),
      "data-clip-id": String(clip.id),
      "data-index": String(i),
      role: "listitem",
      tabindex: "-1", // THE B-12 CURE: routes through setAttribute (el.ts law)
      "aria-current": i === selectedIndex ? "true" : "false",
    }) as unknown as HTMLElement;
    row.addEventListener("click", () => onOpen(i));

    const titleEl = el("span", { class: "legato-clip-title", text: clip.title });
    row.append(titleEl);
    if (clip.jsWalled || clip.error) {
      row.append(
        el("span", {
          class: "legato-clip-degraded",
          text: clip.error ? clip.error : "js-walled",
          "aria-label": clip.error ? "Error: " + clip.error : "JS-walled (title+URL fallback)",
          title: clip.jsWalled
            ? "JS wall — clipped title + URL; open in browser for the full page"
            : "Failed clip: " + (clip.error ?? ""),
        }),
      );
    }
    const snippetEl = el("p", { class: "legato-clip-snippet", text: snippet || "(no text captured)" });
    row.append(snippetEl);
    const meta = el("span", { class: "legato-clip-meta" });
    meta.append(
      el("span", { class: "legato-clip-state", text: STATE_LABELS[clip.state], title: clip.state }),
    );
    for (const tag of clip.tags) {
      meta.append(el("span", { class: "legato-clip-tag", text: tag }));
    }
    row.append(meta);
    listEl.append(row);
    rowEls.push(row);
  }
  return { listEl, rowEls, searchInput, emptyPanel };
}

/**
 * Focus the selected row (the tabindex=-1 target — only reachable
 * by programmatic .focus(), never Tab-order; that is the contract).
 * Called on Enter / detail-Esc-return.
 */
export function focusRow(rowEls: readonly HTMLElement[], index: number): void {
  if (index < 0 || index >= rowEls.length) return;
  rowEls[index].focus();
}
