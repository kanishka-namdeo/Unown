/**
 * messages.ts — pi message-shape helpers (one implementation, both call sites).
 *
 * pi's AssistantMessage.content is (TextContent | ThinkingContent | ToolCall)[]
 * — NEVER a plain string (pi-repo/packages/ai/src/types.ts). Two call sites
 * learned this independently and diverged: the goal gate (tools.ts) handles
 * both shapes; the terminal-note capture (termhooks.ts agent_end) checked only
 * the string shape, matched nothing, and so shipped EVERY terminal note
 * without its "Final outcome:" line — the single most valuable dream input.
 */

/** Extract an assistant message's visible text: string content, or the joined text blocks of array content. */
export function assistantTextOf(m: { role?: string; content?: unknown } | undefined | null): string {
	if (!m || m.role !== "assistant") return "";
	const content = m.content;
	if (typeof content === "string") return content.trim();
	if (Array.isArray(content)) {
		return content
			.filter((b: any) => b?.type === "text" && typeof b.text === "string")
			.map((b: any) => b.text)
			.join("\n")
			.trim();
	}
	return "";
}
