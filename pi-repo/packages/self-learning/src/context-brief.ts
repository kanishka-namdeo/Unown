/**
 * context-brief.ts — summary context mode for subagents (pi-cciotti port).
 *
 * A `context: "summary"` agent does not spawn blind: one cheap LLM call
 * distills the PARENT session's recent conversation into a role-directed
 * brief (≤4096 chars) that is prepended to the child's task. Cheaper than a
 * full fork (the cciotti measurement that motivated the design), more
 * targeted than raw transcript surgery — and it degrades gracefully: any
 * failure falls back to the fresh context with a visible warning, never
 * aborting the delegation.
 *
 * The distillation source (cciotti's shape): newest-first user text +
 * assistant text, tool-call NAMES only (bodies skipped — they are the bulk),
 * byte-capped before the prompt is ever built.
 *
 * Public surface:
 *   - extractBriefSource(entries, budgetChars) — pure entry projection
 *   - buildBriefPrompt(source, roleInstruction) — pure prompt builder
 *   - CONTEXT_BRIEF_MAX_CHARS (4096) — the cap on the final brief
 *   - summarizeParentContext(chat, entries, opts) — the orchestrator
 *   - composeTaskWithBrief(brief, task) — the delivery shape
 *
 * Standing invariant: no fork of the pi substrate; no pi imports (the LLM
 * call is injected as a plain async function).
 */

/** The final brief is capped at 4096 chars (cciotti's default). */
export const CONTEXT_BRIEF_MAX_CHARS = 4096;

/** The raw source fed to the distillation call is capped at ~24k chars. */
export const BRIEF_SOURCE_BUDGET_CHARS = 24_000;

/**
 * Project session entries into the distillation source: newest-first, user
 * text + assistant text, tool-call names only. `entries` is the pi session
 * entry array (sessionManager.getEntries()); unknown shapes are skipped
 * silently. Pure.
 */
export function extractBriefSource(entries: unknown[], budgetChars = BRIEF_SOURCE_BUDGET_CHARS): string {
        const lines: string[] = [];
        let budget = budgetChars;
        for (let i = entries.length - 1; i >= 0 && budget > 0; i--) {
                const entry = entries[i] as Record<string, any> | null | undefined;
                if (!entry || typeof entry !== "object") continue;
                if (entry.type === "session" || entry.type === "summary") continue;
                const message = entry.message ?? entry;
                const role = message?.role ?? entry.role;
                if (role === "user") {
                        const text = textOf(message?.content ?? entry.content);
                        if (!text) continue;
                        const line = `USER: ${text}`;
                        if (line.length > budget) {
                                lines.push(`USER: ${text.slice(0, budget)}…`);
                                budget = 0;
                                break;
                        }
                        lines.push(line);
                        budget -= line.length + 1;
                } else if (role === "assistant") {
                        const content = message?.content ?? entry.content;
                        const text = textOf(content);
                        const toolNames = Array.isArray(content)
                                ? content.filter((b: any) => b?.type === "toolCall").map((b: any) => b.name).filter(Boolean)
                                : [];
                        const parts: string[] = [];
                        if (text) parts.push(text);
                        if (toolNames.length > 0) parts.push(`[tools: ${toolNames.join(", ")}]`);
                        if (parts.length === 0) continue;
                        const line = `ASSISTANT: ${parts.join(" ")}`;
                        if (line.length > budget) {
                                lines.push(`ASSISTANT: ${parts.join(" ").slice(0, budget)}…`);
                                budget = 0;
                                break;
                        }
                        lines.push(line);
                        budget -= line.length + 1;
                }
        }
        return lines.reverse().join("\n");
}

function textOf(content: unknown): string {
        if (typeof content === "string") return content.trim();
        if (!Array.isArray(content)) return "";
        return content
                .filter((b: any) => b?.type === "text" && typeof b.text === "string")
                .map((b: any) => b.text)
                .join("\n")
                .trim();
}

/**
 * The distillation prompt (cciotti's shape: newest-first source, one call,
 * hard length discipline). `roleInstruction` is the per-agent `contextBrief`
 * frontmatter shaping WHAT the brief keeps.
 */
export function buildBriefPrompt(source: string, roleInstruction?: string): string {
        const role = roleInstruction?.trim()
                ? `The consumer of this brief is a subagent with this role — keep what matters for it: ${roleInstruction.trim()}`
                : "Keep the facts, decisions, file paths and open questions the subagent will need.";
        return [
                "Distill the following orchestrator session into a compact handoff brief for a subagent that sees ONLY this brief plus its task.",
                role,
                "Rules: newest context wins; quote exact file paths, identifiers and decisions verbatim; drop tool output bodies; at most 4000 characters; plain text, no preamble.",
                "",
                "=== SESSION (newest last) ===",
                source,
                "=== END SESSION ===",
                "",
                "Reply with ONLY the brief.",
        ].join("\n");
}

/** The minimal chat function the orchestrator needs (llm.ts's chatText shape). */
export type BriefChatFn = (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, opts?: { maxTokens?: number; timeoutMs?: number }) => Promise<string>;

export interface BriefOptions {
        /** Per-agent role instruction (frontmatter contextBrief). */
        roleInstruction?: string;
        /** Cap for the final brief (default CONTEXT_BRIEF_MAX_CHARS). */
        maxChars?: number;
        /** Timeout for the distillation call (default 60s). */
        timeoutMs?: number;
}

/**
 * Distill the parent session into a brief. Returns null when there is
 * nothing worth summarizing (empty source) or the distillation call fails —
 * the caller then spawns fresh with a warning, never aborts.
 */
export async function summarizeParentContext(
        chat: BriefChatFn,
        entries: unknown[],
        opts: BriefOptions = {},
): Promise<string | null> {
        const source = extractBriefSource(entries);
        // Nothing meaningful to summarize: skip the paid call entirely.
        if (source.trim().length < 80) return null;
        try {
                const raw = await chat(
                        [{ role: "user", content: buildBriefPrompt(source, opts.roleInstruction) }],
                        { maxTokens: 1200, timeoutMs: opts.timeoutMs ?? 60_000 },
                );
                const brief = raw.trim();
                if (!brief) return null;
                const cap = opts.maxChars ?? CONTEXT_BRIEF_MAX_CHARS;
                return brief.length > cap ? `${brief.slice(0, cap - 1)}…` : brief;
        } catch {
                return null;
        }
}

/** The delivery shape (cciotti's exact framing): brief first, task after. */
export function composeTaskWithBrief(brief: string, task: string): string {
        return `Context brief from the parent session:\n${brief}\n\nTask:\n${task}`;
}
