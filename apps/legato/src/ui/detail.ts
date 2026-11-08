/**
 * detail.ts — the reading view (ticket L-5, PLAN §1.1).
 *
 * The detail pane renders ONE clip: its title, its URL, and the
 * extracted readable text. Keyboard contract:
 *
 *   - **Enter** on the focused list row (or row click) opens detail
 *     for that clip — the app wires this (see app.ts).
 *   - **Esc** while the detail is visible closes it and restores
 *     focus to the ORIGINATING list row (the Ostinato focus-return
 *     lane: the app remembers which row index invoked the detail and
 *     refocuses it after close — focus never wanders to body).
 *   - The detail pane itself is NOT a modal (it is a split pane, not
 *     an overlay), so the Ostinato dialog contract does not apply
 *     here; it is a plain `article` with a live-region status line
 *     for the "N of M" position (the app owns that counter).
 *
 * THE HIGHLIGHTS LANE (L-8 SEAM, documented):
 *   - L-5 renders the clip's existing highlights (if any) in a
 *     read-only lane under the text — the highlight's anchor/quote
 *     + optional note, one block each. This is the STUB: L-8's
 *     annotation UI (the user's ability to CREATE highlights by
 *     selecting text in the body) lands here as a replacement of
 *     this read-only lane. The seam is the `renderHighlights(pane,
 *     clip)` function: L-8 imports it, calls it after painting the
 *     body, and binds selection events. The read-only stub is
 *     deliberately the same call shape, so L-8's work is an
 *     in-place upgrade of one function, not a structural change.
 *   - A clip with zero highlights renders the honest "No highlights
 *     yet" line (never a blank lane — the Q-3 "never a blank" law).
 *
 * DEGRADED CLIPS (T-3/T-6 lanes, PLAN §4.1): when `jsWalled` or
 * `emptyText` is set, the text lane renders the "open in browser"
 * affordance + the title/URL fallback, NOT a silent empty pane.
 */
import { el } from "./el.js";
import {
  createHighlight,
  deleteHighlight,
  listForClip,
  detectDrift,
  HighlightRangeError,
} from "../domain/highlights.js";
import type { Clip, Highlight } from "../domain/types.js";

export interface DetailPaneOpts {
  /** the clip to render (null = the empty detail lane, "select a
   *  clip from the list") */
  clip: Clip | null;
  /** position text ("3 of 12") — the app computes it from the
   *  queue state (L-6 owns the queue; L-5 owns the counter line) */
  positionLabel?: string;
  /** L-7: the tag editor's open action (the app injects it; the
   *  detail pane renders the "Edit tags" button when this is
   *  provided — the visible affordance, not just the 't' key). */
  onEditTags?: () => void;
  /** L-8: called after a highlight is created via text selection.
   *  The app persists (StoragePort) + re-renders. The `id` is the
   *  new Highlight.id allocated by the domain. */
  onHighlightCreated?: (clipId: number, h: Highlight) => void;
  /** L-8: called after a highlight is deleted. The app persists
   *  (StoragePort) + re-renders. The `id` is the deleted
   *  Highlight.id. */
  onHighlightDeleted?: (clipId: number, highlightId: number) => void;
  /** id prefix (tests run multiple panes) */
  idPrefix?: string;
}

/**
 * Render (or re-render) the detail pane. Idempotent: first call
 * attaches the structure, subsequent calls repaint the content.
 */
