/**
 * filterbar.test.ts — the L-7 tag filter bar DOM pins (PLAN §3 L-7,
 * PRD V-7).
 *
 * Lane semantics (the el-pin precedent):
 *   Lane A — `cd apps/legato && bun test`: DOM-free; the DOM-
 *            guarded tests register skipped stubs. The DOM-free
 *            half — `tagChips`, `comboLabel` (pure data over the
 *            domain index + combo) — RUNS in both lanes.
 *   Lane B — `bun test apps/legato` from the root: happy-dom
 *            preload provides the DOM; the render + toggle +
 *            clear-all + keyboard-reach pins RUN.
 *
 * Pins (DOM-guarded):
 *   - render from seed: the bar renders one chip per tag in the
 *     domain index, with counts, in canonical order
 *   - toggle composition: clicking a chip toggles its tag in the
 *     AND-combo; clicking two chips builds a two-tag combo (the
 *     composition law's UI half — the app updates filterCombo and
 *     re-renders; the bar is a pure renderer)
 *   - clear-all: the clear button fires onClearAll (the app resets
 *     the whole combo: tags + state + query)
 *   - keyboard reach: the bar's group element carries tabindex="0"
 *     (routes through setAttribute per el.ts's attribute-routing
 *     law); each chip is a natively-focusable <button>
 *   - the active-combo display (aria-live region) updates to
 *     reflect the current combo state
 */
import { test, expect } from "bun:test";
import type { Clip, LegatoData } from "../domain/types.js";
import { buildTagIndex, type FilterCombo, emptyCombo } from "../domain/tags.js";
import { renderFilterBar, tagChips, comboLabel } from "./filterbar.js";

// ─── Pure half (runs in BOTH lanes) ─────────────────────────────

