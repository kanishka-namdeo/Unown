/**
 * Chaconne — focus-trap DOM-guarded pins (the C-9 lane's DOM half).
 *
 * The cycleFocusWithin wrap law (forward wrap last→first, backward
 * wrap first→last, focus-not-inside jump-to-nearest-end) pinned in
 * happy-dom with a synthetic overlay. The `focusableInOverlay`
 * enumeration (the native focusable + tabindex-positive selectors,
 * the zero-size filter) gets its own pin here; the e2e battery
 * (chaconne-a11y.spec.ts's C-9 extension) pins the live Chrome
 * behavior over a real Chromium.
 *
 * Lane semantics (the Ostinato el.test.ts precedent):
 *   Lane A — `cd apps/chaconne && bun test`: no `bunfig.toml` inside
 *            the app dir → no DOM globals; this file registers ONE
 *            skipped stub and stays DOM-free by architecture. The
 *            import is LAZY (inside the else branch) — module scope
 *            `document` would throw in a DOM-free runtime.
 *   Lane B — `bun test apps/chaconne` from the repo root: the root
 *            `bunfig.toml`'s happy-dom preload provides `document`,
 *            so the 8 pins RUN here.
 *
 * The zero-size filter in `focusableInOverlay`: happy-dom's
 * `getBoundingClientRect` returns zeros (no layout engine), so the
 * filter is relaxed to "not hidden" (the `style.display !== "none"`
 * check) rather than "visible box". The e2e battery (real Chromium)
 * pins the true zero-size filtering; happy-dom pins the enumeration
 * order + the wrap math.
 */
import { test, expect } from "bun:test";

const hasDom = typeof document !== "undefined";

if (!hasDom) {
  test.skip("focus-trap pin — requires a DOM (Lane B's happy-dom provides it)", () => {});
} else {
  /** Build a minimal overlay with 3 focusable children (b1, i1, b2). */
  function makeOverlay(id: string = "ov"): HTMLElement {
    const ov = document.createElement("div");
    ov.id = id;
    const b1 = document.createElement("button"); b1.id = id + "-b1";
    const i1 = document.createElement("input"); i1.id = id + "-i1";
    const b2 = document.createElement("button"); b2.id = id + "-b2";
    ov.append(b1, i1, b2);
    document.body.append(ov);
    return ov;
  }

  function clean(): void { document.body.innerHTML = ""; }

  test("focus-trap: focusableInOverlay 3 focusable children in DOM order", async () => {
    clean();
    const { focusableInOverlay } = await import("./focus-trap.js");
    const ov = makeOverlay("ft1");
    const items = focusableInOverlay(ov);
    expect(items.length).toBe(3);
    expect(items[0].id).toBe("ft1-b1");
    expect(items[1].id).toBe("ft1-i1");
    expect(items[2].id).toBe("ft1-b2");
    clean();
  });

  test("focus-trap: cycleFocusWithin focus-NOT-inside → first (dir +1)", async () => {
    clean();
    const { cycleFocusWithin } = await import("./focus-trap.js");
    const ov = makeOverlay("ft2");
    document.body.focus();
    const handled = cycleFocusWithin(ov, 1);
    expect(handled).toBe(true);
    expect(document.activeElement?.id).toBe("ft2-b1");
    clean();
  });

  test("focus-trap: cycleFocusWithin focus-NOT-inside → last (dir -1)", async () => {
    clean();
    const { cycleFocusWithin } = await import("./focus-trap.js");
    const ov = makeOverlay("ft3");
    document.body.focus();
    const handled = cycleFocusWithin(ov, -1);
    expect(handled).toBe(true);
    expect(document.activeElement?.id).toBe("ft3-b2");
    clean();
  });

  test("focus-trap: cycleFocusWithin wraps forward (last → first)", async () => {
    clean();
    const { cycleFocusWithin } = await import("./focus-trap.js");
    const ov = makeOverlay("ft4");
    (ov.querySelector("#ft4-b2") as HTMLElement).focus();
    const handled = cycleFocusWithin(ov, 1);
    expect(handled).toBe(true);
    expect(document.activeElement?.id).toBe("ft4-b1");
    clean();
  });

  test("focus-trap: cycleFocusWithin wraps backward (first → last)", async () => {
    clean();
    const { cycleFocusWithin } = await import("./focus-trap.js");
    const ov = makeOverlay("ft5");
    (ov.querySelector("#ft5-b1") as HTMLElement).focus();
    const handled = cycleFocusWithin(ov, -1);
    expect(handled).toBe(true);
    expect(document.activeElement?.id).toBe("ft5-b2");
    clean();
  });

  test("focus-trap: cycleFocusWithin moves to next (mid-list, dir +1)", async () => {
    clean();
    const { cycleFocusWithin } = await import("./focus-trap.js");
    const ov = makeOverlay("ft6");
    (ov.querySelector("#ft6-b1") as HTMLElement).focus();
    const handled = cycleFocusWithin(ov, 1);
    expect(handled).toBe(true);
    expect(document.activeElement?.id).toBe("ft6-i1");
    clean();
  });

  test("focus-trap: cycleFocusWithin 0 focusable → returns false", async () => {
    clean();
    const { cycleFocusWithin } = await import("./focus-trap.js");
    const ov = document.createElement("div");
    ov.id = "ft7";
    document.body.append(ov);
    const handled = cycleFocusWithin(ov, 1);
    expect(handled).toBe(false);
    clean();
  });

  test("focus-trap: focusableInOverlay excludes disabled elements", async () => {
    clean();
    const { focusableInOverlay } = await import("./focus-trap.js");
    const ov = document.createElement("div");
    ov.id = "ft8";
    const btn = document.createElement("button");
    btn.id = "ft8-dis";
    btn.disabled = true;
    const input = document.createElement("input");
    input.id = "ft8-ok";
    ov.append(btn, input);
    document.body.append(ov);
    const items = focusableInOverlay(ov);
    expect(items.length).toBe(1);
    expect(items[0].id).toBe("ft8-ok");
    clean();
  });
}