export function renderDetailPane(root: HTMLElement, opts: DetailPaneOpts): {
  paneEl: HTMLElement;
  highlightsLane: HTMLElement;
} {
  const P = opts.idPrefix ?? "legato";
  const { clip, positionLabel } = opts;

  let paneEl = root.querySelector<HTMLElement>("#" + P + "-detail");
  if (!paneEl) {
    paneEl = el("article", {
      id: P + "-detail",
      class: "legato-detail",
      "aria-label": "Clip detail",
      tabindex: "-1", // programmatic focus target on detail-open + detail-close return (the B-12 cure; NOT a tab stop — tabindex=-1 is reachable via .focus() only, the L-11 a11y battery's tab-order pin's "the reading lane is keyboard-reachable via Enter on a focused row + Esc to return, NOT via Tab" contract)
    }) as unknown as HTMLElement;
    root.append(paneEl);
  }
  paneEl.replaceChildren();

  const highlightsLane = el("section", {
    class: "legato-highlights-lane",
    "aria-label": "Highlights",
  });

  if (clip === null) {
    // The empty detail lane (Q-3: honest, never a blank).
    paneEl.append(
      el("h2", { class: "legato-detail-empty-title", text: "Nothing open" }),
      el("p", {
        class: "legato-detail-empty-copy",
        text: "Select a clip from the list (j/k to move, Enter to open) to read it here.",
      }),
    );
    return { paneEl, highlightsLane };
  }

  // The position line (the app's counter — L-6 will drive the queue).
  if (positionLabel) {
    paneEl.append(el("p", { class: "legato-detail-position", text: positionLabel }));
  }

  // The title + URL.
  paneEl.append(el("h1", { class: "legato-detail-title", text: clip.title }));
  const urlEl = el("a", {
    class: "legato-detail-url",
    text: clip.finalUrl ?? clip.url,
    href: clip.finalUrl ?? clip.url,
  });
  paneEl.append(urlEl);

  // The state badge (the fugue accent-ink trap cured by CONSTRUCTION
  // — the badge class routes through the scheme-paired --badge-ink
  // / --badge-bg tokens in legato.css; the DOM carries the state
  // string, never a color).
  paneEl.append(
    el("span", {
      class: "legato-detail-badge",
      text: clip.state,
      title: "State: " + clip.state,
      "data-state": clip.state,
    }),
  );

  // L-7: the tag editor's visible affordance (the "Edit tags"
  // button — the 't' key shortcut's visible twin; the app wires
  // onEditTags to openTagEditor + renderTagEditor, the Ostinato
  // dialog contract).
  if (opts.onEditTags !== undefined) {
    const editTagsBtn = el("button", {
      class: "legato-detail-edit-tags",
      "aria-label": "Edit tags for this clip (press t)",
      text: "Edit tags (t)",
    }) as HTMLButtonElement;
    editTagsBtn.addEventListener("click", () => opts.onEditTags!());
    paneEl.append(editTagsBtn);
  }

  // The tags lane (L-7 owns tag filtering; L-5 renders the tags
  // that exist on this clip).
  if (clip.tags.length > 0) {
    const tagsEl = el("span", { class: "legato-detail-tags" });
    for (const t of clip.tags) tagsEl.append(el("span", { class: "legato-detail-tag", text: t }));
    paneEl.append(tagsEl);
  }

  // The degraded-clip affordance (T-3/T-6: "open in browser" + the
  // title/URL fallback, never a silent empty pane).
  if (clip.jsWalled || clip.emptyText || clip.error) {
    const errLabel = clip.error ?? "js-walled";
    paneEl.append(
      el("div", {
        class: "legato-detail-degraded",
        role: "alert",
        text:
          (clip.jsWalled
            ? "This page is behind a JS wall — only the title and URL were captured. "
            : clip.error
              ? "Capture was degraded (" + errLabel + "): "
              : "") +
          "Open in your browser for the full page: " +
          (clip.finalUrl ?? clip.url),
      }),
    );
  }

  // The extracted text (the reading lane).
  const bodyEl = el("div", { class: "legato-detail-body", "data-clip-id": String(clip.id) });
  if (clip.text.trim() === "") {
    bodyEl.append(
      el("p", {
        class: "legato-detail-empty-text",
        text: "No readable text was captured for this clip (the page's body was empty or wall-protected).",
      }),
    );
  } else {
    // Newline-preserving text: each paragraph break becomes a <p>.
    for (const para of clip.text.split(/\n\n+/)) {
      const p = para.trim();
      if (p !== "") bodyEl.append(el("p", { text: p }));
    }
    // L-8: highlight the body text with the existing highlights' ranges.
    applyHighlightSpans(bodyEl, clip);
  }
  paneEl.append(bodyEl);

  // L-8: bind the selection → 'h' create + 'x' delete + panel jump-to
  // keyboard contract onto the body element.
  bindHighlightKeyboard(bodyEl, paneEl, clip, P, opts);
  // THE HIGHLIGHTS LANE (the L-8 seam — the documented stub).
  renderHighlights(highlightsLane, clip, opts);
  paneEl.append(highlightsLane);

  return { paneEl, highlightsLane };
}

