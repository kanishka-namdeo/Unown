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
import type { Clip } from "../domain/types.js";

export interface DetailPaneOpts {
  /** the clip to render (null = the empty detail lane, "select a
   *  clip from the list") */
  clip: Clip | null;
  /** position text ("3 of 12") — the app computes it from the
   *  queue state (L-6 owns the queue; L-5 owns the counter line) */
  positionLabel?: string;
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
      tabindex: "-1", // programmatic focus target on detail-close return
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
  const bodyEl = el("div", { class: "legato-detail-body" });
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
  }
  paneEl.append(bodyEl);

  // THE HIGHLIGHTS LANE (the L-8 seam — the documented stub).
  renderHighlights(highlightsLane, clip);
  paneEl.append(highlightsLane);

  return { paneEl, highlightsLane };
}

/**
 * The L-8 highlights seam (the documented stub L-5 ships):
 * renders the clip's EXISTING highlights read-only. L-8 replaces
 * this function's body with the annotation UI (selection → new
 * highlight); the call site stays the same (one in-place upgrade,
 * not a structural change — the seam's contract is the function
 * name + signature, not its implementation).
 */
export function renderHighlights(lane: HTMLElement, clip: Clip): void {
  lane.replaceChildren();
  if (clip.highlights.length === 0) {
    lane.append(
      el("p", {
        class: "legato-highlights-empty",
        text: "No highlights yet. (L-8 lands the annotation UI here — select text in the body to create a highlight.)",
      }),
    );
    return;
  }
  for (const h of clip.highlights) {
    const block = el("blockquote", { class: "legato-highlight-block" });
    block.append(el("p", { class: "legato-highlight-quote", text: h.quote }));
    if (h.note) block.append(el("p", { class: "legato-highlight-note", text: h.note }));
    block.append(el("footer", { class: "legato-highlight-meta", text: h.anchor }));
    lane.append(block);
  }
}
