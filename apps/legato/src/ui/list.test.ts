/**
 * list.test.ts — the clip-list surface pins (L-5, PLAN §1.1: "j/k
 * row movement, Enter opens detail, the row rendering title +
 * snippet + state + tags").
 *
 * Lane semantics (the el-pin precedent):
 *   Lane A — `cd apps/legato && bun test`: DOM-free; the DOM-guarded
 *            tests register skipped stubs. The DOM-FREE half —
 *            `moveSelection` (the j/k cursor math) — RUNS in both
 *            lanes (no DOM needed).
 *   Lane B — `bun test apps/legato` from the root: happy-dom
 *            preload provides the DOM; the render + focus pins RUN.
 */
import { test, expect } from "bun:test";
import { moveSelection } from "./list.js";
import type { Clip } from "../domain/types.js";

// ─── DOM-free half (runs in BOTH lanes) ──────────────────────────

function mkClip(id: number, title: string, text: string, state: Clip["state"] = "unread", tags: string[] = []): Clip {
  return {
    id,
    url: "https://example.com/" + id,
    title,
    text,
    tags,
    state,
    highlights: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

// The j/k-wrap law (the Ostinato cursor math, pinned DOM-free).
test("moveSelection: j (dir=1) wraps from the last row to the first", () => {
  expect(moveSelection(3, 2, 1)).toBe(0);
});
test("moveSelection: k (dir=-1) wraps from the first row to the last", () => {
  expect(moveSelection(3, 0, -1)).toBe(2);
});
test("moveSelection: mid moves are plain increments", () => {
  expect(moveSelection(5, 1, 1)).toBe(2);
  expect(moveSelection(5, 3, -1)).toBe(2);
});
test("moveSelection: out-of-range index is re-clamped before the move", () => {
  expect(moveSelection(3, 99, 1)).toBe(0); // clamped to 2, +1 % 3 = 0
  expect(moveSelection(3, -7, -1)).toBe(2); // clamped to 0, -1 wraps to 2
});
test("moveSelection: a one-row list is a no-op for both directions", () => {
  expect(moveSelection(1, 0, 1)).toBe(0);
  expect(moveSelection(1, 0, -1)).toBe(0);
});
test("moveSelection: an empty list returns 0 (the no-selection position)", () => {
  expect(moveSelection(0, 5, 1)).toBe(0);
  expect(moveSelection(0, 5, -1)).toBe(0);
});

// ─── DOM-guarded half (Lane B only) ───────────────────────────────

const hasDom = typeof document !== "undefined";

if (!hasDom) {
  test.skip("list render + j/k focus + empty-state — requires a DOM (Lane B's happy-dom provides it)", () => {});
} else {
  test("list: renders rows with title + snippet + state + tags, tabindex=-1 (DOM)", async () => {
    const { renderClipList } = await import("./list.js");
    const root = document.createElement("div");
    document.body.append(root);
    const clips = [mkClip(1, "Row One", "body text here", "unread", ["a", "b"])];
    renderClipList(root, {
      clips,
      searchTerms: [],
      selectedIndex: 0,
      onOpen: () => {},
      onSearch: () => {},
      onClipFirst: () => {},
      idPrefix: "t1",
    });
    const rows = root.querySelectorAll<HTMLElement>(".legato-clip-row");
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("Row One");
    expect(rows[0].textContent).toContain("body text here");
    expect(rows[0].textContent).toContain("Unread");
    expect(rows[0].textContent).toContain("a");
    expect(rows[0].getAttribute("tabindex")).toBe("-1"); // the B-12 law
    root.remove();
  });

  test("list: j/k focus movement; row click activates (DOM)", async () => {
    const { renderClipList, focusRow, moveSelection: ms } = await import("./list.js");
    const root = document.createElement("div");
    document.body.append(root);
    let opened = -1;
    const clips = [mkClip(1, "A", "one"), mkClip(2, "B", "two"), mkClip(3, "C", "three")];
    let selected = 0;
    function paint() {
      return renderClipList(root, {
        clips,
        searchTerms: [],
        selectedIndex: selected,
        onOpen: (i) => {
          opened = i;
        },
        onSearch: () => {},
        onClipFirst: () => {},
        idPrefix: "t2",
      });
    }
    let handles = paint();
    selected = ms(3, selected, 1); // j: 0 → 1
    handles = paint();
    focusRow(handles.rowEls, selected);
    const active = document.activeElement;
    expect(active === handles.rowEls[1] || active!.isSameNode(handles.rowEls[1])).toBe(true);
    expect(handles.rowEls[1].getAttribute("aria-current")).toBe("true");
    handles.rowEls[selected].dispatchEvent(new Event("click"));
    expect(opened).toBe(1);
    root.remove();
  });

  test("list: empty clip set shows the honest empty-state panel (DOM)", async () => {
    const { renderClipList } = await import("./list.js");
    const root = document.createElement("div");
    document.body.append(root);
    renderClipList(root, {
      clips: [],
      searchTerms: [],
      selectedIndex: 0,
      onOpen: () => {},
      onSearch: () => {},
      onClipFirst: () => {},
      idPrefix: "t3",
    });
    const empty = root.querySelector<HTMLElement>("#t3-empty");
    expect(empty !== null).toBe(true);
    expect(empty!.textContent).toContain("No clips yet");
    expect(empty!.textContent).toContain("Clip your first URL");
    root.remove();
  });
}
