/**
 * tag-editor.test.ts — the L-7 tag editor dialog DOM pins (PLAN §3
 * L-7, PRD V-7).
 *
 * Lane semantics (the el-pin precedent):
 *   Lane A — `cd apps/legato && bun test`: DOM-free; the DOM-
 *            guarded tests register skipped stubs. The DOM-free
 *            half — `addTagToEditor`, `removeTagFromEditor`
 *            (pure data over the domain's `canonicalTagList`) —
 *            RUNS in both lanes.
 *   Lane B — `bun test apps/legato` from the root: happy-dom
 *            preload provides the DOM; the open/edit/persist/Esc
 *            pins RUN.
 *
 * Pins (the Ostinato dialog contract — the brief's "the dialog
 * contract is law"):
 *   - open: the overlay attaches with role=dialog + aria-modal +
 *     aria-labelledby resolving to the real title element
 *   - edit: adding a tag re-derives the canonical list (the
 *     domain's law — the editor never hand-writes the order);
 *     removing a tag does the same
 *   - persist: the app's onCommit fires with the new tag list on
 *     every add/remove (the Ostinato every-transition rule)
 *   - Esc: the overlay closes + focus returns to the invoking
 *     element (the Ostinato P0 #9 focus-return lane)
 *   - the focus trap: Tab wraps within the dialog
 */
import { test, expect } from "bun:test";
import type { Clip } from "../domain/types.js";
import {
  openTagEditor,
  closeTagEditor,
  renderTagEditor,
  addTagToEditor,
  removeTagFromEditor,
  type TagEditorState,
} from "./tag-editor.js";

// ─── Pure half (runs in BOTH lanes) ─────────────────────────────

function mkEditorState(clip: Clip): TagEditorState {
  const st: TagEditorState = {
    open: true,
    clipId: clip.id,
    tags: [...clip.tags],
    draft: "",
    invokingEl: null,
    onCommit: () => {},
  };
  return st;
}

