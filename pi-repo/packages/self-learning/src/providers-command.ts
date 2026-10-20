/**
 * providers-command.ts — the `/providers` slash command (R2, the TUI native).
 *
 * THE DECISION THIS IMPLEMENTS: provider management lives ONLY in the
 * terminal — the `unown providers` CLI (the non-interactive twin) and this
 * in-chat command, so a user mid-session can list/add/key/test/refresh/remove
 * providers and set defaults WITHOUT leaving the conversation. There is no
 * HTTP surface and no dashboard form: the web dashboard is a viewer, not a
 * credential surface.
 *
 * The registry core (src/providers.ts) is the single source of truth — this
 * module calls the SAME functions the CLI calls (listProviders, upsertProvider,
 * removeProvider, setProviderKey, setDefaultModel, testProvider,
 * refreshProviderModels); the bridge preset keeps the CLI's special rules
 * (PI_PROVIDER id, placeholder key, served allow-list). The text vocabulary
 * (✓ / ✗ / ⚠ / ·, actionable failure classification: 401 → key, unreachable →
 * URL/network) mirrors providers-cli.ts on purpose — one voice, two surfaces.
 *
 * Purity contract (the engine-status.ts pattern): NO DB imports, no HTTP
 * server, no pi imports. The command context is a minimal STRUCTURAL type
 * (mode/hasUI/ui/modelRegistry) so the real ExtensionCommandContext satisfies
 * it without adapters and tests can fake it with scripted queues. The two
 * network-reaching registry functions (testProvider, refreshProviderModels)
 * ride behind an injectable deps object — every other call is pure disk.
 *
 * UX notes:
 *   - bare /providers opens the interactive manager when the host has dialogs
 *     (TUI + RPC — RPC degrades to sequential prompts) and prints the text
 *     summary in print/json mode (ctx.hasUI === false).
 *   - /providers list always prints the summary; /providers test <id> and
 *     /providers refresh <id> are the headless one-shots.
 *   - after any registry mutation the command awaits ctx.modelRegistry.refresh()
 *     (re-reads models.json) so /model's picker and the footer reflect changes
 *     without a restart. Switching THIS session's model stays /model's job —
 *     the "make default" notify says so.
 */

import { join } from "node:path";
import { bridgeKnownModels, resolveUnownHome } from "./term.ts";
import { PRESETS, type ProviderPreset } from "./presets.ts";
import {
        keyStatusLabel,
        listProviders,
        refreshProviderModels,
        removeProvider,
        setDefaultModel,
        setProviderKey,
        testProvider,
        upsertProvider,
        type ProviderEntry,
        type ProviderList,
        type ProviderSummary,
        type ProviderTestResult,
        type RefreshResult,
} from "./providers.ts";

// ---------------------------------------------------------------------------
// Context + deps (structural, fake-friendly)
// ---------------------------------------------------------------------------

/** The dialog subset of pi's ExtensionUIContext the command needs. */
export interface ProvidersCommandUI {
        select(title: string, options: string[], opts?: unknown): Promise<string | undefined>;
        confirm(title: string, message: string, opts?: unknown): Promise<boolean>;
        input(title: string, placeholder?: string, opts?: unknown): Promise<string | undefined>;
        notify(message: string, type?: "info" | "warning" | "error"): void;
}

/**
 * Minimal structural command context. The real ExtensionCommandContext
 * satisfies it as-is; tests build one from scripted select/input/confirm
 * queues. `modelRegistry.refresh()` (re-read models.json) is optional because
 * minimal hosts may not expose it.
 */
export interface ProvidersCommandCtx {
        mode?: string;
        hasUI: boolean;
        ui: ProvidersCommandUI;
        modelRegistry?: { refresh(): Promise<unknown> };
}

/** Injectable seams: the registry root + the two network-reaching calls. */
export interface ProvidersCommandDeps {
        /** Registry root (models.json / auth.json / settings.json). */
        agentDir: string;
        /** Live endpoint probe with the stored credential. */
        testProvider: (agentDir: string, providerId: string, timeoutMs?: number) => Promise<ProviderTestResult>;
        /** Live `GET /models` discovery import. */
        refreshProviderModels: (agentDir: string, providerId: string, timeoutMs?: number) => Promise<RefreshResult>;
}

