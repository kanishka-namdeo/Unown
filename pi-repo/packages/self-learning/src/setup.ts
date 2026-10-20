/**
 * setup.ts — `unown setup` (provider connection wizard) + `unown models`.
 *
 * Makes the terminal agent usable out of the box with any provider:
 *
 *   unown setup                      interactive wizard (bundled bridge,
 *                                    OpenAI, OpenRouter, Anthropic, Dashscope,
 *                                    DeepSeek, or any custom endpoint)
 *   unown setup --provider openai \
 *     --api-key sk-... --model gpt-4o       non-interactive (scripts/CI)
 *   unown setup --list              print the provider presets
 *   unown models                    show configured models (+ live bridge list)
 *
 * Writes three files under ~/.unown/agent/ (UNOWN_HOME honors the env var):
 *   models.json   — provider + model registry pi loads
 *   auth.json     — API keys, mode 0600 (bridge mode keeps its placeholder key
 *                   inside models.json instead, matching the bridge contract)
 *   settings.json — defaultProvider + defaultModel so sessions start on the
 *                   chosen model without any picker
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as readline from "node:readline/promises";
import { probeOpenAiEndpoint, readAgentModelsFile, resolveActiveProvider } from "./probe.ts";
import { keyStatusLabel, listProviders, upsertProvider, type ProviderEntry } from "./providers.ts";
import { bridgeKnownModels, UNOWN_AGENT_DIR } from "./term.ts";

// ---------------------------------------------------------------------------
// Provider presets
// ---------------------------------------------------------------------------
export interface ProviderPreset {
        /** Provider id written to models.json (also the --provider flag value). */
        id: string;
        label: string;
        baseUrl: string;
        api: "openai-completions" | "anthropic-messages";
        defaultModel: string;
        input: string[];
        keyEnvHint: string;
        note?: string;
}

export const PRESETS: ProviderPreset[] = [
        {
                id: "bridge",
                label: "The bundled llm-bridge (this repo's stack — Dashscope coding plan)",
                baseUrl: `${(process.env.PI_BRIDGE_URL || "http://127.0.0.1:3031").replace(/\/+$/, "")}/v1`,
                api: "openai-completions",
                defaultModel: process.env.PI_MODEL_ID || "kimi-k2.5",
                input: ["text", "image"],
                keyEnvHint: "BRIDGE_UPSTREAM_KEY (in the repo's .env — nothing stored locally)",
                note: "model routing, thinking translation and SSE passthrough handled by the bridge",
        },
        {
                id: "openai",
                label: "OpenAI",
                baseUrl: "https://api.openai.com/v1",
                api: "openai-completions",
                defaultModel: "gpt-4o",
                input: ["text", "image"],
                keyEnvHint: "OPENAI_API_KEY",
        },
        {
                id: "openrouter",
                label: "OpenRouter (one key, every model)",
                baseUrl: "https://openrouter.ai/api/v1",
                api: "openai-completions",
                defaultModel: "openrouter/auto",
                input: ["text", "image"],
                keyEnvHint: "OPENROUTER_API_KEY",
        },
        {
                id: "anthropic",
                label: "Anthropic (Claude)",
                baseUrl: "https://api.anthropic.com",
                api: "anthropic-messages",
                defaultModel: "claude-sonnet-4-5",
                input: ["text", "image"],
                keyEnvHint: "ANTHROPIC_API_KEY",
        },
        {
                id: "dashscope",
                label: "Dashscope (Alibaba Cloud — Qwen/Kimi)",
                baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                api: "openai-completions",
                defaultModel: "qwen-plus",
                input: ["text", "image"],
                keyEnvHint: "DASHSCOPE_API_KEY",
        },
        {
                id: "deepseek",
                label: "DeepSeek",
                baseUrl: "https://api.deepseek.com/v1",
                api: "openai-completions",
                defaultModel: "deepseek-chat",
                input: ["text"],
                keyEnvHint: "DEEPSEEK_API_KEY",
        },
        {
                id: "agnes",
                label: "Agnes AI (OpenAI-compatible, image-capable)",
                baseUrl: "https://apihub.agnes-ai.com/v1",
                api: "openai-completions",
                defaultModel: "agnes-3.0-flash",
                input: ["text", "image"],
                keyEnvHint: "AGNES_API_KEY",
                note: "flash models also take image input (VLM)",
        },
        {
                id: "custom",
                label: "Any other OpenAI-compatible endpoint (vLLM, llama.cpp, Ollama, …)",
                baseUrl: "http://127.0.0.1:11434/v1",
                api: "openai-completions",
                defaultModel: "",
                input: ["text"],
                keyEnvHint: "your endpoint's key (blank for local servers)",
        },
];

