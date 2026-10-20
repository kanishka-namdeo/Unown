/**
 * session-diff-stats.ts — the per-session `+N -M` diff accumulator.
 *
 * Beauty-4 (the feedback release): the footer shows a compact diff-stat chip
 * (`+12 -3`, added in the diff-added green, removed in the diff-removed red)
 * next to the context meter, accumulated over every successful edit/write
 * tool execution of the current session — the Gemini Code Assist footer's
 * code-changes item and Claude Code's per-session diffstat, in this repo's
 * glyph vocabulary. Pure module: parsing and counting only, no fs, no theme —
 * the footer renders, interactive-mode feeds.
 *
 * Counting rules:
 *   - edit: count `+`/`-` lines of the tool's display-oriented diff
 *     (`+123 content` / `-123 content` / ` 123 content` — the same string
 *     diff.ts renders), so the chip agrees with the block the user just saw.
 *   - write: a write creates or fully replaces a file, so every content line
 *     counts as an addition (the previous content is not available at the
 *     event seam; this is the same convention Gemini's code-changes counter
 *     uses for file writes).
 *   - failed executions (isError) and unknown tools contribute nothing.
 */

export interface DiffLineCounts {
	added: number;
	removed: number;
}

/** A read-only view of the accumulator — the footer never mutates it. */
export interface ReadonlySessionDiffStats {
	get(): DiffLineCounts;
}

type ToolExecutionLike = {
	content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
	details?: unknown;
	isError?: boolean;
};

/**
 * Count added/removed lines in the edit tool's display-oriented diff format.
 * Lines are `+<num> <content>`, `-<num> <content>` or ` <num> <content>`;
 * anything that does not carry a +/- prefix (context, ellipsis) is ignored.
 */
export function countDiffLines(diffText: string): DiffLineCounts {
	let added = 0;
	let removed = 0;
	for (const line of diffText.split("\n")) {
		if (line.startsWith("+")) {
			added++;
		} else if (line.startsWith("-")) {
			removed++;
		}
	}
	return { added, removed };
}

/** Number of lines a write contributes (trailing blank lines trimmed, matching the write preview). */
function writeContentLineCount(content: string): number {
	const lines = content.split("\n");
	let end = lines.length;
	while (end > 0 && lines[end - 1] === "") {
		end--;
	}
	return end;
}

/**
 * Derive the diff-stat of one completed tool execution. Returns undefined when
 * the tool does not change tracked file content (reads, bash, unknown tools).
 */
export function diffLineCountsForToolExecution(
	toolName: string,
	args: unknown,
	result: ToolExecutionLike,
): DiffLineCounts | undefined {
	if (result.isError) {
		return undefined;
	}
	switch (toolName) {
		case "edit": {
			const details = result.details as { diff?: unknown } | undefined | null;
			if (details && typeof details.diff === "string" && details.diff.length > 0) {
				return countDiffLines(details.diff);
			}
			return undefined;
		}
		case "write": {
			const writeArgs = (args ?? {}) as { content?: unknown };
			if (typeof writeArgs.content !== "string" || writeArgs.content.length === 0) {
				return undefined;
			}
			return { added: writeContentLineCount(writeArgs.content), removed: 0 };
		}
		default:
			return undefined;
	}
}

/**
 * Per-session accumulator. Interactive-mode records every completed
 * tool_execution_end; the footer pulls the totals at render time. Reset when
 * the session changes (setSession) so each session tells its own story.
 */
export class SessionDiffStats implements ReadonlySessionDiffStats {
	private added = 0;
	private removed = 0;

	record(toolName: string, args: unknown, result: ToolExecutionLike): DiffLineCounts | undefined {
		const counts = diffLineCountsForToolExecution(toolName, args, result);
		if (counts) {
			this.add(counts);
		}
		return counts;
	}

	/** Fold in a precomputed execution's counts (the tool-execution component computes its own). */
	add(counts: DiffLineCounts): void {
		this.added += counts.added;
		this.removed += counts.removed;
	}

	get(): DiffLineCounts {
		return { added: this.added, removed: this.removed };
	}

	reset(): void {
		this.added = 0;
		this.removed = 0;
	}
}