/**
 * Production deps. The agent dir resolves at CALL time via term.ts's
 * resolveUnownHome (same rule as UNOWN_AGENT_DIR — `||` not `??`, so an empty
 * UNOWN_HOME means the real home), which keeps UNOWN_HOME redirects working
 * for tests and harnesses that flip it per-run.
 */
export function defaultProvidersDeps(): ProvidersCommandDeps {
        return {
                agentDir: join(resolveUnownHome(), "agent"),
                testProvider,
                refreshProviderModels,
        };
}

// ---------------------------------------------------------------------------
// Entry point: argument grammar
// ---------------------------------------------------------------------------

/**
 * `/providers` dispatch:
 *
 *   /providers                interactive manager (TUI/RPC) · text summary otherwise
 *   /providers list           the text summary, always
 *   /providers test <id>      live endpoint probe with the stored key
 *   /providers refresh <id>   import the endpoint's live model catalog
 */
export async function runProvidersCommand(
        args: string,
        ctx: ProvidersCommandCtx,
        deps: ProvidersCommandDeps = defaultProvidersDeps(),
): Promise<void> {
        const tokens = (args ?? "").trim().split(/\s+/).filter((t) => t.length > 0);
        const sub = tokens[0] ?? "";
        switch (sub) {
                case "":
                        if (ctx.hasUI) return interactiveProviders(ctx, deps);
                        return notifySummary(ctx, deps);
                case "list":
                case "ls":
                        return notifySummary(ctx, deps);
                case "test":
                        return runTestOneShot(ctx, deps, tokens[1]);
                case "refresh":
                case "sync":
                        return runRefreshOneShot(ctx, deps, tokens[1]);
                default:
                        ctx.ui.notify(
                                `Unknown /providers argument "${sub}".\nUsage: /providers [list | test <id> | refresh <id>] — bare /providers opens the manager`,
                                "error",
                        );
        }
}

// ---------------------------------------------------------------------------
// Text summary (the list render — pure)
// ---------------------------------------------------------------------------

/**
 * The text summary lines: per provider `✓ <id> — <name>` (+ `(default)`),
 * indented base URL, key status + api, model count, and the default provider's
 * canonical `<provider>/<model>` line. Footer hints point at the interactive
 * manager (when dialogs exist) and the CLI twin.
 */
export function providerListLines(list: ProviderList, opts: { hasUI?: boolean } = {}): string[] {
        if (list.error) {
                return [
                        `models.json is invalid: ${list.error}`,
                        "  repair by hand, or reset with: unown setup --provider <p> --force",
                        "  unown doctor            # diagnostics",
                ];
        }
        if (list.providers.length === 0) {
                return [
                        "No providers configured yet — add one:",
                        "  /providers               # the interactive manager (needs the TUI)",
                        "  unown setup              # the guided alternative",
                ];
        }
        const lines: string[] = ["Providers (~/.unown/agent/models.json):"];
        for (const p of list.providers) {
                const marker = p.isDefault ? " (default)" : "";
                lines.push(`  ✓ ${p.id} — ${p.name ?? p.id}${marker}`);
                if (p.baseUrl) lines.push(`      ${p.baseUrl}`);
                lines.push(`      ${keyStatusLabel(p)}${p.api ? ` · ${p.api}` : ""}`);
                lines.push(`      ${p.modelIds.length} model${p.modelIds.length === 1 ? "" : "s"}`);
                if (p.isDefault && list.defaultModel) lines.push(`      default model: ${p.id}/${list.defaultModel}`);
        }
        lines.push("");
        lines.push(
                opts.hasUI === false
                        ? "unown providers --help for the CLI twin · switch mid-session with /model"
                        : "/providers to manage interactively · unown providers --help for the CLI twin",
        );
        return lines;
}

