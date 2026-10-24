/**
 * context-viz.ts — the `/context` command (the 2026-10-24 parity round).
 *
 * The user-facing context-window view every competitor ships: Claude Code's
 * `/context` grid, aider's `/tokens`, Gemini CLI's `/stats`, Codex's `/usage`
 * analytics. Unown had the MODEL-facing half (`get_context_remaining`, the
 * codex-ported agent tool in context-tools.ts) but nothing the HUMAN can
 * invoke mid-session to see where the window is going.
 *
 * Design (honest numbers, labeled estimates):
 *   - USED and the WINDOW are ACTUALS when pi reports them
 *     (`ctx.getContextUsage()` — the host's own accounting). When the host
 *     hasn't reported yet (before the first response), a chars/4 estimate
 *     over the visible message history stands in and is labeled as such.
 *   - The memory stack (unown's four injected tiers) is MEASURED — the exact
 *     injected file contents are the input, chars/4 over them is a tight
 *     estimate of what they cost in the system prompt.
 *   - "Conversation" is an estimate over the session branch (chars/4).
 *   - "System + tools" is the residual (used − memory − conversation,
 *     clamped at 0) — the system prompt, tool schemas and scaffolding, which
 *     the extension API cannot read directly; it is only shown when USED is
 *     an actual, because it is only a real number then.
 *   - Session rollups (messages, tokens in/out, cache) reuse the /usage
 *     attribution semantics — computed by the caller (tools.ts's
 *     sessionUsageSummary) and passed in, keeping this module pure.
 *
 * Pure module: no pi imports, no I/O, no clocks. Every function is exported
 * for unit tests.
 */

// ---------------------------------------------------------------------------
// Inputs + report shapes
// ---------------------------------------------------------------------------

export interface MemoryStackFile {
    path: string;
    content: string;
    /** Authoritative tier label when the producer knows it (term.ts's
     *  TerminalMemoryFile.tier: "tier0-policy" / "project" / "tier2-user" /
     *  "local" / "guide"). Derived from the path only when absent — the
     *  `path` is a VIRTUAL display name ("memory/tier0-policy.md (…)"),
     *  not a real fs path. */
    tier?: string;
}

export interface SessionUsageRollup {
    messages: number;
    tokensIn: number;
    tokensOut: number;
    cacheRead: number;
    cacheWrite: number;
    models: string[];
}

export interface ContextReportInput {
    /** Active model id (e.g. "agnes-3.0-flash"), when the host exposes it. */
    model?: string | null;
    /** Active provider id (e.g. "zai-bridge"), when the host exposes it. */
    provider?: string | null;
    /** Context window in tokens — ACTUAL from ctx.getContextUsage(), else the model-spec fallback. */
    contextWindow?: number | null;
    /** Used tokens — ACTUAL from ctx.getContextUsage() when reported. */
    usedTokens?: number | null;
    /** The chars/4 estimate over the visible message history (the fallback for `usedTokens`). */
    messageEstimateTokens?: number | null;
    /** The memory stack actually injected into this session's system prompt. */
    memoryStack?: MemoryStackFile[];
    /** Session entries (the read-only list every extension context carries). */
    entries?: any[];
    /** Registered tool count, when known (shown as a fact, not a token guess). */
    toolCount?: number | null;
    /** The /usage-attribution rollup, when the caller computed it. */
    sessionUsage?: SessionUsageRollup | null;
}

export interface ContextReport {
    model: string | null;
    provider: string | null;
    contextWindow: number | null;
    used: number | null;
    /** true when `used` is the host's actual accounting; false when it is the chars/4 estimate. */
    usedIsActual: boolean;
    usedPercent: number | null;
    remaining: number | null;
    memoryStackTokens: number;
    memoryStackFiles: Array<{ name: string; tier: string; tokens: number }>;
    conversationTokens: number | null;
    /** residual = used − memory − conversation (only when used is actual); never negative. */
    systemAndToolsTokens: number | null;
    sessionUsage: SessionUsageRollup | null;
    toolCount: number | null;
    /** 0..4 advice band: 0 fresh, 1 healthy, 2 compact-soon, 3 compact-now, 4 unknown (no numbers). */
    band: "fresh" | "healthy" | "compact-soon" | "compact-now" | "unknown";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** chars/4 token estimate — the same heuristic context-tools.ts ships. */
export function estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
}

