/**
 * The live demos' receipts — one entry per agent-built app the band frames,
 * every number with its source. Authored data (the addons-data pattern),
 * not generated: the counts come from each build round's own artifacts and
 * are re-pinned by the live-demo test (drift between this file and the
 * section is a defect).
 *
 * ── Sigil Focus (the 2026-10-28 live round) ────────────────────────────
 * Sources: receipts agent-demo/.unown/receipts/2026-10-27*.jsonl (200
 * build+polish calls across four boots) · git: the app's four agent
 * commits (df7676d → c6ff4df) · tests: src/lib/sigil/*.test.ts (27 green)
 * · files: the app's 30 source files. Narrative: docs/live-demo-session.md.
 *
 * ── Sigil Bazaar (the commerce round, 2026-10-28) ──────────────────────
 * Sources: receipts sigil-bazaar/.unown/receipts/*.jsonl — 25 session
 * boots over 3 rounds (build → review → browser-QA; the boots are chunked
 * resume-chains of one session, the host sandbox's 10-minute call budget —
 * the round's record documents it) · 838 tool_calls / 836 tool_results /
 * 9 checkpoints auto-written · git: the app's seven agent commits
 * (0ea5eca scaffold → 1c5beda QA fix; the brief and the review-findings
 * staging commits are the operator's) · tests: src/lib/bazaar/*.test.ts
 * (88 green — the QA round added the last 3) · files: 35 under src/
 * (10 components, 16 lib incl. 7 test files, 9 route/layout/css).
 * Narrative + the three briefs: docs/bazaar-demo-session.md.
 */
export interface LiveDemoApp {
  id: string;
  /** Switcher label. */
  name: string;
  /** The route iframed (embed=1 appended by the band). */
  route: string;
  /** The URL bar's truthful text — the deployment's own route. */
  url: string;
  poster: string;
  posterAlt: string;
  /** The reset handshake type the embedded copy listens for. */
  resetType: string;
  receipt: {
    sessions: number;
    toolCalls: number;
    files: number;
    tests: number;
    commits: number;
    embeddingAdaptations: number;
    receiptDoc: string;
  };
}

export const LIVE_DEMO_APPS: LiveDemoApp[] = [
  {
    id: "focus",
    name: "Sigil Focus",
    route: "/demo",
    url: "unown-nine.vercel.app/demo?embed=1",
    poster: "/landing/demo/poster.png",
    posterAlt:
      "Sigil Focus — the kanban board app unown built: four columns with seeded demo tasks, focus timer and stats",
    resetType: "sigil-reset",
    receipt: {
        sessions: 4,
      toolCalls: 200,
      files: 30,
      tests: 27,
      commits: 4,
      embeddingAdaptations: 4,
      receiptDoc:
        "https://github.com/kanishka-namdeo/Unown/blob/main/docs/live-demo-session.md",
    },
  },
  {
    id: "bazaar",
    name: "Sigil Bazaar",
    route: "/bazaar",
    url: "unown-nine.vercel.app/bazaar?embed=1",
    poster: "/landing/bazaar/poster.png",
    posterAlt:
      "Sigil Bazaar — the e-commerce app unown built: an arcane storefront with category filters, cart and checkout, running live",
    resetType: "bazaar-reset",
    receipt: {
      sessions: 3,
      toolCalls: 838,
      files: 35,
      tests: 88,
      commits: 7,
      embeddingAdaptations: 9,
      receiptDoc:
        "https://github.com/kanishka-namdeo/Unown/blob/main/docs/bazaar-demo-session.md",
    },
  },
];

/** The band's default app (the first entry — Sigil Focus). */
export const DEFAULT_DEMO = LIVE_DEMO_APPS[0];
