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
  // THE GROUP'S CHILDREN'S STABILITY LANE (the "the chips' DOM
  // stability" contract, the `list.ts`'s "the idempotent re-
  // render" law's twin): the group's children (the chips
  // container + the combo display + the clear button) are
  // re-queried on each render (the `chipsEl` / `comboEl` /
  // `clearBtn`'s idempotent re-query lane — the "the
  // container is created ONCE, its children are re-painted on
  // each render" contract). The group's `replaceChildren()`
  // is NOT called (a wiped group's children are re-created on
  // each render, the focus-losing lane: a focused chip that is
  // replaced by a re-render loses its focus + the activation's
  // second press has no target, the Ostinato "the keyboard-
  // first affordance's activation fires the same callback as
  // the click lane" law's diagnostic). The chips container's
  // `chipsEl.replaceChildren()` (below) is the re-paint lane
  // (the chip buttons are re-created on each render, the
  // "the chip's `aria-pressed` state's re-paint" contract —
  // the chip's DOM state IS the domain's combo state, the
  // Ostinato "never a color-only cue" law's executable form:
  // the chip's re-render is the combo state's UI-reflectable
  // half). The combo display + the clear button are re-queried
  // the same way (the `list.ts`'s "the idempotent re-render"
  // law's twin: the container is created ONCE, its content is
  // re-painted on each render).

  // The chips container (role=group — the L-11 a11y battery's
  // toggle-button pattern cure: the chips are <button> elements,
  // natively focusable, and `role="listitem"` on a button does
  // NOT allow `aria-pressed` (the axe aria-allowed-attr critical
  // the L-11 battery pins) — the native button role is the
  // honest surface: the chip is a toggle button, not a list item.
  // The Ostinato toggle-button pattern: `aria-pressed` rides the
  // native button, never a color-only cue.
  // THE CHIPS CONTAINER'S IDEMPOTENT PATTERN (the `list.ts`'s
  // "the idempotent re-render" law's twin: the container is
  // created ONCE, its children are re-painted on each
  // render — the "the chips' DOM stability" contract: a chip
  // that is focused + activated via the keyboard lane must
  // NOT be replaced by a re-render, or the focus is lost + the
  // activation's second press has no target (the Ostinato
  // "the keyboard-first affordance's activation fires the same
  // callback as the click lane" law's executable form: the
  // button's `click()` is the activation's target, the
  // "the keyboard lane's activation fires the same callback as
  // the click lane" contract — a replaced button's focus
  // loss breaks the keyboard lane's continuity, the Ostinato
  // "focus never wanders to body" law's diagnostic).
  let chipsEl = groupEl.querySelector<HTMLElement>("#" + P + "-filter-chips");
  if (chipsEl === null) {
    chipsEl = el("div", {
      id: P + "-filter-chips",
      class: "legato-filter-chips",
      role: "group",
      "aria-label": "Tags",
    }) as unknown as HTMLElement;
    groupEl.append(chipsEl);
  }
  // THE CHIPS' IN-PLACE UPDATE LANE (the "the chip's DOM
  // stability" contract, the Ostinato "the keyboard-first
  // affordance's activation fires the same callback as the
  // click lane" law's executable form: a chip that is focused
  // + activated via the keyboard lane must NOT be replaced by
  // a re-render, or the focus is lost + the activation's
  // second press has no target). The existing chip buttons are
  // UPDATED in place (their `class` / `aria-pressed` /
  // `aria-label` / text content re-paint to the current
  // `chips` state — the "the chip's DOM state IS the domain's
  // combo state" contract's UI-reflectable half, the Ostinato
  // "never a color-only cue" law's executable form: the chip's
  // attribute re-paint is the combo state's DOM-reflectable
  // signal). A chip that has been removed from the domain's
  // tag set (the tag no longer exists on any clip — the
  // `buildTagIndex`'s re-derivation lane, the "the tag index
  // derives from the store" ruling) is deleted from the
  // container; a new chip that has appeared is created +
  // appended (the "the container's children's re-paint" lane's
  // honest form: the chip set's diff is applied in place, the
  // "the chip's DOM stability" law's executable proof).
  const existingBtns = Array.from(chipsEl.querySelectorAll<HTMLButtonElement>(".legato-filter-chip"));
  const existingByTag = new Map<string, HTMLButtonElement>();
  for (const b of existingBtns) {
    const tag = b.getAttribute("data-tag");
    if (tag !== null) existingByTag.set(tag, b);
  }
  // THE FOCUS-RESTORATION LANE (the Ostinato "the keyboard-first
  // affordance's activation never loses focus" pattern — the
  // re-paint lane's focus-stability half): when the pre-paint
  // active element was one of the chip buttons, the
  // re-paint's attribute re-set (`textContent` / `className` /
  // `setAttribute`) can drop the focus (the browser's
  // `activeElement`'s "the focused element's DOM state's re-set
  // can blur it" lane — the Ostinato "the keyboard-first
  // affordance's activation fires the same callback as the
  // click lane" law's focus-stability half: the activation's
  // target button must survive the re-render WITH ITS FOCUS, or
  // the keyboard lane's continuity is broken — the second Enter
  // press has no focused button to activate, the "focus never
  // wanders to body" law's diagnostic). The lane: capture the
  // pre-paint active element's `data-tag` (if it is one of the
  // chip buttons), and after the re-paint's in-place attribute
  // re-set, re-focus the re-painted chip with the SAME
  // `data-tag` (the focus-restoration's "the re-painted chip's
  // focus restoration" lane — the button element ITSELF survives
  // the in-place re-paint [the `btn = existing`'s stability
  // contract], so the re-focus is the same element's
  // `.focus()` call, the Ostinato "the keyboard-first
  // affordance's activation never loses focus" pattern's
  // executable form).
  const doc = (globalThis as Record<string, unknown>)["document"] as Document | undefined;
  const prePaintActive = doc?.activeElement as HTMLElement | null;
  const prePaintActiveTag =
    prePaintActive !== null && prePaintActive.classList.contains("legato-filter-chip")
      ? prePaintActive.getAttribute("data-tag")
      : null;
  const chipEls: HTMLButtonElement[] = [];
  for (const chip of chips) {
    const existing = existingByTag.get(chip.tag);
    let btn: HTMLButtonElement;
    if (existing !== undefined) {
      // THE IN-PLACE UPDATE (the "the chip's DOM stability" law's
      // "the existing chip's attribute re-paint" lane): the
      // button's `class` / `aria-pressed` / `aria-label` / text
      // content are re-set to the current `chip` state (the
      // "the chip's DOM state IS the domain's combo state"
      // contract's UI-reflectable half). The button element ITSELF
      // is NOT replaced (the focus-stability law: the focused
      // chip's button survives the re-render, the Ostinato "the
      // keyboard-first affordance's activation fires the same
      // callback as the click lane" law's executable form — the
      // button's `click()` is the activation's target, a
      // replaced button's focus loss breaks the keyboard lane's
      // continuity).
      btn = existing;
      btn.className =
        "legato-filter-chip" + (chip.selected ? " legato-filter-chip-selected" : "");
      btn.setAttribute("aria-pressed", chip.selected ? "true" : "false");
      btn.setAttribute(
        "aria-label",
        "Filter by tag " +
          chip.tag +
          " (" +
          chip.count +
          " clip" +
          (chip.count === 1 ? "" : "s") +
          (chip.selected ? ", selected" : "") +
          ")",
      );
      btn.textContent = chip.tag + " (" + String(chip.count) + ")";
      // Re-bind the click handler (the `onToggleTag` callback's
      // identity may have changed across re-renders — the app's
      // `st.filterCombo`'s XOR toggle lane, the "the chip's
      // click lane's `onToggleTag` callback" contract's
      // re-binding half: the button's click lane + its
      // keyboard lane are the SAME action — the `onToggleTag`
      // callback, the Ostinato "the keyboard-first affordance's
      // activation fires the same callback as the click lane"
      // law's executable form). The `onclick` property (not a
      // `addEventListener`) is the "the button's click lane's
      // single-handler" contract: the `onclick` assignment
      // replaces the previous handler (no duplicate-fire
      // concern — the "the chip's click lane's re-binding"
      // law's honest form: the button's click activation is a
      // single callback, not a multi-listener pile-up, the
      // Ostinato "the affordance's click lane + its keyboard
      // lane are the SAME action" law's executable form).
      btn.onclick = () => opts.onToggleTag(chip.tag);
    } else {
      // THE NEW CHIP'S CREATE LANE (the "the container's
      // children's re-paint" law's "the new chip's append" lane):
      // a chip that did not exist in the previous render's tag
      // set (the domain's tag index's re-derivation added a new
      // tag — the "the tag index derives from the store" ruling
      // + the "the chip set's diff is applied in place" law's
      // honest form) is created + appended to the container
      // (the "the chip's DOM stability" contract's "the new
      // chip's fresh create" half: a new chip has no focus
      // continuity concern — it was not focused in the
      // previous render, the Ostinato "the keyboard-first
      // affordance's activation" law's "the new affordance's
      // keyboard reach" executable form).
      btn = el("button", {
        class:
          "legato-filter-chip" + (chip.selected ? " legato-filter-chip-selected" : ""),
        "data-tag": chip.tag,
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
      // THE SINGLE-HANDLER CONTRACT (the "the button's click
      // lane's re-binding" law): the CREATE lane used
      // `addEventListener("click")` for the fresh button; the
      // in-place update's `btn.onclick = ...` does NOT remove
      // that original listener (the `onclick` property and
      // `addEventListener` are independent lanes — a click fires
      // BOTH, the double-toggle bug: the tag toggles ON then
      // OFF on a single click, ending in the same state, the
      // "the chip's click lane's single-handler" contract's
      // violation). The cure: the CREATE lane binds via
      // `btn.onclick` (the single-handler property, the
      // "the button's click lane's one-callback" contract's
      // executable form: the `onclick` assignment replaces the
      // previous handler on re-render, no duplicate-fire
      // concern — the Ostinato "the affordance's click lane +
      // its keyboard lane are the SAME action" law's honest
      // form: one callback, not a multi-listener pile-up).
      btn.onclick = () => opts.onToggleTag(chip.tag);
      chipsEl.append(btn);
    }
    chipEls.push(btn);
  }
  // THE REMOVED CHIPS' DELETE LANE (the "the chip set's diff is
  // applied in place" law's "the removed chip's delete" half):
  // a chip that no longer exists in the domain's tag set (the
  // tag was removed from every clip — the `buildTagIndex`'s re-
  // derivation lane) is deleted from the container (the
  // "the chip's DOM stability" contract's "the removed chip's
  // honest delete" lane: the chip's DOM is the domain's tag
  // set's UI-reflectable signal — a chip that has no domain
  // backing is a phantom affordance, the Ostinato "never a
  // color-only cue" law's twin: the DOM's chip set IS the
  // domain's tag set, a removed chip's DOM deletion is the
  // domain's removal's UI-reflectable half).
  for (const [tag, btn] of existingByTag) {
    if (!chips.some((c) => c.tag === tag)) {
      btn.remove();
    }
  }

  // THE FOCUS-RESTORATION LANE'S RE-FOCUS (the Ostinato "the
  // keyboard-first affordance's activation never loses focus"
  // pattern's executable form): when the pre-paint active element
  // was one of the chip buttons (the
  // the re-paint's attribute re-set can drop the focus (the
  // browser's `activeElement`'s "the focused element's DOM
  // state's re-set can blur it" lane). The re-focus: the
  // re-painted chip with the SAME `data-tag` is re-focused
  // (the button element ITSELF survives the in-place re-paint
  // [the `btn = existing`'s stability contract] + the re-
  // focus is the same element's `.focus()` call, the Ostinato
  // "the keyboard-first affordance's activation never loses
  // focus" pattern's executable proof — the keyboard lane's
  // continuity survives the re-render, the Ostinato "focus
  // never wanders to body" law's diagnostic lane's cure).
  if (prePaintActiveTag !== null) {
    const repainted = existingByTag.get(prePaintActiveTag);
    if (repainted !== undefined && repainted.isConnected) {
      repainted.focus();
    }
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