/** Sum chars/4 over a message branch's text-bearing content blocks. */
export function estimateConversationTokens(entries: any[]): number {
    let chars = 0;
    for (const entry of entries ?? []) {
        try {
            if (!entry || entry.type !== "message" || !entry.message) continue;
            const content = entry.message.content;
            if (typeof content === "string") {
                chars += content.length;
            } else if (Array.isArray(content)) {
                for (const block of content) {
                    if (block?.type === "text" && typeof block.text === "string") chars += block.text.length;
                    else if (block?.type === "toolCall") chars += 80; // name + args skeleton
                    else if (block?.type === "thinking" && typeof block.thinking === "string") chars += block.thinking.length;
                }
            }
        } catch {
            /* malformed entry — best-effort estimate */
        }
    }
    return chars === 0 ? 0 : Math.ceil(chars / 4);
}

/** Normalize a producer tier label ("tier0-policy" → "policy") or derive
 * the tier from a memory file's path (policy/project/user/local/other). */
export function memoryTierOf(path: string, tier?: string): string {
    if (tier) {
        return tier.replace(/^tier\d+-/, "");
    }
    const base = path.split(/[\\/]/).pop() ?? path;
    if (base === "policy.md") return "policy";
    if (base === "project.md") return "project";
    if (base === "user.md") return "user";
    if (base === "local.md") return "local";
    return "other";
}

/** Band thresholds — mirrored from the compaction guidance copy (70/85). */
export function bandFor(usedPercent: number | null): ContextReport["band"] {
    if (usedPercent === null || !Number.isFinite(usedPercent)) return "unknown";
    if (usedPercent >= 85) return "compact-now";
    if (usedPercent >= 70) return "compact-soon";
    if (usedPercent >= 50) return "healthy";
    return "fresh";
}

// ---------------------------------------------------------------------------
// Compute + render
// ---------------------------------------------------------------------------

export function computeContextReport(input: ContextReportInput): ContextReport {
    const usedIsActual = typeof input.usedTokens === "number" && input.usedTokens !== null;
    // Fallback chain for USED: the host's actual → the caller's message
    // estimate → the conversation estimate over `entries` (chars/4). The last
    // two hop is the get_context_remaining contract (estimate before the
    // first response) with the entries the slash command already holds.
    const conversationTokens =
        input.entries !== undefined ? estimateConversationTokens(input.entries) : (input.messageEstimateTokens ?? null);
    const used = usedIsActual
        ? (input.usedTokens as number)
        : (input.messageEstimateTokens ?? conversationTokens ?? null);
    const contextWindow = typeof input.contextWindow === "number" && input.contextWindow! > 0 ? input.contextWindow! : null;
    const usedPercent = used !== null && contextWindow !== null ? (used / contextWindow) * 100 : null;
    const remaining = used !== null && contextWindow !== null ? Math.max(0, contextWindow - used) : null;

    const memoryStackFiles = (input.memoryStack ?? []).map((f) => ({
        name: (f.path.split(/[\\/]/).pop() ?? f.path).replace(/\.md$/, ".md"),
        tier: memoryTierOf(f.path, f.tier),
        tokens: estimateTokens(f.content ?? ""),
    }));
    const memoryStackTokens = memoryStackFiles.reduce((sum, f) => sum + f.tokens, 0);

    // The residual is only honest when USED is an actual (an estimate minus
    // estimates would compound error into a fake precision).
    const systemAndToolsTokens =
        usedIsActual && used !== null ? Math.max(0, used - memoryStackTokens - (conversationTokens ?? 0)) : null;

    return {
        model: input.model ?? null,
        provider: input.provider ?? null,
        contextWindow,
        used,
        usedIsActual,
        usedPercent,
        remaining,
        memoryStackTokens,
        memoryStackFiles,
        conversationTokens,
        systemAndToolsTokens,
        sessionUsage: input.sessionUsage ?? null,
        toolCount: input.toolCount ?? null,
        band: bandFor(usedPercent),
    };
}

