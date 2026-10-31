/**
 * settings/ui.ts — the interactive Settings hub (Phase 8).
 *
 * A select-driven hub (the /addons configurator's proven pattern — works in
 * every terminal, no custom-component surface to break) over the registry's
 * 10 intent-ordered sections, with the cross-cutting surfaces the TUI spec
 * demands: fuzzy Search, Recently changed (with revert), Recommended (from
 * health checks), Health check, Export/Import/Reset, and per-item editors
 * with risk badges, contextual help, persisted-rule preview and
 * revert-to-default. Keyboard-first: every write can be reached without a
 * mouse; command-launching actions pre-fill the editor via setEditorText.
 *
 * Risk contract (trust framework §3): high-risk writes require a TYPED
 * confirmation naming the consequence; every write previews the exact value
 * and destination file; every write lands in the change ledger.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { engineFetch } from "../engine-auth.ts";
import { listPendingDreams, renderPendingDiff } from "../dream-review.ts";
import { recentChanges, recordChange, revertChange } from "./history.ts";
import { loadHubPrefs, saveHubPrefs } from "./prefs.ts";
import {
        discardStagedSkill,
        itemById,
        listStagedSkills,
        promoteStagedSkill,
        SETTINGS_REGISTRY,
        itemsBySection,
} from "./registry.ts";
import { renderCapabilityMap } from "./render.ts";
import { searchSettings } from "./search.ts";
import {
        exportSettings,
        importSettings,
        listBackups,
        resetSettings,
        type ResetScope,
} from "./transfer.ts";
import { SECTION_META, type ChangeEntry, type SettingsItem, type SettingsValue } from "./types.ts";

interface HubOptions {
        cwd: string;
        unownVersion?: string;
}

const RISK_LABEL: Record<string, string> = { low: "● low", med: "◐ med", high: "○ HIGH" };

function shortSection(id: string): string {
        return SECTION_META.find((s) => s.id === id.split(".")[0])?.title ?? id;
}

async function currentValue(item: SettingsItem): Promise<string> {
        if (!item.get) return "";
        try {
                const value = await item.get();
                if (value === undefined) return "(unset)";
                if (item.format) return item.format(value);
                if (typeof value === "boolean") return value ? "on" : "off";
                return String(value);
        } catch (err) {
                return `(unreadable: ${err instanceof Error ? err.message : String(err)})`;
        }
}

/** The typed confirmation high-risk writes must pass (trust framework §3.2). */
async function confirmHighRisk(ctx: ExtensionContext, item: SettingsItem, consequence: string): Promise<boolean> {
        const typed = await ctx.ui.input(
                `HIGH RISK — ${item.name}\n${consequence}\nType "yes" to confirm (anything else cancels):`,
        );
        return (typed ?? "").trim().toLowerCase() === "yes";
}

/** Write through an item's setter with ledger recording + preview honesty. */
async function applyValue(
        ctx: ExtensionContext,
        item: SettingsItem,
        value: SettingsValue,
        via: string,
): Promise<boolean> {
        if (item.risk === "high") {
                const ok = await confirmHighRisk(
                        ctx,
                        item,
                        `This writes ${JSON.stringify(value)} to ${item.persistedIn ?? "its owning file"}. ${item.help}`,
                );
                if (!ok) {
                        ctx.ui.notify("Cancelled — nothing was written", "info");
                        return false;
                }
        }
        const before = item.get ? await item.get() : undefined;
        try {
                await item.set!(value);
        } catch (err) {
                ctx.ui.notify(`Write failed: ${err instanceof Error ? err.message : String(err)}`, "error");
                return false;
        }
        recordChange({
                actor: "user",
                itemId: item.id,
                itemName: item.name,
                section: item.section,
                before,
                after: value,
                via,
        });
        // The owning surface's live side effect (e.g. a theme switch
        // re-renders the TUI) — persistence already rode item.set.
        if (item.afterSet) {
                try {
                        item.afterSet(ctx.ui, value);
                } catch (err) {
                        ctx.ui.notify(
                                `Saved, but the live apply failed: ${err instanceof Error ? err.message : String(err)} — /reload binds it`,
                                "warning",
                        );
                }
        }
        const reload = item.reloadNote ? ` — ${item.reloadNote}` : "";
        ctx.ui.notify(`Saved: ${item.name} = ${String(value)}${reload}`, "info");
        return true;
}

