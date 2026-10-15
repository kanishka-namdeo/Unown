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
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as readline from "node:readline/promises";
import { probeOpenAiEndpoint, readAgentModelsFile, resolveActiveProvider } from "./probe.ts";
import { UNOWN_AGENT_DIR } from "./term.ts";

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
		baseUrl: `${(process.env.PI_BRIDGE_URL ?? "http://127.0.0.1:3031").replace(/\/+$/, "")}/v1`,
		api: "openai-completions",
		defaultModel: process.env.PI_MODEL_ID ?? "kimi-k2.5",
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

export function writeAgentConfig(input: WriteConfigInput): void {
	// A fresh UNOWN_HOME has no agent dir yet — create it before writing.
	mkdirSync(UNOWN_AGENT_DIR, { recursive: true });

	// models.json — full rewrite (setup is an explicit reconfigure action).
	const modelsJson: Record<string, unknown> = {
		providers: {
			[input.providerId]: {
				name: input.providerName,
				baseUrl: input.baseUrl,
				api: input.api,
				...(input.apiKeyInModelsJson ? { apiKey: input.apiKeyInModelsJson } : {}),
				models: [
					{
						id: input.modelId,
						name: `${input.modelId} (via unown)`,
						contextWindow: 131072,
						maxTokens: 8192,
						input: input.input,
					},
				],
			},
		},
	};
	writeFileSync(join(UNOWN_AGENT_DIR, "models.json"), `${JSON.stringify(modelsJson, null, 2)}\n`, "utf8");

	// auth.json — merge the provider key in (0600).
	if (input.apiKeyInAuthJson) {
		const authPath = join(UNOWN_AGENT_DIR, "auth.json");
		let auth: Record<string, unknown> = {};
		if (existsSync(authPath)) {
			try {
				auth = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>;
			} catch {
				auth = {};
			}
		}
		auth[input.providerId] = { type: "api_key", key: input.apiKeyInAuthJson };
		writeFileSync(authPath, `${JSON.stringify(auth, null, 2)}\n`, "utf8");
		chmodSync(authPath, 0o600);
	}

	// settings.json — default provider/model so sessions never need a picker.
	mergeJson(join(UNOWN_AGENT_DIR, "settings.json"), {
		defaultProvider: input.providerId,
		defaultModel: input.modelId,
	});
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
	console.log(`Configured providers (~/.unown/agent/models.json):`);
	for (const p of file.providers) {
		const marker = active && p.id === active.id ? "  ← default" : "";
		console.log(`  ${p.id}${p.baseUrl ? `  ${p.baseUrl}` : ""}${marker}`);
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
	force: boolean;
	list: boolean;
}

function parseSetupFlags(args: string[]): SetupFlags {
	const flags: SetupFlags = { force: false, list: false };
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		const next = args[i + 1];
		if (a === "--force" || a === "-f") flags.force = true;
		else if (a === "--list") flags.list = true;
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
		}
	}
	return flags;
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
		const res = await fetch(`${(process.env.PI_BRIDGE_URL ?? "http://127.0.0.1:3031").replace(/\/+$/, "")}/health`, {
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
	const apiKey = process.env.BRIDGE_API_KEY ?? "bridge-local";
	writeAgentConfig({
		providerId: process.env.PI_PROVIDER ?? "zai-bridge",
		providerName: "unown llm-bridge",
		baseUrl: preset.baseUrl,
		api: preset.api,
		modelId,
		input: preset.input,
		apiKeyInModelsJson: apiKey,
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
	});
	// Verify reachability (best effort, non-fatal).
	const probe = await probeOpenAiEndpoint(baseUrl, apiKey || undefined, 4000);
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
			const overwrite = await ask(rl, "\nOverwrite ~/.unown/agent/models.json with the new provider?", "y");
			if (!/^[yY]/.test(overwrite)) {
				console.log("Aborted — nothing written.");
				return 1;
			}
		}
		return preset.id === "bridge" ? runBridgeSetup({}, preset, rl) : runDirectSetup({}, preset, rl);
	} finally {
		rl.close();
	}
}

/** Entry point for `unown setup [flags]`. Returns the process exit code. */
export async function runSetupCommand(args: string[]): Promise<number> {
	const flags = parseSetupFlags(args);
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
	const modelsPath = join(UNOWN_AGENT_DIR, "models.json");
	if (existsSync(modelsPath) && !flags.force) {
		console.error(`unown setup: ${modelsPath} already exists — re-run with --force to overwrite it`);
		return 1;
	}
	return preset.id === "bridge" ? runBridgeSetup(flags, preset, null) : runDirectSetup(flags, preset, null);
}