// ---------------------------------------------------------------------------
// Config writing
// ---------------------------------------------------------------------------
interface WriteConfigInput {
        providerId: string;
        providerName: string;
        baseUrl: string;
        api: "openai-completions" | "anthropic-messages";
        modelId: string;
        input: string[];
        /** Key stored inside models.json (bridge placeholder / shared secret). */
        apiKeyInModelsJson?: string;
        /** Key stored in auth.json (0600) — preferred for real secrets. */
        apiKeyInAuthJson?: string;
        /** `$ENV_VAR` reference stored in models.json instead of a secret. */
        apiKeyEnvRef?: string;
        /** Additional served model ids to register after modelId (the bridge
         *  preset passes its full allow-list so /model + --model can route
         *  between the served catalog without a manual models.json edit). */
        extraModelIds?: string[];
}

function mergeJson(path: string, patch: Record<string, unknown>): void {
        let current: Record<string, unknown> = {};
        if (existsSync(path)) {
                try {
                        current = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
                } catch {
                        current = {};
                }
        }
        writeFileSync(path, `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`, "utf8");
}

/**
 * Write a provider configuration (M1: MERGE semantics — accumulate, never
 * rewrite). Delegates to providers.ts's upsertProvider so `unown setup`,
 * `unown providers add` and the engine provider API share ONE mutation path.
 *
 *   default: the provider is added/updated IN PLACE; sibling providers in
 *            models.json are untouched, and this provider becomes the default
 *            (setup is a "make this my setup" action).
 *   reset:   models.json is rewritten with EXACTLY this provider — the
 *            pre-multi-provider `setup --force` escape hatch.
 *
 * auth.json keeps its merge + 0600/ACL behaviour (via upsertProvider's
 * secureFilePermissions, which also hardens ACLs on Windows now).
 */
export function writeAgentConfig(input: WriteConfigInput & { reset?: boolean }): void {
        const entry: ProviderEntry = {
                id: input.providerId,
                name: input.providerName,
                baseUrl: input.baseUrl,
                api: input.api,
                modelId: input.modelId,
                input: input.input,
                extraModelIds: input.extraModelIds,
                ...(input.apiKeyInModelsJson ? { apiKeyInModelsJson: input.apiKeyInModelsJson } : {}),
                ...(input.apiKeyInAuthJson ? { apiKeyInAuthJson: input.apiKeyInAuthJson } : {}),
                ...(input.apiKeyEnvRef ? { apiKeyEnvRef: input.apiKeyEnvRef } : {}),
        };
        upsertProvider(UNOWN_AGENT_DIR, entry, { setDefault: true, reset: input.reset === true });
}

// ---------------------------------------------------------------------------
// unown models
// ---------------------------------------------------------------------------
export async function printModelsOverview(): Promise<void> {
        const file = readAgentModelsFile(UNOWN_AGENT_DIR);
        if (file.error) {
                console.log(`✗ ~/.unown/agent/models.json is invalid: ${file.error}`);
                console.log("  fix it by re-running: unown setup");
                return;
        }
        if (file.providers.length === 0) {
                console.log("No provider configured yet — run: unown setup");
                return;
        }
        const active = resolveActiveProvider(UNOWN_AGENT_DIR);
        const list = listProviders(UNOWN_AGENT_DIR);
        console.log(`Configured providers (~/.unown/agent/models.json):`);
        for (const p of file.providers) {
                const marker = active && p.id === active.id ? "  ← default" : "";
                const summary = list.providers.find((x) => x.id === p.id);
                const keyNote = summary ? `  [${keyStatusLabel(summary)}]` : "";
                console.log(`  ${p.id}${p.baseUrl ? `  ${p.baseUrl}` : ""}${keyNote}${marker}`);
                for (const m of p.modelIds) console.log(`      · ${m}`);
        }
        // Live list when the default provider is a local bridge.
        if (active?.baseUrl) {
                const probe = await probeOpenAiEndpoint(active.baseUrl, active.apiKey ?? undefined, 3000);
                const served = probe.ok ? probe.models : undefined;
                if (served && served.length > 0) {
                        console.log(`\nServed right now by ${active.baseUrl}:`);
                        for (const m of served) console.log(`      · ${m}`);
                        const model = active.modelIds[0];
                        if (model && !served.includes(model)) {
                                console.log(`\n⚠ default model "${model}" is not in the served list — requests will still work,`);
                                console.log("  but check the allow-list (BRIDGE_KNOWN_MODELS) or pick another: unown setup");
                        }
                }
        }
        console.log(`\nSwitch models mid-session with /model (or Ctrl+L). Reconfigure with: unown setup`);
}

