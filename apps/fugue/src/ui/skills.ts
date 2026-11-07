/**
 * skills.ts — the skills view (F-7 chunk 3, the learning band part
 * two): the engine's skills (adapter-fed) + the staged queue
 * (the app server's read-only /skills-staged route) + the promote
 * hint (the exact human command, rendered as TEXT — never a
 * mutation button: staging -> promotion stays a human mv).
 *
 * Honesty rules (V-41 / E-02):
 *   - engine skills [] → the honest empty state ("no engine skills"),
 *     never a seeded row.
 *   - staged [] → the honest empty state ("nothing staged"), never a
 *     fake candidate.
 *   - the promote hint is the verbatim command
 *     `mv .unown/skills-staged/<name> .unown/skills/<name>` —
 *     readable, copyable, with the one-line note that promotion is
 *     a human decision (the app never automates it, the 2026-10-22
 *     hardening law).
 */

/** One engine skill row (GET /api/skills `skills[]` — the engine's
 *  SkillRow view; the RAW string id passes through uncoerced). */
export interface SkillRecord {
  id: string;
  projectSlug: string; // "" when the engine omits the field
  createdAt: number; // epoch ms (0 when the engine omits it)
  updatedAt: number;
}

/** One staged-queue row (the app server's GET /skills-staged wire
 *  row: the dir name + the SKILL.md's first heading title). */
export interface StagedSkillRow {
  name: string; // the dir name (the raw string id of the candidate)
  title: string; // the SKILL.md's first heading, '#'-stripped
}

export interface SkillsOptions {
  skills: SkillRecord[]; // the engine lane (adapter-fed)
  staged: StagedSkillRow[]; // the staged lane (app-server-fed)
  /** Load-failure reasons for each lane (the E-02 honest panels). */
  skillsError?: string;
  stagedError?: string;
}

/** The exact promote command for one staged candidate — TEXT ONLY.
 *  The human runs it; the app never moves a file (the hardening law). */
export function promoteCommand(name: string): string {
  return `mv .unown/skills-staged/${name} .unown/skills/${name}`;
}

/** One engine-skill row's HTML (the RAW string id in data-skill). */
export function renderSkillRow(s: SkillRecord): string {
  const slug = s.projectSlug !== "" ? `<span class="fugue-skill-slug">${escapeHtml(s.projectSlug)}</span>` : "";
  return `<li class="fugue-skill-row" data-skill="${escapeHtml(s.id)}">
    <span class="fugue-skill-id">${escapeHtml(s.id)}</span>
    ${slug}
    <span class="fugue-skill-timestamps">${s.updatedAt > 0 ? escapeHtml(new Date(s.updatedAt).toISOString()) : "—"} updated</span>
  </li>`;
}

/** One staged-candidate row: the name + title + the promote hint
 *  (the exact command as readable, copyable text + the one-line
 *  human-decision note). Read-only: NO buttons that mutate anything. */
export function renderStagedRow(s: StagedSkillRow): string {
  return `<li class="fugue-staged-row" data-staged="${escapeHtml(s.name)}">
    <span class="fugue-staged-name">${escapeHtml(s.name)}</span>
    ${s.title !== "" ? `<span class="fugue-staged-title">${escapeHtml(s.title)}</span>` : `<span class="fugue-staged-title fugue-staged-title-empty">(no title)</span>`}
    <p class="fugue-promote-hint" data-promote="${escapeHtml(s.name)}">
      <code class="fugue-promote-cmd">${escapeHtml(promoteCommand(s.name))}</code>
      <span class="fugue-promote-note">promotion is a human decision — the app never automates it (no move button here)</span>
    </p>
  </li>`;
}

/** Render the full skills view HTML. Each lane degrades to its own
 *  honest empty / error panel (the V-41 law: no fake data, no
 *  seeded rows; a failed lane surfaces the E-02 panel, never a
 *  silent substitute). */
export function renderSkills(opts: SkillsOptions): string {
  const parts: string[] = [];

  // — the engine lane —
  if (opts.skillsError !== undefined && opts.skillsError !== "") {
    parts.push(
      `<div class="fugue-panel fugue-panel-error" data-panel="skills-load-failed"><h2>Engine skills load failed</h2><p class="fugue-panel-reason">${escapeHtml(opts.skillsError)}</p></div>`,
    );
  } else if (opts.skills.length === 0) {
    parts.push(
      `<div class="fugue-panel" data-panel="no-engine-skills"><h2>No engine skills</h2><p class="fugue-panel-body">The engine's skills table is empty in this lane (GET /api/skills reads the engine DB, not the filesystem). Nothing was seeded — the empty state is the honest one.</p></div>`,
    );
  } else {
    parts.push(
      `<h3>Engine skills</h3><ul class="fugue-skills">${opts.skills
        .map(renderSkillRow)
        .join("\n")}</ul>`,
    );
  }

  // — the staged lane —
  if (opts.stagedError !== undefined && opts.stagedError !== "") {
    parts.push(
      `<div class="fugue-panel fugue-panel-error" data-panel="staged-load-failed"><h2>Staged queue load failed</h2><p class="fugue-panel-reason">${escapeHtml(opts.stagedError)}</p></div>`,
    );
  } else if (opts.staged.length === 0) {
    parts.push(
      `<h3>Staged queue</h3><div class="fugue-panel" data-panel="no-staged"><p class="fugue-panel-body">Nothing is staged under <code>.unown/skills-staged/</code> right now. Staging a candidate (a dir with a SKILL.md) makes it appear here — read-only, with its promote command.</p></div>`,
    );
  } else {
    parts.push(
      `<h3>Staged queue</h3><ul class="fugue-staged">${opts.staged
        .map(renderStagedRow)
        .join("\n")}</ul>`,
    );
  }

  return `<section class="fugue-route" data-route="skills" aria-label="Skills">${parts.join(
    "\n",
  )}</section>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