/**
 * L-8: wrap the quote ranges with <mark> spans in the body DOM.
 * Each existing highlight's quote is located via `clip.text.indexOf(
 * h.quote)` (the drift-safe locate — the drift policy: when the
 * quote no longer appears, it is NOT rendered as a body span,
 * but it remains in the panel with the drift flag).
 */
function applyHighlightSpans(bodyEl: HTMLElement, clip: Clip): void {
  // Walk the <p> children and wrap each highlight's quote range.
  // For each highlight, find the paragraph containing its first
  // character and wrap the range.
  const ps = Array.from(bodyEl.querySelectorAll<HTMLElement>("p"));
  // Build an offset map: for each <p>, its start offset in clip.text.
  // The body renders each paragraph (split on \n\n+) as a <p>.
  const paraStarts: number[] = [];
  let offset = 0;
  for (const p of ps) {
    paraStarts.push(offset);
    offset += (p.textContent ?? "").length + 2; // +2 for the \n\n
  }
  // For each highlight, find which paragraph its quote falls into
  // and wrap it. We locate by text index in clip.text.
  for (const h of clip.highlights) {
    const qStart = clip.text.indexOf(h.quote);
    if (qStart === -1) continue; // drifted — the panel carries it
    const qEnd = qStart + h.quote.length;
    // Find the paragraph that contains qStart.
    let pIdx = -1;
    for (let i = 0; i < ps.length; i++) {
      const psStart = paraStarts[i];
      const pText = ps[i].textContent ?? "";
      if (qStart >= psStart && qStart < psStart + pText.length) {
        pIdx = i;
        break;
      }
    }
    if (pIdx === -1) continue;
    // The offset within the paragraph's text node.
    const withinP = qStart - paraStarts[pIdx];
    const withinPEnd = withinP + h.quote.length;
    wrapRangeInText(ps[pIdx], withinP, withinPEnd, h.id, h.quote);
  }
}

/**
 * Wrap a character range `[start, end)` inside a <p>'s first
 * Text node with a <mark class="legato-highlight-span"> element
 * carrying `data-highlight-id`. If a mark is already there, skip.
 */
function wrapRangeInText(
  p: HTMLElement,
  start: number,
  end: number,
  highlightId: number,
  quote: string,
): void {
  // Skip if this highlight is already wrapped.
  if (p.querySelector<HTMLElement>(`[data-highlight-id="${highlightId}"]`)) return;
  const walker = p.childNodes;
  // Find the Text node that contains the start offset.
  let textNode: Text | null = null;
  let nodeStart = 0;
  for (let i = 0; i < walker.length; i++) {
    const node = walker[i] as Text;
    if (node.nodeType === 3) {
      const nodeLen = node.textContent?.length ?? 0;
      if (start >= nodeStart && start < nodeStart + nodeLen) {
        textNode = node as Text;
        break;
      }
      nodeStart += nodeLen;
    }
  }
  if (!textNode) return;
  const textContent = textNode.textContent ?? "";
  const relStart = start - nodeStart;
  const relEnd = end - nodeStart;
  const before = textContent.slice(0, relStart);
  const mid = textContent.slice(relStart, relEnd);
  const after = textContent.slice(relEnd);
  const mark = el("mark", {
    class: "legato-highlight-span",
    "data-highlight-id": String(highlightId),
    "aria-label": "Highlight: " + quote,
    tabindex: "-1",
  }) as unknown as HTMLElement;
  mark.textContent = mid;
  // Build the replacement nodes via the global document handle.
  const doc = (globalThis as Record<string, unknown>)["document"] as Document | undefined;
  if (!doc) return;
  const parent = textNode.parentNode;
  if (!parent) return;
  const beforeNode = doc.createTextNode(before) as Text;
  const afterNode = doc.createTextNode(after) as Text;
  parent.replaceChild(beforeNode, textNode);
  parent.insertBefore(mark, beforeNode.nextSibling);
  if (after !== "") parent.insertBefore(afterNode, mark.nextSibling);
}