// ---------------------------------------------------------------------------
// The item editor
// ---------------------------------------------------------------------------

async function openItem(ctx: ExtensionContext, opts: HubOptions, item: SettingsItem): Promise<void> {
        for (;;) {
                const value = await currentValue(item);
                const lines = [
                        `${RISK_LABEL[item.risk]} · ${item.kind}`,
                        `${item.summary}`,
                        `Now: ${value}`,
                        item.default !== undefined ? `Default: ${item.default}` : "",
                        item.persistedIn ? `Lives in: ${item.persistedIn}` : "",
                        item.related?.length ? `Related: ${item.related.join(" · ")}` : "",
                ].filter(Boolean);
                const options: string[] = [];
                if (item.kind === "toggle") options.push(item.get ? (await item.get()) ? "Turn OFF" : "Turn ON" : "Toggle");
                if (item.kind === "select" && (item.choices || item.getChoices)) options.push("Change value…");
                if (item.kind === "number") options.push("Change value…");
                if (item.kind === "text") options.push("Change value…");
                if (item.kind === "action") options.push(item.actionLabel ? item.actionLabel.replace(/^runs /, "Run: ") : "Run");
                if (item.set && item.default !== undefined) options.push("Revert to default");
                options.push("Help (what / where / how to revert)", "Back");
                const choice = await ctx.ui.select(`${shortSection(item.id)} → ${item.name}\n${lines.join("\n")}`, options);
                if (choice === undefined || choice === "Back") return;

                if (choice.startsWith("Run")) {
                        await runAction(ctx, opts, item);
                        continue;
                }
                if (choice === "Turn ON" || choice === "Turn OFF" || choice === "Toggle") {
                        const current = item.get ? Boolean(await item.get()) : false;
                        await applyValue(ctx, item, !current, "/settings hub");
                        continue;
                }
                if (choice === "Change value…") {
                        if (item.kind === "select") {
                                const choices = item.getChoices ? item.getChoices(ctx.ui) : (item.choices ?? []);
                                if (choices.length === 0) {
                                        ctx.ui.notify("No choices available (themes not loaded?) — try /reload", "warning");
                                        continue;
                                }
                                const picked = await ctx.ui.select(
                                        `${item.name} — pick a value`,
                                        choices.map((c) => c.label),
                                );
                                if (picked === undefined) continue;
                                const match = choices.find((c) => c.label === picked);
                                if (match) await applyValue(ctx, item, match.value, "/settings hub");
                        } else if (item.kind === "number") {
                                const raw = await ctx.ui.input(`${item.name} (${item.min ?? "-∞"}..${item.max ?? "∞"}${item.integer ? ", whole" : ""})`, String(value));
                                if (raw === undefined || raw.trim() === "") continue;
                                const parsed = Number(raw);
                                if (!Number.isFinite(parsed)) {
                                        ctx.ui.notify("Not a number — unchanged", "warning");
                                        continue;
                                }
                                const clamped = Math.min(Math.max(parsed, item.min ?? -Infinity), item.max ?? Infinity);
                                const final = item.integer ? Math.trunc(clamped) : clamped;
                                await applyValue(ctx, item, final, "/settings hub");
                        } else {
                                const raw = await ctx.ui.input(`${item.name} — new value`, value);
                                if (raw === undefined || raw.trim() === "") continue;
                                await applyValue(ctx, item, raw.trim(), "/settings hub");
                        }
                        continue;
                }
                if (choice === "Revert to default") {
                        await applyValue(ctx, item, item.default, "/settings hub (revert to default)");
                        continue;
                }
                if (choice.startsWith("Help")) {
                        ctx.ui.notify(
                                `${item.name}\n${item.help}\n${item.persistedIn ? `Lives in: ${item.persistedIn}\n` : ""}Revert: here (${item.set ? "Revert to default / Recently changed" : "edit the file above"}).`,
                                "info",
                        );
                        continue;
                }
        }
}

// ---------------------------------------------------------------------------
// Action items — each launches the owning flow
// ---------------------------------------------------------------------------

