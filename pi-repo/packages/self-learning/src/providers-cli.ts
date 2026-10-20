/**
 * providers-cli.ts — `unown providers` (M1 of the multi-provider plan).
 *
 * The management surface over the multi-provider registry (src/providers.ts):
 * add / list / remove / key / default / test. `unown setup` remains the
 * guided first-connection flow (now merging too); `providers` is the
 * day-to-day surface once you are running — the Cline "API Provider"
 * settings page, as a terminal command.
 *
 * Grammar (clig.dev, mirrors setup/mcp/automations: subcommand first, own
 * flags, unknown flags ERROR, -h/--help never runs the command):
 *
 *   unown providers list [--json]
 *   unown providers add [--provider P] [--api-key K] [--key-env VAR]
 *                       [--model M] [--base-url U] [--id ID] [--name N]
 *                       [--default]        (interactive when TTY + no flags)
 *   unown providers remove <id>
 *   unown providers key <id> [--api-key K]   (prompt when TTY + no flag)
 *   unown providers default <id> [model]
 *   unown providers test <id>
 *
 * Keys never appear in argv echoes; --key-env stores a `$VAR` reference in
 * models.json instead of a secret (headless CI pattern).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as readline from "node:readline/promises";
import { probeOpenAiEndpoint } from "./probe.ts";
import { PRESETS, type ProviderPreset } from "./setup.ts";
import {
        listProviders,
        removeProvider,
        resolveProviderKey,
        setDefaultModel,
        setProviderKey,
        testProvider,
        upsertProvider,
        type ProviderSummary,
} from "./providers.ts";
import { bridgeKnownModels, UNOWN_AGENT_DIR } from "./term.ts";

export const PROVIDERS_HELP = `unown providers — manage the model provider registry

usage:
  unown providers list [--json]        show configured providers (+ key status)
  unown providers add [flags]          add or update a provider (keeps the rest)
      --provider P   preset id: openai | openrouter | anthropic | dashscope |
                     deepseek | agnes | custom (any OpenAI-compatible endpoint)
      --api-key K    the provider key (stored in ~/.unown/agent/auth.json, 0600)
      --key-env VAR  store $VAR as a reference instead of the secret itself
      --model M      the model id to register (preset default when omitted)
      --base-url U   endpoint override (required shape for --provider custom)
      --id ID        registry id override (multiple customs: --id team-gw …)
      --name N       display name override
      --default      make this provider the default (default: first add is)
  unown providers remove <id>          drop a provider (+ its stored key)
  unown providers key <id> [--api-key K]   rotate the stored key (prompts in TTY)
  unown providers default <id> [model] set the default provider/model
  unown providers test <id>            live endpoint probe with the stored key

Files (~/.unown/agent/): models.json (registry), auth.json (keys, 0600),
settings.json (defaultProvider + defaultModel). Adding NEVER removes other
providers — that is the point. 'unown setup --force' resets to one.
`;

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

function keyStatusLabel(p: ProviderSummary): string {
        switch (p.keyStatus) {
                case "auth-json":
                        return "key: auth.json";
                case "models-json":
                        return "key: in models.json";
                case "env-ref":
                        return `key: $${p.keyEnv}`;
                default:
                        return "key: none";
        }
}

export async function cmdProvidersList(jsonMode: boolean): Promise<number> {
        const list = listProviders(UNOWN_AGENT_DIR);
        if (list.error) {
                console.error(`unown providers: models.json is invalid: ${list.error}`);
                console.error("  repair by hand, or reset with: unown setup --provider <p> --force");
                return 1;
        }
        if (jsonMode) {
                console.log(JSON.stringify(list, null, 2));
                return 0;
        }
        if (list.providers.length === 0) {
                console.log("No providers configured yet — add one:");
                console.log("  unown providers add --provider openai --api-key sk-... --model gpt-4o");
                console.log("  unown setup                # the guided alternative");
                return 0;
        }
        console.log(`Providers (~/.unown/agent/models.json):`);
        for (const p of list.providers) {
                const marker = p.isDefault ? "  ← default" : "";
                console.log(`  ${p.id}${p.baseUrl ? `  ${p.baseUrl}` : ""}${marker}`);
                console.log(`      · ${keyStatusLabel(p)}${p.api ? ` · ${p.api}` : ""}`);
                for (const m of p.modelIds) {
                        const dm = p.isDefault && m === list.defaultModel ? "  ← default model" : "";
                        console.log(`      · ${m}${dm}`);
                }
        }
        console.log(`\nSwitch mid-session with /model. Manage with: unown providers add | remove | key | default | test`);
        return 0;
}

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------

interface AddFlags {
        provider?: string;
        apiKey?: string;
        keyEnv?: string;
        model?: string;
        baseUrl?: string;
        id?: string;
        name?: string;
        default?: boolean;
}

function parseAddFlags(args: string[]): { flags: AddFlags; help: boolean; unknown: string[] } {
        const flags: AddFlags = {};
        const unknown: string[] = [];
        let help = false;
        for (let i = 0; i < args.length; i++) {
                const a = args[i];
                const next = args[i + 1];
                if (a === "-h" || a === "--help") help = true;
                else if (a === "--default") flags.default = true;
                else if (a === "--provider" && next) {
                        flags.provider = next;
                        i++;
                } else if (a === "--api-key" && next) {
                        flags.apiKey = next;
                        i++;
                } else if (a === "--key-env" && next) {
                        flags.keyEnv = next;
                        i++;
                } else if (a === "--model" && next) {
                        flags.model = next;
                        i++;
                } else if (a === "--base-url" && next) {
                        flags.baseUrl = next;
                        i++;
                } else if (a === "--id" && next) {
                        flags.id = next;
                        i++;
                } else if (a === "--name" && next) {
                        flags.name = next;
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

async function cmdProvidersAdd(args: string[]): Promise<number> {
        const { flags, help, unknown } = parseAddFlags(args);
        if (help) {
                console.log(PROVIDERS_HELP);
                return 0;
        }
        if (unknown.length) {
                console.error(`unown providers add: unknown argument(s): ${unknown.join(" ")}`);
                console.error(PROVIDERS_HELP);
                return 1;
        }
        const interactive = !flags.provider && process.stdin.isTTY && process.stdout.isTTY;
        let preset: ProviderPreset | undefined;
        let providerId = flags.id;
        let providerName = flags.name;
        let baseUrl = flags.baseUrl;
        let modelId = flags.model;
        let apiKey = flags.apiKey;
        let keyEnv = flags.keyEnv;

        if (interactive) {
                const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
                try {
                        console.log("Add a provider (existing ones are kept):");
                        PRESETS.forEach((p, i) => console.log(`  ${i + 1}) ${p.label}`));
                        const choice = await ask(rl, "Choose", "2");
                        const idx = Number.parseInt(choice, 10);
                        preset = PRESETS[(idx || 2) - 1];
                        if (!preset) {
                                console.error(`unown providers add: invalid choice "${choice}"`);
                                return 1;
                        }
                        if (preset.id === "custom") {
                                baseUrl = await ask(rl, "Endpoint base URL (OpenAI-compatible, usually ends in /v1)", preset.baseUrl);
                                providerId = (await ask(rl, "Provider id (short registry name)", "custom-llm")) || "custom-llm";
                                modelId = await ask(rl, "Model id");
                        } else {
                                providerId = preset.id;
                                modelId = await ask(rl, "Model id", preset.defaultModel);
                        }
                        console.log(`  (key hint: ${preset.keyEnvHint}; stored in auth.json mode 0600 — blank for local servers)`);
                        apiKey = await ask(rl, "API key");
                } finally {
                        rl.close();
                }
        } else {
                if (!flags.provider) {
                        console.error("unown providers add: --provider is required non-interactively (or run in a TTY for the wizard)");
                        console.error("  presets: " + PRESETS.map((p) => p.id).join(" | "));
                        return 1;
                }
                preset = PRESETS.find((p) => p.id === flags.provider);
                if (!preset) {
                        console.error(`unown providers add: unknown provider "${flags.provider}" — pick one of:`);
                        console.error("  " + PRESETS.map((p) => p.id).join(" | "));
                        return 1;
                }
        }

        // Defaults from the preset once resolved.
        if (preset) {
                if (!baseUrl) baseUrl = preset.baseUrl;
                if (!modelId) modelId = preset.defaultModel;
                if (!providerId) providerId = preset.id;
                if (!providerName) providerName = flags.name ?? preset.label.split(" (")[0];
        }
        if (preset?.id === "custom" && !providerId) providerId = "custom-llm";
        if (preset?.id === "custom") providerName = flags.name ?? providerId ?? "custom-llm";
        if (!baseUrl) {
                console.error("unown providers add: no base URL (use --base-url)");
                return 1;
        }
        if (!modelId) {
                console.error("unown providers add: no model id (use --model)");
                return 1;
        }
        if (!providerId || !/^[a-z0-9][a-z0-9-]*$/.test(providerId)) {
                console.error(`unown providers add: bad registry id "${providerId}" — lowercase letters, digits, dashes`);
                return 1;
        }
        if (!providerName) providerName = providerId;
        if (apiKey && keyEnv) {
                console.error("unown providers add: --api-key and --key-env are mutually exclusive");
                return 1;
        }
        const keyless = !apiKey && !keyEnv;
        if (keyless && !interactive) {
                console.log("  · no key given — continuing keyless (fine for local servers)");
        }

        // Does it already exist? Then this is an UPDATE (in place).
        const before = listProviders(UNOWN_AGENT_DIR);
        const existed = before.providers.some((p) => p.id === providerId);
        const willDefault = flags.default === true || before.providers.length === 0;

        // The bundled bridge is special (same rules as setup's runBridgeSetup):
        // its registry id is PI_PROVIDER || "zai-bridge" so a later
        // `unown setup --provider bridge` updates the SAME entry instead of
        // growing a duplicate; its "key" is the shared placeholder the bridge
        // itself checks (BRIDGE_API_KEY || "bridge-local"), stored in
        // models.json like setup always did; and every id the bridge serves
        // (its allow-list) is registered so /model + --model can route.
        let apiKeyInModelsJson: string | undefined;
        let extraModelIds: string[] | undefined;
        if (preset?.id === "bridge") {
                providerId = process.env.PI_PROVIDER || "zai-bridge";
                apiKeyInModelsJson = process.env.BRIDGE_API_KEY || "bridge-local";
                extraModelIds = bridgeKnownModels(modelId).filter((m) => m !== modelId);
        }

        upsertProvider(
                UNOWN_AGENT_DIR,
                {
                        id: providerId,
                        name: providerName,
                        baseUrl,
                        api: preset?.api ?? "openai-completions",
                        modelId,
                        input: preset?.input ?? ["text"],
                        ...(apiKey ? { apiKeyInAuthJson: apiKey } : {}),
                        ...(keyEnv ? { apiKeyEnvRef: keyEnv } : {}),
                        ...(apiKeyInModelsJson ? { apiKeyInModelsJson } : {}),
                        ...(extraModelIds ? { extraModelIds } : {}),
                },
                { setDefault: willDefault },
        );

        // Verification (best effort; the same classification setup uses):
        // with --key-env probe with the CURRENT env value when it is set.
        // The bridge probes with its placeholder key.
        const probeKey = apiKey ?? apiKeyInModelsJson ?? (keyEnv ? process.env[keyEnv] : undefined);
        const probe = await probeOpenAiEndpoint(baseUrl, probeKey, 6000);
        if (probe.ok) {
                const served = probe.models && probe.models.length > 0 ? ` — serves ${probe.models.slice(0, 6).join(", ")}${probe.models.length > 6 ? " …" : ""}` : "";
                console.log(`\n✓ ${existed ? "updated" : "added"} ${providerId} → ${baseUrl}${served}`);
        } else if (probe.problem === "auth") {
                console.log(`\n✓ ${existed ? "updated" : "added"} ${providerId}, but the endpoint rejected the key (HTTP ${probe.status}).`);
                console.log("  rotate it with: unown providers key " + providerId);
                return 1;
        } else {
                console.log(`\n✓ ${existed ? "updated" : "added"} ${providerId}, but could not reach ${baseUrl}.`);
                console.log("  check the URL, or probe later with: unown providers test " + providerId);
        }
        if (willDefault) console.log(`  default → ${providerId}/${modelId}`);
        else console.log(`  keep the current default with: unown providers default ${providerId}`);
        const after = listProviders(UNOWN_AGENT_DIR);
        console.log(`  registry: ${after.providers.map((p) => p.id).join(", ")}`);
        return 0;
}

// ---------------------------------------------------------------------------
// remove / key / default / test
// ---------------------------------------------------------------------------

async function cmdProvidersRemove(id: string): Promise<number> {
        if (!id) {
                console.error("unown providers remove: which provider? (see: unown providers list)");
                return 1;
        }
        const result = removeProvider(UNOWN_AGENT_DIR, id);
        if (!result.removed) {
                console.error(`unown providers remove: unknown provider "${id}" — configured: ${
                        listProviders(UNOWN_AGENT_DIR).providers.map((p) => p.id).join(", ") || "(none)"
                }`);
                return 1;
        }
        console.log(`✓ removed ${id} (its stored key went with it)`);
        if (result.wasDefault) {
                if (result.remaining > 0) {
                        const list = listProviders(UNOWN_AGENT_DIR);
                        console.log(`  default fell back to ${list.defaultProvider}/${list.defaultModel}`);
                } else {
                        console.log("  no providers left — add one before starting a session: unown providers add");
                }
        }
        return 0;
}

async function cmdProvidersKey(id: string, args: string[]): Promise<number> {
        if (!id || id.startsWith("--")) {
                console.error("unown providers key <id> [--api-key K] — which provider? (see: unown providers list)");
                return 1;
        }
        const rest = args.slice(args.indexOf(id) + 1);
        let apiKey: string | undefined;
        for (let i = 0; i < rest.length; i++) {
                if (rest[i] === "--api-key" && rest[i + 1]) {
                        apiKey = rest[i + 1];
                        i++;
                }
        }
        if (!apiKey) {
                if (!process.stdin.isTTY || !process.stdout.isTTY) {
                        console.error("unown providers key: --api-key is required non-interactively (or run in a TTY to be prompted)");
                        return 1;
                }
                const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
                try {
                        apiKey = (await rl.question(`New API key for ${id} (input hidden by your terminal's paste; stored 0600): `)).trim();
                } finally {
                        rl.close();
                }
        }
        if (!apiKey) {
                console.error("unown providers key: no key given");
                return 1;
        }
        if (!setProviderKey(UNOWN_AGENT_DIR, id, apiKey)) {
                console.error(`unown providers key: unknown provider "${id}"`);
                return 1;
        }
        // Verify the new credential immediately (rotation's whole point).
        const test = await testProvider(UNOWN_AGENT_DIR, id);
        if (test.probe?.ok) {
                console.log(`✓ rotated the key for ${id} — endpoint accepts it`);
                return 0;
        }
        if (test.probe?.problem === "auth") {
                console.log(`✓ stored the key for ${id}, but the endpoint rejected it (HTTP ${test.probe.status})`);
                return 1;
        }
        console.log(`✓ stored the key for ${id} (endpoint unreachable right now — verify later: unown providers test ${id})`);
        return 0;
}

async function cmdProvidersDefault(id: string, model?: string): Promise<number> {
        if (!id || id.startsWith("--")) {
                console.error("unown providers default <id> [model] — which provider? (see: unown providers list)");
                return 1;
        }
        const result = setDefaultModel(UNOWN_AGENT_DIR, id, model);
        if (!result.ok) {
                console.error(`unown providers default: ${result.error}`);
                return 1;
        }
        const list = listProviders(UNOWN_AGENT_DIR);
        console.log(`✓ default → ${list.defaultProvider}/${list.defaultModel}`);
        return 0;
}

async function cmdProvidersTest(id: string): Promise<number> {
        if (!id || id.startsWith("--")) {
                console.error("unown providers test <id> — which provider? (see: unown providers list)");
                return 1;
        }
        const list = listProviders(UNOWN_AGENT_DIR);
        const p = list.providers.find((x) => x.id === id);
        if (!p) {
                console.error(`unown providers test: unknown provider "${id}" — configured: ${list.providers.map((x) => x.id).join(", ") || "(none)"}`);
                return 1;
        }
        if (!p.baseUrl) {
                console.error(`unown providers test: ${id} declares no baseUrl — fix ~/.unown/agent/models.json`);
                return 1;
        }
        const keyInfo = resolveProviderKey(UNOWN_AGENT_DIR, id);
        const keyLabel = keyInfo.source === "env-ref" ? `$${keyInfo.envVar}` : keyInfo.source;
        const result = await testProvider(UNOWN_AGENT_DIR, id, 8000);
        const probe = result.probe;
        if (probe?.ok) {
                const models = probe.models && probe.models.length > 0 ? ` — serves ${probe.models.slice(0, 8).join(", ")}${probe.models.length > 8 ? " …" : ""}` : "";
                console.log(`✓ ${id} (${p.baseUrl}) reachable${models}`);
                console.log(`  credential: ${keyLabel}`);
                if (probe.models && probe.models.length > 0) {
                        const missing = p.modelIds.filter((m) => !probe.models!.includes(m));
                        if (missing.length > 0) console.log(`  ⚠ registered but not served: ${missing.join(", ")}`);
                }
                return 0;
        }
        if (probe?.problem === "auth") {
                console.log(`✗ ${id} rejected the credential (HTTP ${probe.status}) — rotate it:`);
                console.log(`  unown providers key ${id}`);
                return 1;
        }
        console.log(`✗ ${id} unreachable at ${p.baseUrl} — start the endpoint or fix the URL:`);
        console.log(`  unown providers add --provider ${id} --base-url <url> …  # re-point`);
        return 1;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runProvidersCommand(argv: string[]): Promise<number> {
        const sub = argv[0];
        const rest = argv.slice(1);
        switch (sub) {
                case undefined:
                case "list":
                case "ls": {
                        const jsonMode = rest.includes("--json");
                        const unknown = rest.filter((a) => a !== "--json" && a !== "-h" && a !== "--help");
                        if (unknown.length) {
                                console.error(`unown providers list: unknown argument(s): ${unknown.join(" ")}`);
                                return 1;
                        }
                        if (rest.includes("-h") || rest.includes("--help")) {
                                console.log(PROVIDERS_HELP);
                                return 0;
                        }
                        return cmdProvidersList(jsonMode);
                }
                case "add":
                        return cmdProvidersAdd(rest);
                case "remove":
                case "rm":
                        return cmdProvidersRemove(rest[0]);
                case "key":
                        return cmdProvidersKey(rest[0], rest);
                case "default": {
                        const positional = rest.filter((a) => !a.startsWith("--"));
                        return cmdProvidersDefault(positional[0], positional[1]);
                }
                case "test":
                        return cmdProvidersTest(rest[0]);
                case "-h":
                case "--help":
                case "help":
                        console.log(PROVIDERS_HELP);
                        return 0;
                default:
                        console.error(`unown providers: unknown subcommand "${sub}"`);
                        console.error(PROVIDERS_HELP);
                        return 1;
        }
}
