/**
 * UI shell (PLAN §1.1).
 *
 * Keyboard-first list/detail: j/k nav, / search, Ctrl+K command
 * palette (every P0 action reachable). Theming: light + dark, with
 * the fugue accent-ink a11y trap cured from day one (scheme-paired
 * badge text). The Ostinato dialog contract from day one:
 * role=dialog + aria-modal, attach-before-focus, Tab-trap + Esc
 * focus-return, and the el() tabindex-attribute-routing law (B-12's
 * cure — the B-12 class defect dies here at the design stage).
 *
 * Entries land at L-5: app.ts (boot + every-transition persist),
 * palette.ts, list.ts, detail.ts, queue.ts (L-6), theme.ts,
 * legato.css.
 *
 * L-1 placeholder: the layer contract lives in this comment; the
 * shell lands at L-5.
 */
export {};
