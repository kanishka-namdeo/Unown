/**
 * Coda — app entry.
 *
 * Wires the app on DOMContentLoaded. The real service-worker
 * registration lands in ticket C3; this entry bootstraps the UI now.
 */

import { App } from "./app";

function registerServiceWorker(): void {
  // Registration is an enhancement, never a boot dependency. The app fully
  // works with file:// and in browsers without SW support; if the registration
  // fails we log it and move on. Pinned to relative specifier + relative
  // scope so any mount point works (the plan's P0 fix).
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js", { scope: "./" })
      .then((reg) => {
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              // eslint-disable-next-line no-console
              console.info("[coda] new service worker available");
            }
          });
        });
        // eslint-disable-next-line no-console
        console.info("[coda] service worker registered, scope:", reg.scope);
      })
      .catch((err) => {
        // Fail-soft: a SW error must never take the app down with it.
        // eslint-disable-next-line no-console
        console.warn("[coda] service worker registration failed:", err);
      });
  });
}

function boot(): void {
  const app = new App();
  void app.boot();
  registerServiceWorker();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
