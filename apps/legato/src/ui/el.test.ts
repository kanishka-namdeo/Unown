/**
 * el.test.ts — the el() attribute-routing law pin (the B-12
 * regression, L-5's day-one law, PLAN §3 L-5).
 *
 * Lane semantics (the el-pin precedent, PLAN §5.3):
 *   Lane A — `cd apps/legato && bun test`: no `bunfig.toml` inside
 *            the app dir, so no DOM globals exist; this file
 *            registers skipped stubs and stays DOM-free by
 *            architecture. The module import is LAZY (inside the
 *            else branch) because app.ts's module-scope bootstrap
 *            calls browserEntry() → dynamic import — touching
 *            `document` at load time in a DOM-guarded path, which
 *            would throw between tests in a DOM-free runtime.
 *   Lane B — `bun test apps/legato` from the repo root: the root
 *            `bunfig.toml`'s happy-dom preload provides `document`,
 *            so the real pins RUN here.
 *
 * The pins (all through the app's own element-creation path):
 *   - `tabindex: "-1"` lands as a real ATTRIBUTE + the reflected
 *     property (`getAttribute("tabindex") === "-1"` AND
 *     `tabIndex === -1`) — the B-12 regression: before the cure
 *     the property branch set a junk expando `e.tabindex` and the
 *     attribute never landed, so the element was never focusable
 *   - `tabindex: "0"` → `tabIndex === 0`
 *   - control pins for the two already-correct routes: `aria-label`
 *     and `data-count` land as real attributes
 *   - the FOCUSABILITY proof: a tabindex="-1" element created via
 *     el() IS focusable (the B-12 class defect — a junk expando
 *     would leave tabIndex at -1 by default, which is NOT the same
 *     as a programmatically-focusable -1 target; the attribute
 *     route sets the real reflection, which the browser honors
 *     for .focus())
 */
import { test, expect } from "bun:test";

const hasDom = typeof document !== "undefined";

if (!hasDom) {
  // Lane A (DOM-free by architecture): skipped stubs — the pins run
  // only where a DOM exists (Lane B's happy-dom preload).
  test.skip("el: tabindex='-1' lands as the real attribute + reflected property (B-12 pin) — requires a DOM (Lane B)", () => {});
  test.skip("el: tabindex='0' lands as the real attribute + tabIndex 0 — requires a DOM (Lane B)", () => {});
  test.skip("el: aria-label + data-count land as real attributes (control) — requires a DOM (Lane B)", () => {});
  test.skip("el: a tabindex='-1' element is programmatically focusable (the B-12 proof) — requires a DOM (Lane B)", () => {});
} else {
  test("el: tabindex='-1' lands as the real attribute + reflected property (the B-12 pin)", async () => {
    const { el } = await import("./el.js");
    const e = el("div", { tabindex: "-1" });
    expect(e.getAttribute("tabindex")).toBe("-1");
    expect(e.tabIndex).toBe(-1);
  });

  test("el: tabindex='0' lands as the real attribute + tabIndex 0", async () => {
    const { el } = await import("./el.js");
    const e = el("div", { tabindex: "0" });
    expect(e.getAttribute("tabindex")).toBe("0");
    expect(e.tabIndex).toBe(0);
  });

  test("el: aria-label + data-count land as real attributes (control)", async () => {
    const { el } = await import("./el.js");
    const e = el("div", { "aria-label": "x", "data-count": "2" });
    expect(e.getAttribute("aria-label")).toBe("x");
    expect(e.getAttribute("data-count")).toBe("2");
  });

  test("el: a tabindex='-1' element is programmatically focusable (the B-12 proof)", async () => {
    const { el } = await import("./el.js");
    const e = el("div", { tabindex: "-1", class: "b12-probe" });
    document.body.append(e);
    e.focus();
    expect(document.activeElement === e || document.activeElement!.isSameNode(e)).toBe(true);
    e.remove();
  });
}