async function runAction(ctx: ExtensionContext, opts: HubOptions, item: SettingsItem): Promise<void> {
        const cwd = opts.cwd;
        switch (item.id) {
                case "agent.capabilities":
                        ctx.ui.notify(renderCapabilityMap(), "info");
                        return;
                case "agent.output-style":
                        ctx.ui.setEditorText("/output-style");
                        ctx.ui.notify("Command staged — press Enter to run /output-style", "info");
                        return;
                case "memory.stack":
                        ctx.ui.setEditorText("/learning");
                        ctx.ui.notify("Command staged — press Enter to run /learning", "info");
                        return;
                case "memory.search": {
                        const query = await ctx.ui.input("Search memories for…");
                        if (query === undefined || !query.trim()) return;
                        ctx.ui.setEditorText(`/memory search ${query.trim()}`);
                        ctx.ui.notify("Command staged — press Enter to search", "info");
                        return;
                }
                case "memory.edit-rollback":
                        ctx.ui.setEditorText("/dashboard memory");
                        ctx.ui.notify("Command staged — press Enter to open the Memory screen", "info");
                        return;
                case "learning.feed":
                        ctx.ui.setEditorText("/feed");
                        ctx.ui.notify("Command staged — press Enter to run /feed", "info");
                        return;
                case "learning.pending-dreams":
                        await openDreamInbox(ctx, cwd);
                        return;
                case "learning.skills-staged":
                        await openStagedSkills(ctx, cwd);
                        return;
                case "learning.skills-screen":
                        ctx.ui.setEditorText("/dashboard skills");
                        ctx.ui.notify("Command staged — press Enter to open the Skills screen", "info");
                        return;
                case "automation.list":
                case "automation.stop":
                case "automation.runs":
                        await openAutomations(ctx, item.id);
                        return;
                case "safety.envelope":
                        await renderEnvelope(ctx, cwd);
                        return;
                case "safety.trust-manifest":
                        await renderTrustManifest(ctx, cwd);
                        return;
                case "safety.permissions":
                        ctx.ui.setEditorText("/permissions status");
                        ctx.ui.notify("Command staged — press Enter to run /permissions status", "info");
                        return;
                case "safety.add-dir":
                        ctx.ui.setEditorText("/add-dir list");
                        ctx.ui.notify("Command staged — press Enter to list current grants", "info");
                        return;
                case "models.providers":
                        ctx.ui.setEditorText("/providers");
                        ctx.ui.notify("Command staged — press Enter to run /providers", "info");
                        return;
                case "models.thinking":
                        ctx.ui.setEditorText("/thinking");
                        ctx.ui.notify("Command staged — press Enter to run /thinking", "info");
                        return;
                case "models.usage":
                        ctx.ui.setEditorText("/usage");
                        ctx.ui.notify("Command staged — press Enter to run /usage", "info");
                        return;
                case "tools.mcp":
                        ctx.ui.setEditorText("/mcp");
                        ctx.ui.notify("Command staged — press Enter to run /mcp", "info");
                        return;
                case "tools.hooks":
                        ctx.ui.setEditorText("/hooks");
                        ctx.ui.notify("Command staged — press Enter to run /hooks", "info");
                        return;
                case "tools.lsp":
                        ctx.ui.setEditorText("/lsp");
                        ctx.ui.notify("Command staged — press Enter to run /lsp", "info");
                        return;
                case "tools.subagents":
                        ctx.ui.setEditorText("/agents");
                        ctx.ui.notify("Command staged — press Enter to run /agents", "info");
                        return;
                case "obs.status":
                        ctx.ui.setEditorText("/status");
                        ctx.ui.notify("Command staged — press Enter to run /status", "info");
                        return;
                case "obs.context":
                        ctx.ui.setEditorText("/context");
                        ctx.ui.notify("Command staged — press Enter to run /context", "info");
                        return;
                case "obs.insights":
                        ctx.ui.setEditorText("/insights");
                        ctx.ui.notify("Command staged — press Enter to run /insights", "info");
                        return;
                case "obs.recent-changes":
                        await openRecent(ctx);
                        return;
                case "rec.undo":
                        ctx.ui.setEditorText("/undo 1");
                        ctx.ui.notify("Command staged — press Enter to undo the last turn's file changes (/undo n for more)", "info");
                        return;
                case "rec.restore":
                        ctx.ui.setEditorText("/checkpoints");
                        ctx.ui.notify("Command staged — press Enter to list checkpoints (/restore <id|label>)", "info");
                        return;
                case "rec.recovery":
                        ctx.ui.setEditorText("/recovery");
                        ctx.ui.notify("Command staged — press Enter to run /recovery", "info");
                        return;
                case "rec.dream-rollback":
                        ctx.ui.setEditorText("/dashboard memory");
                        ctx.ui.notify("Command staged — press Enter to open the Memory screen (one-key rollback)", "info");
                        return;
                case "rec.update-rollback":
                        ctx.ui.notify("Run: unown update --rollback (restores the previous binary)", "info");
                        return;
                case "rec.reset":
                        await openReset(ctx, opts);
                        return;
                case "rec.transfer":
                        await openTransfer(ctx, opts);
                        return;
                case "adv.env-browser":
                        await openEnvBrowser(ctx);
                        return;
                default:
                        ctx.ui.notify(`${item.name}: no interactive flow yet — ${item.help}`, "info");
        }
}

