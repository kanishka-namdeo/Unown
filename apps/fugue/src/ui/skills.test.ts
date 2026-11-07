/**
 * skills.test.ts — the skills view's Lane A pins (F-7 chunk 3, the
 * learning band part two). DOM-free: drive the pure view-model
 * functions + the renderer over in-memory data, no network, no fs.
 *
 * Pins:
 *   - the honest empty states for BOTH lanes (the engine's skills []
 *     + the staged queue [] — the V-41 law: no fake data, no seeded
 *     rows).
 *   - the title extraction is the adapter/server's job; the view
 *     renders whatever title arrives (a row with no title shows the
 *     honest "(no title)" line, never a fabricated one).
 *   - the promote hint is the EXACT command as text (readable,
 *     copyable): 'mv .unown/skills-staged/<name> .unown/skills/<name>'
 *     + the one-line note that promotion is a human decision (the
 *     app never automates it — no mutation button in the render).
 *   - the RAW string id flows through uncoerced (the F-7 ruling).
 *   - a load-failure lane surfaces the E-02 honest panel, never a
 *     silent substitute.
 */
import { describe, test, expect } from "bun:test";
import {
  renderSkills,
  renderStagedRow,
  renderSkillRow,
  promoteCommand,
  type SkillRecord,
  type StagedSkillRow,
} from "./skills.js";

const SKILL: SkillRecord = {
  id: "skl-8f2b1c0e",
  projectSlug: "agent-service-c5ccfe",
  createdAt: 1794000000000,
  updatedAt: 1794063969594,
};

const STAGED: StagedSkillRow[] = [
  { name: "browser-resilience", title: "Browser resilience — the iframe fill recover pattern" },
  { name: "run-chaconne-tests", title: "" },
  { name: "setup-automation-spend-test", title: "Set up the automation spend test" },
];

describe("the promote hint (the human-decision law)", () => {
  test("the exact mv command is rendered as text", () => {
    expect(promoteCommand("browser-resilience")).toBe(
      "mv .unown/skills-staged/browser-resilience .unown/skills/browser-resilience",
    );
  });

  test("a staged row renders the command in a copyable <code> + the human note", () => {
    const html = renderStagedRow(STAGED[0]);
    expect(html).toContain('data-promote="browser-resilience"');
    // The command text is the verbatim mv command (the human runs it;
    // the app never automates it — the 2026-10-22 hardening law).
    expect(html).toContain(
      "mv .unown/skills-staged/browser-resilience .unown/skills/browser-resilience",
    );
    // The command sits in a <code> block (readable, copyable).
    expect(html).toMatch(/<code class="fugue-promote-cmd">mv \.unown\/skills-staged\/browser-resilience \.unown\/skills\/browser-resilience<\/code>/);
    // The one-line human-decision note (the app never automates it).
    expect(html).toContain("promotion is a human decision");
    // Read-only law: NO button, NO mutation control in the staged row.
    expect(html).not.toContain("<button");
  });

  test("a row with no title shows the honest '(no title)' line", () => {
    expect(renderStagedRow(STAGED[1])).toContain("(no title)");
  });
});

describe("the engine skill row (raw string id, honest fields)", () => {
  test("the RAW string id passes through uncoerced", () => {
    expect(renderSkillRow(SKILL)).toContain('data-skill="skl-8f2b1c0e"');
  });

  test("an empty slug omits the slug span (no fabricated value)", () => {
    expect(renderSkillRow({ ...SKILL, projectSlug: "" })).not.toContain("fugue-skill-slug");
  });

  test("a zero updatedAt renders the honest '— updated' lane", () => {
    expect(renderSkillRow({ ...SKILL, updatedAt: 0 })).toContain("— updated");
  });
});

describe("the full skills view (the two-lane honesty)", () => {
  test("both lanes empty → the two honest empty panels, never fake data", () => {
    const html = renderSkills({ skills: [], staged: [] });
    expect(html).toContain('data-panel="no-engine-skills"');
    expect(html).toContain('data-panel="no-staged"');
    expect(html).toContain("No engine skills");
    expect(html).toContain("Nothing is staged");
  });

  test("a populated lane renders the rows; the other lane stays honest", () => {
    const html = renderSkills({ skills: [SKILL], staged: [] });
    expect(html).toContain('data-skill="skl-8f2b1c0e"');
    expect(html).toContain('data-panel="no-staged"');
    expect(html).not.toContain('data-panel="no-engine-skills"');
  });

  test("the E-02 honest panels: a failed lane surfaces the reason, not a substitute", () => {
    const html = renderSkills({
      skills: [],
      staged: [],
      skillsError: "engine 503 on GET /api/skills",
    });
    expect(html).toContain('data-panel="skills-load-failed"');
    expect(html).toContain("engine 503 on GET /api/skills");
    expect(html).not.toContain('data-panel="no-engine-skills"');
  });

  test("an HTML payload in a load-failure reason is escaped (the XSS pin)", () => {
    const html = renderSkills({
      skills: [],
      staged: [],
      stagedError: '<img src=x onerror=alert(1)>',
    });
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
  });
});
