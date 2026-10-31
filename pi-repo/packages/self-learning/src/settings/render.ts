/**
 * settings/render.ts — headless text renderings (the print/RPC lane).
 *
 * `/settings status`, `/settings search`, `/settings diff`, `/settings
 * health` must work without a TTY (a config surface you cannot read from a
 * script is half a surface). Everything here is pure text, no ctx.ui.
 */

import { diffAgainstDefaults, formatDiffRows } from "./diff.ts";
import { runHealthChecks } from "./health.ts";
import { recentChanges } from "./history.ts";
import { SETTINGS_REGISTRY, itemsBySection } from "./registry.ts";
import { formatSearchResults, searchSettings } from "./search.ts";
import { RISK_BADGE, SECTION_META } from "./types.ts";

function line(char = "─", width = 64): string {
        return char.repeat(width);
}

/**
 * The status card. `verbose` adds the capability map card (the --verbose
 * lane the help text always implied — implemented in the S2-20 sweep; before
 * that the flag was documented but silently ignored).
 */
export async function renderStatus(opts?: { verbose?: boolean }): Promise<string> {
        const out: string[] = [];
        out.push("unown settings — status");
        out.push(line());
        for (const meta of SECTION_META) {
                const items = itemsBySection(meta.id);
                out.push(`${meta.title} — ${meta.purpose}`);
                for (const item of items) {
                        let value = "";
                        if (item.get) {
                                try {
                                        const current = await item.get();
                                        value = current === undefined ? "" : ` = ${item.format ? item.format(current) : String(current)}`;
                                } catch {
                                        value = " = (unreadable)";
                                }
                        }
                        out.push(`  ${RISK_BADGE[item.risk]} ${item.name}${value}`);
                }
                out.push("");
        }
        const recent = recentChanges(3);
        if (recent.length > 0) {
                out.push("Recently changed:");
                for (const entry of recent) {
                        out.push(`  ${new Date(entry.ts).toISOString().slice(0, 16)} ${entry.itemName}: ${String(entry.before)} → ${String(entry.after)} (${entry.actor})`);
                }
        }
        if (opts?.verbose) {
                out.push("");
                out.push(renderCapabilityMap());
        }
        return out.join("\n");
}

export function renderHelp(): string {
        return [
                "unown settings hub",
                line(),
                "/settings                  open the interactive hub (TUI)",
                "/settings status [--verbose] print every section + effective values; --verbose adds the capability map (headless-safe)",
                "/settings search <query>   fuzzy-search the catalog (headless-safe)",
                "/settings health           run the health checks (headless-safe)",
                "/settings diff             settings that differ from defaults (headless-safe)",
                "/settings recent [n]       the change ledger, newest first (headless-safe)",
                "/settings export [path]    write a settings bundle (default: unown-settings.json)",
                "/settings import <path>    apply a bundle (backs up current state first)",
                "/settings reset <scope>    scoped reset: hub | addons | pi | all (backs up first)",
                "",
                `${SETTINGS_REGISTRY.length} catalog entries across ${SECTION_META.length} intent-ordered sections.`,
        ].join("\n");
}

export async function renderSearch(query: string): Promise<string> {
        // 12 rows × 2 lines fits a terminal viewport — a longer notify scrolls the
        // top hits (the best ones) off-screen in the TUI lane.
        return formatSearchResults(searchSettings(query, 12));
}

export async function renderHealth(cwd: string): Promise<string> {
        const checks = await runHealthChecks(cwd);
        const glyph: Record<string, string> = { ok: "✓", warn: "!", fail: "✗", info: "·" };
        const out = checks.map((c) => `${glyph[c.status]} ${c.label} — ${c.detail}${c.fixItemId ? `  (fix: /settings → ${c.fixItemId})` : ""}`);
        return [`unown settings — health (${checks.filter((c) => c.status === "fail").length} fail / ${checks.filter((c) => c.status === "warn").length} warn)`, line(), ...out].join("\n");
}

export async function renderDiff(): Promise<string> {
        return ["unown settings — diff vs defaults", line(), formatDiffRows(await diffAgainstDefaults())].join("\n");
}

export function renderRecent(n = 10): string {
        const entries = recentChanges(n);
        if (entries.length === 0) return "No settings changes recorded yet.";
        return [
                `unown settings — recently changed (newest first, ${entries.length})`,
                line(),
                ...entries.map(
                        (e) =>
                                `${new Date(e.ts).toISOString().slice(0, 19)}  ${e.itemName}: ${String(e.before)} → ${String(e.after)}  [${e.actor} via ${e.via}]`,
                ),
        ].join("\n");
}

/** The capability map card (Agent → Capability map; also used by /settings status --verbose). */
export function renderCapabilityMap(): string {
        return [
                "unown — capability map",
                line(),
                "The five mechanisms (the self-learning layer):",
                "  1. Tiered memory — policy → project → user → local, injected every turn",
                "  2. Self-improving harness — benchmark suites + harness tests + receipts",
                "  3. AutoDreaming + skill acquisition — notes → dreams (canary-gated) → staged skills",
                "  4. Routing — per-job model routing + the llm-bridge (concurrency, failover)",
                "  5. Hooks — 13 events × 5 handler types, strict-mode deny-list",
                "",
                "Session tools (model-facing): read/grep/glob, bash (deny-listed), edit/write",
                "(write-jail), task (subagents), fleet (async children), web_search/webfetch",
                "(cached), browser (stealth), LSP diagnostics, MCP tools, todo, notes,",
                "checkpoints/undo, recipes, wiki, review, goal tracking, memory search.",
                "",
                "Unattended surfaces: the detached engine (REST+SSE, token-gated),",
                "automations/routines (read-only default), standing orders, watch.",
                "",
                "See: /settings → each section card; docs/usage.md; unown --help.",
        ].join("\n");
}