function notifySummary(ctx: ProvidersCommandCtx, deps: ProvidersCommandDeps): void {
        const list = listProviders(deps.agentDir);
        const level = list.error ? "error" : "info";
        ctx.ui.notify(providerListLines(list, { hasUI: ctx.hasUI }).join("\n"), level);
}

// ---------------------------------------------------------------------------
// One-shots: /providers test <id> · /providers refresh <id>
// ---------------------------------------------------------------------------

async function runTestOneShot(ctx: ProvidersCommandCtx, deps: ProvidersCommandDeps, id?: string): Promise<void> {
        if (!id) {
                ctx.ui.notify(`/providers test <id> — which provider? (configured: ${configuredIds(deps) || "(none)"})`, "warning");
                return;
        }
        const list = listProviders(deps.agentDir);
        const p = list.providers.find((x) => x.id === id);
        if (!p) {
                ctx.ui.notify(`unknown provider "${id}" — configured: ${configuredIds(deps) || "(none)"}`, "error");
                return;
        }
        const result = await deps.testProvider(deps.agentDir, id, 8000);
        ctx.ui.notify(renderTestVerdict(id, p, result), result.probe?.ok ? "info" : "error");
}

async function runRefreshOneShot(ctx: ProvidersCommandCtx, deps: ProvidersCommandDeps, id?: string): Promise<void> {
        if (!id) {
                ctx.ui.notify(`/providers refresh <id> — which provider? (configured: ${configuredIds(deps) || "(none)"})`, "warning");
                return;
        }
        const list = listProviders(deps.agentDir);
        if (!list.providers.some((x) => x.id === id)) {
                ctx.ui.notify(`unknown provider "${id}" — configured: ${configuredIds(deps) || "(none)"}`, "error");
                return;
        }
        const result = await deps.refreshProviderModels(deps.agentDir, id);
        if (!result.found) {
                ctx.ui.notify(`unknown provider "${id}"`, "error");
                return;
        }
        await refreshRegistry(ctx);
        ctx.ui.notify(...renderRefreshVerdict(id, result));
}

// ---------------------------------------------------------------------------
// Verdict rendering (the CLI's classification vocabulary, one voice)
// ---------------------------------------------------------------------------

/** `auth-json` | `models-json` | `env-ref ($VAR)` | `none` — the CLI's label. */
function keySourceLabel(source: ProviderTestResult["keySource"], keyEnv?: string): string {
        if (source === "env-ref") return keyEnv ? `$${keyEnv}` : "env-ref";
        return source ?? "none";
}

/** The test-connection verdict (mirrors providers-cli.ts cmdProvidersTest). */
export function renderTestVerdict(id: string, p: ProviderSummary, result: ProviderTestResult): string {
        if (!result.found) return `unknown provider "${id}" — configured: (see /providers list)`;
        if (!p.baseUrl) return `✗ ${id} declares no baseUrl — fix ~/.unown/agent/models.json`;
        const probe = result.probe;
        if (probe?.ok) {
                const lines = [`✓ ${id} reachable at ${p.baseUrl} — credential: ${keySourceLabel(result.keySource, result.keyEnv)}`];
                if (probe.models && probe.models.length > 0) {
                        lines.push(`  serves ${probe.models.length} models: ${probe.models.slice(0, 8).join(", ")}${probe.models.length > 8 ? " …" : ""}`);
                        const missing = p.modelIds.filter((m) => !probe.models!.includes(m));
                        if (missing.length > 0) lines.push(`  ⚠ registered but not served: ${missing.join(", ")}`);
                }
                return lines.join("\n");
        }
        if (probe?.problem === "auth") {
                return `✗ ${id} rejected the credential (HTTP ${probe.status}) — set a new key: /providers → ${id} → Set API key (or: unown providers key ${id})`;
        }
        return `✗ ${id} unreachable at ${p.baseUrl} — start the endpoint or fix the URL:\n  unown providers add --provider ${id} --base-url <url> …  # re-point`;
}

