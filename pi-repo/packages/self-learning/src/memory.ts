/**
 * memory.ts — Tiered Memory (pattern 1/5).
 *
 * Hierarchy (most general → most specific):
 *   policy.md  — hard guardrails every agent instance must respect
 *   project.md — durable project/task knowledge (AutoDream writes here)
 *   user.md    — user preferences & working style
 *   local.md   — session-local overrides (most specific wins)
 *
 * The resolved block is injected into the pi system prompt through
 * `agentsFilesOverride`, rendered as <project_instructions> blocks the same
 * way pi natively treats AGENTS.md files.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { store, DATA_DIR } from "./store.ts";
import { emit } from "./bus.ts";

export const MEMORY_DIR = join(DATA_DIR, "memory");
export const TIERS = ["policy", "project", "user", "local"] as const;
export type Tier = (typeof TIERS)[number];

export interface MemoryFile {
	tier: Tier;
	path: string; // virtual path shown to the agent
	content: string;
}

export interface MemoryVersion {
	id: number;
	tier: string;
	version: number;
	content: string;
	changed_by: string;
	note: string | null;
	created_at: number;
}

const VIRTUAL_PATHS: Record<Tier, string> = {
	policy: "memory/tier0-policy.md (enterprise policy — highest authority)",
	project: "memory/tier1-project.md (project memory — maintained by AutoDream & the harness)",
	user: "memory/tier2-user.md (user memory)",
	local: "memory/tier3-local.md (local overrides — highest precedence)",
};

const SEEDS: Record<Tier, string> = {
	policy: `# Tier 0 — Policy (non-negotiable guardrails)

- Never delete or overwrite files outside the current working directory.
- Never install packages, start network listeners, or contact external hosts.
- Always verify your work by running the provided tests before declaring success.
- Keep changes minimal: fix exactly what the task asks for.
- If a verification fails, inspect the failure output and fix the root cause — never edit tests to make them pass.
`,
	project: `# Tier 1 — Project Memory

## Workflow
- The workspace contains a small Node/Bun project with tests. Run tests with \`bun <testfile>\`.
- Verification is automated: a verify script executes after your turn; its output is ground truth.

## Known pitfalls
(empty — the self-improving harness appends lessons from failed runs here)
`,
	user: `# Tier 2 — User Memory

- The user values minimal diffs and clear, idiomatic code.
- Prefer standard library functions over hand-rolled logic.
`,
	local: `# Tier 3 — Local Overrides

(empty — most specific tier; anything here overrides the tiers above)
`,
};

export function tierPath(tier: Tier): string {
	return join(MEMORY_DIR, `${tier}.md`);
}

export function readTier(tier: Tier): string {
	const p = tierPath(tier);
	if (existsSync(p)) return readFileSync(p, "utf8");
	return SEEDS[tier];
}

export function currentVersion(tier: Tier): number {
	const row = store.get<{ version: number }>(`SELECT MAX(version) AS version FROM memory_versions WHERE tier = ?`, [tier]);
	return row?.version ?? 0;
}

export function writeTier(tier: Tier, content: string, changedBy: string, note: string): number {
	mkdirSync(MEMORY_DIR, { recursive: true });
	writeFileSync(tierPath(tier), content, "utf8");
	const version = currentVersion(tier) + 1;
	store.run(
		`INSERT INTO memory_versions (tier, version, content, changed_by, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		[tier, version, content, changedBy, note, Date.now()],
	);
	emit("memory:changed", { tier, version, changedBy, note });
	return version;
}

export function appendRules(tier: Tier, rules: string[], changedBy: string, note: string): number {
	const current = readTier(tier);
	const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
	const block = [``, `<!-- ${changedBy} @ ${stamp} — ${note} -->`, ...rules.map((r) => `- ${r}`)].join("\n");
	const next = current.trimEnd() + "\n" + block + "\n";
	return writeTier(tier, next, changedBy, note);
}

export function seedMemoryIfEmpty() {
	mkdirSync(MEMORY_DIR, { recursive: true });
	for (const tier of TIERS) {
		if (!existsSync(tierPath(tier))) {
			writeTier(tier, SEEDS[tier], "seed", "initial tier seed");
		}
	}
}

/** Overlay = in-memory candidate memory (used by the self-improving harness). */
export type MemoryOverlay = Partial<Record<Tier, string>>;

export function resolveMemoryFiles(overlay?: MemoryOverlay): MemoryFile[] {
	return TIERS.map((tier) => ({
		tier,
		path: VIRTUAL_PATHS[tier],
		content: overlay?.[tier] ?? readTier(tier),
	}));
}

export interface ResolvedMemory {
	files: MemoryFile[];
	block: string;
	totalChars: number;
}

/**
 * Build the resolved memory block. Precedence is explicit in the header:
 * when two tiers conflict, the most specific tier wins.
 */
export function resolveMemory(overlay?: MemoryOverlay): ResolvedMemory {
	const files = resolveMemoryFiles(overlay);
	const header = `# Agent Memory (tiered — most specific tier wins on conflict)

The following memory tiers are loaded from most general to most specific.
When instructions conflict, later (more specific) tiers override earlier ones.
The agent should treat them as accumulated long-term knowledge.

`;
	const block =
		header +
		files
			.map((f) => `<project_instructions path="${f.path}">\n${f.content.trim()}\n</project_instructions>`)
			.join("\n\n");
	return { files, block, totalChars: block.length };
}

export function history(tier: Tier, limit = 30): MemoryVersion[] {
	return store.query<MemoryVersion>(
		`SELECT id, tier, version, content, changed_by, note, created_at FROM memory_versions WHERE tier = ? ORDER BY version DESC LIMIT ?`,
		[tier, limit],
	);
}

export function snapshot(): { tier: string; version: number; content: string; chars: number; updatedAt: number | null }[] {
	return TIERS.map((tier) => {
		const content = readTier(tier);
		const v = currentVersion(tier);
		const last = store.get<{ created_at: number }>(`SELECT created_at FROM memory_versions WHERE tier = ? AND version = ?`, [tier, v]);
		return { tier, version: v, content, chars: content.length, updatedAt: last?.created_at ?? null };
	});
}

export function rollback(tier: Tier, toVersion: number, note = "manual rollback"): number {
	const row = store.get<{ content: string }>(`SELECT content FROM memory_versions WHERE tier = ? AND version = ?`, [tier, toVersion]);
	if (!row) throw new Error(`no version ${toVersion} for tier ${tier}`);
	return writeTier(tier, row.content, "rollback", note);
}
