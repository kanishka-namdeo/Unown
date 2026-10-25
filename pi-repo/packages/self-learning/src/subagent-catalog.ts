/**
 * subagent-catalog.ts — the advertised-subagent catalog, delegation levels,
 * the BLOCKED reply protocol, and the deterministic completion guard.
 *
 * Ported from pi-cciotti (a-chris/pi-cciotti, itself a fork of
 * nicobailon/pi-subagents) — reverse-engineered and adapted to Unown's
 * no-fork extension seams. The cciotti design notes that motivated each
 * piece are inline; the port keeps the measured budgets and drops the
 * pieces Unown already has elsewhere (worktrees, structured output).
 *
 * WHY THIS FILE EXISTS
 *
 * Before this module the parent model learned about subagents ONLY from the
 * `task` tool description (a hard-coded sentence naming `general` and
 * `explore`). Two failure modes followed, both measured by pi-cciotti's
 * context-cost work: (1) user/project agents defined in .unown/agents/*.md
 * were invisible until the model guessed `agent:` names wrong and burned a
 * corrective round-trip; (2) the delegation POLICY (when to fan out at all)
 * had no dial, so cost-sensitive users could not turn delegation down.
 *
 * The catalog fixes (1) the same way cciotti does: a byte-budgeted
 * `<advertised_subagents>` block appended to the system prompt on
 * `before_agent_start`, listing each agent's name + description with a
 * confirm-via-list instruction. The delegation level fixes (2): one sentence
 * per level (never / rarely / standard / aggressive) in the same block —
 * policy rides with the prompt, not with tool plumbing.
 *
 * The BLOCKED protocol and the completion guard port cciotti's fail-closed
 * child-contract: a child that cannot legitimately do the task says so in a
 * machine-readable way, and a writing child that "succeeds" without touching
 * a single file is reported as a failure, not a success.
 *
 * Public surface (pure unless noted — no pi imports, no network):
 *   - DelegationLevel / parseDelegationLevel / DELEGATION_LEVEL_ENV
 *   - DELEGATION_SENTENCES
 *   - CatalogFields (advertise, completionGuard, fallbackModels, context,
 *     contextBrief) + parseAgentCatalogFrontmatter
 *   - ADVERTISED_CATALOG_MAX_AGENTS / _MAX_BYTES / _DESCRIPTION_MAX_BYTES
 *   - renderAdvertisedCatalog(agents, level)
 *   - CHILD_BOUNDARY_INSTRUCTIONS / isBlockedReply
 *   - MutationSnapshot types + snapshotWorkingTree (git, sync) +
 *     diffMutations (pure) + COMPLETION_GUARD_FAILURE
 *
 * Standing invariant: no fork of the pi substrate; no pi imports.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Delegation levels (cciotti port, shrunk to Unown's dial)
// ---------------------------------------------------------------------------

/**
 * How eagerly the parent should delegate. Each level contributes exactly one
 * sentence to the system prompt (cciotti's rule: the level is POLICY, so it
 * rides with the prompt; it never changes tool plumbing).
 *
 *   never      — the catalog is withdrawn entirely; the task tool guidance
 *                stays so an explicit user request can still spawn one.
 *   rarely     — only when the user explicitly asks for delegation.
 *   standard   — delegate focused, parallelizable investigations (default).
 *   aggressive — prefer delegation for most non-trivial work.
 */
export type DelegationLevel = "never" | "rarely" | "standard" | "aggressive";

/** Env var the level is read from (documented in .env.example + docs). */
export const DELEGATION_LEVEL_ENV = "UNOWN_DELEGATION_LEVEL";

/** Parse + validate a delegation level; invalid values fall back to "standard"
 *  (tolerant posture, matching parseAgentFrontmatterExtras). */
export function parseDelegationLevel(value: string | undefined): DelegationLevel {
        const v = (value ?? "").trim().toLowerCase();
        if (v === "never" || v === "rarely" || v === "standard" || v === "aggressive") return v;
        return "standard";
}

/** The one sentence each level contributes (cciotti keeps these to a single
 *  line each — the catalog is re-sent every turn, so every byte is recurring
 *  cost). */
export const DELEGATION_SENTENCES: Record<DelegationLevel, string> = {
        never: "Delegate only when the user explicitly asks for a subagent.",
        rarely: "Delegate rarely — only for large, clearly separable investigations the user would expect you to hand off.",
        standard:
                "Delegate focused, self-contained investigations or implementations whenever a fresh context would keep this session sharp.",
        aggressive:
                "Delegate aggressively — prefer a subagent for most non-trivial investigation and implementation work; keep orchestration and user-facing decisions here.",
};

