/**
 * skill-seeds.ts — starter Agent Skills seeded into ~/.unown/agent/skills/.
 *
 * On first boot the CLI writes each seed to <skills-dir>/<dir>/SKILL.md so the
 * terminal agent starts with a small, opinionated skill library in the
 * agentskills.io format (YAML frontmatter + markdown body, validated by pi's
 * loader). Content deliberately avoids backticks so the template literals stay
 * escape-free.
 */
export interface StarterSkill {
	/** Skill folder name (lowercase-hyphens, becomes the skill name). */
	dir: string;
	/** Full SKILL.md file content (frontmatter + markdown body). */
	skillMd: string;
}

export const STARTER_SKILLS: StarterSkill[] = [
	{
		dir: "unown-self-learning",
		skillMd: `---
name: unown-self-learning
description: Working with unown's learning layer — the in-session note tool for capturing durable pitfalls and conventions, and the injected 4-tier memory stack (policy, project, user, local). Use when working with unown memory, capturing learnings mid-session, deciding whether to record a note, or checking what the agent already remembers about a project.
---

# Using unown's learning layer

unown remembers across sessions. Every session starts with the project's accumulated knowledge already injected, and everything durable you learn this session should be recorded so future sessions start with it too.

## The note tool

- A note tool is available in every unown session. It records a durable observation and delivers it to the AutoDream engine, which consolidates notes into the project's memory.
- Record the note the moment you learn a durable pitfall or convention, not at session end: a discovered footgun, a non-obvious build or test command, a project-specific convention, a workaround that took real search time to find.
- One note, one rule. Notes are consolidated by an automated engine — a focused imperative sentence survives; a rambling narrative does not.

## Writing good notes

- Write rules, not stories. Shape: "When X, do Y" or "Never do X because Z."
- Good: "Run tests with bun test, not npm test — npm test silently skips the suite."
- Good: "Routes must be registered in src/router.ts only; adding them elsewhere doubles the handler."
- Bad: "Spent a while on testing today, confusing at first but it worked out."
- Skip noise: one-off facts, obvious API details, and anything re-derivable from the repo in seconds. Record only what a future session would otherwise get wrong or waste time rediscovering.

## The 4-tier memory stack

- Every session receives the resolved stack: policy → project → user → local. More specific tiers override more general ones.
- Policy — global enterprise rules, highest authority.
- Project — .unown/memory/project.md in the current project, maintained by AutoDream from session notes. Hand edits are allowed and preserved as new versions.
- User — global preferences across projects (~/.unown/memory/user.md).
- Local — .unown/memory/local.md, most specific, gitignored.

## Rules of engagement

- Read the injected memory before re-deriving anything: conventions, pitfalls, and preferred commands are probably already there. Never contradict an explicit project rule; never re-derive a fact the memory already states.
- If injected memory is stale or wrong, fix the tier that owns the fact: edit the file directly, or note the correction so AutoDream consolidates it.
`,
	},
	{
		dir: "verification-first",
		skillMd: `---
name: verification-first
description: Run the project's real checks and read their actual output before claiming any task is finished; write the missing check first when none exists. Use before declaring a task complete, claiming success, finishing an implementation or a fix, or reporting that a bug is resolved.
---

# Verify before declaring done

A task is not done because the code looks right. It is done when the project's own checks pass on the changed code and you have read their real output.

## Before claiming completion

- Identify the project's real check: tests ("bun test", "npm test", "pytest"), build, linter, typecheck — whatever the repo actually uses. Find it in package.json scripts, CI config, or the AGENTS.md instructions.
- Run it, then read the full output — not just the exit code. Skipped tests, warnings, and partial failures hide in the middle of the log.
- Run the narrowest check that covers the change first; run the broader suite too when shared code is touched.
- State what was done and what was verified, naming the exact commands that passed.

## When the task has no check

- Write a minimal check FIRST, before implementing: a script, a test, or an assertion whose output makes success observable.
- A change with no observable success condition is not verifiable. Treat that as a gap in the plan, not a convenience.

## Absolute rules

- Never claim success from code reading alone. Reading proves the code says something — not that it does it.
- When a check fails, fix the root cause. Never weaken, skip, or delete the check — unless you can prove the check itself is wrong, and say so explicitly when you do.
- Feed the actual failing output (error message, line, expected vs actual) into the next attempt. Guessing at fixes wastes turns.
- If verification is genuinely impossible, say so plainly and downgrade the claim to "implemented but not verified". Never present unverified work as done.
`,
	},
	{
		dir: "methodical-debugging",
		skillMd: `---
name: methodical-debugging
description: A disciplined loop for failures whose cause is unknown — reproduce deterministically, shrink to a minimal reproducer, test one explicit hypothesis at a time, instrument instead of guessing, then verify the fix and scan for latent cases. Use when debugging an error, test failure, or unexpected behavior whose cause is unknown.
---

# Debugging failures you don't understand

When the cause is unknown, stop theorizing and start shrinking the problem. Editing several places at once produces new bugs, not fixes.

## The loop

1. Reproduce reliably first. Find the exact command, input, or request that triggers the failure. For intermittent bugs, force determinism — fixed seeds, frozen time, single-threaded execution, a tight retry loop. A failure you cannot reproduce on demand cannot be verified as fixed.
2. Shrink to a minimal reproducer before theorizing. Strip inputs, modules, and steps until removing any one of them stops the failure. The smallest failing case usually points at the cause.
3. Form ONE explicit hypothesis — "X causes this, so changing only X should change the failure like Y" — test it, and record the outcome. Negative results eliminate branches; they are progress.
4. Prefer instrumenting over shotgun edits. Add a log line, assertion, or breakpoint where correct becomes incorrect, and observe actual values. Never edit code based on imagined values.
5. Change one variable at a time. Two simultaneous changes make both results uninterpretable.
6. Divide and conquer: bisect the path between input and symptom — the call chain, the data, or the commit timeline — until the first wrong value appears.

## After the fix

- Verify the original reproduction is gone: run the exact command from step 1.
- Confirm the cause is fixed, not the symptom — ask what else shares that code path or pattern, and check the similar latent cases.
- Add a regression test that fails on the old code and passes now.
- If the root cause is a durable project pitfall others will hit, record a note so it lands in project memory.

## Signs you are off track

- You cannot state the root cause in one sentence after the fix — you patched a symptom.
- The fix touched unrelated files — the reproducer was not minimal.
- Three blind edits in a row without a new observation — go back to instrumenting.
`,
	},
	{
		dir: "repo-exploration",
		skillMd: `---
name: repo-exploration
description: Orient in a codebase before changing it — map the layout and entry points, read the nearest AGENTS.md/CLAUDE.md contract chain, read files fully before editing, and enumerate all usages before changing signatures or exports. Use when entering an unfamiliar repository, planning wide-ranging changes, or locating where a feature lives.
---

# Explore the repo before changing it

In a codebase you do not know, the fastest path to a correct change is reading before writing. Ten minutes of mapping saves hours of wrong assumptions.

## Map the layout first

- Identify the shape: monorepo packages, source module dirs, entry points (main, index, cli), test locations, config files.
- Locate the feature before planning changes: search for its user-facing strings, route or command names, and types, then read the matching module and its callers.
- Note the conventions the repo already commits to — language version, test runner, formatter, import style. They are constraints, not suggestions.

## Read the contracts before editing

- Read the nearest AGENTS.md / CLAUDE.md chain before editing anything: repo root first, then the closest one above the files you will touch. Follow it exactly; it overrides general preference.
- Read a file fully before editing it. Partial reads produce edits that duplicate existing helpers or break invariants five lines below the part you saw.
- Grep for all usages before changing any signature, export, or name. Count call sites — a rename with 40 usages is a wide-ranging change and gets planned like one.

## Match existing conventions

- Prefer the repo's established patterns over importing new libraries or novel abstractions for the same problem. Consistency beats local elegance.
- When conventions are unclear, mirror the closest existing code that solves a similar problem.

## Before wide-ranging changes

- List the affected files first — usages of what changes plus what depends on them — so the blast radius is explicit before the first edit.
- Sequence the changes so the repo keeps working between steps; verify after each step instead of after the whole batch.
- Prefer the smallest change that satisfies the task. Every extra touched file is extra review and regression surface.
`,
	},
];
