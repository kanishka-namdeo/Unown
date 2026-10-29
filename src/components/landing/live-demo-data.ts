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
 *
 * ── Cadence (the cadence round, 2026-10-28) ─────────────────────────────
 * Sources: receipts .unown/receipts/*.jsonl — 11 agent sessions (15 boots)
 * over 8 rounds (plan → lib → api → ui → e2e → review → drill → landing,
 * plus the re-review) · 1,381
 * tool_calls · 9 reviewer-subagent boots · git: the round's commits
 * (94d7cb1 → the round's close) · tests: src/lib/cadence/*.test.ts +
 * src/app/cadence/api/__tests__/*.ts + src/components/cadence/__tests__/
 * *.tsx (96 green across 8 files) · files: 30 under src/. Narrative:
 * docs/cadence-demo-session.md.
 *
 * ── Parley (the parley round, 2026-10-28) ─────────────────────────────
 * Sources: receipts .unown/receipts/2026-10-28*.jsonl (20 main-lane
 * boots, the round's 8 stages: plan → lib → api → ui → e2e → review →
 * drill → landing) · 1,109 tool_calls · git: the round's 7 code commits
 * (6a5ef23 domain → b8d3e0a API → 3d10ed4 UI → c05c9c2 CSP → 9ea0a4f
 * E2E → cf1797f adversarial review; the session-record + benchmark
 * commits are the operator's) · tests: 302 green across 23 files
 * (src/lib/parley + src/app/parley/api/__tests__ +
 * src/components/parley/__tests__) · files: 81 under src/ (lib + api +
 * components + app). Narrative: docs/parley-demo-session.md.
 *
 * ── Fugue (the SOTA round, 2026-10-28) ──────────────────────────────
 * Sources: receipts .unown/receipts/*.jsonl (the build repo,
 * /home/z/my-project/fugue-build) — 26 agent sessions over the round's
 * phase chain (plan → scaffold → domain → auth+API → UI → e2e → review,
 * each capped phase a chunked resume-chain, the cadence round's pattern)
 * · ~640 tool_calls · git: the app's eight agent commits (05eef38 brief →
 * e0a3058 review pass) · tests: src/lib/fugue/*.test.ts +
 * src/components/fugue/*.test.tsx (174 green across 11 files) · files: 38
 * under src/. Narrative: docs/fugue-demo-session.md.
 *
 * ── Aria (the aria round, 2026-10-29) ───────────────────────────────
 * Sources: receipts .unown/receipts/*.jsonl — 21 agent sessions (A1–A21,
 * the round's phase chain: 2 plan boots → 6 lib → 7 api → 6 ui, each
 * capped phase a chunked resume-chain, plus 920 tool_calls counted from
 * the session envelopes — the build-receipt envelopes; the final count
 * lands at release when the E2E + review phases close the round) · git:
 * the round's 4 agent commits so far on main (1998ac5 plan → 782ea8e
 * domain → c34a2b2 api → 6024571 ui; the E2E + embed-landing phases add
 * the round's remaining commits) · tests: the aria surface's 556 green
 * across 34 files (315 lib + 210 api + 31 ui, the phase CP2–CP4
 * receipts) · files: 122 under src/ (36 lib incl. 18 test files, 71 app
 * incl. 49 routes + 14 api test files, 13 components + 2 component test
 * files, provider/page/layout/globals/css). Narrative:
 * docs/aria-demo-session.md.
 *
 * ── Nocturne (the nocturne round, 2026-10-29) ─────────────────────────
 * Sources: the round's session ledger benchmarks/nocturne-round/ux-ledger.md
 * — 19 agent sessions (N1–N19, the round's phase chain: plan → 7 lib → 7
 * api → 4 ui, each capped phase a chunked resume-chain) · 103 files
 * counted by the aria convention (find src/lib/nocturne src/app/nocturne
 * src/components/nocturne -type f; toolCalls unreceipted in the ledger) ·
 * git: the round's 4 app commits (c61c64c plan → ae8defe domain → a769ada
 * api → d697079 ui; the operator's snapshot + housekeeping commits are
 * not the round's) · tests: the nocturne surface's 466 green (360 lib +
 * 78 api + 28 ui, the round's CP1–CP4 receipts) · files: 103 under src/.
 * Narrative: docs/nocturne-demo-session.md (the round's session doc; the
 * receipt link follows the aria convention).
 *
 * ── Encore (the Website Excellence round, 2026-10-29) ─────────────────
 * Sources: the round's session envelopes e1-e10 under
 * benchmarks/website-excellence-round/sessions/ (17 ledgered sessions,
 * 513 tool calls) · git: the round's three agent commits (b89db87 lib →
 * b1c868e UI+loop; the landing phase adds the third) · tests: 125 green
 * (70 lib incl. the five-receipt drift gate + 55 component) · files: 24
 * under src/ + public/. Narrative: docs/encore-demo-session.md — the
 * Website Excellence showcase, the platform critiquing its own design
 * output with receipted scores (the "earned performance").
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
  {
    id: "cadence",
    name: "Cadence",
    route: "/cadence",
    url: "unown-nine.vercel.app/cadence?embed=1",
    poster: "/landing/cadence/poster.png",
    posterAlt:
      "Cadence — the habit & streak tracker app unown built: today check-offs with streaks, a 52-week heatmap and stats, running live",
    resetType: "cadence-reset",
    receipt: {
      sessions: 11,
      toolCalls: 1381,
      files: 30,
      tests: 96,
      commits: 8,
      embeddingAdaptations: 10,
      receiptDoc:
        "https://github.com/kanishka-namdeo/Unown/blob/main/docs/cadence-demo-session.md",
    },
  },
  {
    id: "parley",
    name: "Parley",
    route: "/parley",
    url: "unown-nine.vercel.app/parley?embed=1",
    poster: "/landing/parley/poster.png",
    posterAlt:
      "Parley — the multi-tenant support-inbox SaaS unown built: a live inbox with SLA chips, RBAC-gated views, an invite flow and a customer portal, running live",
    resetType: "parley-reset",
    receipt: {
      sessions: 20,
      toolCalls: 1109,
      files: 81,
      tests: 302,
      commits: 7,
      embeddingAdaptations: 8,
      receiptDoc:
        "https://github.com/kanishka-namdeo/Unown/blob/main/docs/parley-demo-session.md",
    },
  },
  {
    id: "fugue",
    name: "Fugue",
    route: "/fugue/flows",
    url: "unown-nine.vercel.app/fugue/flows?embed=1",
    poster: "/landing/fugue/poster.png",
    posterAlt:
      "Fugue — the AI workflow-automation app unown built: the flows dashboard with its step editor and the per-step run timeline, running live",
    resetType: "fugue-reset",
    receipt: {
      sessions: 26,
      toolCalls: 640,
      files: 38,
      tests: 174,
      commits: 8,
      embeddingAdaptations: 11,
      receiptDoc:
        "https://github.com/kanishka-namdeo/Unown/blob/main/docs/fugue-demo-session.md",
    },
  },
  {
    id: "aria",
    name: "Aria",
    route: "/aria",
    url: "unown-nine.vercel.app/aria?embed=1",
    poster: "/landing/aria/poster.png",
    posterAlt:
      "Aria — the enterprise CRM unown built: accounts, deals, sequences and forecasts, running live",
    resetType: "aria-reset",
    receipt: {
      sessions: 21,
      toolCalls: 920,
      files: 122,
      tests: 556,
      commits: 4,
      embeddingAdaptations: 5,
      receiptDoc:
        "https://github.com/kanishka-namdeo/Unown/blob/main/docs/aria-demo-session.md",
    },
  },
  {
    id: "nocturne",
    name: "Nocturne",
    route: "/nocturne",
    url: "unown-nine.vercel.app/nocturne?embed=1",
    poster: "/landing/nocturne/poster.png",
    posterAlt:
      "Nocturne — the incident-ops dashboard unown built: the live KPI band, open incidents with SLA countdowns, on-call rotations and runbooks, running live",
    resetType: "nocturne-reset",
    receipt: {
      sessions: 28,
      toolCalls: 0, // unreceipted per-envelope in this round's ledger — the counted lane is files/tests/commits
      files: 104,
      tests: 473,
      commits: 8,
      embeddingAdaptations: 6,
      receiptDoc:
        "https://github.com/kanishka-namdeo/Unown/blob/main/docs/nocturne-demo-session.md",
    },
  },
  {
    id: "encore",
    name: "Encore",
    route: "/encore",
    url: "unown-nine.vercel.app/encore?embed=1",
    poster: "/landing/encore/poster.png",
    posterAlt:
      "Encore — the Website Excellence showcase unown built: the platform's own measured story, receipted critique scores and the before/after loop, running live",
    resetType: "encore-reset",
    receipt: {
      sessions: 17,
      toolCalls: 513,
      files: 24,
      tests: 125,
      commits: 3,
      embeddingAdaptations: 0,
      receiptDoc:
        "https://github.com/kanishka-namdeo/Unown/blob/main/docs/encore-demo-session.md",
    },
  },
];

/** The band's default app (the first entry — Sigil Focus). */
export const DEFAULT_DEMO = LIVE_DEMO_APPS[0];