// ---------------------------------------------------------------------------
// Composite surfaces
// ---------------------------------------------------------------------------

async function openDreamInbox(ctx: ExtensionContext, cwd: string): Promise<void> {
        const pending = listPendingDreams(cwd);
        if (pending.length === 0) {
                ctx.ui.notify(
                        "No pending dreams. In review mode (Learning → Dream review mode) a fully-passed project dream parks its diff here instead of shipping — you approve or discard it.",
                        "info",
                );
                return;
        }
        for (const dream of pending) {
                const preview = renderPendingDiff(dream);
                const choice = await ctx.ui.select(
                        `Pending dream — ${dream.slug} (${dream.notesIn} notes, ${new Date(dream.createdAt).toISOString().slice(0, 16)})\n${dream.summary}\n\n${preview.slice(0, 3000)}`,
                        ["Approve — ship exactly this diff", "Discard — revert, ship nothing", "Skip (leave pending)"],
                );
                if (choice === undefined || choice.startsWith("Skip")) continue;
                try {
                        const endpoint = choice.startsWith("Approve") ? "approve" : "discard";
                        const res = await engineFetch(`/api/dreams/pending/${endpoint}`, {
                                method: "POST",
                                headers: { "content-type": "application/json" },
                                body: JSON.stringify({ projectPath: dream.projectPath, id: dream.id }),
                        });
                        const data = (await res.json()) as { ok?: boolean; detail?: string; error?: string };
                        ctx.ui.notify(data.detail ?? data.error ?? "done", data.ok ? "info" : "warning");
                } catch (err) {
                        ctx.ui.notify(
                                `Engine unreachable (${err instanceof Error ? err.message : String(err)}) — the engine applies dream approvals. Start it with: bun run agent:start`,
                                "warning",
                        );
                }
        }
}

async function openStagedSkills(ctx: ExtensionContext, cwd: string): Promise<void> {
        const staged = listStagedSkills(cwd);
        if (staged.length === 0) {
                ctx.ui.notify("No staged skills in .unown/skills-staged/ — minted skills appear here for your promotion (they never auto-load).", "info");
                return;
        }
        for (const skill of staged) {
                const preview = skill.skillMd.slice(0, 2500);
                const choice = await ctx.ui.select(
                        `Staged skill — ${skill.name}\n\n${preview}`,
                        ["Promote into .unown/skills/ (loads after /reload)", "Discard (delete the staged copy)", "Skip"],
                );
                if (choice === undefined || choice.startsWith("Skip")) continue;
                if (choice.startsWith("Promote")) {
                        const result = promoteStagedSkill(cwd, skill.name);
                        recordChange({
                                actor: "user",
                                itemId: "learning.skills-staged",
                                itemName: `Staged skill: ${skill.name}`,
                                section: "learning",
                                before: "staged",
                                after: "promoted",
                                via: "/settings staged-skills inbox",
                        });
                        ctx.ui.notify(result.ok ? `Promoted ${skill.name} — /reload loads it` : `Failed: ${result.error}`, result.ok ? "info" : "error");
                } else {
                        const confirmed = await ctx.ui.confirm(`Delete the staged skill "${skill.name}"?`, "It was never loaded — this just removes the staged copy.");
                        if (!confirmed) continue;
                        const result = discardStagedSkill(cwd, skill.name);
                        recordChange({
                                actor: "user",
                                itemId: "learning.skills-staged",
                                itemName: `Staged skill: ${skill.name}`,
                                section: "learning",
                                before: "staged",
                                after: "discarded",
                                via: "/settings staged-skills inbox",
                        });
                        ctx.ui.notify(result.ok ? `Discarded ${skill.name}` : `Failed: ${result.error}`, result.ok ? "info" : "error");
                }
        }
}

