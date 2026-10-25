/**
 * status-card.ts — `/status` and `/diff`, the in-session visibility pair
 * (the 2026-10-25 completion round).
 *
 * Competitive basis: Codex `/status` (the model/effort/permissions/working-dir
 * card) and Codex `/diff`; Claude Code shows the same facts across /status,
 * /model and /cost; Crush renders an inline diff view. Unown had every FACT
 * already — version, model, thinking level, permission mode, engine health,
 * worktree state, memory stack — but no one-glance view that assembles them:
 * `unown doctor` is config-first, pi's `/session` is message/token stats
 * only, `/engine` is health-only, `/permissions` is the rules table. The gap
 * the sweep kept flagging was exactly the assembly: "what am I running right
 * now" needed three commands to answer.
 *
 * `/diff` completes the git workflow family: `/commit` stages and commits,
 * `/blame` audits, but there was no way to SEE the working tree before
 * committing — the workflow users run before every commit in every other
 * agent (aider /diff, Codex /diff, Crush's diff rendering).
 *
 * Everything here is read-only: git through the hardened read-only runner
 * (gittools.runGit), the engine through the file/loop snapshot (never a live
 * probe on the hot path), memory through the terminal resolver.
 */

import { basename, join } from "node:path";

import { getEngineStatusInfo } from "./engine-status.ts";
import { agentGitSha } from "./engine-version.ts";
import { runGit as runGitHardened } from "./gittools.ts";
import { readInstallMetadata } from "./install-layout.ts";
import { unownHome, unownVersion } from "./packaging.ts";
import { findGitRepo, worktreeRoot } from "./worktree.ts";

// ---------------------------------------------------------------------------
// The card (pure — every input is injectable so the renderer is unit-tested
// without a TUI, a git repo or a live engine)
// ---------------------------------------------------------------------------

export interface StatusCardInput {
	/** e.g. "0.0.15" */
	version: string;
	/** The checkout's git sha (unown info's own attribution field). */
	gitSha?: string;
	sessionId?: string;
	sessionName?: string;
	messageCount?: number;
	model?: { provider?: string | null; model: string | null };
	/** The install receipt, when this machine has one (install-surface.ts's
	 *  source): which channel installed this, at which version. */
	install?: { mode: string; version: string; platform?: string };
	/** pi's thinking level (unown's --effort maps here). */
	thinkingLevel?: string;
	permissionMode?: string;
	permissionModeSource?: "config" | "session";
	/** "up" | "down" | "unknown" from the engine status snapshot. */
	engineState?: string;
	engineVersion?: string;
	/** The managed tree name when the session runs inside `--worktree`. */
	worktree?: string | null;
	git?: { branch?: string; modified: number; untracked: number } | null;
	/** Resolved memory tiers (names) + injected chars. */
	memory?: { tiers: string[]; chars: number } | null;
	/** Additional working directories granted via --add-dir / /add-dir. */
	addDirs?: number;
	/** Flags that are active and surprising enough to name on the card. */
	notes?: string[];
}

/** Render the card. Plain text (the TUI notify pane is not a pager); each
 *  section is one line so the card stays inside a toast at 80 columns. */