// ---------------------------------------------------------------------------
// unown setup
// ---------------------------------------------------------------------------
interface SetupFlags {
        provider?: string;
        apiKey?: string;
        model?: string;
        baseUrl?: string;
        keyEnv?: string;
        force: boolean;
        list: boolean;
}

export const SETUP_USAGE = `unown setup — connect a model provider

usage: unown setup [--provider P] [--api-key K] [--model M] [--base-url U] [--key-env VAR] [--force|-f] [--list]
  --provider P   bridge | openai | openrouter | anthropic | dashscope | deepseek | agnes | custom
  --api-key K    the provider key (stored under ~/.unown/agent, never in the repo)
  --model M      the model id to use
  --base-url U   endpoint override (any OpenAI-compatible server)
  --key-env VAR  reference $VAR from the environment instead of storing the key
  --force, -f    RESET: rewrite models.json with exactly this provider (drops others)
  --list         show the provider presets and exit

With no flags: the interactive wizard.

Adding a provider KEEPS existing ones (multi-provider registry; see
  unown providers list / unown providers add). --force restores the old
  single-provider rewrite behaviour.
`;

/** clig.dev: unknown flags ERROR (they used to be silently dropped and the
 * wizard launched anyway — `setup --help` opened the wizard, typos were
 * invisible); -h/--help prints the usage instead of running anything. */
function parseSetupFlags(args: string[]): { flags: SetupFlags; help: boolean; unknown: string[] } {

        const flags: SetupFlags = { force: false, list: false };
        const unknown: string[] = [];
        let help = false;
        for (let i = 0; i < args.length; i++) {
                const a = args[i];
                const next = args[i + 1];
                if (a === "--force" || a === "-f") flags.force = true;
                else if (a === "--list") flags.list = true;
                else if (a === "-h" || a === "--help") help = true;
                else if (a === "--provider" && next) {
                        flags.provider = next;
                        i++;
                } else if (a === "--api-key" && next) {
                        flags.apiKey = next;
                        i++;
                } else if (a === "--model" && next) {
                        flags.model = next;
                        i++;
                } else if (a === "--base-url" && next) {
                        flags.baseUrl = next;
                        i++;
                } else if (a === "--key-env" && next) {
                        flags.keyEnv = next;
                        i++;
                } else unknown.push(a);
        }
        return { flags, help, unknown };
}

async function ask(rl: readline.Interface, question: string, fallback?: string): Promise<string> {
        const suffix = fallback !== undefined ? ` [${fallback || "none"}]: ` : ": ";
        const answer = ((await rl.question(question + suffix)) as string).trim();
        return answer || (fallback ?? "");
}

function printPresetTable(): void {
        console.log("Provider presets (unown setup --provider <id>):");
        for (const p of PRESETS) {
                console.log(`  ${p.id.padEnd(12)} ${p.label}`);
                console.log(
                        `  ${" ".repeat(12)} endpoint ${p.baseUrl}${p.defaultModel ? ` · default model ${p.defaultModel}` : ""}`,
                );
        }
}

/** Bridge health snippet for the wizard (best effort, 3s). */
async function bridgeHealthSnippet(): Promise<string | null> {
        try {
                const res = await fetch(`${(process.env.PI_BRIDGE_URL || "http://127.0.0.1:3031").replace(/\/+$/, "")}/health`, {
                        signal: AbortSignal.timeout(3000),
                });
                if (!res.ok) return null;
                const body = (await res.json()) as {
                        upstream?: { ok?: boolean; status?: number };
                        upstreamKeyIsSet?: boolean;
                        defaultModel?: string;
                        models?: string[];
                };
                const key = body.upstreamKeyIsSet ? "key set" : "NO upstream key";
                const up = body.upstream?.ok
                        ? "upstream healthy"
                        : `upstream unhealthy (${body.upstream?.status ?? "no answer"})`;
                const models = (body.models ?? []).join(", ");
                return `${up} · ${key} · serves: ${models || "nothing"} (default ${body.defaultModel ?? "?"})`;
        } catch {
                return null;
        }
}