// ---------------------------------------------------------------------------
// Catalog frontmatter fields (the per-agent knobs this module adds)
// ---------------------------------------------------------------------------

/** Fields parsed from agent frontmatter that configure catalog + guard
 *  behavior. SubagentConfig extends this in tools.ts. */
export interface CatalogFields {
        /** Include this agent in the advertised catalog (default true). Set
         *  false for internal helpers the model should only use when a
         *  command/skill names them explicitly (cciotti's planner shape). */
        advertise?: boolean;
        /** Deterministic completion guard: a writing agent that finishes with
         *  zero working-tree mutations is reported as FAILED (default false;
         *  the `worker` builtin turns it on). */
        completionGuard?: boolean;
        /** Ordered fallback models for provider-style failures (auth / quota /
         *  rate / 5xx / timeout, before any tool use). Never rotates on
         *  context overflow or content errors. */
        fallbackModels?: string[];
        /** Context mode: "fresh" (default) or "summary" — a distilled brief of
         *  the parent conversation prepended to the task. */
        context?: "fresh" | "summary";
        /** Role-directed instruction shaping the summary brief (only used when
         *  context === "summary"). */
        contextBrief?: string;
}

/**
 * Pluck the catalog fields from a parsed frontmatter object. Tolerant of
 * camelCase + snake_case keys; invalid values are dropped silently (the same
 * posture as parseAgentFrontmatterExtras — one bad field never breaks agent
 * discovery).
 */
export function parseAgentCatalogFrontmatter(frontmatter: unknown): CatalogFields {
        if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) return {};
        const fm = frontmatter as Record<string, unknown>;
        const out: CatalogFields = {};

        const advRaw = fm.advertise;
        if (typeof advRaw === "boolean") out.advertise = advRaw;
        else if (typeof advRaw === "string") {
                const v = advRaw.trim().toLowerCase();
                if (v === "true" || v === "1") out.advertise = true;
                else if (v === "false" || v === "0") out.advertise = false;
        }

        const guardRaw = fm.completionGuard ?? fm.completion_guard;
        if (typeof guardRaw === "boolean") out.completionGuard = guardRaw;
        else if (typeof guardRaw === "string") {
                const v = guardRaw.trim().toLowerCase();
                if (v === "true" || v === "1") out.completionGuard = true;
                else if (v === "false" || v === "0") out.completionGuard = false;
        }

        const fbRaw = fm.fallbackModels ?? fm.fallback_models;
        if (typeof fbRaw === "string") {
                const list = fbRaw
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean);
                if (list.length > 0) out.fallbackModels = list;
        } else if (Array.isArray(fbRaw)) {
                const list = fbRaw
                        .filter((s): s is string => typeof s === "string")
                        .map((s) => s.trim())
                        .filter(Boolean);
                if (list.length > 0) out.fallbackModels = list;
        }

        const ctxRaw = fm.context;
        if (typeof ctxRaw === "string") {
                const v = ctxRaw.trim().toLowerCase();
                if (v === "fresh" || v === "summary") out.context = v;
        }

        const briefRaw = fm.contextBrief ?? fm.context_brief;
        if (typeof briefRaw === "string" && briefRaw.trim()) out.contextBrief = briefRaw.trim();

        return out;
}

// ---------------------------------------------------------------------------
// The advertised catalog (cciotti port — byte-budgeted, overflow-omitting)
// ---------------------------------------------------------------------------

/** Hard caps from cciotti's measured budget: 16 agents, 12,288 rendered bytes,
 *  512-byte descriptions. Overflow drops OLDEST-NAME-FIRST with an explicit
 *  `<omitted count="N"/>` marker — canonical names are never truncated. */
export const ADVERTISED_CATALOG_MAX_AGENTS = 16;
export const ADVERTISED_CATALOG_MAX_BYTES = 12_288;
export const ADVERTISED_CATALOG_DESCRIPTION_MAX_BYTES = 512;

/** The minimum shape renderAdvertisedCatalog needs (SubagentConfig satisfies
 *  this; tests pass smaller literals). */
export interface CatalogAgent {
        name: string;
        description: string;
        advertise?: boolean;
}

