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
 *                       [--context-window N] [--max-tokens K]
 *                       [--default]        (interactive when TTY + no flags)
 *   unown providers remove <id>
 *   unown providers key <id> [--api-key K]   (prompt when TTY + no flag)
 *   unown providers default <id> [model]
 *   unown providers test <id>
 *
 * Keys never appear in argv echoes; --key-env stores a `$VAR` reference in
 * models.json instead of a secret (headless CI pattern). The model-specs
 * gate runs on add: specs are detected from verifiable sources (or taken
 * from the two flags / asked in a TTY) before the model is usable.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { formatSpecShort } from "./model-spec-detect.ts";
import { probeLatencyNote, probeProviderEndpoint, rateLimitNote } from "./probe.ts";
import {
	applyModelSpecs,
	keyStatusLabel,
	listProviders,
	looksLikeChatModel,
	type ProviderSummary,
	refreshProviderModels,
	removeProvider,
	resolveProviderKey,
	sanitizeApiKey,
	setDefaultModel,
	setProviderKey,
	testProvider,
	upsertProvider,
} from "./providers.ts";
import { PRESETS, type ProviderPreset } from "./setup.ts";
import { createTerminalDialog, type SetupDialog } from "./setup-dialog.ts";
import { allowUnverifiedSpecs, askSpecNumbers, recordUserSpec, resolveSpecGate } from "./spec-gate.ts";
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
      --context-window N  the model's total context in tokens — the model-specs
                          gate's remediation flag (required non-interactively
                          when no verifiable source knows the model)
      --max-tokens K      the model's max output tokens (the gate's other half)
      --default      make this provider the default (default: first add is)
      --all-models   import every chat model the endpoint serves (discovery)
  unown providers remove <id>          drop a provider (+ its stored key)
  unown providers key <id> [--api-key K]   rotate the stored key (prompts in TTY)
  unown providers default <id> [model] set the default provider/model
  unown providers test <id>            live endpoint probe with the stored key
  unown providers refresh <id>         import the endpoint's live model catalog