/** The refresh verdict; returns [text, level] (mirrors cmdProvidersRefresh). */
export function renderRefreshVerdict(id: string, result: RefreshResult): [string, "info" | "warning"] {
        if (result.problem) {
                const hint = result.probe?.problem === "auth" ? `\n  rotate the key: /providers → ${id} → Set API key (or: unown providers key ${id})` : "";
                return [`· ${id}: ${result.problem}${hint}`, "warning"];
        }
        if (result.added.length === 0 && result.missing.length === 0) {
                return [`✓ ${id} is in sync — ${result.served?.length ?? 0} chat models served, all registered`, "info"];
        }
        const lines: string[] = [];
        if (result.added.length > 0) {
                lines.push(`✓ imported ${result.added.length} new model${result.added.length === 1 ? "" : "s"} from ${id}: ${result.added.slice(0, 8).join(", ")}${result.added.length > 8 ? " …" : ""}`);
                lines.push(`  switch to one with: /providers → ${id} → Make default…  (or /model mid-session)`);
        }
        if (result.missing.length > 0) {
                lines.push(`  ⚠ registered but no longer served (kept — prune by hand if intended): ${result.missing.join(", ")}`);
        }
        return [lines.join("\n"), "info"];
}

function configuredIds(deps: ProvidersCommandDeps): string {
        return listProviders(deps.agentDir)
                .providers.map((p) => p.id)
                .join(", ");
}

/** Best-effort models.json re-read so /model + the footer see mutations. */
async function refreshRegistry(ctx: ProvidersCommandCtx): Promise<void> {
        try {
                await ctx.modelRegistry?.refresh?.();
        } catch {
                /* best effort — the next boot re-reads models.json regardless */
        }
}

// ---------------------------------------------------------------------------
// The interactive manager (TUI; RPC degrades to sequential prompts)
// ---------------------------------------------------------------------------

const ADD_ENTRY = "+ Add provider…";
const DONE_ENTRY = "Done";
const BACK_ENTRY = "Back";
const PROVIDER_ACTIONS = [
        "Make default…",
        "Set API key",
        "Test connection",
        "Refresh models",
        "Remove provider…",
        "Back",
] as const;

/** One select row: `✓ agnes — Agnes AI (default) · key: auth.json · 6 models`. */
function providerEntryLabel(p: ProviderSummary): string {
        const key = keyStatusLabel(p).replace(/^key: /, "");
        const def = p.isDefault ? " (default)" : "";
        return `✓ ${p.id} — ${p.name ?? p.id}${def} · key: ${key} · ${p.modelIds.length} model${p.modelIds.length === 1 ? "" : "s"}`;
}

async function interactiveProviders(ctx: ProvidersCommandCtx, deps: ProvidersCommandDeps): Promise<void> {
        for (;;) {
                const list = listProviders(deps.agentDir);
                if (list.error) {
                        ctx.ui.notify(providerListLines(list).join("\n"), "error");
                        return;
                }
                const labels = list.providers.map(providerEntryLabel);
                const byLabel = new Map<string, string>();
                list.providers.forEach((p, i) => byLabel.set(labels[i], p.id));
                const choice = await ctx.ui.select("Providers", [...labels, ADD_ENTRY, DONE_ENTRY]);
                if (!choice || choice === DONE_ENTRY) return;
                if (choice === ADD_ENTRY) {
                        await addProviderFlow(ctx, deps);
                        continue;
                }
                const id = byLabel.get(choice);
                if (id) await providerActionMenu(ctx, deps, id);
        }
}

async function providerActionMenu(ctx: ProvidersCommandCtx, deps: ProvidersCommandDeps, id: string): Promise<void> {
        const action = await ctx.ui.select(id, [...PROVIDER_ACTIONS]);
        if (!action || action === BACK_ENTRY) return;
        switch (action) {
                case "Make default…":
                        return makeDefaultFlow(ctx, deps, id);
                case "Set API key":
                        return setKeyFlow(ctx, deps, id);
                case "Test connection":
                        return testConnectionFlow(ctx, deps, id);
                case "Refresh models":
                        return refreshModelsFlow(ctx, deps, id);
                case "Remove provider…":
                        return removeFlow(ctx, deps, id);
        }
}

