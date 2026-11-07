/**
 * focus-trap.ts — the Fugue dialog contract's focus trap (the
 * Chaconne/Ostinato C-9 kin, ported for the F-9 a11y battery).
 *
 * TWO LAWS (the battery pins both):
 *   1. THE CYCLE LAW: while a dialog overlay is open, the Tab/Shift+Tab
 *      cycle stays INSIDE the overlay — Tab past the last stop wraps to
 *      the first, Shift+Tab from the first wraps to the last. The trap
 *      only manages the WRAP cases; interior movement is the browser's
 *      own order over the overlay's focusable stops.
 *   2. THE ESC-RETURN LAW: the owner captures the INVOKING control at
 *      open time and returns focus to it after close. The invoker may
 *      be detached by the owner's re-render — a detached .focus() is a
 *      browser no-op and focus lands on document.body (the honest
 *      terminal state, the Chaconne C-9 receipt's pin).
 *
 * Zero-dep + DOM-consultative: every helper takes real elements and
 * consults the live DOM (querySelectorAll / document.activeElement).
 * The DOM-free render lane (the bun:test suites) imports the types
 * without a host; the browser lane wires the listeners.
 */

/** The FOCUSABLE-STOPS query: the browser's own tab-order stops.
 *  Disabled elements are excluded — a disabled stop is not a stop
 *  (the palette's disabled rows stay visible, just untabbable). */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

/** All focusable stops inside `root`, in document order. */
export function focusStops(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}

export interface CycleOptions {
  /** The stop that receives focus when the overlay first opens
   *  (the attach-before-focus law: the owner focuses AFTER the
   *  re-render has landed the overlay in the document). */
  openFocus?: HTMLElement;
}

/**
 * Wire the cycle law onto `root` (the overlay element). Returns the
 * detach function — the owner calls it when the overlay is removed.
 *
 * The wire: a keydown listener on `root`. A Tab/Shift+Tab whose
 * CURRENT stop is an edge stop is recaptured to the wrap side;
 * everything else passes through to the browser's natural order.
 */
export function cycleFocusWithin(root: HTMLElement, opts: CycleOptions = {}): () => void {
  const handler = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const stops = focusStops(root);
    if (stops.length === 0) return;
    const active = document.activeElement;
    if (!root.contains(active)) return; // focus already outside — pass through.
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (active === root && opts.openFocus) {
      // The overlay itself has focus (the open moment): send to the
      // first stop (or the owner's named open stop).
      e.preventDefault();
      (e.shiftKey ? last : opts.openFocus).focus();
    }
  };
  root.addEventListener("keydown", handler);
  return () => root.removeEventListener("keydown", handler);
}

/**
 * The focus-return helper (the ESC-RETURN law): focus `invoker`
 * (the control that was active when the overlay opened). When the
 * invoker was detached by the owner's re-render, .focus() is a
 * browser no-op and focus lands on document.body — the honest
 * terminal state the Chaconne C-9 receipt pins.
 */
/**
 * The attach-before-focus helper (the D11 kin): focus `target` AFTER
 * the overlay has landed in the document (the owner's re-render has
 * run). No-op when the target is not connected — the browser keeps
 * focus where it was.
 */
export function focusAfterAttach(target: HTMLElement | null | undefined): void {
  if (target && target.isConnected) target.focus();
}

export function returnFocus(invoker: HTMLElement | null | undefined): void {
  if (invoker && invoker.isConnected) {
    invoker.focus();
    return;
  }
  // Detached invoker (or none): the browser's focus is already on
  // body after the overlay removal; pin that honestly, no op.
}