Files (~/.unown/agent/): models.json (registry), auth.json (keys, 0600),
settings.json (defaultProvider + defaultModel). Adding NEVER removes other
providers — that is the point. 'unown setup --force' resets to one.
`;

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

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
	allModels?: boolean;
	/** --context-window N (the model-specs gate's remediation flag). */
	contextWindow?: number;
	/** --max-tokens K (the gate's other half). */
	maxTokens?: number;
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
		else if (a === "--all-models") flags.allModels = true;
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
		} else if (a === "--context-window" && next) {
			const n = Number(next);
			if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
				unknown.push(`--context-window (not a positive whole number: "${next}")`);
			} else flags.contextWindow = n;
			i++;
		} else if (a === "--max-tokens" && next) {
			const n = Number(next);
			if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
				unknown.push(`--max-tokens (not a positive whole number: "${next}")`);
			} else flags.maxTokens = n;
			i++;
		} else unknown.push(a);
	}
	return { flags, help, unknown };
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
	const keyEnv = flags.keyEnv;
	// Hoisted so the model-specs gate can ask after the probe (the dialog
	// owns the terminal; created only in the interactive lane).
	let dialog: SetupDialog | null = null;

	if (interactive) {
		// The setup-dialog owns the terminal (masked secrets, validated
		// choices, raw-mode safety) — the readline/promises chain proved
		// flaky under a real PTY (see setup-dialog.ts) and echoed the
		// API key in clear text.
		dialog = createTerminalDialog();
		dialog.note("Add a provider (existing ones are kept):");
		// Default 2 (the first NON-bridge preset — `add` is the day-2
		// surface; the bridge is already wired on day 1).
		const idx = await dialog.choose(
			"Choose",
			PRESETS.map((p) => p.label),
			1,
		);
		preset = PRESETS[idx];
		if (!preset) {
			console.error(`unown providers add: invalid choice`);
			return 1;
		}
		if (preset.id === "custom") {
			baseUrl = await dialog.ask("Endpoint base URL (OpenAI-compatible, usually ends in /v1)", preset.baseUrl);
			providerId = (await dialog.ask("Provider id (short registry name)", "custom-llm")) || "custom-llm";
			modelId = await dialog.ask("Model id");
		} else {
			providerId = preset.id;
			modelId = await dialog.ask("Model id", preset.defaultModel);
		}
		dialog.note(`  (key hint: ${preset.keyEnvHint}; stored in auth.json mode 0600 — blank for local servers)`);
		const secret = await dialog.askSecret("API key (masked)");
		if (secret !== "\u0003" && secret.trim() !== "") {
			const clean = sanitizeApiKey(secret);
			if (clean.problem) {
				console.error(`unown providers add: ${clean.problem}`);
				return 1;
			}
			apiKey = clean.key;
		}
	} else {
		if (!flags.provider) {
			console.error(
				"unown providers add: --provider is required non-interactively (or run in a TTY for the wizard)",
			);
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
	if (baseUrl) baseUrl = baseUrl.trim().replace(/\/+$/, "");
	if (apiKey) {
		const clean = sanitizeApiKey(apiKey);
		if (clean.problem) {
			console.error(`unown providers add: ${clean.problem}`);
			return 1;
		}
		apiKey = clean.key;
	}
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
	// The bridge probes with its placeholder key. The probe speaks the
	// provider's own wire (anthropic-messages → x-api-key).
	const probeKey = apiKey ?? apiKeyInModelsJson ?? (keyEnv ? process.env[keyEnv] : undefined);
	const probe = await probeProviderEndpoint(baseUrl, probeKey, { timeoutMs: 6000, api: preset?.api });
	// --- the model-specs gate (the model-specs round) ---
	// The record is already written; the gate heals it in place (detected
	// numbers overwrite the seed stamp via resolveSpecGate, user answers
	// via recordUserSpec + applyModelSpecs). Refusing here leaves the
	// registration in place but the model unusable until the specs land
	// — the session preflight enforces the same verdict.
	const gateRemediation = `unown providers add --provider ${flags.provider ?? providerId} --model ${modelId} --context-window <N> --max-tokens <K> — or export UNOWN_ALLOW_UNVERIFIED_SPECS=1`;
	if (flags.contextWindow !== undefined || flags.maxTokens !== undefined) {
		if (flags.contextWindow === undefined || flags.maxTokens === undefined) {
			console.error(
				`unown providers add: --context-window and --max-tokens go together (only one was given) — ${gateRemediation}`,
			);
			return 1;
		}
		const spec = recordUserSpec(UNOWN_AGENT_DIR, providerId, modelId, {
			contextWindow: flags.contextWindow,
			maxTokens: flags.maxTokens,
		});
		applyModelSpecs(UNOWN_AGENT_DIR, providerId, {
			[modelId]: { contextWindow: spec.contextWindow!, maxTokens: spec.maxTokens! },
		});
		console.log(`  · specs recorded: ${formatSpecShort(spec)}`);
	} else {
		const gate = await resolveSpecGate(
			{ providerId, modelId, baseUrl, apiKey: probeKey, ...(preset?.api ? { api: preset.api } : {}) },
			{
				agentDir: UNOWN_AGENT_DIR,
				stopWhenComplete: true,
				...(probe.modelEntries ? { endpointCatalog: { data: probe.modelEntries } } : {}),
			},
		);
		if (gate.status === "verified") {
			console.log(`  · specs ${gate.healed ? "verified + healed" : "verified"}: ${formatSpecShort(gate.spec)}`);
		} else if (dialog) {
			dialog.note(
				`  ⚠ no verifiable source for ${modelId}'s specs (tried: the endpoint's own /models, the curated catalog, models.dev, the LiteLLM database).`,
			);
			dialog.note(
				"  The context window and max output tokens drive auto-compaction and the reply cap — unown refuses to guess.",
			);
			const numbers = await askSpecNumbers(dialog, modelId);
			if (!numbers) {
				dialog.note(
					"  ✗ could not get valid specs — the model stays unusable until they land (the session preflight will ask again).",
				);
			} else {
				const spec = recordUserSpec(UNOWN_AGENT_DIR, providerId, modelId, numbers);
				applyModelSpecs(UNOWN_AGENT_DIR, providerId, {
					[modelId]: { contextWindow: spec.contextWindow!, maxTokens: spec.maxTokens! },
				});
				dialog.note(`  · specs recorded: ${formatSpecShort(spec)}`);
			}
		} else if (allowUnverifiedSpecs()) {
			console.log("  · specs UNVERIFIED — proceeding because UNOWN_ALLOW_UNVERIFIED_SPECS=1");
		} else {
			// The registration itself SUCCEEDED — exit 0 with a loud
			// warning, not a refusal: `providers add` is a registration
			// action (the design record's bulk rule — never make
			// registration a wall), and the HARD gate fires at USE time
			// (the session preflight asks / aborts there with the same
			// remediation). A non-zero exit here would break every
			// script that registers a private/local model id no
			// registry knows.
			console.log(
				`  ⚠ specs UNVERIFIED for ${modelId} — no verifiable source (tried the endpoint's own /models, the curated catalog, models.dev, the LiteLLM database).`,
			);
			console.log("    the model stays unusable at session start until its specs land:");
			console.log(`    ${gateRemediation}`);
		}
	}
	if (probe.ok) {
		const served =
			probe.models && probe.models.length > 0
				? ` — serves ${probe.models.slice(0, 6).join(", ")}${probe.models.length > 6 ? " …" : ""}`
				: "";
		console.log(`\n✓ ${existed ? "updated" : "added"} ${providerId} → ${baseUrl}${served}`);
	} else if (probe.problem === "auth") {
		console.log(
			`\n✓ ${existed ? "updated" : "added"} ${providerId}, but the endpoint rejected the key (HTTP ${probe.status}).`,
		);
		console.log("  rotate it with: unown providers key " + providerId);
		return 1;
	} else if (probe.problem === "rate-limit") {
		console.log(`\n✓ ${existed ? "updated" : "added"} ${providerId} → ${baseUrl} — ${rateLimitNote(probe)}.`);
	} else {
		console.log(`\n✓ ${existed ? "updated" : "added"} ${providerId}, but could not reach ${baseUrl}.`);
		console.log("  check the URL, or probe later with: unown providers test " + providerId);
	}
	// Discovery on add: --all-models imports every chat model the endpoint
	// serves (the Cline dropdown experience) instead of just the named one.
	if (flags.allModels && probe.ok) {
		const refresh = await refreshProviderModels(UNOWN_AGENT_DIR, providerId);
		if (refresh.added.length > 0) {
			console.log(
				`  imported ${refresh.added.length} more model${refresh.added.length === 1 ? "" : "s"}: ${refresh.added.slice(0, 8).join(", ")}${refresh.added.length > 8 ? " …" : ""}`,
			);
		} else if (refresh.problem) {
			console.log(`  · model import: ${refresh.problem}`);
		} else {
			console.log("  · no additional chat models served beyond what is registered");
		}
	}
	if (willDefault) console.log(`  default → ${providerId}/${modelId}`);
	else console.log(`  keep the current default with: unown providers default ${providerId}`);
	const after = listProviders(UNOWN_AGENT_DIR);
	console.log(`  registry: ${after.providers.map((p) => p.id).join(", ")}`);
	return 0;
}

