/**
 * Coda UI — status / transient message helpers.
 *
 * The single status line doubles as the toast lane for DomainInvariantError
 * surfacing: every repository failure the UI catches is reported HERE,
 * never swallowed.
 */

let transientTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Show a message in the status line. `error` styling is applied for
 * domain failures. Transient messages fade back to the last `sticky`
 * status text (or "Ready.") after `ttlMs`.
 */
export function showTransient(el: HTMLElement, text: string, error = false, ttlMs = 3000): void {
  if (transientTimer) clearTimeout(transientTimer);
  el.textContent = text;
  el.classList.toggle("coda-status--error", error);
  if (error) {
    el.classList.remove("coda-status--transient");
    // errors stay visible until the next sticky update
    transientTimer = setTimeout(() => {
      el.classList.remove("coda-status--error");
    }, ttlMs * 2);
  } else {
    el.classList.add("coda-status--transient");
    transientTimer = setTimeout(() => {
      el.classList.remove("coda-status--transient");
    }, ttlMs);
  }
}

/** Update the sticky status text (replaces any transient message). */
export function renderStatusBar(el: HTMLElement, text: string): void {
  if (transientTimer) clearTimeout(transientTimer);
  el.textContent = text;
  el.classList.remove("coda-status--error", "coda-status--transient");
}
