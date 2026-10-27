/**
 * The live demo's receipt — every number the section prints, with its
 * source. Authored data (the addons-data pattern), not generated: the
 * counts come from the build session's own artifacts and are re-pinned by
 * the live-demo test (drift between this file and the section is a defect).
 *
 * Sources (the 2026-10-28 live round, all committed):
 *   - receipts: agent-demo/.unown/receipts/2026-10-27*.jsonl (tool-call
 *     ledgers per session boot; 200 build+polish calls across four boots)
 *   - git: the demo app's four agent commits (df7676d → c6ff4df)
 *   - tests: src/lib/sigil/*.test.ts — 27 assertions-green tests
 *   - files: the app's 30 source files (8 components, 11 lib, 3 API routes,
 *     layout/page/CSS)
 * The full narrative + the brief the agent was given:
 * docs/live-demo-session.md.
 */
export const LIVE_DEMO_RECEIPT = {
  sessions: 4,
  toolCalls: 200,
  files: 30,
  tests: 27,
  commits: 4,
  /** The embedded copy's documented integration adaptations (code comments
   * in the sigil trees + docs/live-demo-session.md). Honest count for the
   * "agent-written" claim: the app as BUILT is 100% agent code; the
   * embedded copy carries these four host-integration patches. */
  embeddingAdaptations: 4,
  receiptDoc: "https://github.com/kanishka-namdeo/Unown/blob/main/docs/live-demo-session.md",
  demoRoute: "/demo",
} as const;

export type LiveDemoReceipt = typeof LIVE_DEMO_RECEIPT;