// ---------------------------------------------------------------------------
// remove / key / default / test / refresh
// ---------------------------------------------------------------------------

async function cmdProvidersRemove(id: string): Promise<number> {
	if (!id) {
		console.error("unown providers remove: which provider? (see: unown providers list)");
		return 1;
	}
	const result = removeProvider(UNOWN_AGENT_DIR, id);
	if (!result.removed) {
		console.error(
			`unown providers remove: unknown provider "${id}" — configured: ${
				listProviders(UNOWN_AGENT_DIR)
					.providers.map((p) => p.id)
					.join(", ") || "(none)"
			}`,
		);
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
		// Masked entry via the setup dialog (the old readline prompt
		// echoed the key in clear text while claiming it was hidden).
		const dialog = createTerminalDialog();
		const secret = await dialog.askSecret(`New API key for ${id} (masked, stored 0600)`);
		if (secret === "\u0003") {
			console.error("unown providers key: cancelled — nothing written");
			return 1;
		}
		apiKey = secret;
	}
	if (!apiKey || !apiKey.trim()) {
		console.error("unown providers key: no key given");
		return 1;
	}
	const clean = sanitizeApiKey(apiKey);
	if (clean.problem) {
		console.error(`unown providers key: ${clean.problem}`);
		return 1;
	}
	apiKey = clean.key;
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
	if (test.probe?.problem === "rate-limit") {
		console.log(
			`✓ stored the key for ${id} — ${rateLimitNote(test.probe)}; verify later: unown providers test ${id}`,
		);
		return 0;
	}
	console.log(
		`✓ stored the key for ${id} (endpoint unreachable right now — verify later: unown providers test ${id})`,
	);
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
		console.error(
			`unown providers test: unknown provider "${id}" — configured: ${list.providers.map((x) => x.id).join(", ") || "(none)"}`,
		);
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
		const models =
			probe.models && probe.models.length > 0
				? ` — serves ${probe.models.slice(0, 8).join(", ")}${probe.models.length > 8 ? " …" : ""}`
				: "";
		console.log(`✓ ${id} (${p.baseUrl}) reachable${models}${probeLatencyNote(probe)}`);
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
	if (probe?.problem === "rate-limit") {
		console.log(`· ${id} — ${rateLimitNote(probe)} (credential: ${keyLabel})`);
		return 0;
	}
	console.log(`✗ ${id} unreachable at ${p.baseUrl} — start the endpoint or fix the URL:`);
	console.log(`  unown providers add --provider ${id} --base-url <url> …  # re-point`);
	return 1;
}

