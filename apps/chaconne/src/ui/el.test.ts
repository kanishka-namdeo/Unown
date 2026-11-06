/**
 * C-3 — the el-kin unit pins (the Ostinato el.test.ts precedent,
 * verbatim lane semantics).
 *
 *   Lane A — `cd apps/chaconne && bun test`: no bunfig inside the app
 *            dir → DOM-free runtime → one skipped stub.
 *   Lane B — `bun test apps/chaconne` from the root: the root
 *            bunfig.toml's happy-dom preload provides `document` →
 *            the real pins RUN.
 *
 * The pins (all through the app's own element-creation path, el.ts):
 *   - `tabindex: "-1"` lands as a real ATTRIBUTE + reflected property
 *     (the B-12 class: the junk-expando regression)
 *   - `tabindex: "0"` → `tabIndex === 0`
 *   - control pins: `aria-label` + `data-count` land as real attributes
 */
import { test, expect } from "bun:test";

const hasDom = typeof document !== "undefined";

if (!hasDom) {
  test.skip("chaconne el pin — requires a DOM (Lane B's happy-dom provides it)", () => {});
} else {
  test("el: { tabindex: '-1' } lands as the real attribute AND the reflected property", async () => {
    const { el } = await import("./el.js");
    const e = el("div", { tabindex: "-1" });
    expect(e.getAttribute("tabindex")).toBe("-1");
    expect(e.tabIndex).toBe(-1);
  });

  test("el: { tabindex: '0' } lands as the real attribute + tabIndex 0", async () => {
    const { el } = await import("./el.js");
    const e = el("div", { tabindex: "0" });
    expect(e.getAttribute("tabindex")).toBe("0");
    expect(e.tabIndex).toBe(0);
  });

  test("el: { 'aria-label' } still lands as a real attribute (control)", async () => {
    const { el } = await import("./el.js");
    const e = el("div", { "aria-label": "x" });
    expect(e.getAttribute("aria-label")).toBe("x");
  });

  test("el: { 'data-count' } still lands as a real attribute (control)", async () => {
    const { el } = await import("./el.js");
    const e = el("div", { "data-count": "2" });
    expect(e.getAttribute("data-count")).toBe("2");
  });
}