export function renderStatusCard(input: StatusCardInput): string {
	const lines: string[] = [];
	lines.push(`unown v${input.version}${input.gitSha ? ` (${input.gitSha.slice(0, 8)})` : ""}`);
	if (input.install) {
		const plat = input.install.platform ? ` (${input.install.platform})` : "";
		lines.push(`install ${input.install.mode} v${input.install.version}${plat}`);
	}
	const sessionBits: string[] = [];
	if (input.sessionName) sessionBits.push(`"${input.sessionName}"`);
	if (input.sessionId) sessionBits.push(`id ${String(input.sessionId).slice(0, 8)}`);
	if (input.messageCount !== undefined) sessionBits.push(`${input.messageCount} message(s)`);
	lines.push(`session ${sessionBits.length > 0 ? sessionBits.join(" · ") : "(in-memory)"}`);
	if (input.model) {
		const via = input.model.provider ? ` via ${input.model.provider}` : "";
		lines.push(
			`model ${input.model.model ?? "(unset — see /model)"}${via}${input.thinkingLevel ? ` · thinking ${input.thinkingLevel}` : ""}`,
		);
	}
	if (input.permissionMode) {
		const src = input.permissionModeSource === "session" ? " (session override)" : "";
		lines.push(`permissions ${input.permissionMode}${src}${input.addDirs ? ` · ${input.addDirs} add-dir(s)` : ""}`);
	}
	if (input.memory) {
		const tiers = input.memory.tiers.length > 0 ? input.memory.tiers.join(" + ") : "none";
		lines.push(`memory ${tiers} · ~${input.memory.chars.toLocaleString()} chars injected`);
	}
	const engine =
		input.engineState === "up"
			? `up${input.engineVersion ? ` (v${input.engineVersion})` : ""}`
			: input.engineState === "down"
				? "down (terminal mode — notes queue in the outbox)"
				: "unknown (no probe yet this session)";
	lines.push(`engine ${engine}`);
	if (input.worktree)
		lines.push(`worktree ${input.worktree} (a --worktree session — changes stay in the tree until merged)`);
	if (input.git) {
		const dirtyBits: string[] = [];
		if (input.git.modified > 0) dirtyBits.push(`${input.git.modified} modified`);
		if (input.git.untracked > 0) dirtyBits.push(`${input.git.untracked} untracked`);
		const dirty = dirtyBits.length > 0 ? ` · ${dirtyBits.join(", ")}` : " · clean";
		lines.push(`git ${input.git.branch ?? "(no branch)"}${dirty} (/diff to view)`);
	} else {
		lines.push("git — not inside a repository");
	}
	for (const note of input.notes ?? []) lines.push(note);
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Collection (the impure half: git, engine snapshot, memory resolver)
// ---------------------------------------------------------------------------

/** Cheap git facts through the hardened read-only runner. Null outside a repo. */
export async function collectGitFacts(cwd: string): Promise<StatusCardInput["git"]> {
	const repoRoot = await findGitRepo(cwd);
	if (repoRoot === null) return null;
	const branch = await runGitHardened(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
	const status = await runGitHardened(cwd, ["status", "--porcelain"]);
	if (status.code !== 0) return null;
	let modified = 0;
	let untracked = 0;
	for (const line of status.stdout.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (trimmed.startsWith("??")) untracked++;
		else modified++;
	}
	return {
		branch: branch.code === 0 ? branch.stdout.trim() : undefined,
		modified,
		untracked,
	};
}

/** The managed session-worktree name when cwd lives under .unown/worktrees/. */
export async function detectSessionWorktree(cwd: string): Promise<string | null> {
	const repoRoot = await findGitRepo(cwd);
	if (repoRoot === null) return null;
	const wtRoot = worktreeRoot(repoRoot);
	if (cwd === wtRoot || !cwd.startsWith(wtRoot)) return null;
	const rel = cwd.slice(wtRoot.length).replace(/^[\\/:]+/, "");
	const name = rel.split(/[\\/]/)[0];
	return name && name.length > 0 ? name : null;
}

/** Memory tiers + injected chars (the terminal resolver /context already
 *  visualizes in depth; the card carries only the one-line summary). */
async function collectMemoryFacts(cwd: string): Promise<StatusCardInput["memory"] | null> {
	try {
		// Lazy import keeps the module importable from contexts that do not want
		// the term.ts graph loaded (its store.ts opens SQLite at module scope —
		// the suite's _env.ts redirect covers tests; here the TUI owns it).
		const { terminalMemoryForAgentDetailed } = await import("./term.ts");
		const { files } = terminalMemoryForAgentDetailed(cwd);
		if (!Array.isArray(files) || files.length === 0) return null;
		let chars = 0;
		const tiers: string[] = [];
		for (const f of files as Array<{ tier?: string; content?: string }>) {
			if (typeof f.content === "string") chars += f.content.length;
			// TerminalMemoryFile carries `tier` (the resolution tier) and a
			// display `path` — tier is the label the card wants (live: the first
			// cut read a nonexistent `name` field and printed "memory none"
			// over ~7,000 real chars).
			if (typeof f.tier === "string" && !tiers.includes(f.tier)) tiers.push(f.tier);
		}
		return { tiers, chars };
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Command registration (/status + /diff)
// ---------------------------------------------------------------------------

export interface StatusCommandsOptions {
	cwd: string;
	/** Live permissions status (the gate bootRuntime owns); absent → the card
	 *  simply omits the line (subagent contexts have no gate of their own). */
	permissionsStatus?: () => { disabled: boolean; mode: string; modeSource: "config" | "session" } | undefined;
	/** Test override for the version (defaults to unownVersion()). */
	version?: string;
	/** Additional dirs granted to the session (--add-dir / /add-dir). */
	addDirs?: () => number | undefined;
	verbose?: boolean;
}

export function registerStatusCommands(pi: any, opts: StatusCommandsOptions): void {
	pi.registerCommand("status", {
		description: "One-glance session card: model, thinking, permissions, memory, engine, worktree, git",
		handler: async (_args: string | undefined, ctx: any) => {
			// The real version comes from the caller (cli.ts's VERSION, resolved from
			// the repo package.json relative to import.meta.dir); the fallback reads
			// the SAME path so a bare registerStatusCommands still reports honestly.
			const version = opts.version ?? unownVersion(join(import.meta.dir, "..", "..", "..", "..", "package.json"));
			const [git, worktreeName] = await Promise.all([collectGitFacts(opts.cwd), detectSessionWorktree(opts.cwd)]);
			const engine = (() => {
				try {
					return getEngineStatusInfo();
				} catch {
					return undefined;
				}
			})();
			const entries =
				typeof ctx?.sessionManager?.getEntries === "function" ? (ctx.sessionManager.getEntries() as any[]) : [];
			const sessionId =
				typeof ctx?.sessionManager?.getSessionId === "function" ? ctx.sessionManager.getSessionId() : undefined;
			const sessionName =
				typeof ctx?.sessionManager?.getSessionName === "function" ? ctx.sessionManager.getSessionName() : undefined;
			const model = (() => {
				try {
					const m = typeof ctx?.getModel === "function" ? ctx.getModel() : undefined;
					if (m && typeof m.id === "string") return { provider: m.provider ?? null, model: m.id };
				} catch {
					/* fall through to the entries-derived model */
				}
				// Last model_change / assistant provider+model in the session log.
				for (let i = entries.length - 1; i >= 0; i--) {
					const e = entries[i];
					if (e?.type === "model_change" && typeof e.modelId === "string") {
						return { provider: typeof e.provider === "string" ? e.provider : null, model: e.modelId };
					}
					const msg = e?.message;
					if (msg?.role === "assistant" && typeof msg.model === "string") {
						return { provider: typeof msg.provider === "string" ? msg.provider : null, model: msg.model };
					}
				}
				return undefined;
			})();
			const thinkingLevel = (() => {
				try {
					return typeof ctx?.getThinkingLevel === "function" ? ctx.getThinkingLevel() : undefined;
				} catch {
					return undefined;
				}
			})();
			const perms = (() => {
				try {
					const s = opts.permissionsStatus?.();
					if (!s || s.disabled) return undefined;
					return { mode: s.mode, source: s.modeSource };
				} catch {
					return undefined;
				}
			})();
			const addDirs = (() => {
				try {
					return opts.addDirs?.();
				} catch {
					return undefined;
				}
			})();
			const memory = await collectMemoryFacts(opts.cwd);
			// The install receipt is optional state: a dev run straight from a clone
			// may never have written one, and the card simply omits the line.
			const install = (() => {
				try {
					const meta = readInstallMetadata(unownHome());
					return meta ? { mode: meta.mode, version: meta.version, platform: meta.platform } : undefined;
				} catch {
					return undefined;
				}
			})();
			const card = renderStatusCard({
				version,
				gitSha: agentGitSha(),
				sessionId,
				sessionName,
				messageCount: entries.filter((e) => e?.type === "message").length,
				model,
				thinkingLevel,
				permissionMode: perms?.mode,
				permissionModeSource: perms?.source,
				engineState: engine?.state,
				// EngineStatusInfo.engineVersion is an EngineBuildRef object, not a
				// string (live: the card printed "v[object Object]") — take its
				// .version field, the same thing engine-status.ts renders.
				engineVersion:
					typeof engine?.engineVersion?.version === "string" ? engine.engineVersion.version : undefined,
				worktree: worktreeName,
				git,
				memory,
				addDirs,
				install,
			});
			ctx.ui.notify(card, "info");
		},
	});

	pi.registerCommand("diff", {
		description: "Working-tree diff: git status + unified diff (truncated; --stat for the compact view)",
		handler: async (args: string | undefined, ctx: any) => {
			const repoRoot = await findGitRepo(opts.cwd);
			if (repoRoot === null) {
				ctx.ui.notify("Not inside a git repository — /diff has nothing to show.", "warning");
				return;
			}
			const wantStat = (args ?? "").includes("--stat");
			const status = await runGitHardened(opts.cwd, ["status", "--porcelain"]);
			if (status.code !== 0) {
				ctx.ui.notify(`/diff: git status failed: ${status.stderr.trim().slice(0, 200)}`, "error");
				return;
			}
			const rows = status.stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
			if (rows.length === 0) {
				ctx.ui.notify("Working tree clean — nothing to diff (git status reports no changes).", "info");
				return;
			}
			const parts: string[] = [`${rows.length} change(s) in the working tree:`];
			if (wantStat) {
				const stat = await runGitHardened(opts.cwd, ["diff", "--stat", "HEAD"]);
				parts.push((stat.code === 0 ? stat.stdout : "").trim());
				const untracked = rows.filter((r) => r.startsWith("??")).map((r) => r.slice(3).trim());
				if (untracked.length > 0) parts.push(`untracked (not in the diff):\n${untracked.join("\n")}`);
			} else {
				// Untracked files have no diff hunks — list them, then the unified
				// diff of everything tracked (staged + unstaged) against HEAD.
				const untracked = rows.filter((r) => r.startsWith("??")).map((r) => r.slice(3).trim());
				if (untracked.length > 0) parts.push(`untracked: ${untracked.join(", ")}`);
				const staged = await runGitHardened(opts.cwd, ["diff", "--cached"]);
				const unstaged = await runGitHardened(opts.cwd, ["diff"]);
				const diff = [staged.stdout, unstaged.stdout].filter((s) => s.trim().length > 0).join("\n");
				const diffLines = diff.split("\n");
				// The TUI notify pane is not a pager: cap the inline view (Codex
				// scrolls; we truncate with a pointer to the full command).
				const CAP = 200;
				parts.push(diffLines.length > CAP ? diffLines.slice(0, CAP).join("\n") + "\n…" : diff);
				if (diffLines.length > CAP) {
					parts.push(`(${diffLines.length - CAP} more lines — rerun with --stat, or git diff in a terminal)`);
				}
			}
			ctx.ui.notify(parts.join("\n\n"), "info");
		},
	});
}