// ---------------------------------------------------------------------------
// refresh — live model discovery
// ---------------------------------------------------------------------------

async function cmdProvidersRefresh(id: string): Promise<number> {
	if (!id || id.startsWith("--")) {
		console.error("unown providers refresh <id> — which provider? (see: unown providers list)");
		return 1;
	}
	const list = listProviders(UNOWN_AGENT_DIR);
	const p = list.providers.find((x) => x.id === id);
	if (!p) {
		console.error(
			`unown providers refresh: unknown provider "${id}" — configured: ${list.providers.map((x) => x.id).join(", ") || "(none)"}`,
		);
		return 1;
	}
	const result = await refreshProviderModels(UNOWN_AGENT_DIR, id);
	if (!result.found) return 1; // unreachable branch (handled above)
	if (result.problem) {
		console.log(`· ${id}: ${result.problem}`);
		if (result.probe?.problem === "auth") {
			console.log(`  rotate the key with: unown providers key ${id}`);
			return 1;
		}
		return 0; // informational — an endpoint without /models is not an error
	}
	if (result.added.length === 0 && result.missing.length === 0) {
		console.log(`✓ ${id} is in sync — ${result.served?.length ?? 0} chat models served, all registered`);
		return 0;
	}
	if (result.added.length > 0) {
		console.log(`✓ imported ${result.added.length} new model${result.added.length === 1 ? "" : "s"} from ${id}:`);
		for (const m of result.added) console.log(`      · ${m}`);
		console.log("  switch to one with: unown providers default " + id + " <model>  (or /model mid-session)");
	}
	if (result.missing.length > 0) {
		console.log(
			`  ⚠ registered but no longer served (kept — prune by hand if intended): ${result.missing.join(", ")}`,
		);
	}
	return 0;
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
		case "refresh":
		case "sync":
			return cmdProvidersRefresh(rest[0]);
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
