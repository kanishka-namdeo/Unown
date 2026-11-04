/**
 * R-1-e2e chunk 5 — the el() attribute-routing unit pin (B-12 class:
 * the junk-expando routing of hyphenless-but-unreflected props).
 *
 * Lane semantics (the OSTINATO_E2E self-skip precedent, applied to
 * the unit lane):
 *   Lane A — `cd apps/ostinato && bun test`: no `bunfig.toml` inside
 *            the app dir, so no DOM globals exist; this file
 *            registers ONE skipped stub and stays DOM-free by
 *            architecture. The pin's import is LAZY (inside the else
 *            branch) because app.ts's module bootstrap runs
 *            `main().catch(...)` on load — touching `document` at
 *            module scope, which would throw between tests in a
 *            DOM-free runtime.
 *   Lane B — `bun test apps/ostinato` from the repo root: the root
 *            `bunfig.toml`'s happy-dom preload provides `document`,
 *            so the real pins RUN here (the 102nd test).
 *
 * The pins (all through the app's own element-creation path):
 *   - `tabindex: "-1"` lands as a real ATTRIBUTE + reflected property
 *     (`getAttribute("tabindex") === "-1"` AND `tabIndex === -1`) —
 *     the B-12 regression: before the fix the property branch set a
 *     junk expando `e.tabindex` and the attribute never landed, so
 *     the element was never focusable
 *   - `tabindex: "0"` → `tabIndex === 0`
 *   - control pins for the two already-correct routes: `aria-label`
 *     and `data-count` land as real attributes
 */
import { test, expect } from "bun:test";

const hasDom = typeof document !== "undefined";

if (!hasDom) {
  // Lane A (DOM-free by architecture): one skipped stub — the pin
  // runs only where a DOM exists (Lane B's happy-dom preload).
  test.skip("el pin — requires a DOM (Lane B's happy-dom provides it)", () => {});
} else {
  test("el: { tabindex: '-1' } lands as the real attribute AND the reflected property", async () => {
    const { el } = await import("./app.js");
    const e = el("div", { tabindex: "-1" });
    expect(e.getAttribute("tabindex")).toBe("-1");
    expect(e.tabIndex).toBe(-1);
  });

  test("el: { tabindex: '0' } lands as the real attribute + tabIndex 0", async () => {
    const { el } = await import("./app.js");
    const e = el("div", { tabindex: "0" });
    expect(e.getAttribute("tabindex")).toBe("0");
    expect(e.tabIndex).toBe(0);
  });

  test("el: { 'aria-label' } still lands as a real attribute (control)", async () => {
    const { el } = await import("./app.js");
    const e = el("div", { "aria-label": "x" });
    expect(e.getAttribute("aria-label")).toBe("x");
  });

  test("el: { 'data-count' } still lands as a real attribute (control)", async () => {
    const { el } = await import("./app.js");
    const e = el("div", { "data-count": "2" });
    expect(e.getAttribute("data-count")).toBe("2");
  });
}