/** Make default… → pick one of the provider's registered models → settings.json. */
async function makeDefaultFlow(ctx: ProvidersCommandCtx, deps: ProvidersCommandDeps, id: string): Promise<void> {
        const list = listProviders(deps.agentDir);
        const p = list.providers.find((x) => x.id === id);
        if (!p) {
                ctx.ui.notify(`unknown provider "${id}"`, "error");
                return;
        }
        if (p.modelIds.length === 0) {
                ctx.ui.notify(`${id} has no models registered — Refresh models first (or add one: unown providers add)`, "warning");
                return;
        }
        const chosen = await ctx.ui.select(`Default model for ${id}`, [...p.modelIds, BACK_ENTRY]);
        if (!chosen || chosen === BACK_ENTRY) return;
        const result = setDefaultModel(deps.agentDir, id, chosen);
        if (!result.ok) {
                ctx.ui.notify(result.error ?? "failed to set the default", "error");
                return;
        }
        await refreshRegistry(ctx);
        ctx.ui.notify(`✓ default set to ${id}/${chosen} — use /model to switch this session`, "info");
}

/** Set API key → auth.json (0600) → immediate live verify (rotation's point). */
async function setKeyFlow(ctx: ProvidersCommandCtx, deps: ProvidersCommandDeps, id: string): Promise<void> {
        const key = await ctx.ui.input(
                `API key for ${id}`,
                "(paste key — or blank to keep the current one; $ENV refs via unown providers key --key-env)",
        );
        if (key === undefined || key.trim() === "") return;
        if (!setProviderKey(deps.agentDir, id, key.trim())) {
                ctx.ui.notify(`unknown provider "${id}"`, "error");
                return;
        }
        const test = await deps.testProvider(deps.agentDir, id);
        if (test.probe?.ok) {
                ctx.ui.notify(`✓ key stored for ${id} — endpoint accepts it (credential: ${keySourceLabel(test.keySource, test.keyEnv)})`, "info");
        } else if (test.probe?.problem === "auth") {
                ctx.ui.notify(`✓ stored the key for ${id}, but the endpoint rejected it (HTTP ${test.probe.status}) — check the key and retry`, "warning");
        } else {
                ctx.ui.notify(`✓ stored the key for ${id} (endpoint unreachable right now — verify later: /providers test ${id})`, "warning");
        }
}

/** Test connection → the actionable verdict (401 → key, unreachable → URL). */
async function testConnectionFlow(ctx: ProvidersCommandCtx, deps: ProvidersCommandDeps, id: string): Promise<void> {
        const list = listProviders(deps.agentDir);
        const p = list.providers.find((x) => x.id === id);
        if (!p) {
                ctx.ui.notify(`unknown provider "${id}"`, "error");
                return;
        }
        const result = await deps.testProvider(deps.agentDir, id, 8000);
        ctx.ui.notify(renderTestVerdict(id, p, result), result.probe?.ok ? "info" : "error");
}

/** Refresh models → live GET /models import (+N added, M no longer served). */
async function refreshModelsFlow(ctx: ProvidersCommandCtx, deps: ProvidersCommandDeps, id: string): Promise<void> {
        const result = await deps.refreshProviderModels(deps.agentDir, id);
        if (!result.found) {
                ctx.ui.notify(`unknown provider "${id}"`, "error");
                return;
        }
        await refreshRegistry(ctx);
        ctx.ui.notify(...renderRefreshVerdict(id, result));
}

/** Remove provider… → confirm → removeProvider (+ default fallback report). */
async function removeFlow(ctx: ProvidersCommandCtx, deps: ProvidersCommandDeps, id: string): Promise<void> {
        const sure = await ctx.ui.confirm(`Remove ${id}?`, "Models and the stored key entry are removed; other providers are untouched.");
        if (!sure) return;
        const result = removeProvider(deps.agentDir, id);
        if (!result.removed) {
                ctx.ui.notify(`unknown provider "${id}" — configured: ${configuredIds(deps) || "(none)"}`, "error");
                return;
        }
        await refreshRegistry(ctx);
        const lines = [`✓ removed ${id} (its stored key went with it)`];
        if (result.wasDefault) {
                if (result.remaining > 0) {
                        const list = listProviders(deps.agentDir);
                        lines.push(`  default fell back to ${list.defaultProvider}/${list.defaultModel}`);
                } else {
                        lines.push("  no providers left — add one before your next session: /providers → + Add provider…");
                }
        }
        ctx.ui.notify(lines.join("\n"), "info");
}

