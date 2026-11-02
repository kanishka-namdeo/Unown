/**
 * Coda — bootable stub entry (ticket C1).
 *
 * The real UI (notes list, markdown editor, task board, search, PWA
 * registration) lands in ticket C2. This stub proves the module loads
 * and the app-local typecheck passes; it must not import anything that
 * requires a build step beyond plain browser module resolution.
 */

const root = document.querySelector("#coda-status");
if (root) {
  root.textContent = "Coda stub loaded — UI arrives in C2.";
}
