/**
 * filterbar.ts — the tag filter bar (ticket L-7, PLAN §1.1 "the
 * filter bar extends the list view", PRD V-7).
 *
 * THE BAR LIVES ABOVE THE CLIP LIST (the list view's top chrome):
 * tag chips (one per distinct tag in the store, each showing its
 * clip count) + the active-combo display + a clear-all affordance.
 * Clicking a chip TOGGLES that tag in the AND-combo (XOR
 * selection at the UI level — the domain's AND-combo dedupes by
 * construction, so double-toggling never adds a duplicate; the
 * combination of selected chips is the filter).
 *
 * COMPOSITION WITH THE L-5/L-6 LANES (the module-header doc in
 * `../domain/tags.ts` states the law in full; this UI carries it
 * through):
 *
 *   - the bar's selected tags ARE `FilterCombo.tags` — the AND
 *     dimension;
 *   - the bar does NOT own the state filter: `FilterCombo.state`
 *     rides in from the app (the queue view's active/all toggle is
 *     the L-6 lane, not a per-clip state constraint; a non-null
 *     `state` filter is set by future work or by the palette
 *     command and the bar just passes it through unchanged);
 *   - the '/' text query is the L-5 lane: the app runs the search
 *     lane (search.ts) BEFORE the bar's composed predicate and
 *     hands the bar its result set — the bar never re-runs search
 *     (it is not a conjunct; the composition law says the ranked
 *     lane owns its own ordering).
 *
 * DOM-GUARD: every DOM global named here is resolved through the
 * globalThis-seam INSIDE function bodies (the el.ts / app.ts
 * convention) — the module load is side-effect-free, so Lane A's
 * DOM-free runtime imports it clean.
 *
 * KEYBOARD REACH (the tabindex law): the bar's chip container is
 * `tabindex="0"` (routes through setAttribute per el.ts's
 * attribute-routing law); each chip is a `<button>` (natively
 * focusable). The active-combo display is `aria-live="polite"`
 * so a screen reader announces the current selection on change
 * (the Ostinato live-region lane, the L-6 conflict-notice
 * precedent).
 */
import { el } from "./el.js";
import type { TagIndex, FilterCombo } from "../domain/tags.js";

/** One tag chip's state, as the bar renders it. */
export interface TagChip {
  tag: string;
  count: number;
  selected: boolean;
}

/**
 * Derive the bar's chip list from the domain index + the current
 * combo. The chips are in the index's canonical (sorted) order;
 * `selected` is true when the tag is in `combo.tags` (the UI's
 * XOR toggle state — the domain's AND-combo dedupes by
 * construction, so the "selected" set here is the same as
 * `combo.tags`).
 */
export function tagChips(
  index: TagIndex,
  combo: FilterCombo,
): TagChip[] {
  const sel = new Set(combo.tags);
  return index.tags.map((e) => ({
    tag: e.tag,
    count: e.count,
    selected: sel.has(e.tag),
  }));
}

/** The active-combo display string (the bar's live region). */
export function comboLabel(combo: FilterCombo): string {
  if (combo.tags.length === 0 && combo.state === null && combo.query.trim() === "")
    return "No tag filter active";
  const parts: string[] = [];
  if (combo.tags.length > 0) parts.push(combo.tags.join(" + "));
  if (combo.state !== null) parts.push("state: " + combo.state);
  return parts.join(" · ");
}

export interface FilterBarOpts {
  /** the domain's tag index (rebuild on every re-render) */
  index: TagIndex;
  /** the current filter combo (the app owns the value; the bar
   *  is a pure renderer that receives it + emits changes) */
  combo: FilterCombo;
  /** called when a chip is toggled — the app updates
   *  `combo.tags` and re-renders (the bar does not mutate the
   *  combo itself; the UI is a pure renderer over the app's
   *  state, same as list.ts's `onSearch` / `onOpen` pattern). */
  onToggleTag: (tag: string) => void;
  /** the clear-all affordance — the app resets the whole combo
   *  (tags + state + query) and re-renders. */
  onClearAll: () => void;
  /** id prefix (multiple bar instances in tests) */
  idPrefix?: string;
}