// ---------------------------------------------------------------------------
// Add provider (preset + custom) — the CLI add flow, dialog-driven
// ---------------------------------------------------------------------------

async function addProviderFlow(ctx: ProvidersCommandCtx, deps: ProvidersCommandDeps): Promise<void> {
        const labels = PRESETS.map((p) => p.label);
        const chosen = await ctx.ui.select("Add provider", [...labels, BACK_ENTRY]);
        if (!chosen || chosen === BACK_ENTRY) return;
        const preset = PRESETS.find((p) => p.label === chosen);
        if (!preset) return;
        if (preset.id === "custom") return addCustomProvider(ctx, deps, preset);
        return addPresetProvider(ctx, deps, preset);
}

/**
 * Preset add: optional key → upsert (first provider in an empty registry
 * becomes the default, mirroring the CLI) → live discovery (the CLI's
 * `--all-models` lane) → default-model pick when the endpoint answered.
 */
async function addPresetProvider(ctx: ProvidersCommandCtx, deps: ProvidersCommandDeps, preset: ProviderPreset): Promise<void> {
        const id = preset.id === "bridge" ? process.env.PI_PROVIDER || "zai-bridge" : preset.id;
        let entry: ProviderEntry;
        if (preset.id === "bridge") {
                // The bundled bridge keeps the CLI's special rules: registry id
                // PI_PROVIDER || zai-bridge (so `unown setup --provider bridge`
                // updates the SAME entry), the shared placeholder key the bridge
                // itself checks, and every served id registered for /model routing.
                // No key prompt — the upstream secret lives in the repo's .env.
                entry = {
                        id,
                        name: preset.label.split(" (")[0],
                        baseUrl: preset.baseUrl,
                        api: preset.api,
                        modelId: preset.defaultModel,
                        input: preset.input,
                        apiKeyInModelsJson: process.env.BRIDGE_API_KEY || "bridge-local",
                        extraModelIds: bridgeKnownModels(preset.defaultModel).filter((m) => m !== preset.defaultModel),
                };
        } else {
                const key = await ctx.ui.input(`API key for ${preset.id}`, "(optional now — you can set it later; blank for local servers)");
                entry = {
                        id,
                        name: preset.label.split(" (")[0],
                        baseUrl: preset.baseUrl,
                        api: preset.api,
                        modelId: preset.defaultModel,
                        input: preset.input,
                        ...(key && key.trim() ? { apiKeyInAuthJson: key.trim() } : {}),
                };
        }

        const before = listProviders(deps.agentDir);
        const willDefault = before.providers.length === 0;
        upsertProvider(deps.agentDir, entry, { setDefault: willDefault });

        // Discovery: import every chat model the endpoint serves (the CLI's
        // --all-models experience), then offer the default pick from what it
        // actually answered — the endpoint knows its catalog better than a preset.
        // Picking a model in THAT dialog is an explicit default-setting act (the
        // title says so); backing out leaves the session default untouched.
        const refresh = await deps.refreshProviderModels(deps.agentDir, id);
        let defaultModel = entry.modelId;
        let picked = false;
        if (!refresh.problem && refresh.served && refresh.served.length > 0) {
                const chosen = await ctx.ui.select(`Default model for ${id}`, [...refresh.served, BACK_ENTRY]);
                if (chosen && chosen !== BACK_ENTRY) {
                        const result = setDefaultModel(deps.agentDir, id, chosen);
                        if (result.ok) {
                                defaultModel = chosen;
                                picked = true;
                        }
                }
        }
        await refreshRegistry(ctx);

        const madeDefault = willDefault || picked;
        const after = listProviders(deps.agentDir);
        const count = after.providers.find((p) => p.id === id)?.modelIds.length ?? 1;
        if (refresh.problem) {
                ctx.ui.notify(
                        `added ${id} — ${entry.modelId} registered${madeDefault ? ` (default ${id}/${defaultModel})` : ""}, but model discovery failed: ${refresh.problem}\n` +
                                `  fix: /providers → ${id} → Set API key or Refresh models (or: unown providers test ${id})`,
                        "warning",
                );
                return;
        }
        ctx.ui.notify(
                `✓ added ${id} — ${count} model${count === 1 ? "" : "s"} imported${madeDefault ? `, default ${id}/${defaultModel}` : ""}\n` +
                        (madeDefault ? `  use /model to switch this session` : `  make it the default: /providers → ${id} → Make default…`) +
                        ` · registry: ${after.providers.map((p) => p.id).join(", ") || "(none)"}`,
                "info",
        );
}