async function runBridgeSetup(
        flags: Partial<SetupFlags>,
        preset: ProviderPreset,
        rl: readline.Interface | null,
): Promise<number> {
        const health = await bridgeHealthSnippet();
        console.log(`\nBundled llm-bridge: ${preset.baseUrl}`);
        console.log(
                health ? `  status: ${health}` : "  status: not reachable right now (start the stack later: bun run agent:start)",
        );
        if (health && !health.includes("key set")) {
                console.log("  ⚠ BRIDGE_UPSTREAM_KEY is not set in the repo's .env — chats will fail with 401 until you add it.");
        }
        let modelId = flags.model ?? preset.defaultModel;
        if (rl && !flags.model) {
                modelId = await ask(rl, "Model to use", preset.defaultModel);
        }
        if (!modelId) {
                console.error("unown setup: no model given (use --model)");
                return 1;
        }
        // `||` not `??`: BRIDGE_API_KEY ships EMPTY in .env.example (bun auto-loads
        // .env), and the empty string used to leak past the fallback — models.json
        // was written WITHOUT the placeholder key and every session failed auth
        // ("No API key found"). Same class as resolveUnownHome in term.ts.
        const apiKey = process.env.BRIDGE_API_KEY || "bridge-local";
        writeAgentConfig({
                providerId: process.env.PI_PROVIDER || "zai-bridge",
                providerName: "unown llm-bridge",
                baseUrl: preset.baseUrl,
                api: preset.api,
                modelId,
                input: preset.input,
                apiKeyInModelsJson: apiKey,
                // Register every id the bridge serves (its allow-list) so the
                // catalog is routable (/model, --model, agent frontmatter).
                extraModelIds: bridgeKnownModels(modelId).slice(1),
                // --force RESETS (drops the other providers — the single-provider
                // escape hatch); without it the bridge merges in alongside them.
                ...(flags.force ? { reset: true } : {}),
        });
        console.log(`\n✓ configured the bundled bridge (${modelId})`);
        console.log("  next: unown            # start a session");
        console.log("        unown doctor     # verify the whole path");
        return 0;
}

async function runDirectSetup(
        flags: Partial<SetupFlags>,
        preset: ProviderPreset,
        rl: readline.Interface | null,
): Promise<number> {
        let baseUrl = flags.baseUrl ?? preset.baseUrl;
        let modelId = flags.model ?? preset.defaultModel;
        let apiKey = flags.apiKey ?? "";
        let providerId = preset.id;
        if (rl) {
                console.log(`\n${preset.label}`);
                console.log(`  endpoint: ${baseUrl}`);
                if (preset.id === "custom") {
                        baseUrl = await ask(rl, "Endpoint base URL (OpenAI-compatible, usually ends in /v1)", preset.baseUrl);
                        providerId = (await ask(rl, "Provider id (short name used in config files)", "custom-llm")) || "custom-llm";
                        modelId = await ask(rl, "Model id");
                } else {
                        modelId = await ask(rl, "Model id", preset.defaultModel);
                }
                if (!flags.apiKey) {
                        console.log(`  (key hint: ${preset.keyEnvHint}; stored in ~/.unown/agent/auth.json with mode 0600)`);
                        apiKey = await ask(rl, "API key");
                }
        }
        if (!baseUrl) {
                console.error("unown setup: no base URL (use --base-url)");
                return 1;
        }
        if (!modelId) {
                console.error("unown setup: no model id (use --model)");
                return 1;
        }
        if (!apiKey && !flags.apiKey) {
                // Local servers (Ollama, llama.cpp, vLLM) may be keyless — allow it,
                // but say so.
                console.log("  · no API key given — continuing keyless (fine for local servers)");
        }
        writeAgentConfig({
                providerId,
                providerName: preset.id === "custom" ? providerId : preset.label.split(" (")[0],
                baseUrl,
                api: preset.api,
                modelId,
                input: preset.input,
                ...(apiKey ? { apiKeyInAuthJson: apiKey } : {}),
                ...(flags.keyEnv ? { apiKeyEnvRef: flags.keyEnv } : {}),
                ...(flags.force ? { reset: true } : {}),
        });
        // Verify reachability (best effort, non-fatal). With --key-env, probe
        // with the CURRENT env value so verification works without storing it.
        const probeKey = apiKey || (flags.keyEnv ? process.env[flags.keyEnv] : undefined);
        const probe = await probeOpenAiEndpoint(baseUrl, probeKey, 4000);
        if (probe.ok) {
                const list =
                        probe.models && probe.models.length > 0
                                ? ` — serves ${probe.models.slice(0, 6).join(", ")}${probe.models.length > 6 ? " …" : ""}`
                                : "";
                console.log(`\n✓ configured ${providerId} → ${baseUrl}`);
                console.log(`  endpoint reachable${list}`);
        } else if (probe.problem === "auth") {
                console.log(`\n✓ wrote the configuration, but the endpoint rejected the key (HTTP ${probe.status}).`);
                console.log("  double-check the API key, then re-run: unown setup");
                return 1;
        } else {
                console.log(`\n✓ wrote the configuration, but could not reach ${baseUrl}.`);
                console.log("  start the endpoint (or point --base-url elsewhere) and re-run: unown setup");
        }
        console.log("  next: unown            # start a session");
        console.log("        unown doctor     # verify the whole path");
        return 0;
}

