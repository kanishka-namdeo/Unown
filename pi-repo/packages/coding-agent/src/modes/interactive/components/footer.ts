import { isAbsolute, relative, resolve, sep } from "node:path";
import { type Component, truncateToWidth, visibleWidth, viewportTier } from "@earendil-works/pi-tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import { areExperimentalFeaturesEnabled } from "../../../core/experimental.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { addUsageToTotals, createUsageTotals } from "../../../core/usage-totals.ts";
import { theme } from "../theme/theme.ts";
import type { DiffLineCounts, ReadonlySessionDiffStats } from "./session-diff-stats.ts";

/**
 * Sanitize text for display in a single-line status.
 * Removes newlines, tabs, carriage returns, and other control characters.
 */
function sanitizeStatusText(text: string): string {
        // Replace newlines, tabs, carriage returns with space, then collapse multiple spaces
        return text
                .replace(/[\r\n\t]/g, " ")
                .replace(/ +/g, " ")
                .trim();
}

/**
 * Format token counts for compact footer display.
 */
export function formatTokens(count: number): string {
        if (count < 1000) return count.toString();
        if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
        if (count < 1000000) return `${Math.round(count / 1000)}k`;
        if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
        return `${Math.round(count / 1000000)}M`;
}

export function formatCwdForFooter(cwd: string, home: string | undefined): string {
        if (!home) return cwd;

        const resolvedCwd = resolve(cwd);
        const resolvedHome = resolve(home);
        const relativeToHome = relative(resolvedHome, resolvedCwd);
        const isInsideHome =
                relativeToHome === "" ||
                (relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));

        if (!isInsideHome) return cwd;
        return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

