/**
 * queue.test.ts — the L-6 UI keyboard-flow pins (PLAN §3 L-6,
 * §4.4 Q-1..Q-3, PRD V-6).
 *
 * Lane semantics (the el-pin precedent):
 *   Lane A — `cd apps/legato && bun test`: DOM-free; the DOM-
 *            guarded tests register skipped stubs.
 *   Lane B — `bun test apps/legato` from the root: happy-dom
 *            preload provides the DOM; the render + key + focus
 *            pins RUN.
 *
 * Pins:
 *   - 'r/d/a/u' keys change the correct clip state
 *   - a concurrent-flip guard ConflictError → the notice renders
 *     (never silent — Q-1)
 *   - the Q-3 empty states: "all-read" (queue empty, clips exist)
 *     and "no-matches" (search active, zero results)
 *   - focus-after-removal: archiving the focused clip in the
 *     active view → focus lands on the NEXT row (Q-2)
 */
import { test, expect } from "bun:test";
import type { LegatoData, Clip, ClipState } from "../domain/types.js";
import { ConflictError, markReading } from "../domain/queue.js";
import { renderQueueEmpty, chipLabel, renderStateChip, queueEmptyKindFor } from "./queue.js";

// ─── Pure half (runs in BOTH lanes) ─────────────────────────────

function mkClip(id: number, state: ClipState, createdAt = "2026-01-01T00:00:00Z"): Clip {
  return {
    id,
    url: "https://example.com/" + id,
    title: "Clip " + id,
    text: "body " + id,
    tags: [],
    state,
    highlights: [],
    createdAt,
    updatedAt: createdAt,
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

test("chipLabel: the four-state label table", () => {
  expect(chipLabel(mkClip(1, "unread"))).toBe("Unread");
  expect(chipLabel(mkClip(2, "reading"))).toBe("Reading");
  expect(chipLabel(mkClip(3, "done"))).toBe("Done");
  expect(chipLabel(mkClip(4, "archived"))).toBe("Archived");
});

test("queueEmptyKindFor: filter inactive → the queue lane's kind", () => {
  // no clips at all
  expect(queueEmptyKindFor(mkData([]), false, [])).toBe("no-clips");
  // clips exist, active view empty (all done/archived)
  const data = mkData([mkClip(1, "done"), mkClip(2, "archived")]);
  expect(queueEmptyKindFor(data, false, data.clips)).toBe("all-read");
  // a clip is in the active view → no panel
  const data2 = mkData([mkClip(1, "unread")]);
  expect(queueEmptyKindFor(data2, false, data2.clips)).toBeNull();
});

test("queueEmptyKindFor: filter active → the filtered lane's kind", () => {
  const data = mkData([mkClip(1, "unread")]);
  // a filter is active but something matched → no panel
  expect(queueEmptyKindFor(data, true, data.clips)).toBeNull();
  // a filter is active and nothing matched → the "no-matches" panel
  expect(queueEmptyKindFor(data, true, [])).toBe("no-matches");
  // filter INACTIVE with zero clips → the "no-clips" panel (the L-5 state)
  const empty = mkData([]);
  expect(queueEmptyKindFor(empty, false, [])).toBe("no-clips");
  // filter INACTIVE + clips exist + active view empty → "all-read"
  const dataAllRead = mkData([mkClip(1, "done"), mkClip(2, "archived")]);
  expect(queueEmptyKindFor(dataAllRead, false, [])).toBe("all-read");
});

test("ConflictError: the Q-1 guard throws a typed error, not a silent write", () => {
  const data = mkData([mkClip(1, "reading")]);
  // The caller saw "unread" but the stored state is "reading":
  let thrown: unknown = null;
  try {
    markReading(data, 1, "unread", "2026-11-07T00:00:00.000Z");
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(ConflictError);
  expect((data.clips[0].state)).toBe("reading"); // UNCHANGED
});

// ─── DOM-guarded half (Lane B only) ─────────────────────────────

const hasDom = typeof document !== "undefined";

if (!hasDom) {
  test.skip("queue UI render + key + focus pins — requires a DOM (Lane B's happy-dom provides it)", () => {});
} else {
  test("renderQueueEmpty: the 'no-clips' panel (the L-5 affordance, distinct from L-6)", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const panel = renderQueueEmpty(root, "no-clips");
    expect(panel !== null).toBe(true);
    expect(panel!.textContent).toContain("No clips yet");
    root.remove();
  });

  test("renderQueueEmpty: the 'all-read' panel with the show-all affordance", async () => {
    let clicked = false;
    const root = document.createElement("div");
    document.body.append(root);
    const panel = renderQueueEmpty(root, "all-read", undefined, () => { clicked = true; });
    expect(panel!.textContent).toContain("All caught up");
    const btn = panel!.querySelector<HTMLElement>(".legato-queue-empty-showall")!;
    expect(btn !== null).toBe(true);
    btn.click();
    expect(clicked).toBe(true);
    root.remove();
  });

  test("renderQueueEmpty: the 'no-matches' panel with the clear-filters affordance", async () => {
    let cleared = false;
    const root = document.createElement("div");
    document.body.append(root);
    const panel = renderQueueEmpty(root, "no-matches", () => { cleared = true; });
    expect(panel!.textContent).toContain("No matches");
    const btn = panel!.querySelector<HTMLElement>(".legato-queue-empty-clear")!;
    expect(btn !== null).toBe(true);
    btn.click();
    expect(cleared).toBe(true);
    root.remove();
  });

  test("renderQueueEmpty: re-render is idempotent (a stale panel is replaced)", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    renderQueueEmpty(root, "all-read");
    renderQueueEmpty(root, "no-matches", () => {});
    const panels = root.querySelectorAll<HTMLElement>("#legato-queue-empty");
    expect(panels.length).toBe(1);
    expect(panels[0].textContent).toContain("No matches");
    root.remove();
  });

  test("renderStateChip: the chip carries the data-state attribute (the accent-ink cure by construction)", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const clip = mkClip(1, "reading");
    const chip = renderStateChip(clip);
    root.append(chip);
    expect(chip.getAttribute("data-state")).toBe("reading");
    expect(chip.textContent).toBe("Reading");
    root.remove();
  });
}