function mkClip(id: number, tags: string[]): Clip {
  return {
    id,
    url: "https://example.com/" + id,
    title: "Clip " + id,
    text: "body",
    tags,
    state: "unread",
    highlights: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

test("addTagToEditor: adds + re-derives the canonical list (the domain's law)", () => {
  const st = mkEditorState(mkClip(1, ["b", "a"]));
  st.draft = "  Zeta ";
  const next = addTagToEditor(st);
  // The canonical list: normalize + dedupe + ASCII-sort.
  expect(next).toEqual(["a", "b", "zeta"]);
  expect(st.tags).toEqual(["a", "b", "zeta"]);
  expect(st.draft).toBe("");
});

test("addTagToEditor: an empty / whitespace draft adds nothing (returns null)", () => {
  const st = mkEditorState(mkClip(1, ["a", "b"]));
  st.draft = "   ";
  expect(addTagToEditor(st)).toBeNull();
  expect(st.tags).toEqual(["a", "b"]); // unchanged
});

test("addTagToEditor: adding a tag already present is idempotent (no duplicate)", () => {
  const st = mkEditorState(mkClip(1, ["a"]));
  st.draft = "A"; // case-variant of "a"
  const next = addTagToEditor(st);
  expect(next).toEqual(["a"]);
});

test("removeTagFromEditor: drops the tag + re-derives the canonical list", () => {
  const st = mkEditorState(mkClip(1, ["a", "b", "c"]));
  const next = removeTagFromEditor(st, "b");
  expect(next).toEqual(["a", "c"]);
  expect(st.tags).toEqual(["a", "c"]);
});

// ─── DOM-guarded half (Lane B only) ─────────────────────────────

const hasDom = typeof document !== "undefined";

if (!hasDom) {
  test.skip("tag editor dialog open / edit / persist / Esc — requires a DOM (Lane B's happy-dom provides it)", () => {});
} else {
  test("tag editor: opens with the Ostinato dialog contract (role=dialog, aria-modal, aria-labelledby) (DOM)", async () => {
    const clip = mkClip(1, ["a"]);
    let committed: number[] | null = null;
    const st: TagEditorState = {
      open: false,
      clipId: null,
      tags: [],
      draft: "",
      invokingEl: null,
      onCommit: (clipId: number, tags: string[]) => {
        committed = [clipId];
      },
    };
    openTagEditor(st, clip);
    expect(st.open).toBe(true);
    expect(st.clipId).toBe(1);
    expect(st.tags).toEqual(["a"]);
    renderTagEditor(st);
    const overlay = document.getElementById("legato-tag-editor")!;
    expect(overlay !== null).toBe(true);
    expect(overlay.getAttribute("role")).toBe("dialog");
    expect(overlay.getAttribute("aria-modal")).toBe("true");
    expect(overlay.getAttribute("aria-labelledby")).toBe("legato-tag-editor-title");
    // The aria-labelledby target resolves to a real, visible element
    // (never a dangling id).
    const title = document.getElementById("legato-tag-editor-title");
    expect(title !== null).toBe(true);
    expect(title!.tagName).toBe("H2");
    expect(title!.textContent).toBe("Edit tags");
    // Attach-before-focus: the input received focus after the
    // overlay was in the DOM.
    const input = overlay.querySelector<HTMLElement>(".legato-tag-editor-input");
    expect(document.activeElement === input).toBe(true);
    closeTagEditor(st);
    expect(document.getElementById("legato-tag-editor")).toBeNull();
  });

  test("tag editor: adding a tag fires onCommit with the re-derived canonical list (the persist lane) (DOM)", async () => {
    const clip = mkClip(1, ["b", "a"]);
    const commits: string[][] = [];
    const st: TagEditorState = {
      open: true,
      clipId: 1,
      tags: [...clip.tags],
      draft: "",
      invokingEl: null,
      onCommit: (_clipId: number, tags: string[]) => {
        commits.push(tags);
      },
    };
    renderTagEditor(st);
    const overlay = document.getElementById("legato-tag-editor")!;
    const input = overlay.querySelector<HTMLInputElement>(".legato-tag-editor-input")!;
    input.value = "zeta";
    // Press Enter in the input (the keyboard-first law).
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    // The commit fired with the re-derived canonical list.
    expect(commits.length).toBe(1);
    expect(commits[0]).toEqual(["a", "b", "zeta"]);
    closeTagEditor(st);
  });

  test("tag editor: removing a tag fires onCommit with the re-derived canonical list (the persist lane) (DOM)", async () => {
    const clip = mkClip(1, ["a", "b", "c"]);
    const commits: string[][] = [];
    const st: TagEditorState = {
      open: true,
      clipId: 1,
      tags: [...clip.tags],
      draft: "",
      invokingEl: null,
      onCommit: (_clipId: number, tags: string[]) => {
        commits.push(tags);
      },
    };
    renderTagEditor(st);
    const overlay = document.getElementById("legato-tag-editor")!;
    const bChip = overlay.querySelector<HTMLElement>('[data-tag="b"]')!;
    bChip.click();
    expect(commits.length).toBe(1);
    expect(commits[0]).toEqual(["a", "c"]);
    closeTagEditor(st);
  });

  test("tag editor: Esc closes the overlay + returns focus to the invoking element (the Ostinato P0 #9 focus-return lane) (DOM)", async () => {
    const clip = mkClip(1, ["a"]);
    const st: TagEditorState = {
      open: false,
      clipId: null,
      tags: [],
      draft: "",
      invokingEl: null,
      onCommit: () => {},
    };
    // The invoking element (the detail pane in the app; here a
    // test stand-in) gets focus first.
    const invoker = document.createElement("button");
    invoker.id = "tag-editor-invoker";
    document.body.append(invoker);
    invoker.focus();
    openTagEditor(st, clip);
    expect(st.invokingEl === invoker || st.invokingEl!.isSameNode(invoker)).toBe(true);
    renderTagEditor(st);
    // Dispatch Esc to the overlay (the dialog's own key handler).
    const overlay = document.getElementById("legato-tag-editor")!;
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    // The overlay is gone + focus returned to the invoking element.
    expect(document.getElementById("legato-tag-editor")).toBeNull();
    expect(document.activeElement === invoker || document.activeElement!.isSameNode(invoker)).toBe(true);
    invoker.remove();
  });

  test("tag editor: the focus trap — Tab wraps within the dialog (the Ostinato dialog contract) (DOM)", async () => {
    const clip = mkClip(1, ["a", "b"]);
    const st: TagEditorState = {
      open: true,
      clipId: 1,
      tags: [...clip.tags],
      draft: "",
      invokingEl: null,
      onCommit: () => {},
    };
    renderTagEditor(st);
    const overlay = document.getElementById("legato-tag-editor")!;
    const stops = Array.from(
      overlay.querySelectorAll<HTMLElement>("input, button"),
    ).filter((e) => !e.hasAttribute("disabled"));
    // The focus stops: the add input, the Add button, the two tag
    // chips, the Cancel button.
    expect(stops.length).toBeGreaterThanOrEqual(4);
    // Simulate a Tab from the last stop → wraps to the first.
    const lastIdx = stops.length - 1;
    stops[lastIdx].focus();
    const tabEvt = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    overlay.dispatchEvent(tabEvt);
    // After the wrap, focus should be on the first stop.
    expect(
      document.activeElement === stops[0] ||
        document.activeElement!.isSameNode(stops[0]),
    ).toBe(true);
    closeTagEditor(st);
  });

  test("tag editor: the Cancel button closes the overlay (the Esc lane's visible twin) (DOM)", async () => {
    const clip = mkClip(1, ["a"]);
    const st: TagEditorState = {
      open: false,
      clipId: null,
      tags: [],
      draft: "",
      invokingEl: null,
      onCommit: () => {},
    };
    openTagEditor(st, clip);
    renderTagEditor(st);
    const overlay = document.getElementById("legato-tag-editor")!;
    const cancelBtn = overlay.querySelector<HTMLElement>(".legato-tag-editor-cancel")!;
    cancelBtn.click();
    expect(document.getElementById("legato-tag-editor")).toBeNull();
    expect(st.open).toBe(false);
  });
}