/**
 * L-8: the keyboard + selection binding for the highlight UX.
 *
 * Contract:
 *   - **h** — create a highlight from the current text selection
 *     within the body. The selection range is mapped to character
 *     offsets in `clip.text` via `getSelection()` + range offsets.
 *     On range violation (`HighlightRangeError`), the notice is
 *     surfaced via the `onHighlightCreated` failure path — the
 *     highlight is NOT created (no-silent-truncation law).
 *   - **x** — delete the FOCUSED highlight span (the one with
 *     the active element carrying `data-highlight-id` or the panel
 *     row's attribute (the DOM focus lane).
 *
 * The binding is attached to `bodyEl` (the selection source) and
 * `paneEl` (the keyboard event target for the panel).
 */
function bindHighlightKeyboard(
  bodyEl: HTMLElement,
  paneEl: HTMLElement,
  clip: Clip,
  P: string,
  opts: DetailPaneOpts,
): void {
  // The 'h' key: create a highlight from the current selection.
  bodyEl.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "h" || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    const sel = (globalThis as Record<string, unknown>)["window"] as Window | undefined;
    const selection = sel?.getSelection?.();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const selectedText = selection.toString();
    if (selectedText.trim() === "") return;
    // Map the selection to character offsets in clip.text.
    const offsets = selectionOffsetsInText(bodyEl, range, clip.text);
    if (offsets === null) return; // the selection is not inside the body
    const { start, end } = offsets;
    const now = new Date().toISOString();
    let created: Highlight | null = null;
    let notice: string | null = null;
    try {
      created = createHighlight(clip, start, end, undefined, now);
      // Push onto the clip's highlights array.
      clip.highlights.push(created);
      clip.updatedAt = now;
    } catch (err) {
      if (err instanceof HighlightRangeError) {
        notice =
          "Highlight rejected (" + err.reason + "): " + err.message;
      } else {
        notice = "Highlight rejected: " + String(err);
      }
    }
    // Clear the selection (the visual highlight will be rendered
    // on the next re-render via applyHighlightSpans).
    selection.removeAllRanges();
    if (created !== null) {
      opts.onHighlightCreated?.(clip.id, created);
    } else if (notice !== null) {
      // Surface the rejection via the app's status lane.
      const statusEl = (globalThis as Record<string, unknown>)["document"] as Document | undefined;
      const status = statusEl?.getElementById(P + "-status");
      if (status) status.textContent = notice;
    }
  });

  // The 'x' key: delete the focused highlight.
  paneEl.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "x" || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    const active = (globalThis as Record<string, unknown>)["document"] as Document | undefined;
    const activeEl = active?.activeElement as HTMLElement | null;
    const hlId =
      activeEl?.getAttribute("data-highlight-id") ??
      activeEl?.closest(".legato-highlight-row")?.getAttribute("data-highlight-id");
    if (hlId === null) return;
    const id = Number(hlId);
    deleteHighlight(clip, id);
    opts.onHighlightDeleted?.(clip.id, id);
  });
}

/**
 * Map a DOM Range to character offsets within `clip.text`.
 * Returns `{ start, end }` or null when the range is not fully
 * inside `bodyEl` (the selection escaped the body — no highlight).
 */
function selectionOffsetsInText(
  bodyEl: HTMLElement,
  range: Range,
  text: string,
): { start: number; end: number } | null {
  // Compute the character offset of range.start and range.end
  // within the body's text content.
  const startOffset = charOffset(bodyEl, range.startContainer, range.startOffset);
  const endOffset = charOffset(bodyEl, range.endContainer, range.endOffset);
  if (startOffset === null || endOffset === null) return null;
  if (endOffset <= startOffset) return null; // empty or inverted range
  if (endOffset > text.length) return null; // beyond-length (no-silent-truncation)
  return { start: startOffset, end: endOffset };
}