/** Custom endpoint: id → base URL → model id → optional key (4 inputs max). */
async function addCustomProvider(ctx: ProvidersCommandCtx, deps: ProvidersCommandDeps, preset: ProviderPreset): Promise<void> {
        const idIn = await ctx.ui.input("Provider id (short registry name)", "custom-llm");
        const id = (idIn ?? "").trim() || "custom-llm";
        if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
                ctx.ui.notify(`bad registry id "${id}" — lowercase letters, digits, dashes`, "error");
                return;
        }
        const urlIn = await ctx.ui.input("Endpoint base URL (OpenAI-compatible, usually ends in /v1)", preset.baseUrl);
        const baseUrl = (urlIn ?? "").trim() || preset.baseUrl;
        const modelIn = await ctx.ui.input("Model id", "");
        const modelId = (modelIn ?? "").trim();
        if (!modelId) {
                ctx.ui.notify("no model id given — nothing added", "warning");
                return;
        }
        const keyIn = await ctx.ui.input("API key (optional — blank for local servers)", "");
        const key = (keyIn ?? "").trim();

        const before = listProviders(deps.agentDir);
        const willDefault = before.providers.length === 0;
        upsertProvider(
                deps.agentDir,
                {
                        id,
                        name: id,
                        baseUrl,
                        api: "openai-completions",
                        modelId,
                        input: ["text"],
                        ...(key ? { apiKeyInAuthJson: key } : {}),
                },
                { setDefault: willDefault },
        );
        await refreshRegistry(ctx);
        ctx.ui.notify(
                `✓ added ${id} → ${baseUrl} (model ${modelId}${willDefault ? `, default ${id}/${modelId}` : ""})${key ? "" : " — keyless (fine for local servers)"}\n` +
                        `  use /model to switch this session`,
                "info",
        );
}

// ---------------------------------------------------------------------------
// Argument completions (registered on the command)
// ---------------------------------------------------------------------------

/**
 * Complete `list` / `test` / `refresh` after `/providers `, and configured
 * provider ids after `test ` / `refresh ` (the registry, read live). The TUI
 * passes the raw text after the command name — a trailing space means the
 * subcommand word is done and the id word has started.
 */
export function providersArgumentCompletions(prefix: string): Array<{ value: string; label: string }> | null {
        const trimmed = (prefix ?? "").trimStart();
        const spaceIdx = trimmed.search(/\s/);
        if (spaceIdx === -1) {
                const subs = ["list", "test", "refresh"].filter((s) => s.startsWith(trimmed));
                return subs.length > 0 ? subs.map((s) => ({ value: s, label: s })) : null;
        }
        const sub = trimmed.slice(0, spaceIdx);
        if (sub !== "test" && sub !== "refresh") return null;
        const idPrefix = trimmed.slice(spaceIdx).trim();
        const ids = listProviders(join(resolveUnownHome(), "agent"))
                .providers.map((p) => p.id)
                .filter((id) => id.startsWith(idPrefix));
        return ids.length > 0 ? ids.map((id) => ({ value: id, label: id })) : null;
}