async function openAutomations(ctx: ExtensionContext, focus: string): Promise<void> {
        let automations: Array<Record<string, any>> = [];
        let engineError = "";
        try {
                const res = await engineFetch("/api/automations");
                const data = (await res.json()) as { automations?: Array<Record<string, any>> };
                automations = data.automations ?? [];
        } catch (err) {
                engineError = err instanceof Error ? err.message : String(err);
        }
        if (automations.length === 0) {
                ctx.ui.notify(
                        engineError
                                ? `Engine unreachable (${engineError}) — start it with: bun run agent:start`
                                : "No routines configured. Create one with: unown routines create",
                        "info",
                );
                return;
        }
        const options = automations.map(
                (a) =>
                        `${a.lifecycle === "active" ? "▶" : "⏸"} ${a.title} [${a.mode}] ${a.schedule ?? ""} · runs: ${a.run_count ?? 0}${a.running ? " · RUNNING" : ""}`,
        );
        if (focus === "automation.runs") {
                const detail: string[] = [];
                for (const a of automations.slice(0, 6)) {
                        try {
                                const res = await engineFetch(`/api/automations/${encodeURIComponent(a.id)}/runs?limit=5`);
                                const data = (await res.json()) as { runs?: Array<Record<string, any>> };
                                const runs = (data.runs ?? [])
                                        .map(
                                                (r) =>
                                                        `    ${r.status} · ${r.turns ?? 0} turns · ${Number(r.tokens_in ?? 0) + Number(r.tokens_out ?? 0)} tok · ${String(r.output ?? "").slice(0, 80)}`,
                                        )
                                        .join("\n");
                                detail.push(`${a.title}:\n${runs || "    (no runs)"}`);
                        } catch {
                                /* per-routine failure never breaks the card */
                        }
                }
                ctx.ui.notify(`Automation spend & history (this spend is NOT inside the governor ledger):\n\n${detail.join("\n\n")}`, "info");
                return;
        }
        const picked = await ctx.ui.select("Routines — pick one to stop (Esc to exit)", options);
        if (picked === undefined) return;
        const index = options.indexOf(picked);
        const automation = automations[index];
        if (!automation) return;
        if (!(await confirmHighRiskRaw(ctx, `STOP the running child of "${automation.title}"?`, "The child is SIGKILLed; its run row records 'stopped' (never 'failed') and no retry is armed."))) return;
        try {
                const res = await engineFetch(`/api/automations/${encodeURIComponent(automation.id)}/stop`, { method: "POST" });
                const data = (await res.json()) as { ok?: boolean; detail?: string };
                ctx.ui.notify(data.detail ?? (data.ok ? "stopped" : "nothing to stop"), data.ok ? "info" : "warning");
        } catch (err) {
                ctx.ui.notify(`Engine unreachable: ${err instanceof Error ? err.message : String(err)}`, "warning");
        }
}

async function confirmHighRiskRaw(ctx: ExtensionContext, title: string, consequence: string): Promise<boolean> {
        const typed = await ctx.ui.input(`${title}\n${consequence}\nType "yes" to confirm:`);
        return (typed ?? "").trim().toLowerCase() === "yes";
}