async function runInteractiveSetup(): Promise<number> {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        try {
                const file = readAgentModelsFile(UNOWN_AGENT_DIR);
                if (file.providers.length > 0) {
                        const active = resolveActiveProvider(UNOWN_AGENT_DIR);
                        console.log(
                                `Current configuration: ${active?.id ?? file.providers[0]?.id} → ${active?.baseUrl ?? "?"} (${active?.modelIds.join(", ") ?? "?"})`,
                        );
                        console.log(`Files: ${join(UNOWN_AGENT_DIR, "models.json")}\n`);
                } else {
                        console.log("No provider configured yet.\n");
                }
                console.log("What should unown talk to?");
                PRESETS.forEach((p, i) => {
                        console.log(`  ${i + 1}) ${p.label}`);
                });
                console.log(`  ${PRESETS.length + 1}) Keep the current configuration`);
                const choice = await ask(rl, "Choose", "1");
                const idx = Number.parseInt(choice, 10);
                if (Number.isInteger(idx) && idx === PRESETS.length + 1) {
                        console.log("Keeping the current configuration — nothing written.");
                        return 0;
                }
                const preset = PRESETS[(idx || 1) - 1];
                if (!preset) {
                        console.error(`unown setup: invalid choice "${choice}"`);
                        return 1;
                }
                if (existsSync(join(UNOWN_AGENT_DIR, "models.json"))) {
                        const others = file.providers.map((p) => p.id).filter((id) => id !== "zai-bridge");
                        if (others.length > 0) {
                                console.log(`\nExisting providers are KEPT (added alongside): ${others.join(", ")}`);
                        }
                }
                return preset.id === "bridge" ? runBridgeSetup({}, preset, rl) : runDirectSetup({}, preset, rl);
        } finally {
                rl.close();
        }
}

/** Entry point for `unown setup [flags]`. Returns the process exit code. */
export async function runSetupCommand(args: string[]): Promise<number> {
        const { flags, help, unknown } = parseSetupFlags(args);
        if (help) {
                console.log(SETUP_USAGE);
                return 0;
        }
        if (unknown.length) {
                console.error(`unown setup: unknown argument(s): ${unknown.join(" ")}`);
                console.error(SETUP_USAGE);
                return 1;
        }
        if (flags.list) {
                printPresetTable();
                return 0;
        }
        if (!flags.provider) {
                if (!process.stdin.isTTY || !process.stdout.isTTY) {
                        console.error("unown setup: interactive wizard needs a TTY — use flags instead, e.g.");
                        console.error("  unown setup --provider openai --api-key sk-... --model gpt-4o");
                        console.error("presets:");
                        printPresetTable();
                        return 1;
                }
                return runInteractiveSetup();
        }
        const preset = PRESETS.find((p) => p.id === flags.provider);
        if (!preset) {
                console.error(`unown setup: unknown provider "${flags.provider}" — pick one of:`);
                printPresetTable();
                return 1;
        }
        // No exists-guard anymore: setup MERGES (M1) — adding a provider keeps
        // the existing ones; --force resets models.json to exactly this one.
        if (flags.force) {
                const modelsPath = join(UNOWN_AGENT_DIR, "models.json");
                if (existsSync(modelsPath)) {
                        const file = readAgentModelsFile(UNOWN_AGENT_DIR);
                        const others = file.providers.filter((p) => p.id !== preset!.id && p.id !== "zai-bridge").map((p) => p.id);
                        if (others.length > 0) {
                                console.log(`  ⚠ --force RESETS ~/.unown/agent/models.json to just ${preset.id} — drops: ${others.join(", ")}`);
                        }
                }
        }
        return preset.id === "bridge" ? runBridgeSetup(flags, preset, null) : runDirectSetup(flags, preset, null);
}