function mkClip(id: number, tags: string[], state: Clip["state"] = "unread"): Clip {
  return {
    id,
    url: "https://example.com/" + id,
    title: "Clip " + id,
    text: "body " + id,
    tags,
    state,
    highlights: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function mkData(clips: Clip[]): LegatoData {
  const tags = new Set<string>();
  for (const c of clips) for (const t of c.tags) tags.add(t);
  return {
    schema: "legato.v1",
    schemaVersion: 1,
    clips,
    tags: [...tags].sort(),
    queue: clips.map((c) => c.id),
  };
}

test("tagChips: renders one entry per tag in the index, canonical order, with counts (pure)", () => {
  const clips = [mkClip(1, ["b", "a"]), mkClip(2, ["a", "c"]), mkClip(3, ["c"])];
  const idx = buildTagIndex(clips);
  const combo: FilterCombo = { tags: ["a"], state: null, query: "" };
  const chips = tagChips(idx, combo);
  expect(chips.map((c) => c.tag)).toEqual(["a", "b", "c"]);
  expect(chips.find((c) => c.tag === "a")!.selected).toBe(true);
  expect(chips.find((c) => c.tag === "b")!.selected).toBe(false);
  expect(chips.find((c) => c.tag === "c")!.count).toBe(2);
});

test("comboLabel: empty combo → 'No tag filter active'; tag combo → the joined tags (pure)", () => {
  expect(comboLabel(emptyCombo())).toBe("No tag filter active");
  expect(comboLabel({ tags: ["a", "b"], state: null, query: "" })).toBe("a + b");
  expect(comboLabel({ tags: ["a"], state: "reading", query: "" })).toBe("a · state: reading");
});

// ─── DOM-guarded half (Lane B only) ─────────────────────────────

const hasDom = typeof document !== "undefined";

if (!hasDom) {
  test.skip("filter bar render + toggle + clear-all + keyboard reach — requires a DOM (Lane B's happy-dom provides it)", () => {});
} else {
  test("filter bar: renders one chip per tag with counts, in canonical order (DOM)", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const clips = [mkClip(1, ["b", "a"]), mkClip(2, ["a", "c"]), mkClip(3, ["c"])];
    const idx = buildTagIndex(clips);
    const combo: FilterCombo = { tags: [], state: null, query: "" };
    const { chipEls, groupEl, comboEl } = renderFilterBar(root, {
      index: idx,
      combo,
      onToggleTag: () => {},
      onClearAll: () => {},
      idPrefix: "fb1",
    });
    expect(chipEls.length).toBe(3);
    expect(groupEl.getAttribute("tabindex")).toBe("0"); // the B-12 law
    expect(groupEl.getAttribute("role")).toBe("group");
    expect(chipEls[0].textContent).toBe("a (2)");
    expect(chipEls[1].textContent).toBe("b (1)");
    expect(chipEls[2].textContent).toBe("c (2)");
    expect(comboEl.textContent).toBe("No tag filter active");
    expect(comboEl.getAttribute("role")).toBe("status");
    root.remove();
  });

  test("filter bar: clicking a chip fires onToggleTag with the right tag; the combo display updates (DOM)", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const clips = [mkClip(1, ["a", "b"]), mkClip(2, ["a"])];
    const idx = buildTagIndex(clips);
    let activeCombo: FilterCombo = { tags: [], state: null, query: "" };
    const toggled: { value: string | null } = { value: null };
    let _touched = false; // prevent TS narrowing

    function paint() {
      const { chipEls, comboEl } = renderFilterBar(root, {
        index: idx,
        combo: activeCombo,
        onToggleTag: (tag: string) => {
          toggled.value = tag;
          // The app updates the combo (XOR toggle semantics) and
          // re-renders — the bar is a pure renderer.
          const i = activeCombo.tags.indexOf(tag);
          if (i >= 0) activeCombo.tags = activeCombo.tags.filter((_, j) => j !== i);
          else activeCombo.tags = [...activeCombo.tags, tag].sort();
          paint();
        },
        onClearAll: () => {
          activeCombo = emptyCombo();
          paint();
        },
        idPrefix: "fb2",
      });
      return { chipEls, comboEl };
    }

    let handles = paint();
    handles.chipEls[0].click(); // toggle "a"
    expect(toggled.value).toBe("a");
    expect(activeCombo.tags).toEqual(["a"]);
    handles = paint();
    expect(handles.comboEl.textContent).toBe("a");
    // Re-render: the "a" chip is now selected (aria-pressed=true).
    const aChip = Array.from(handles.chipEls).find((b) => b.getAttribute("data-tag") === "a")!;
    expect(aChip.getAttribute("aria-pressed")).toBe("true");
    expect(aChip.classList.contains("legato-filter-chip-selected")).toBe(true);

    // Toggle "b" too — the two-tag AND combo composes.
    handles = paint();
    const bChip = Array.from(handles.chipEls).find((b) => b.getAttribute("data-tag") === "b")!;
    bChip.click();
    expect(activeCombo.tags).toEqual(["a", "b"]);
    handles = paint();
    expect(handles.comboEl.textContent).toBe("a + b");
    root.remove();
  });

  test("filter bar: the clear-all button fires onClearAll (the app resets the whole combo) (DOM)", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const clips = [mkClip(1, ["a", "b"]), mkClip(2, ["a"])];
    const idx = buildTagIndex(clips);
    let activeCombo: FilterCombo = { tags: ["a", "b"], state: "reading", query: "" };
    let cleared = false;

    function paint() {
      const { clearBtn, comboEl } = renderFilterBar(root, {
        index: idx,
        combo: activeCombo,
        onToggleTag: (tag: string) => {
          const i = activeCombo.tags.indexOf(tag);
          if (i >= 0) activeCombo.tags = activeCombo.tags.filter((_, j) => j !== i);
          else activeCombo.tags = [...activeCombo.tags, tag].sort();
          paint();
        },
        onClearAll: () => {
          cleared = true;
          activeCombo = emptyCombo();
          paint();
        },
        idPrefix: "fb3",
      });
      return { clearBtn, comboEl };
    }

    let handles = paint();
    expect(handles.comboEl.textContent).toBe("a + b · state: reading");
    handles.clearBtn.click();
    expect(cleared).toBe(true);
    expect(activeCombo.tags).toEqual([]);
    expect(activeCombo.state).toBe(null);
    handles = paint();
    expect(handles.comboEl.textContent).toBe("No tag filter active");
    root.remove();
  });

  test("filter bar: keyboard reach — the group is tabindex=0 (the B-12 law); chips are natively focusable buttons (DOM)", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const clips = [mkClip(1, ["a"]), mkClip(2, ["b"])];
    const idx = buildTagIndex(clips);
    const combo: FilterCombo = { tags: [], state: null, query: "" };
    const { groupEl, chipEls } = renderFilterBar(root, {
      index: idx,
      combo,
      onToggleTag: () => {},
      onClearAll: () => {},
      idPrefix: "fb4",
    });
    // The group's tabindex routes through setAttribute (the B-12
    // cure — the attribute is the truth, not a property expando).
    expect(groupEl.getAttribute("tabindex")).toBe("0");
    expect(groupEl.tabIndex).toBe(0); // reflected property agrees
    // The chips are <button> elements — natively focusable, no
    // tabindex needed (the keyboard-first law: every P0 action
    // reachable without the pointer).
    for (const btn of chipEls) {
      expect(btn.tagName).toBe("BUTTON");
      expect(btn.hasAttribute("tabindex")).toBe(false);
    }
    root.remove();
  });

  test("filter bar: a selected chip carries aria-pressed=true (the toggle-button a11y pattern) (DOM)", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const clips = [mkClip(1, ["a"]), mkClip(2, ["b"])];
    const idx = buildTagIndex(clips);
    const combo: FilterCombo = { tags: ["a"], state: null, query: "" };
    const { chipEls } = renderFilterBar(root, {
      index: idx,
      combo,
      onToggleTag: () => {},
      onClearAll: () => {},
      idPrefix: "fb5",
    });
    const aChip = chipEls.find((b) => b.getAttribute("data-tag") === "a")!;
    const bChip = chipEls.find((b) => b.getAttribute("data-tag") === "b")!;
    expect(aChip.getAttribute("aria-pressed")).toBe("true");
    expect(bChip.getAttribute("aria-pressed")).toBe("false");
    root.remove();
  });
}