async function renderEnvelope(ctx: ExtensionContext, cwd: string): Promise<void> {
        const lines: string[] = ["The effective permission envelope — the five layers that decide every action:"];
        const envOn = (name: string): boolean => {
                const raw = process.env[name];
                return !(raw === "0" || raw === "false" || raw === "off");
        };
        lines.push(
                `1. Permission mode: ${process.env.UNOWN_PERMISSION_MODE ?? "default"} (session; /permissions mode)`,
                `2. Permission rules: ${envOn("UNOWN_PERMISSIONS") ? "layer ON (allow/deny/ask rules active)" : "layer DISABLED (UNOWN_PERMISSIONS=0)"} — /permissions status lists them`,
                `3. Write jail: project dir + temp${process.env.UNOWN_STRICT_HOOKS === undefined || envOn("UNOWN_STRICT_HOOKS") ? " + strict-hooks deny (network/git push/sudo blocked)" : " (strict hooks OFF)"}`,
                `4. OS sandbox: ${envOn("UNOWN_OS_SANDBOX") ? "bubblewrap fs+net isolation for engine sandbox runs" : "OFF (UNOWN_OS_SANDBOX=0)"}`,
                `5. Instruction guard: always on — in-session AGENTS.md/skills/memory/hooks writes are denied`,
                "",
                `Project: ${cwd}`,
                `Trust gates: /mcp trust · /hooks trust · /lsp trust · /project-settings trust (see the Trust manifest)`,
                `bypassPermissions: refused under strict hooks; --permission-mode pins it per launch`,
        );
        ctx.ui.notify(lines.join("\n"), "info");
}

async function renderTrustManifest(ctx: ExtensionContext, cwd: string): Promise<void> {
        const { existsSync } = await import("node:fs");
        const configs: Array<[file: string, what: string, command: string]> = [
                [".unown/mcp.json", "MCP servers (stdio commands / HTTP endpoints + elicitation policy)", "/mcp trust"],
                [".unown/hooks.json", "Hook handlers for 13 events (commands run on YOUR machine)", "/hooks trust"],
                [".unown/lsp.json", "LSP server commands per language", "/lsp trust"],
                [".unown/permissions.json", "Permission rules (allow/deny/ask) that ADD to yours", "/permissions → trust"],
                [".unown/settings.json", "Per-project defaults (model, provider, effort, permission mode, add-dirs)", "/project-settings trust"],
        ];
        const lines: string[] = [`Trust manifest — what ${cwd} would activate:`];
        let anyFound = false;
        for (const [file, what, command] of configs) {
                const found = existsSync(join(cwd, file));
                if (!found) continue;
                anyFound = true;
                lines.push(`  • ${file} — ${what}\n    gate: ${command}`);
        }
        if (!anyFound) lines.push("  (no project configs found — nothing to trust)");
        lines.push(
                "",
                "Untrusted configs are WITHHELD until approved; approval fingerprints the file and re-gates on any change.",
                `Trust bypass (UNOWN_TRUST_PROJECT_CONFIG=1): ${process.env.UNOWN_TRUST_PROJECT_CONFIG === "1" ? "ON — DANGER: cloned configs activate unreviewed" : "off (safe)"}`,
        );
        ctx.ui.notify(lines.join("\n"), "info");
}

async function openRecent(ctx: ExtensionContext): Promise<void> {
        const entries = recentChanges(10);
        if (entries.length === 0) {
                ctx.ui.notify("No settings changes recorded yet — every hub write lands here with a revert.", "info");
                return;
        }
        for (;;) {
                const options = entries.map(
                        (e) => `${new Date(e.ts).toISOString().slice(5, 16)} ${e.itemName}: ${String(e.before)} → ${String(e.after)} [${e.actor}]`,
                );
                options.push("Back");
                const picked = await ctx.ui.select("Recently changed (newest first) — pick an entry to revert", options);
                if (picked === undefined || picked === "Back") return;
                const entry = entries[options.indexOf(picked)];
                if (!entry) return;
                const confirmed = await ctx.ui.confirm(`Revert ${entry.itemName} to ${JSON.stringify(entry.before)}?`, "The revert is itself recorded in the ledger.");
                if (!confirmed) continue;
                const result = await revertChange(entry.id, (itemId) => itemById(itemId));
                ctx.ui.notify(result.ok ? result.detail : result.error, result.ok ? "info" : "warning");
                return;
        }
}

async function openReset(ctx: ExtensionContext, opts: HubOptions): Promise<void> {
        const scope = await ctx.ui.select(
                "Reset settings — SCOPED, never all-or-nothing. A timestamped backup is written first (~/.unown/agent/settings-backups/, last 5 kept).",
                ["Hub preferences (review mode, budgets, depth)", "Addons config (ask/todo/advisor)", "pi settings (hub-managed keys)", "ALL of the above", "Cancel"],
        );
        if (scope === undefined || scope === "Cancel") return;
        const map: Record<string, ResetScope> = {
                "Hub preferences (review mode, budgets, depth)": "hub",
                "Addons config (ask/todo/advisor)": "addons",
                "pi settings (hub-managed keys)": "pi",
                "ALL of the above": "all",
        };
        const chosen = map[scope];
        if (!(await confirmHighRiskRaw(ctx, `Reset ${chosen}?`, "Current state is backed up first; the reset itself is recorded in the ledger."))) return;
        const result = resetSettings(chosen, "/settings reset");
        ctx.ui.notify(`Reset done (backup: ${result.backupPath})\n${result.reset.join("\n")}`, "info");
}