/**
 * Render the `<advertised_subagents>` block, or undefined when the level is
 * `never` or nothing is advertisable. Shape (cciotti):
 *
 *   <advertised_subagents>
 *   Delegation policy: <one sentence>
 *   Confirm the exact agent via task_control list (or the task tool) before
 *   executing; unknown names fail fast.
 *
 *   - name: <name>
 *     description: <description (byte-capped)>
 *   ...
 *   </advertised_subagents>
 *
 * Byte budget: the block (including the closing tag) stays under
 * ADVERTISED_CATALOG_MAX_BYTES by dropping whole agents oldest-name-first and
 * appending `<omitted count="N"/>` in their place. Pure; deterministic order
 * (input order preserved — tools.ts passes discovery order, most-specific
 * last, so project agents are the ones kept).
 */
export function renderAdvertisedCatalog(agents: CatalogAgent[], level: DelegationLevel): string | undefined {
        if (level === "never") return undefined;
        const advertisable = agents.filter((a) => a.advertise !== false);
        if (advertisable.length === 0) return undefined;

        const cap = (s: string): string => {
                const bytes = Buffer.byteLength(s, "utf8");
                if (bytes <= ADVERTISED_CATALOG_DESCRIPTION_MAX_BYTES) return s;
                // Byte-safe truncation: never split a UTF-8 sequence; the
                // ellipsis counts against the cap so the result is EXACTLY at
                // most ADVERTISED_CATALOG_DESCRIPTION_MAX_BYTES bytes.
                const ellipsis = "…";
                const budget = ADVERTISED_CATALOG_DESCRIPTION_MAX_BYTES - Buffer.byteLength(ellipsis, "utf8");
                return (
                        Buffer.from(s, "utf8")
                                .subarray(0, budget)
                                .toString("utf8")
                                // A multi-byte sequence cut at the byte boundary decodes to
                                // U+FFFD — it can only appear at the very end of the slice.
                                .replace(/\uFFFD+$/, "")
                                .replace(/\s+\S*$/, "") + ellipsis
                );
        };

        const entry = (a: CatalogAgent): string => `- name: ${a.name}\n  description: ${cap(a.description)}`;

        // Render greedily; drop from the FRONT (oldest-name-first in cciotti's
        // sense: earliest in discovery order) when over budget.
        let kept = advertisable.slice(0, ADVERTISED_CATALOG_MAX_AGENTS).map(entry);
        let omitted = Math.max(0, advertisable.length - ADVERTISED_CATALOG_MAX_AGENTS);
        const header =
                `Delegation policy: ${DELEGATION_SENTENCES[level]}\n` +
                `Confirm the exact agent (task tool / "task_control list") before executing; unknown agent names fail with the available list.`;
        const frame = (body: string): string =>
                `<advertised_subagents>\n${header}\n\n${body}${omitted > 0 ? `\n<omitted count="${omitted}"/>` : ""}\n</advertised_subagents>`;
        let block = frame(kept.join("\n\n"));
        while (Buffer.byteLength(block, "utf8") > ADVERTISED_CATALOG_MAX_BYTES && kept.length > 0) {
                kept = kept.slice(1);
                omitted++;
                block = frame(kept.join("\n\n"));
        }
        if (kept.length === 0) return undefined;
        return block;
}

// ---------------------------------------------------------------------------
// BLOCKED protocol (cciotti port — fail-closed child contract)
// ---------------------------------------------------------------------------

/** Appended to every subagent system prompt (spawned children only): the
 *  machine-readable refusal lane. Ports cciotti's
 *  CHILD_SUBAGENT_BOUNDARY_INSTRUCTIONS verbatim in spirit — a child that
 *  cannot legitimately complete the task must SAY SO instead of improvising.
 *  The safety-refusal sentence (2026-10-25 stress round) exists because a
 *  live child refused an unsafe task with well-meaning free-form prose —
 *  safety worked, the typed signal did not: the parent then has to guess
 *  refusal text apart from a normal answer. A refusal for safety, policy,
 *  or ethics IS "cannot legitimately complete", and must take the same
 *  BLOCKED shape so the parent can re-plan on the typed status. */
export const CHILD_BOUNDARY_INSTRUCTIONS = `You are a child subagent, not the parent orchestrator: you see only this task, you cannot ask the user questions interactively, and you cannot spawn further subagents.

If you cannot safely or legitimately complete the assigned task — missing access, ambiguous target, destructive-looking request, a blocker outside your scope, OR any reason you would refuse the task for safety, policy, or ethics — do NOT improvise a partial answer and do NOT write free-form refusal prose. Return exactly:

BLOCKED: <short reason>

A BLOCKED reply is routed back to the parent as a first-class status, so the orchestrator can re-plan. Finishing silently with nothing done is the ONLY wrong answer.`;

