/**
 * queue.ts — the L-6 UI keyboard flows + state chips + empty states
 * (PLAN §3 L-6, §4.4 Q-1..Q-3).
 *
 * The DOMAIN half (state machine, ordering, guard) lives in
 * `src/domain/queue.ts`; this module is the UI layer: it renders
 * the state chips (the badge on each row / the detail badge),
 * paints the queue view toggle (active vs all), surfaces the
 * conflict notice honestly (a live-region div, never silent — Q-1),
 * and renders the Q-3 empty-state panels.
 *
 * KEYBOARD FLOWS (the brief's 'r/d/a/u' bindings):
 *   - 'r' → mark reading · 'd' → mark done · 'a' → archive · 'u' → restore
 *   These are wired in `app.ts`'s `onKey` lane (the j/k cursor
 *   identifies the target clip; the domain `mark*` / `archive*` /
 *   `restore*` functions carry the concurrent-flip guard). This
 *   module exposes the PURE view logic the app calls on each
 *   re-render: which clips to show, which empty panel to paint.
 *
 * FOCUS TRAP AUDIT (Q-2): the palette's dialog contract is
 * verified when a queue command runs from it — the app's
 * `closePalette` fires BEFORE the key is routed, so the palette
 * is already detached + focus has returned to the invoking
 * element by the time the state-flip lane runs. This module
 * documents that audit; the executable pin is in queue.test.ts
 * (Lane B: open palette → run 'a' from the palette lane → the
 * overlay is gone and focus is on the invoking element).
 */
import { el } from "./el.js";
import type { Clip, ClipState } from "../domain/types.js";
import {
  orderQueue, activeClips, allClips,
  queueEmptyKind, filteredEmptyKind,
  type QueueEmptyKind,
} from "../domain/queue.js";
import { STATE_LABELS } from "./list.js";

// ─── The queue view toggle (active queue vs all) ─────────────────

/**
 * The queue view toggle state. The UI carries it in `app.state`
 * (added at L-6); this type is the shared vocabulary.
 */
export type QueueView = "active" | "all";

/**
 * The clips to paint for the current view + search filter state:
 *   - "active" view (default) + no search → `activeClips(data)`
 *   - "all" view + no search → `allClips(data)`
 *   - any view + search active → the search results (the L-5 lane)
 */
export function queueClips(data: { clips: Clip[] }, view: QueueView): Clip[] {
  return view === "all" ? allClips(data as never) : activeClips(data as never);
}

// ─── State chip render ───────────────────────────────────────────

/**
 * The state chip: the badge the list rows and detail pane carry
 * (the fugue accent-ink trap cured by CONSTRUCTION — the chip's
 * color is the scheme-paired --badge-ink/--badge-bg token pair in
 * legato.css; this DOM carries the STATE STRING + a data-state
 * attribute, never a color).
 *
 * Returns the DOM node (the caller appends it).
 */
export function renderStateChip(clip: Clip): HTMLElement {
  return el("span", {
    class: "legato-state-chip",
    "data-state": clip.state,
    text: STATE_LABELS[clip.state],
    title: "State: " + clip.state + "  (r/d/a/u to change)",
  }) as unknown as HTMLElement;
}

/**
 * The chip's text-only form (used by the a11y tests + the
 * detail pane's inline state line): just the label string.
 */
export function chipLabel(clip: Clip): string {
  return STATE_LABELS[clip.state];
}

// ─── The queue empty-state panel (Q-3: never a blank) ───────────

/**
 * Render the queue empty-state panel into `root`. The panel is
 * chosen by `queueEmptyKind` (the domain decision) — the three
 * distinct Q-3 states:
 *   - "no-clips"  — zero clips (the L-5 affordance: "Clip your
 *                   first URL").
 *   - "all-read"  — clips exist but the active queue is empty
 *                   (done / archived out of the default view);
 *                   the panel names it and offers the "All"
 *                   toggle + the archive affordance.
 *   - "no-matches" — a search/tag filter is active and nothing
 *                   matched; the "clear filters" affordance.
 *
 * `onClearFilters` is called when the user clicks the
 * "Clear filters" button (the "no-matches" panel only).
 * `onShowAll` is called when the user clicks "Show all clips"
 * (the "all-read" panel only — it flips the queue toggle to "all").
 *
 * Returns the panel element (the caller appends it; or null when
 * the active view is non-empty — no panel needed).
 */
export function renderQueueEmpty(
  root: HTMLElement,
  kind: QueueEmptyKind | null,
  onClearFilters?: () => void,
  onShowAll?: () => void,
): HTMLElement | null {
  // Remove any existing panel first (idempotent re-render).
  root.querySelector<HTMLElement>("#legato-queue-empty")?.remove();
  if (kind === null) return null;

  const panel = el("div", {
    id: "legato-queue-empty",
    class: "legato-queue-empty legato-empty",
  }) as unknown as HTMLElement;

  if (kind === "no-clips") {
    panel.append(
      el("h2", { class: "legato-empty-title", text: "No clips yet" }),
      el("p", {
        class: "legato-empty-copy",
        text: "Press Ctrl+K and choose “Clip URL” to save a page for offline reading.",
      }),
    );
  } else if (kind === "all-read") {
    panel.append(
      el("h2", { class: "legato-empty-title", text: "All caught up" }),
      el("p", {
        class: "legato-empty-copy",
        text: "Every clip is done or archived — the active queue is empty.",
      }),
    );
    const showAll = el("button", {
      class: "legato-queue-empty-showall",
      text: "Show all clips",
    });
    showAll.addEventListener("click", () => onShowAll?.());
    panel.append(showAll);
  } else {
    // "no-matches"
    panel.append(
      el("h2", { class: "legato-empty-title", text: "No matches" }),
      el("p", {
        class: "legato-empty-copy",
        text: "Nothing in the library matches the current filter.",
      }),
    );
    const clear = el("button", {
      class: "legato-queue-empty-clear",
      text: "Clear filters",
    });
    clear.addEventListener("click", () => onClearFilters?.());
    panel.append(clear);
  }

  root.append(panel);
  return panel;
}

/**
 * The pure empty-state decision over the UI's view state: combines
 * the queue kind (Q-3) with the filtered-empty kind (the search
 * lane). The app calls this on each re-render to pick the panel.
 */
export function queueEmptyKindFor(
  data: { clips: Clip[]; tags: string[]; queue: number[] },
  filterActive: boolean,
  filtered: readonly Clip[],
): QueueEmptyKind | null {
  // the filtered-empty lane owns the "no-matches" panel when a
  // filter is active; the queue lane owns "no-clips" / "all-read".
  // "all-read" only when there are clips; the no-matches panel is
  // only shown when the filter found nothing (the caller may also
  // pass "all-read" when the filter is inactive and the view is empty).
  if (filterActive) return filteredEmptyKind(filtered, true);
  return queueEmptyKind(data as never);
}