async function openTransfer(ctx: ExtensionContext, opts: HubOptions): Promise<void> {
        const choice = await ctx.ui.select("Settings transfer", ["Export a bundle…", "Import a bundle…", "Backups (last 5)", "Back"]);
        if (choice === undefined || choice === "Back") return;
        if (choice.startsWith("Export")) {
                const path = await ctx.ui.input("Export to path", join(opts.cwd, "unown-settings.json"));
                if (path === undefined || !path.trim()) return;
                const result = exportSettings(path.trim(), opts.unownVersion);
                ctx.ui.notify(result.ok ? `Exported ${SETTINGS_REGISTRY.length}-entry surface bundle → ${result.path}\n(addons, pi settings, ui layout, output style, hub prefs, permission rules — never keys or .env)` : `Export failed: ${result.error}`, "info");
                return;
        }
        if (choice.startsWith("Import")) {
                const path = await ctx.ui.input("Import from path", join(opts.cwd, "unown-settings.json"));
                if (path === undefined || !path.trim()) return;
                const result = importSettings(path.trim(), "/settings import");
                ctx.ui.notify(
                        `Import ${result.ok ? "applied" : "failed"}${result.error ? `: ${result.error}` : ""}\nApplied: ${result.applied.join(", ") || "(nothing)"}\nSkipped: ${result.skipped.join("; ") || "(none)"}\nBackup: ${result.backupPath ?? "-"}`,
                        result.ok ? "info" : "warning",
                );
                return;
        }
        const backups = listBackups();
        ctx.ui.notify(backups.length ? `Backups (newest first):\n${backups.join("\n")}` : "No backups yet (one is written before every import/reset).", "info");
}

async function openEnvBrowser(ctx: ExtensionContext): Promise<void> {
        for (;;) {
                const query = await ctx.ui.input("Search environment variables (name or value; empty exits)");
                if (query === undefined || !query.trim()) return;
                const q = query.trim().toLowerCase();
                const matches = Object.keys(process.env)
                        .filter((k) => k.startsWith("UNOWN_") || k.startsWith("PI_") || k.startsWith("BRIDGE_") || k.startsWith("ZAI_"))
                        .filter((k) => k.toLowerCase().includes(q) || String(process.env[k]).toLowerCase().includes(q))
                        .slice(0, 12);
                if (matches.length === 0) {
                        ctx.ui.notify("No matching UNOWN_/PI_/BRIDGE_ vars are SET (unset vars are documented in .env.example).", "info");
                        continue;
                }
                const options = matches.map((k) => `${k} = ${String(process.env[k]).slice(0, 40)}`);
                options.push("Search again…");
                const picked = await ctx.ui.select("Set vars matching (full doc: .env.example)", options);
                if (picked === undefined) return;
                if (picked === "Search again…") continue;
                const key = matches[options.indexOf(picked)];
                const item = SETTINGS_REGISTRY.find((i) => i.env === key);
                if (item) await openItem(ctx, { cwd: process.cwd() }, item);
                else ctx.ui.notify(`${key} = ${String(process.env[key])}\n(Documentation: .env.example — edit .env to change; service restart applies.)`, "info");
        }
}

// ---------------------------------------------------------------------------
// The hub
// ---------------------------------------------------------------------------

