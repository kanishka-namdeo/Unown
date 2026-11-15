import type { SessionManager } from "../../core/session-manager.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

/**
 * Transcript export (Toccata round A9) — the `v` lane's payload: the
 * conversation rendered as readable markdown for a temp file handed to
 * $VISUAL/$EDITOR, mirroring Claude Code's "write the conversation to a
 * temporary file and open it" contract. This is a viewing artifact, not
 * the share format (that lane lives in the self-learning package with its
 * own redaction pass); nothing here is persisted or shared.
 */
export function buildTranscriptMarkdown(sessionManager: SessionManager): string {
        const lines: string[] = [];
        lines.push("# Transcript");
        lines.push("");
        lines.push(`Session: ${sessionManager.getSessionId()}`);
        lines.push("");

        for (const entry of sessionManager.getBranch()) {
                if (entry.type !== "message") continue;
                appendMessage(lines, entry.message);
        }

        return `${lines.join("\n")}\n`;
}

function appendMessage(lines: string[], message: AgentMessage): void {
        switch (message.role) {
                case "user": {
                        lines.push("## User");
                        lines.push("");
                        appendContentText(lines, message.content);
                        break;
                }
                case "assistant": {
                        lines.push("## Assistant");
                        lines.push("");
                        if (message.model) {
                                lines.push(`_model: ${message.model}_`);
                                lines.push("");
                        }
                        for (const content of message.content) {
                                if (content.type === "text") {
                                        appendContentText(lines, content.text);
                                } else if (content.type === "thinking") {
                                        // Thinking blocks are summary material, not transcript body.
                                } else if (content.type === "toolCall") {
                                        lines.push("```");
                                        lines.push(`tool call: ${content.name} (${content.id})`);
                                        lines.push(previewBlock(JSON.stringify(content.arguments, null, 2)));
                                        lines.push("```");
                                }
                        }
                        break;
                }
                case "toolResult": {
                        lines.push("```");
                        lines.push(`tool result: ${message.toolCallId}${message.isError ? " (error)" : ""}`);
                        for (const content of message.content) {
                                if (content.type === "text") {
                                        lines.push(previewBlock(content.text));
                                }
                        }
                        lines.push("```");
                        break;
                }
                default: {
                        const role = (message as { role?: string }).role ?? "custom";
                        const text = (message as { text?: string }).text;
                        if (typeof text === "string" && text.trim()) {
                                lines.push(`## ${role}`);
                                lines.push("");
                                lines.push(previewBlock(text));
                        }
                        break;
                }
        }
}

function appendContentText(lines: string[], content: unknown): void {
        if (typeof content === "string") {
                lines.push(previewBlock(content));
                lines.push("");
                return;
        }
        if (Array.isArray(content)) {
                for (const block of content) {
                        if (block && typeof block === "object" && block.type === "text" && typeof block.text === "string") {
                                lines.push(previewBlock(block.text));
                        }
                }
                lines.push("");
        }
}

/** Cap a text block so a giant tool result cannot flood the temp file. */
function previewBlock(text: string, maxLines = 200): string {
        const lines = text.split("\n");
        if (lines.length <= maxLines) return text;
        return `${lines.slice(0, maxLines).join("\n")}\n… (${lines.length - maxLines} more lines)`;
}
