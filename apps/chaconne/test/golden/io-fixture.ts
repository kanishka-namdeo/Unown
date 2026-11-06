/**
 * The C-8 import/export battery's shared fixture source (PLAN §5 C-8,
 * edge cases 9 + 10). This is the SINGLE source that
 * `scripts/regen-golden.ts` serializes; the golden files under
 * `test/golden/` are committed bytes, not re-derived.
 *
 * Edge case 9 (UNICODE): the recipe names carry non-ASCII characters
 * (Latin, CJK, emoji) so the canonical-JSON golden's byte-stability
 * proof is against \u-escape drift — the committed golden is raw UTF-8.
 *
 * Edge case 10 (future schema): `refusedFixture` is a `chaconne.v2`
 * document that importData MUST refuse with a dry-run report — never a
 * partial import.
 */
import type { ChaconneData } from "../../src/domain/types.js";

/** The C-8 fixture dataset (edge case 9: UNICODE recipe names). */
export const exportFixture: ChaconneData = {
  schema: "chaconne.v1",
  recipes: [
    {
      id: 1,
      name: "naïve-ünicode",
      version: 1,
      steps: [
        { id: 11, kind: "goto", selector: "http://127.0.0.1:4014/test/fixtures/blank.html" },
        { id: 12, kind: "assert-text", selector: "#title", value: "fixture" },
      ],
    },
    {
      id: 2,
      name: "日本語-フロー",
      version: 1,
      steps: [
        { id: 13, kind: "goto", selector: "http://127.0.0.1:4014/test/fixtures/tall.html" },
        { id: 14, kind: "assert-element", selector: "#bottom" },
      ],
    },
    {
      id: 3,
      name: "emoji-🚀-check",
      version: 1,
      steps: [
        { id: 15, kind: "goto", selector: "http://127.0.0.1:4014/test/fixtures/blank.html" },
        { id: 16, kind: "extract", selector: "#title" },
        { id: 17, kind: "screenshot", selector: "*" },
      ],
    },
  ],
  runs: [
    {
      id: 1,
      recipeId: 1,
      recipeVersion: 1,
      status: "ok",
      startedAt: "2026-11-06T00:00:00.000Z",
      finishedAt: "2026-11-06T00:00:05.000Z",
      committedPrefix: 2,
      extracted: {},
      artifacts: [
        {
          name: `2_r1_sha256:${"a".repeat(64)}.png`,
          sha256: "a".repeat(64),
        },
      ],
    },
    {
      id: 2,
      recipeId: 2,
      recipeVersion: 1,
      status: "step-failed",
      startedAt: "2026-11-06T01:00:00.000Z",
      finishedAt: "2026-11-06T01:00:03.000Z",
      committedPrefix: 0,
      failedStepIdx: 1,
      artifacts: [],
    },
  ],
};

/**
 * The edge-case-10 fixture: a `chaconne.v2` document that MUST be
 * refused by importData's schema gate (never a partial import).
 */
export const refusedFixture: Record<string, unknown> = {
  schema: "chaconne.v2",
  recipes: [
    {
      id: 1,
      name: "naïve-ünicode",
      version: 1,
      steps: [
        { id: 11, kind: "goto", selector: "http://127.0.0.1:4014/test/fixtures/blank.html" },
      ],
    },
  ],
  runs: [
    {
      id: 1,
      recipeId: 1,
      recipeVersion: 1,
      status: "ok",
      startedAt: "2026-11-06T00:00:00.000Z",
      finishedAt: "2026-11-06T00:00:05.000Z",
      committedPrefix: 1,
      artifacts: [],
    },
  ],
};