export async function runSettingsHub(ctx: ExtensionContext, opts: HubOptions): Promise<void> {
        for (;;) {
                const prefs = loadHubPrefs();
                const recent = recentChanges(10).length;
                const recommended = (await (await import("./health.ts")).recommendedItems(opts.cwd)).length;
                const options: string[] = [
                        "Search settings…",
                        `Recently changed (${recent})`,
                        `Recommended for you (${recommended})`,
                        "Health check",
                ];
                for (const meta of SECTION_META) {
                        const count = itemsBySection(meta.id).length;
                        options.push(`${meta.title} — ${meta.purpose} (${count})`);
                }
                options.push("Export / Import / Reset", "Exit");
                const choice = await ctx.ui.select("unown settings — the control centre (Esc to exit)", options);
                if (choice === undefined || choice === "Exit") return;

                if (choice === "Search settings…") {
                        await hubSearch(ctx, opts);
                        continue;
                }
                if (choice.startsWith("Recently changed")) {
                        await openRecent(ctx);
                        continue;
                }
                if (choice.startsWith("Recommended")) {
                        await openRecommended(ctx, opts);
                        continue;
                }
                if (choice === "Health check") {
                        const { renderHealth } = await import("./render.ts");
                        ctx.ui.notify(await renderHealth(opts.cwd), "info");
                        continue;
                }
                if (choice === "Export / Import / Reset") {
                        await openTransfer(ctx, opts);
                        await openReset(ctx, opts);
                        continue;
                }
                const meta = SECTION_META.find((m) => choice.startsWith(`${m.title} —`));
                if (meta) {
                        await openSection(ctx, opts, meta.id, prefs.showAdvanced);
                        continue;
                }
        }
}

async function hubSearch(ctx: ExtensionContext, opts: HubOptions): Promise<void> {
        const query = await ctx.ui.input("Search settings (name, purpose, help, env var…)");
        if (query === undefined || !query.trim()) return;
        const hits = searchSettings(query.trim(), 10);
        if (hits.length === 0) {
                ctx.ui.notify(`No settings matched "${query.trim()}".`, "info");
                return;
        }
        const options = hits.map((h) => {
                const risk = h.item.risk === "high" ? " ○HIGH" : "";
                return `${shortSection(h.item.id)} → ${h.item.name}${risk}`;
        });
        options.push("Back");
        const picked = await ctx.ui.select(`Search: "${query.trim()}" (${hits.length} hits)`, options);
        if (picked === undefined || picked === "Back") return;
        const hit = hits[options.indexOf(picked)];
        if (hit) await openItem(ctx, opts, hit.item);
}

async function openRecommended(ctx: ExtensionContext, opts: HubOptions): Promise<void> {
        const { recommendedItems } = await import("./health.ts");
        const checks = await recommendedItems(opts.cwd);
        if (checks.length === 0) {
                ctx.ui.notify("Nothing to recommend — every check passes.", "info");
                return;
        }
        const options = checks.map((c) => `${c.status === "fail" ? "✗" : "!"} ${c.label} — fix available`);
        options.push("Back");
        const picked = await ctx.ui.select("Recommended — settings worth a decision", options);
        if (picked === undefined || picked === "Back") return;
        const check = checks[options.indexOf(picked)];
        if (!check?.fixItemId) return;
        const item = itemById(check.fixItemId);
        if (item) await openItem(ctx, opts, item);
}

async function openSection(
        ctx: ExtensionContext,
        opts: HubOptions,
        section: string,
        showAdvanced: boolean,
): Promise<void> {
        for (;;) {
                const all = itemsBySection(section as never);
                const visible = all.filter((i) => showAdvanced || !i.advanced);
                const hiddenCount = all.length - visible.length;
                const resolved: string[] = [];
                for (const item of visible) {
                        const value = await currentValue(item);
                        const risk = item.risk === "high" ? " ○" : item.risk === "med" ? " ◐" : "";
                        resolved.push(`${item.name}${risk}${value ? ` = ${value.slice(0, 48)}` : ""}`);
                }
                if (hiddenCount > 0) resolved.push(`Show ${hiddenCount} advanced row(s)…`);
                resolved.push("Back");
                const meta = SECTION_META.find((s) => s.id === section)!;
                const picked = await ctx.ui.select(`${meta.title} — ${meta.purpose}`, resolved);
                if (picked === undefined || picked === "Back") return;
                if (picked.startsWith("Show ")) {
                        const prefs = loadHubPrefs();
                        prefs.showAdvanced = true;
                        saveHubPrefs(prefs);
                        continue;
                }
                const index = resolved.indexOf(picked);
                const item = visible[index];
                if (item) await openItem(ctx, opts, item);
        }
}

/** Entry for the hub's recent list (used by /settings recent in TUI mode too). */
export function recentEntriesFor(n: number): ChangeEntry[] {
        return recentChanges(n);
}