/** Parse a final child reply for the BLOCKED protocol. Tolerates surrounding
 *  whitespace, markdown fences, and the marker appearing as its own first
 *  non-empty line (cciotti requires "exactly: BLOCKED: <reason>"; we accept
 *  the fenced + first-line shapes models actually emit, but never a
 *  mid-document mention — discussing the protocol is not using it). */
export function isBlockedReply(text: string): { blocked: boolean; reason?: string } {
        const stripped = text
                .trim()
                .replace(/^```[a-zA-Z]*\s*\n?/, "")
                .replace(/\n?```\s*$/, "")
                .trim();
        if (!stripped) return { blocked: false };
        const firstLine = stripped.split("\n", 1)[0].trim();
        const match = firstLine.match(/^BLOCKED:\s*(.+)$/i);
        if (match) return { blocked: true, reason: match[1].trim().slice(0, 200) };
        return { blocked: false };
}

// ---------------------------------------------------------------------------
// Deterministic completion guard (cciotti port — git fingerprint snapshots)
// ---------------------------------------------------------------------------

/** The failure text when a guarded writing agent finishes with zero observed
 *  mutations (cciotti's completion-evidence message, verbatim in spirit). */
export const COMPLETION_GUARD_FAILURE = "Subagent completed without making edits for an implementation task.";

/** A working-tree mutation fingerprint: the sorted list of changed paths plus
 *  a hash over their diffs. Same snapshot before and after ⇒ nothing changed. */
export interface MutationSnapshot {
        /** Sorted changed paths (git diff --name-only, tracked + untracked-but-not-ignored). */
        changedPaths: string[];
        /** SHA-256 over the full named diff; empty-string hash when clean. */
        diffDigest: string;
}

/** Digest of the empty diff — the "clean tree" value. */
export const CLEAN_DIGEST = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/**
 * Snapshot a working tree for the completion guard. Pure-ish (git subprocess,
 * no state): returns null when the cwd is not a git repo or git fails — the
 * guard then reports "unavailable", never a false failure.
 *
 * Uses `git status --porcelain` (covers staged + unstaged + untracked) plus
 * `git diff HEAD` for content; both with `-c core.fsmonitor=false` (cciotti's
 * dodge for stale fsmonitor daemons reporting phantom-clean trees).
 */
export function snapshotWorkingTree(cwd: string): MutationSnapshot | null {
        if (!existsSync(join(cwd, ".git"))) return null;
        const run = (args: string[]): string | null => {
                try {
                        const res = spawnSync("git", ["-c", "core.fsmonitor=false", ...args], {
                                cwd,
                                encoding: "utf8",
                                timeout: 15_000,
                                windowsHide: true,
                        });
                        if (res.error || res.status !== 0) return null;
                        return res.stdout ?? "";
                } catch {
                        return null;
                }
        };
        const status = run(["status", "--porcelain=v1", "-z"]);
        const diff = run(["diff", "HEAD"]);
        if (status === null) return null;
        // The full diff including untracked files is expensive; the GUARD only
        // needs to know WHAT changed and that SOMETHING changed. Path list
        // from status; content digest from the tracked diff (untracked files
        // already show up in the path list).
        const changedPaths = status
                .split("\0")
                .map((entry) => entry.slice(3))
                .filter(Boolean)
                .sort();
        // Content digest: the tracked diff (with staged changes) hashed with
        // SHA-256. Collision resistance is more than enough here — we compare
        // equality of the SAME tree before/after; the digest only needs
        // determinism, and untracked files already surface via the path list.
        let digest = CLEAN_DIGEST;
        const material = changedPaths.join("\n") + "\u0000" + (diff ?? "");
        if (material !== "\u0000") {
                digest = createHash("sha256").update(material, "utf8").digest("hex");
        }
        return { changedPaths, diffDigest: digest };
}

/** Pure: did anything mutate between two snapshots? (null snapshot ⇒ unknown.) */
export function treeMutated(before: MutationSnapshot | null, after: MutationSnapshot | null): boolean | null {
        if (!before || !after) return null;
        if (before.changedPaths.length !== after.changedPaths.length) return true;
        if (before.diffDigest !== after.diffDigest) return true;
        return false;
}

/** Paths touched between snapshots (for the guard's evidence line). */
export function mutatedPaths(before: MutationSnapshot | null, after: MutationSnapshot | null): string[] {
        if (!before || !after) return [];
        const beforeSet = new Set(before.changedPaths);
        return after.changedPaths.filter((p) => !beforeSet.has(p));
}