/**
 * Render (or re-render) the filter bar into `root`. Idempotent:
 * the first call attaches the structure, subsequent calls repaint
 * the chips. Returns the live DOM handles the app wires its key
 * handler to.
 *
 * The structure:
 *   - a `role="group"` container with `tabindex="0"` (the
 *     keyboard-reach target — a chip is a `<button>`, natively
 *     focusable; the group's tabindex is the "the bar itself is
 *     reachable" pin — pressing Tab from the list lands on the
 *     first chip, never the container's invisible stop).
 *   - one `<button>` per tag in canonical (sorted) order, each
 *     showing `tag` + `(count)`; the selected chips carry
 *     `aria-pressed="true"` (the toggle-button pattern — a chip
 *     is a toggle, not a select, so the DOM rides
 *     aria-pressed, never a color-only cue).
 *   - the active-combo display: a `role="status"` + `aria-live`
 *     region carrying `comboLabel(combo)` (the Ostinato
 *     live-region lane, the L-6 conflict-notice precedent).
 *   - the clear-all affordance: a `<button>` that calls
 *     `onClearAll` (the app resets the whole combo; the bar's
 *     own UI state is derived from the app's combo, so the bar
 *     re-renders the same way it always does — no special
 *     "clear" state of its own).
 */
export function renderFilterBar(
  root: HTMLElement,
  opts: FilterBarOpts,
): {
  groupEl: HTMLElement;
  chipEls: HTMLButtonElement[];
  comboEl: HTMLElement;
  clearBtn: HTMLButtonElement;
} {
  const P = opts.idPrefix ?? "legato";
  const chips = tagChips(opts.index, opts.combo);

  // The group container (the keyboard-reach target).
  let groupEl = root.querySelector<HTMLElement>("#" + P + "-filter-group");
  if (groupEl === null) {
    groupEl = el("div", {
      id: P + "-filter-group",
      class: "legato-filter-group",
      role: "group",
      "aria-label": "Tag filters",
      "aria-controls": P + "-filter-chips",
      tabindex: "0", // THE B-12 CURE: routes through setAttribute (el.ts law)
    }) as unknown as HTMLElement;
    root.append(groupEl);
  }
  groupEl.replaceChildren();

  // The chips container (role=list — the a11y decision in list.ts
  // applied to a non-navigable selection surface: this is a
  // SET of toggles, not a browse list, but list/listitem is the
  // honest role for "here is a collection of items" without
  // implying a single-selection picker (the listbox's lie).
  const chipsEl = el("div", {
    id: P + "-filter-chips",
    class: "legato-filter-chips",
    role: "list",
    "aria-label": "Tags",
  }) as unknown as HTMLElement;
  groupEl.append(chipsEl);

  const chipEls: HTMLButtonElement[] = [];
  for (const chip of chips) {
    const btn = el("button", {
      class:
        "legato-filter-chip" + (chip.selected ? " legato-filter-chip-selected" : ""),
      "data-tag": chip.tag,
      role: "listitem",
      "aria-pressed": chip.selected ? "true" : "false",
      "aria-label":
        "Filter by tag " +
        chip.tag +
        " (" +
        chip.count +
        " clip" +
        (chip.count === 1 ? "" : "s") +
        (chip.selected ? ", selected" : "") +
        ")",
    }) as HTMLButtonElement;
    btn.textContent = chip.tag + " (" + String(chip.count) + ")";
    btn.addEventListener("click", () => opts.onToggleTag(chip.tag));
    chipsEl.append(btn);
    chipEls.push(btn);
  }

  // The active-combo display (the live region — the Ostinato
  // lane, the L-6 conflict-notice precedent).
  let comboEl = root.querySelector<HTMLElement>("#" + P + "-filter-combo");
  if (comboEl === null) {
    comboEl = el("p", {
      id: P + "-filter-combo",
      class: "legato-filter-combo",
      role: "status",
    }) as unknown as HTMLElement;
    comboEl.setAttribute("aria-live", "polite");
    root.append(comboEl);
  }
  comboEl.textContent = comboLabel(opts.combo);

  // The clear-all affordance.
  let clearBtn = root.querySelector<HTMLButtonElement>("#" + P + "-filter-clear");
  if (clearBtn === null) {
    clearBtn = el("button", {
      id: P + "-filter-clear",
      class: "legato-filter-clear",
      "aria-label": "Clear all filters (tags, state, and search)",
    }) as HTMLButtonElement;
    clearBtn.textContent = "Clear all filters";
    clearBtn.addEventListener("click", () => opts.onClearAll());
    root.append(clearBtn);
  }

  return { groupEl, chipEls, comboEl, clearBtn };
}
