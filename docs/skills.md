# Skills

Agent Skills — the `SKILL.md` capability packages unown sessions discover, the four starter skills, and how to author your own.

- [What Agent Skills are](#what-agent-skills-are)
- [The four starter skills](#the-four-starter-skills)
- [Where skills live](#where-skills-live)
- [AutoDream-minted skills](#autodream-minted-skills)
- [Authoring a skill](#authoring-a-skill)
- [A complete example](#a-complete-example)
- [How sessions pick them up](#how-sessions-pick-them-up)

Related pages: [usage](usage.md) · [subagents](subagents.md) · [memory](memory.md)

## What Agent Skills are

A skill is a directory containing a `SKILL.md` file — YAML frontmatter plus a Markdown body — following the [Agent Skills](https://agentskills.io) standard that pi implements. Everything else in the directory is freeform: helper `scripts/`, `references/` loaded on demand, `assets/` templates.

Skills use **progressive disclosure**, which is what makes them cheap:

1. At session start, only each skill's `name` and `description` ride the system prompt (in an `<available_skills>` block).
2. When a task matches a description, the agent `read`s the full `SKILL.md` — the body, with all its steps and detail, enters the context only then.
3. The agent follows the instructions, resolving relative paths against the skill's directory.

A hundred skills cost a hundred lines of prompt; only the ones actually used pay for their content.

## The four starter skills

On first run, unown seeds four skills into `~/.unown/agent/skills/` (existing files are never clobbered, so edit them freely):

| Skill | What it teaches |
|---|---|
| `unown-self-learning` | Working with unown's learning layer: when to record a `note`, how to write rules-not-stories ("When X, do Y"), and how the 4-tier [memory](memory.md) stack is structured. |
| `verification-first` | Run the project's real checks and read their actual output before claiming any task is done; write the missing check first when none exists. |
| `methodical-debugging` | A disciplined loop for unknown-cause failures: reproduce deterministically, shrink to a minimal reproducer, test one hypothesis at a time, instrument instead of guessing, then verify and add a regression test. |
| `repo-exploration` | Orient before changing: map layout and entry points, read the nearest `AGENTS.md`/`CLAUDE.md` chain, read files fully before editing, and enumerate all usages before changing signatures. |

## Where skills live

| Location | Scope | Notes |
|---|---|---|
| `~/.unown/agent/skills/` | global | unown's agent dir — the starter skills land here; your personal library too |
| `<project>/.unown/skills/` | project | added by the unown CLI explicitly; **commit these** — this is also where AutoDream mints |
| `~/.agents/skills/` | global | the cross-harness directory pi also scans |
| `<project>/.pi/skills/`, `<project>/.agents/skills/` (and ancestors) | project | scanned by pi once the project is trusted (`/trust`) |

A skill directory is any directory containing `SKILL.md`; nested directories are discovered recursively, and skills with the same name collide noisily (first one found wins).

## AutoDream-minted skills

This is the part that grows on its own. When AutoDream consolidates a project's session notes into memory ([memory](memory.md)) and the notes reveal a **recurring multi-step procedure** — how to run this test suite, how to deploy, how to debug the flaky part — it also mints that procedure as a skill into `<project>/.unown/skills/<name>/SKILL.md`, so the very next session can use it.

The minting pipeline is deliberately conservative:

- at most **2 skills per dream**; minting nothing is a fine outcome,
- proposals are validated against the frontmatter and body contracts and **deduplicated** against everything already on disk and in the engine DB,
- only **new** names are minted — refinement happens by retiring and re-minting,
- minting stops once a project has 24 skills (context-budget ceiling for the skill index),
- every version is recorded in the engine DB with dream provenance — **rollback** restores a previous version's file from the TUI dashboard's Memory screen (`unown dashboard`),
- **retirement** (removing the file) is a deliberate TUI-dashboard action; the engine never deletes your files autonomously.

## Authoring a skill

**Layout:**

```
<skills-dir>/my-skill/
├── SKILL.md              # required: frontmatter + instructions
├── scripts/              # optional helpers the agent runs
├── references/           # optional detail, read on demand
└── assets/               # optional templates
```

**Frontmatter contract:**

| Field | Required | Rules |
|---|---|---|
| `name` | yes | Lowercase a-z, 0-9, hyphens; max 64 chars; no leading/trailing or consecutive hyphens |
| `description` | yes | Max 1024 chars. This is the retrieval trigger — it decides when the agent loads the skill |

Optional fields: `license`, `compatibility` (max 500 chars), `metadata`, `allowed-tools` (experimental), `disable-model-invocation` (hide from the system prompt; only `/skill:name` can run it).

**Writing the description.** Third person, concrete, with explicit "Use when ..." clauses naming the trigger situations. Compare:

```yaml
description: Extracts text and tables from PDF files, fills PDF forms, and merges multiple PDFs. Use when working with PDF documents.
```

```yaml
description: Helps with PDFs.
```

The first gets loaded at the right moment; the second never does.

**Writing the body.**

- Imperative voice, step-by-step, self-contained — the body is loaded alone, with no surrounding conversation.
- Keep it under ~80 lines (AutoDream's minter caps at 120 lines / 8,000 chars); anything longer belongs in `references/` linked by relative path.
- Reference scripts and assets with paths relative to the skill directory.
- Do not mention tools or commands unrelated to the skill's job.

**Validation.** pi validates against the standard: name/description violations warn but still load; a missing or empty description means the skill is **not** loaded; unknown frontmatter fields are ignored.

## A complete example

`<project>/.unown/skills/release-checklist/SKILL.md`:

```markdown
---
name: release-checklist
description: Cuts a release of this service end to end - version bump, changelog, build, smoke test, tag and push. Use when asked to cut, ship, or prepare a release, bump the version, or tag a release.
---

# Cutting a release

Follow this exactly; the order matters because the smoke test needs the
built artifacts.

## 1. Pre-flight

- Run the full suite: bun test. A red suite stops the release.
- Check the working tree is clean (git status); stash or commit first.
- Read CHANGELOG.md to match the existing entry style.

## 2. Version and changelog

- Bump the version in package.json (0.0.x line, reset 2026-10-21: increment
  the patch digit in order — 0.0.1, then 0.0.2, then 0.0.3, and so on —
  until otherwise specified; the tag must equal package.json's version).
- Add a CHANGELOG.md entry under the new version heading summarizing the
  merged PRs since the last tag: git log --oneline $(git describe --tags
  --abbrev=0)..HEAD

## 3. Build and smoke test

- bun run build, then ./scripts/smoke.sh against the build output.
- If the smoke test fails, fix the cause and restart from step 1 - never
  weaken the smoke test to ship.

## 4. Tag and push

- git add CHANGELOG.md package.json && git commit -m "release vX.Y.Z"
- git tag vX.Y.Z
- git push && git push --tags

## 5. Verify

- Confirm the tag exists on the remote: git ls-remote --tags origin
- Report the released version, the tag, and the smoke test result.
```

## How sessions pick them up

- **Discovery happens at session start** — the names and descriptions enter the system prompt, and the agent decides from there. `/reload` re-scans without restarting.
- **`/skill:<name>` commands** — every discovered skill registers as a slash command (e.g. `/skill:release-checklist`) that loads the full SKILL.md and runs it; anything typed after the command is appended to the skill content as a user message (`/skill:release-checklist v1.4.2`). On by default; toggle via `/settings` (`enableSkillCommands`).
- Models do not always read a matching skill unprompted — if you know a skill applies, invoking `/skill:<name>` is the reliable way to force it.

That is the whole loop: you (or AutoDream) write a skill once, every future session sees one line about it, and the procedure itself is loaded only when it is actually needed.
