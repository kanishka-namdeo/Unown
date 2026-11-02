/**
 * Coda — app entry.
 *
 * Wires the app on DOMContentLoaded. The real service-worker
 * registration lands in ticket C3; this entry bootstraps the UI now.
 */

import { App } from "./app";

function boot(): void {
  const app = new App();
  void app.boot();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