/** Strip ANSI escapes (used where a chip must be measured for width math). */
function stripAnsiCodes(text: string): string {
        return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Footer component that shows pwd, token stats, and context usage.
 * Computes token/context stats from session, gets git branch and extension statuses from provider.
 *
 * Responsive (round 5, docs/tui-responsive-plan.md R3): the status line
 * degrades by dropping ordered segments instead of truncating the composed
 * string. The context meter and the model identity always survive; optional
 * stats drop by ascending information value (cost, cache, tokens), the
 * meter sheds its bar at the `narrow` tier, and the model sheds its provider
 * prefix and thinking suffix before ever being truncated.
 */
export class FooterComponent implements Component {
        private autoCompactEnabled = true;
        private session: AgentSession;
        private footerData: ReadonlyFooterDataProvider;
        private diffStats?: ReadonlySessionDiffStats;
        /**
         * Round 5 (I3): contextual hint line — evaluated at render time so it
         * always reflects live state. Rendered as the footer's last line,
         * never at the `narrow` tier (chrome budget).
         */
        private hintProvider?: () => string | undefined;

        constructor(session: AgentSession, footerData: ReadonlyFooterDataProvider, diffStats?: ReadonlySessionDiffStats) {
                this.session = session;
                this.footerData = footerData;
                this.diffStats = diffStats;
        }

        /** Install the contextual hint provider (undefined disables the line). */
        setHintProvider(provider?: () => string | undefined): void {
                this.hintProvider = provider;
        }

        setSession(session: AgentSession): void {
                this.session = session;
        }

        setAutoCompactEnabled(enabled: boolean): void {
                this.autoCompactEnabled = enabled;
        }

        /** Beauty-4: the per-session diff accumulator this footer's `+N -M` chip reads. */
        setDiffStats(diffStats?: ReadonlySessionDiffStats): void {
                this.diffStats = diffStats;
        }

        /**
         * No-op: git branch caching now handled by provider.
         * Kept for compatibility with existing call sites in interactive-mode.
         */
        invalidate(): void {
                // No-op: git branch is cached/invalidated by provider
        }

        /**
         * Clean up resources.
         * Git watcher cleanup now handled by provider.
         */
        dispose(): void {
                // Git watcher cleanup handled by provider
        }

        /**
         * The context meter: a 10-cell bar (`ctx ▕███▐▏ 42%/200k`) — numbers
         * become a visual, color shifts only at the 70%/90% thresholds, and the
         * thin end-caps keep the bar readable without color in plain mode.
         *
         * Responsive (round 5): `compact` drops the bar and keeps the numbers
         * (`ctx 42%/200k`) — the meter must survive every tier, so it sheds its
         * decoration, not its information.
         */
        private renderContextMeter(percent: number | null, contextWindow: number, compact: boolean): string {
                const autoIndicator = this.autoCompactEnabled ? " (auto)" : "";
                if (percent === null) {
                        return theme.fg("dim", `ctx ?/${formatTokens(contextWindow)}${autoIndicator}`);
                }
                const clamped = Math.max(0, Math.min(100, percent));
                let label: string;
                if (compact) {
                        label = `ctx ${clamped.toFixed(0)}%/${formatTokens(contextWindow)}${autoIndicator}`;
                } else {
                        const cells = 10;
                        const filled = Math.round((clamped / 100) * cells);
                        const bar = "█".repeat(filled) + "░".repeat(cells - filled);
                        label = `ctx ▕${bar}▏ ${clamped.toFixed(1)}%/${formatTokens(contextWindow)}${autoIndicator}`;
                }

                let colorFn: (s: string) => string;
                if (clamped > 90) {
                        colorFn = (s: string) => theme.fg("error", s);
                } else if (clamped > 70) {
                        colorFn = (s: string) => theme.fg("warning", s);
                } else {
                        colorFn = (s: string) => theme.fg("dim", s);
                }
                return colorFn(label);
        }

        /**
         * The diff-stat chip (beauty-4): `+N -M` next to the context meter, added
         * lines in the diff-added green and removed lines in the diff-removed red —
         * the same tokens the edit blocks use, so the chip and the transcript
         * agree. Hidden until the session's first successful edit/write.
         */
        private renderDiffStatChip(counts: DiffLineCounts): string {
                return `${theme.fg("toolDiffAdded", `+${counts.added}`)} ${theme.fg("toolDiffRemoved", `-${counts.removed}`)}`;
        }

        render(width: number): string[] {
                const state = this.session.state;
                const tier = viewportTier(width);

                // Calculate cumulative usage from ALL session entries (not just post-compaction messages)
                const usageTotals = createUsageTotals();
                let latestCacheHitRate: number | undefined;

                for (const entry of this.session.sessionManager.getEntries()) {
                        if (entry.type === "message" && entry.message.role === "assistant") {
                                addUsageToTotals(usageTotals, entry.message.usage);

                                const latestPromptTokens =
                                        entry.message.usage.input + entry.message.usage.cacheRead + entry.message.usage.cacheWrite;
                                latestCacheHitRate =
                                        latestPromptTokens > 0 ? (entry.message.usage.cacheRead / latestPromptTokens) * 100 : undefined;
                        } else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage) {
                                addUsageToTotals(usageTotals, entry.message.usage);
                        } else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
                                addUsageToTotals(usageTotals, entry.usage);
                        }
                }

                // Calculate context usage from session (handles compaction correctly).
                // After compaction, tokens are unknown until the next LLM response.
                const contextUsage = this.session.getContextUsage();
                const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;

                // Line 1 — where we are. Responsive: the location line sheds
                // decorations by tier instead of truncating the composed string —
                // session name first (narrow), then the branch (narrow), and only
                // then folds the cwd itself.
                let pwd = formatCwdForFooter(this.session.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);
                const branch = this.footerData.getGitBranch();
                const sessionName = this.session.sessionManager.getSessionName();
                if (tier === "narrow") {
                        if (branch) {
                                pwd = `${pwd} (${branch})`;
                        }
                } else {
                        if (branch) {
                                pwd = `${pwd} (${branch})`;
                        }
                        if (sessionName) {
                                pwd = `${pwd} • ${sessionName}`;
                        }
                }
                const locationLine = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));

                // Line 2, left — the context meter plus usage stats, dimmed one step below
                // the location line so the meter's stateful color is the only loud thing.
                // Responsive: ordered segment dropping (never a blind truncation).
                const meter = this.renderContextMeter(contextUsage?.percent ?? null, contextWindow, tier === "narrow");

                // Optional stats, ordered by DESCENDING information value — the
                // fit loop below admits segments in this order, so the earliest
                // entries are kept most strongly and the latest (cost) drop
                // first when room runs out. The `keep` gate hides every optional
                // stat at the `narrow` tier (they would displace the model
                // identity); at every wider tier all of them are eligible and
                // the ordered drop alone decides what survives.
                const statsEligible = tier !== "narrow";
                const statsQueue: Array<{ text: string; keep: boolean }> = [];
                if (areExperimentalFeaturesEnabled()) {
                        statsQueue.push({ text: stripAnsiCodes(`${theme.fg("dim", "•")} ${theme.bold(theme.fg("warning", "xp"))}`), keep: true });
                }
                const diffCounts = this.diffStats?.get();
                if (diffCounts && (diffCounts.added > 0 || diffCounts.removed > 0)) {
                        // Styled, not stripped: the chip keeps the edit-block tokens
                        // (toolDiffAdded/toolDiffRemoved) so the footer and the
                        // transcript agree — the beauty-4 contract. visibleWidth
                        // measures ANSI-bearing text correctly.
                        statsQueue.push({
                                text: this.renderDiffStatChip(diffCounts),
                                keep: statsEligible,
                        });
                }
                if (usageTotals.output) {
                        statsQueue.push({ text: `↓${formatTokens(usageTotals.output)}`, keep: statsEligible });
                }
                if (usageTotals.input) {
                        statsQueue.push({ text: `↑${formatTokens(usageTotals.input)}`, keep: statsEligible });
                }
                if ((usageTotals.cacheRead > 0 || usageTotals.cacheWrite > 0) && latestCacheHitRate !== undefined) {
                        statsQueue.push({ text: `CH${latestCacheHitRate.toFixed(1)}%`, keep: statsEligible });
                }
                if (usageTotals.cacheWrite) {
                        statsQueue.push({ text: `W${formatTokens(usageTotals.cacheWrite)}`, keep: statsEligible });
                }
                if (usageTotals.cacheRead) {
                        statsQueue.push({ text: `R${formatTokens(usageTotals.cacheRead)}`, keep: statsEligible });
                }
                // Kimi Coding is subscription-backed despite using API-key authentication.
                const usingSubscription = state.model
                        ? state.model.provider === "kimi-coding" || this.session.modelRuntime.isUsingSubscription(state.model.provider)
                        : false;
                if (usageTotals.cost || usingSubscription) {
                        statsQueue.push({
                                text: `$${usageTotals.cost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`,
                                keep: statsEligible,
                        });
                }

                // Line 2, right — model identity + thinking level. The model is a
                // survivor: it degrades by shedding its provider prefix and
                // thinking suffix before ever being truncated (and then only with
                // an ellipsis, never a hard mid-word cut).
                const modelName = state.model?.id || "no-model";
                let rightSideWithSuffix = modelName;
                if (state.model?.reasoning) {
                        const thinkingLevel = state.thinkingLevel || "off";
                        rightSideWithSuffix =
                                thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
                }
                let rightSide = rightSideWithSuffix;
                if (this.footerData.getAvailableProviderCount() > 1 && state.model) {
                        rightSide = `(${state.model!.provider}) ${rightSideWithSuffix}`;
                }

                const minPadding = 2;
                // Degrade ladder for the right side: provider → suffix → truncate.
                const rightCandidates = [rightSide, rightSide.replace(/^\([^)]*\) /, ""), modelName];
                let statsLine = "";
                let statsLeft = "";
                let assembledOk = false;
                for (const candidate of rightCandidates) {
                        // Meter first, then keep-eligible segments in queue order —
                        // the queue is sorted by descending value, so when room runs
                        // out the lowest-value segments are the ones not admitted.
                        let left = meter;
                        for (const seg of statsQueue) {
                                if (!seg.keep) continue;
                                const candidateLeft = `${left} ${seg.text}`;
                                if (visibleWidth(candidateLeft) + minPadding + visibleWidth(candidate) > width) continue;
                                left = candidateLeft;
                        }
                        const leftWidth = visibleWidth(left);
                        const rightWidth = visibleWidth(candidate);
                        if (leftWidth + minPadding + rightWidth <= width) {
                                const padding = " ".repeat(width - leftWidth - rightWidth);
                                statsLeft = left;
                                statsLine = left + padding + candidate;
                                assembledOk = true;
                                break;
                        }
                        const availableForRight = width - leftWidth - minPadding;
                        if (availableForRight > 0) {
                                const truncatedRight = truncateToWidth(candidate, availableForRight, "…");
                                statsLeft = left;
                                statsLine =
                                        left +
                                        " ".repeat(Math.max(0, width - leftWidth - visibleWidth(truncatedRight))) +
                                        truncatedRight;
                                assembledOk = true;
                                break;
                        }
                        statsLeft = left;
                        statsLine = left;
                        assembledOk = true;
                }
                if (!assembledOk || visibleWidth(statsLine) > width) {
                        // Terminal narrower than the meter (or the assembled left
                        // side): truncate as the last resort — every line the
                        // chrome band paints must be exactly `width` wide.
                        statsLine = truncateToWidth(stripAnsiCodes(statsLine), width, "…");
                        statsLeft = statsLine;
                }

                // Apply dim to each side separately — the meter's color codes reset fg,
                // which would clear an outer dim wrapper mid-line. The split point is
                // the left side's exact string length (ANSI included), so the visible
                // characters carry over verbatim.
                const dimStatsLeft = theme.fg("dim", statsLeft);
                const remainder = statsLine.slice(statsLeft.length);
                const dimRemainder = theme.fg("dim", remainder);

                // The editor's bottom border is the top edge of the chrome band —
                // a second hairline here would read as a doubled border.
                const lines = [locationLine, dimStatsLeft + dimRemainder];

                return this.finishRender(lines, width);
        }

        /** Shared tail of render(): extension statuses, the contextual hint
         *  line (round 5, I3), and the chrome band. */
        private finishRender(lines: string[], width: number): string[] {
                // Add extension statuses on a single line, sorted by key alphabetically
                const extensionStatuses = this.footerData.getExtensionStatuses();
                if (extensionStatuses.size > 0) {
                        const sortedStatuses = Array.from(extensionStatuses.entries())
                                .sort(([a], [b]) => a.localeCompare(b))
                                .map(([, text]) => sanitizeStatusText(text));
                        const statusLine = sortedStatuses.join(" ");
                        // Truncate to terminal width with dim ellipsis for consistency with footer style
                        lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
                }

                // Contextual hint line (round 5, I3) — evaluated at render time
                // so it tracks live state (working / queued / idle); hidden at
                // the narrow tier where the chrome budget is spent on the
                // status lines themselves.
                if (viewportTier(width) !== "narrow") {
                        let hint: string | undefined;
                        try {
                                hint = this.hintProvider?.();
                        } catch {
                                hint = undefined;
                        }
                        if (hint) {
                                lines.push(truncateToWidth(theme.fg("dim", hint), width, theme.fg("dim", "…")));
                        }
                }

                // Chrome band (move 2): the footer is a raised surface — pad to full width
                // so the background is continuous, then paint chromeBg behind each line.
                const padded = lines.map((line) => {
                        const gap = " ".repeat(Math.max(0, width - visibleWidth(line)));
                        return theme.bg("chromeBg", line + gap);
                });
                return padded;
        }
}
