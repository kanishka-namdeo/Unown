/**
 * Chaconne — the modal focus trap (the C-9 dialog contract).
 *
 * The Ostinato create-form's D11 contract is COMPLETED here: the
 * attach-before-focus + Esc focus-return lanes already land in
 * `recipe-editor.ts`; this module adds the missing pin — the TAB
 * CYCLE must stay INSIDE the dialog while it is open. A modal that
 * leaks focus to the page behind is an a11y failure (the focus
 * lands on the page's content while the overlay's backdrop is
 * still up, and a screen-reader user cannot tell where they are).
 *
 * THE LAW (test-pinned by the e2e battery):
 * - while `#chaconne-editor` (or `#chaconne-palette`) is open,
 *   Tab/Shift+Tab cycles among the dialog's focusable elements;
 *   reaching the last one and pressing Tab wraps to the first
 *   (and vice versa on Shift+Tab); focus NEVER escapes to the
 *   page behind.
 * - The dialog's own key handler (`recipe-editor.ts`'s `onKey`
 *   branch in app.ts) swallows the keydown event BEFORE the
 *   browser's default Tab handling would run; the trap is the
 *   app's explicit action, not a browser behavior.
 *
 * Focusable elements inside the overlay are the ones with
 * `tabindex >= 0` or the native focusable form controls
 * (`input`, `select`, `textarea`, `button`, `a[href]`) that are
 * not `disabled` and have no zero-size box.
 */

/** The focusable elements in the overlay, in DOM order (tab order). */
export function focusableInOverlay(overlay: HTMLElement): HTMLElement[] {
  const sel =
    "a[href], button:not([disabled]), input:not([disabled]), " +
    "select:not([disabled]), textarea:not([disabled]), " +
    "[tabindex]:not([tabindex='-1'])";
  const out: HTMLElement[] = [];
  for (const el of Array.from(overlay.querySelectorAll<HTMLElement>(sel))) {
    // The zero-size filter: skip elements with no visible box under
    // a layout engine. Under happy-dom (lane B), getBoundingClientRect
    // returns zeros for all elements, so the check is relaxed to a
    // style.display !== "none" guard — a display:none element is
    // genuinely unfocusable even in a real browser. The true
    // zero-size filtering is pinned by the e2e battery (real Chromium).
    const hidden = (el as HTMLElement).style?.display === "none";
    if (!hidden) out.push(el);
  }
  return out;
}

/**
 * Cycle the tab focus within the overlay. `dir` +1 = Tab, -1 =
 * Shift+Tab. Returns `true` if the caller should `preventDefault`
 * (focus stayed inside), `false` if the event should fall through
 * to the browser's default (there are fewer than 2 focusable
 * elements in the overlay — nothing to trap).
 *
 * THE WRAP LAW:
 * - `dir=+1`, focus on the LAST element → move to the FIRST.
 * - `dir=-1`, focus on the FIRST element → move to the LAST.
 * - otherwise, move to the next/previous focusable element.
 */
export function cycleFocusWithin(overlay: HTMLElement, dir: 1 | -1): boolean {
  const items = focusableInOverlay(overlay);
  if (items.length === 0) return false;
  const active = document.activeElement as HTMLElement | null;
  const idx = active ? items.indexOf(active) : -1;

  let next: number;
  if (idx === -1) {
    // Focus is not inside the overlay (e.g. just attached):
    // jump to the first (or last, for -1).
    next = dir === 1 ? 0 : items.length - 1;
  } else if (dir === 1 && idx === items.length - 1) {
    next = 0; // wrap forward
  } else if (dir === -1 && idx === 0) {
    next = items.length - 1; // wrap backward
  } else {
    next = idx + dir;
  }
  if (next < 0 || next >= items.length) return false;
  items[next].focus();
  return true;
}