/**
 * Compute the character offset of a DOM node + offset within
 * `container`'s text content. Returns null when the node is not
 * inside `container`.
 */
function charOffset(
  container: HTMLElement,
  node: Node,
  offset: number,
): number | null {
  // The node must be inside the container.
  if (!container.contains(node)) return null;
  // Use the Range API: a range from the start of the container to
  // the target node+offset, then measure its text length.
  const doc = (globalThis as Record<string, unknown>)["document"] as Document | undefined;
  if (!doc) return null;
  const pre = doc.createRange();
  pre.selectNodeContents(container);
  pre.setEnd(node, offset);
  return pre.toString().length;
}

/**
 * The L-8 highlights panel: the full annotation UI replacing the
 * L-5 read-only stub.
 *
 * The panel renders:
 *   - the honest empty lane (Q-3: never a blank — "No highlights
 *     yet. Select text in the body and press h to highlight.")
 *   - for each highlight: a row with the quote, note, drift
 *     indicator, a jump-to button (scrolls + focuses the body
 *     mark), and a delete button (the 'x' key's visible twin)
 */
export function renderHighlights(
  lane: HTMLElement,
  clip: Clip,
  opts: DetailPaneOpts = { clip: null },
): void {
  lane.replaceChildren();

  if (clip.highlights.length === 0) {
    lane.append(
      el("p", {
        class: "legato-highlights-empty",
        text: "No highlights yet. Select text in the body and press h to create a highlight. (x over a highlighted span deletes it.)",
      }),
    );
    return;
  }

  const sorted = listForClip(clip);

  // The panel heading.
  lane.append(
    el("h3", { class: "legato-highlights-panel-title", text: "Highlights (" + String(clip.highlights.length) + ")" }),
  );

  const panel = el("div", { class: "legato-highlights-panel", "aria-label": "Highlights list" });

  for (const h of sorted) {
    const drift = detectDrift(clip, h);
    const row = el("div", {
      class: "legato-highlight-row" + (drift.drifted ? " legato-highlight-drifted" : ""),
      "data-highlight-id": String(h.id),
    });
    row.append(
      el("button", {
        class: "legato-highlight-jump",
        "aria-label": "Jump to highlight: " + h.quote,
        text: "→",
      }),
    );
    row.append(
      el("blockquote", {
        class: "legato-highlight-block",
      }),
    );
    const block = row.querySelector<HTMLElement>(".legato-highlight-block")!;
    block.append(el("p", { class: "legato-highlight-quote", text: h.quote }));
    if (h.note) block.append(el("p", { class: "legato-highlight-note", text: h.note }));
    if (drift.drifted) {
      block.append(
        el("p", {
          class: "legato-highlight-drift-flag",
          "aria-label": "This highlight's quote is no longer in the clip text (drift)",
          text: "⚠ drifted — the quote no longer appears in this clip's text",
        }),
      );
    }
    block.append(
      el("footer", { class: "legato-highlight-meta", text: drift.anchorNow }),
    );
    row.append(
      el("button", {
        class: "legato-highlight-delete",
        "aria-label": "Delete highlight: " + h.quote + " (press x when focused)",
        text: "×",
      }),
    );
    // Jump-to: scroll the body mark into view + focus it.
    row.querySelector<HTMLElement>(".legato-highlight-jump")?.addEventListener("click", () => {
      const doc = (globalThis as Record<string, unknown>)["document"] as Document | undefined;
      const mark = doc?.querySelector<HTMLElement>(`.legato-highlight-span[data-highlight-id="${h.id}"]`);
      mark?.scrollIntoView({ block: "center", behavior: "smooth" });
      mark?.focus();
    });
    // Delete: the 'x' key's visible twin.
    row.querySelector<HTMLElement>(".legato-highlight-delete")?.addEventListener("click", () => {
      deleteHighlight(clip, h.id);
      opts.onHighlightDeleted?.(clip.id, h.id);
    });
    panel.append(row);
  }
  lane.append(panel);
}