function fmt(n: number): string {
    return n.toLocaleString("en-US");
}

function fmtK(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
    return String(n);
}

const BAR_WIDTH = 32;

/** The utilization bar: filled blocks proportional to used%, rounded down. */
export function renderBar(usedPercent: number | null): string {
    if (usedPercent === null || !Number.isFinite(usedPercent)) return `${"·".repeat(BAR_WIDTH)} (no usage data yet)`;
    const clamped = Math.max(0, Math.min(100, usedPercent));
    const filled = Math.round((clamped / 100) * BAR_WIDTH);
    return `${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)}`;
}

const BAND_ADVICE: Record<ContextReport["band"], string> = {
    "compact-now": "⚠ Compact now — run /compact (or start a fresh session for unrelated work; the task tool's children get their own windows).",
    "compact-soon": "Compact soon — after this task, /compact keeps the early turns that matter.",
    healthy: "Healthy — subagents (the task tool) keep big reads and searches out of this window.",
    fresh: "Fresh — plenty of room.",
    unknown: "No usage data yet — send a message and run /context again.",
};

/**
 * Render the report as the notify text `/context` shows. Plain text (the
 * notify surface is theme-colored by the TUI itself); every estimated number
 * is labeled with "~" and the used/actual distinction is in the header line.
 */
export function renderContextReport(r: ContextReport): string {
    const lines: string[] = [];
    const modelLine = r.model ? `${r.model}${r.provider ? ` (${r.provider})` : ""}` : "unknown model";
    const windowLine = r.contextWindow ? `${fmt(r.contextWindow)} tokens` : "unknown";
    lines.push(`Context — ${modelLine} · window ${windowLine}`);

    if (r.used !== null && r.contextWindow !== null) {
        const pct = r.usedPercent !== null ? r.usedPercent.toFixed(1) : "?";
        lines.push(
            `${renderBar(r.usedPercent)} ${pct}% used`,
        );
        lines.push(
            `${r.usedIsActual ? "" : "~"}${fmt(r.used)} used · ${fmt(r.remaining ?? 0)} remaining${r.usedIsActual ? "" : " (estimated — no host accounting yet)"}`,
        );
    } else {
        lines.push(renderBar(null));
    }
    lines.push("");

    lines.push("Where it goes:");
    const memDetail = r.memoryStackFiles.map((f) => `${f.tier} ${fmtK(f.tokens)}`).join(" · ");
    lines.push(`  Memory stack  ~${fmt(r.memoryStackTokens)} tokens${memDetail ? ` (${memDetail})` : " (none injected)"}`);
    if (r.conversationTokens !== null) {
        lines.push(`  Conversation  ~${fmt(r.conversationTokens)} tokens (session history, chars/4)`);
    }
    if (r.systemAndToolsTokens !== null) {
        lines.push(`  System+tools  ~${fmt(r.systemAndToolsTokens)} tokens (prompt, tool schemas${r.toolCount ? `, ${r.toolCount} tools` : ""})`);
    } else if (r.toolCount) {
        lines.push(`  Tools         ${r.toolCount} registered`);
    }
    lines.push("");

    if (r.sessionUsage) {
        const s = r.sessionUsage;
        const cacheNote = s.cacheRead > 0 ? ` · cache ${fmtK(s.cacheRead)} read / ${fmtK(s.cacheWrite)} write` : "";
        lines.push(`Session so far: ${fmt(s.messages)} assistant messages · ${fmt(s.tokensIn)} in / ${fmt(s.tokensOut)} out${cacheNote}`);
        lines.push("");
    }

    lines.push(BAND_ADVICE[r.band]);
    lines.push("The agent has the same numbers: get_context_remaining (its tool). /compact summarizes; /usage bills.");
    return lines.join("\n");
}
