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
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { firstFlightCatalog } from "./flights-core.ts";
import { loadModelHealth, MODEL_HEALTH_TTL_MS } from "./model-health.ts";
import {
	detectModelSpec,
	formatSpecLine,
	formatSpecShort,
	getRecordedSpec,
	isCompleteSpec,
	type ModelSpecDetection,
	recordSpec,
	type SpecCost,
} from "./model-spec-detect.ts";
import { modelSpec } from "./model-specs.ts";
import {
	type EndpointProbe,
	isLoopbackProvider,
	probeLatencyNote,
	probeOpenAiEndpoint,
	probeProviderEndpoint,
	rateLimitNote,
	readAgentModelsFile,
	resolveActiveProvider,
} from "./probe.ts";
import {
	applyModelSpecs,
	clearProviderKey,
	keyStatusLabel,
	listProviders,
	mergeSettings,
	type ProviderEntry,
	resolveProviderKey,
	sanitizeApiKey,
	upsertProvider,
} from "./providers.ts";
import { createTerminalDialog, maskKey, SECRET_CANCEL, type SetupDialog } from "./setup-dialog.ts";
import { allowUnverifiedSpecs, askSpecNumbers, recordUserSpec, resolveSpecGate } from "./spec-gate.ts";
import { bridgeKnownModels, UNOWN_AGENT_DIR } from "./term.ts";

export type { ProviderPreset } from "./presets.ts";
// ---------------------------------------------------------------------------
// Provider presets — re-exported from presets.ts (M4 extraction: the registry
// and the CLI share one table; presets.ts imports nothing from the
// terminal half, so the import-graph detachment tests stay green).
// ---------------------------------------------------------------------------
export { PRESETS } from "./presets.ts";

import { PRESETS, type ProviderPreset } from "./presets.ts";

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
	/** Per-model VERIFIED specs (the model-specs gate's answer) stamped on
	 *  newly-registered models: `{ [modelId]: { contextWindow, maxTokens } }`.
	 *  The chosen model's numbers come from detection or the user; discovered
	 *  extras carry theirs when the same sources could verify them. */
	modelSpecs?: Record<string, { contextWindow: number; maxTokens: number }>;
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
		...(input.modelSpecs ? { modelSpecs: input.modelSpecs } : {}),
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
		const wire = p.api === "anthropic-messages" ? "  · anthropic wire" : "";
		console.log(`  ${p.id}${p.baseUrl ? `  ${p.baseUrl}` : ""}${wire}${keyNote}${marker}`);
		const marks = loadModelHealth(UNOWN_AGENT_DIR).marks;
		for (const m of p.modelIds) {
			const mark = marks[m];
			const health =
				mark && Date.now() - mark < MODEL_HEALTH_TTL_MS
					? `  ⚠ recently failed (${Math.max(1, Math.round((Date.now() - mark) / 60000))} min ago — subagents skip it)`
					: "";
			// The model-specs round: every model shows where its
			// numbers came from (the sidecar is the provenance
			// source of truth); an unverified model says so — it
			// will be checked/gated at first use.
			const recorded = getRecordedSpec(UNOWN_AGENT_DIR, p.id, m);
			const specNote = recorded ? `  [${formatSpecShort(recorded)}]` : "  [specs unverified — checked at first use]";
			console.log(`      · ${m}${specNote}${health}`);
		}
	}
	// Live list when the default provider is a local bridge.
	if (active?.baseUrl) {
		// auth.json > models.json literal > $ENV — the same single key
		// source the doctor probe uses (setup writes keys to auth.json);
		// the probe speaks the provider's own wire.
		const probe = await probeProviderEndpoint(active.baseUrl, resolveProviderKey(UNOWN_AGENT_DIR, active.id).key, {
			timeoutMs: 3000,
			api: active.api,
		});
		const served = probe.ok ? probe.models : undefined;
		if (served && served.length > 0) {
			console.log(`\nServed right now by ${active.baseUrl}${probeLatencyNote(probe)}:`);
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
	/** --context-window N: the model's total context (the non-interactive
	 *  model-specs gate's remediation flag — required when no verifiable
	 *  source knows the model). */
	contextWindow?: number;
	/** --max-tokens K: the model's max output tokens (the gate's other flag). */
	maxTokens?: number;
	force: boolean;
	list: boolean;
}

export const SETUP_USAGE = `unown setup — connect a model provider

usage: unown setup [--provider P] [--api-key K] [--model M] [--base-url U] [--key-env VAR] [--context-window N] [--max-tokens K] [--force|-f] [--list]
  --provider P         bridge | openai | openrouter | anthropic | dashscope | deepseek | agnes | custom
  --api-key K          the provider key (stored under ~/.unown/agent, never in the repo)
  --model M            the model id to use
  --base-url U         endpoint override (any OpenAI-compatible server)
  --key-env VAR        reference $VAR from the environment instead of storing the key
  --context-window N   the model's total context in tokens — required when no
                       verifiable source (the endpoint's /models, the curated
                       catalog, models.dev, LiteLLM) knows the model's specs
  --max-tokens K       the model's max output tokens (the gate's other half)
  --force, -f          RESET: rewrite models.json with exactly this provider (drops others)
  --list               show the provider presets and exit

With no flags: the interactive wizard.

Adding a provider KEEPS existing ones (multi-provider registry; see
  unown providers list / unown providers add). --force restores the old
  single-provider rewrite behaviour.

Model specs: unown verifies context window + max output tokens from
  verifiable sources at configuration time and asks for them (or takes the
  two flags) when nothing verifiable is found — a wrong spec is never
  cosmetic (compaction triggers + the reply cap hang off these numbers).
  UNOWN_ALLOW_UNVERIFIED_SPECS=1 skips the gate for air-gapped installs.
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

// (the standalone readline `ask()` helper lived here; the dialog layer in
// setup-dialog.ts owns prompts now — see that module for why readline was
// dropped for the TTY path.)

// ---------------------------------------------------------------------------
// Setup outcome — everything the closing summary needs (the Hermes-agent
// _print_setup_summary pattern: the user leaves knowing exactly what was
// written where, in one screen).
// ---------------------------------------------------------------------------
export interface SetupOutcome {
	providerId: string;
	providerName: string;
	baseUrl: string;
	modelId: string;
	/** Additional registered model ids (the bridge allow-list / live discovery). */
	extraModels?: string[];
	/** Where the key ended up — the summary line's source of truth. */
	keyDisposition: "auth-json" | "env-ref" | "models-json" | "keyless" | "bridge";
	/** Human note for the key line ("kept existing", "cleared", …). */
	keyNote?: string;
	/** Theme switched by the wizard (undefined = unchanged). */
	theme?: string;
	/** Sibling providers that survived (merge semantics). */
	kept?: string[];
	verified: "ok" | "auth-rejected" | "unreachable" | "skipped";
	/** Live-discovered model list, when the endpoint answered. */
	served?: string[];
	/** The model-specs line: verified numbers + source, or the unverified
	 *  marker (the model-specs round — the user leaves knowing where the
	 *  numbers that drive compaction came from). */
	specLine?: string;
}

// (the local firstFlightCatalog string list moved to src/flights-core.ts —
// the shared First flights catalog: the setup summary and the in-TUI starter
// card render from one source of truth.)

/** Pure builder (unit-tested): the summary text without printing. */
export function buildSetupSummaryText(out: SetupOutcome): string {
	const extra = out.extraModels?.length
		? `  (+${out.extraModels.length} more: ${out.extraModels.slice(0, 4).join(", ")}${out.extraModels.length > 4 ? " …" : ""})`
		: "";
	const keyLine = (() => {
		switch (out.keyDisposition) {
			case "auth-json":
				return `auth.json (mode 0600)${out.keyNote ? ` — ${out.keyNote}` : ""}`;
			case "env-ref":
				return `models.json $ENV reference${out.keyNote ? ` — ${out.keyNote}` : ""}`;
			case "models-json":
				return `models.json (provider-level)${out.keyNote ? ` — ${out.keyNote}` : ""}`;
			case "bridge":
				return "bridge placeholder in models.json (the real secret lives in the repo .env)";
			default:
				return out.keyNote ? `none — ${out.keyNote}` : "none (keyless)";
		}
	})();
	const verifyLine =
		out.verified === "ok"
			? `endpoint reachable${out.served?.length ? ` — serves ${out.served.slice(0, 6).join(", ")}${out.served.length > 6 ? " …" : ""}` : ""}`
			: out.verified === "auth-rejected"
				? "endpoint reachable but REJECTED the key"
				: out.verified === "unreachable"
					? "endpoint not reachable (config written — verify later)"
					: "not verified";
	const lines: string[] = [];
	lines.push("");
	lines.push("✓ setup complete");
	lines.push(`  provider  ${out.providerId} → ${out.baseUrl}`);
	lines.push(`  model     ${out.modelId}${extra}`);
	lines.push(`  key       ${keyLine}`);
	lines.push(`  specs     ${out.specLine ?? "unverified — checked at first use"}`);
	lines.push(`  theme     ${out.theme ? `switched: ${out.theme}` : "unchanged"}`);
	lines.push(`  verify    ${verifyLine}`);
	if (out.kept?.length) lines.push(`  kept      existing providers: ${out.kept.join(", ")}`);
	lines.push("  files     ~/.unown/agent/{models,auth,settings}.json");
	lines.push("\nNext:");
	lines.push("  unown                start a session in this project");
	lines.push("  unown doctor         end-to-end diagnostics");
	lines.push("  unown providers list  see every configured provider");
	lines.push("\nFirst flights (paste into a session):");
	for (const f of firstFlightCatalog()) lines.push(`  · ${f.summary}`);
	return lines.join("\n") + "\n";
}

/** Print it (the wizard's closer). */
function printSetupSummary(out: SetupOutcome): void {
	console.log(buildSetupSummaryText(out));
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

/** Bridge health, structured (best effort, 3s) — one fetch feeds the wizard's
 *  recommendation marker, the bridge step's status line AND its model list. */
interface BridgeHealth {
	snippet: string | null;
	upstreamOk: boolean;
	keySet: boolean;
	models: string[];
	defaultModel?: string;
}

async function bridgeHealth(): Promise<BridgeHealth> {
	try {
		const res = await fetch(`${(process.env.PI_BRIDGE_URL || "http://127.0.0.1:3031").replace(/\/+$/, "")}/health`, {
			signal: AbortSignal.timeout(3000),
		});
		if (!res.ok) return { snippet: null, upstreamOk: false, keySet: false, models: [] };
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
		return {
			snippet: `${up} · ${key} · serves: ${models || "nothing"} (default ${body.defaultModel ?? "?"})`,
			upstreamOk: body.upstream?.ok === true,
			keySet: body.upstreamKeyIsSet === true,
			models: body.models ?? [],
			defaultModel: body.defaultModel,
		};
	} catch {
		return { snippet: null, upstreamOk: false, keySet: false, models: [] };
	}
}

/** Legacy string form (doctor etc. keep the exact snippet text). */
async function bridgeHealthSnippet(): Promise<string | null> {
	return (await bridgeHealth()).snippet;
}

// ---------------------------------------------------------------------------
// Wizard steps shared by both interactive lanes
// ---------------------------------------------------------------------------

/** Read settings.json's current theme ("" when unset). */
function currentTheme(): string {
	try {
		const raw = JSON.parse(readFileSync(join(UNOWN_AGENT_DIR, "settings.json"), "utf8")) as { theme?: string };
		return typeof raw.theme === "string" && raw.theme ? raw.theme : "";
	} catch {
		return "";
	}
}

/** Theme names available to the TUI: pi's built-ins + ~/.unown/agent/themes/*.json. */
function availableThemes(): string[] {
	const names = new Set<string>(["dark", "light"]);
	const dir = join(UNOWN_AGENT_DIR, "themes");
	try {
		for (const f of readdirSync(dir)) {
			if (f.endsWith(".json")) names.add(f.slice(0, -".json".length));
		}
	} catch {
		/* no themes dir yet — built-ins still apply */
	}
	return [...names];
}

/**
 * The "Pick a look" beat (Hermes onboarding: name → theme → …). Asked AFTER
 * the provider is verified — first run connects the model; the look is the
 * dessert. Blank/first option = keep current (no write). Writes settings.json
 * via mergeSettings (never clobbers sibling keys).
 */
async function runThemeStep(dialog: SetupDialog): Promise<string | undefined> {
	const current = currentTheme() || "unown";
	const others = availableThemes()
		.filter((t) => t !== current)
		.sort((a, b) => (a === "unown" ? -1 : b === "unown" ? 1 : a.localeCompare(b)));
	const options = [`${current} (keep current)`, ...others];
	dialog.note("\nThe look — pick a TUI theme (switch any time in-session: /settings):");
	const idx = await dialog.choose("Theme", options, 0);
	if (idx === 0) return undefined;
	const theme = others[idx - 1];
	if (!theme) return undefined;
	mergeSettings(UNOWN_AGENT_DIR, { theme });
	return theme;
}

/**
 * The existing-secret question (Hermes main_provider_setup: `key[:8]… ✓` +
 * Keep / Replace / Clear). Returns the effective key decision for the write.
 */
interface KeyDecision {
	/** Final storage form for writeAgentConfig. */
	apiKeyInAuthJson?: string;
	apiKeyInModelsJson?: string;
	apiKeyEnvRef?: string;
	/** True when the stored key was cleared. */
	cleared?: boolean;
	/** For the summary keyNote. */
	note: string;
	cancelled?: boolean;
}

async function runKeyStep(
	dialog: SetupDialog,
	preset: ProviderPreset,
	providerId: string,
	effectiveProviderId: string,
): Promise<KeyDecision> {
	const existing = resolveProviderKey(UNOWN_AGENT_DIR, effectiveProviderId);
	if (existing.source !== "none" && existing.key) {
		const src =
			existing.source === "auth-json"
				? "auth.json"
				: existing.source === "models-json"
					? "models.json"
					: `$${existing.envVar ?? "?"} (env ref)`;
		dialog.note(`  key: ${maskKey(existing.key)} ✓  already stored (${src})`);
		const idx = await dialog.choose(
			"Use it?",
			["Keep the stored key", "Replace with a new key", "Clear the stored key (continue keyless)"],
			0,
		);
		if (idx === 0) {
			return existing.source === "auth-json"
				? { apiKeyInAuthJson: existing.key, note: "kept existing (auth.json)" }
				: existing.source === "models-json"
					? { apiKeyInModelsJson: existing.key, note: "kept existing (models.json)" }
					: { apiKeyEnvRef: existing.envVar, note: "kept existing ($ENV ref)" };
		}
		if (idx === 2) {
			const res = clearProviderKey(UNOWN_AGENT_DIR, effectiveProviderId);
			return {
				cleared: true,
				note: res.removedAuthEntry || res.removedModelsKey ? "cleared the stored key" : "was already keyless",
			};
		}
		// idx === 1: replace — falls through to the masked prompt
	} else if (existing.source === "env-ref" && existing.envVar) {
		dialog.note(`  key: $${existing.envVar} is referenced but NOT set in this environment — requests would fail.`);
	} else {
		dialog.note(`  (key hint: ${preset.keyEnvHint}; stored in ~/.unown/agent/auth.json with mode 0600)`);
	}
	dialog.note("  The input is masked — type the key, Enter to finish. Blank = keyless (fine for local servers).");
	const secret = await dialog.askSecret("API key");
	if (secret === SECRET_CANCEL) return { note: "", cancelled: true };
	if (!secret) return { note: "no key given — continuing keyless" };
	// Paste hygiene (Claude Code's practice): trim + reject keys that still
	// contain whitespace/control characters — never echo the value back.
	const clean = sanitizeApiKey(secret);
	if (clean.problem) {
		dialog.note(`  ⚠ ${clean.problem}`);
		const retry = await dialog.ask("Re-enter the key (blank = continue keyless)", "");
		const retryClean = sanitizeApiKey(retry);
		if (retry && retryClean.problem) {
			dialog.note(`  ⚠ ${retryClean.problem} — continuing keyless`);
			return { note: "key rejected at entry (malformed) — keyless" };
		}
		if (!retryClean.key) return { note: "no key given — continuing keyless" };
		return { apiKeyInAuthJson: retryClean.key, note: "entered masked (after one retry)" };
	}
	return { apiKeyInAuthJson: clean.key, note: "entered masked" };
}

/**
 * Model step with LIVE discovery: probe the endpoint with the effective key,
 * then offer a numbered choice from what it actually serves. Falls back to a
 * plain typed ask when the endpoint cannot be probed (down, throttled, or a
 * keyless endpoint with no model list).
 */
interface ModelDecision {
	modelId: string;
	extraModelIds: string[];
	served?: string[];
	verified: SetupOutcome["verified"];
	note?: string;
	/** The live probe (the model-specs gate reuses its raw catalog entries
	 *  so detection never re-fetches /models). */
	probe?: EndpointProbe;
}

async function runModelStep(
	dialog: SetupDialog,
	baseUrl: string,
	preset: ProviderPreset,
	key: string | undefined,
	fallbackDefault: string,
): Promise<ModelDecision> {
	// BOTH wires have a /models probe now — the anthropic-messages wire
	// lists {root}/v1/models with x-api-key (the 2026-10-30 wire-aware
	// probe; the old Bearer probe made a valid Anthropic key invisible).
	const probe = await probeProviderEndpoint(baseUrl, key, { timeoutMs: 5000, api: preset.api });
	if (!probe.ok || !probe.models || probe.models.length === 0) {
		if (probe.ok) {
			const modelId = await dialog.ask("Model id (endpoint served no list — type one)", fallbackDefault);
			return { modelId, extraModelIds: [], verified: "ok", probe };
		}
		if (probe.problem === "rate-limit") {
			dialog.note(`  ⚠ ${rateLimitNote(probe)} — type the model id by hand.`);
			const modelId = await dialog.ask("Model id", fallbackDefault);
			return { modelId, extraModelIds: [], verified: "skipped", probe };
		}
		dialog.note(`  ⚠ could not reach ${baseUrl} for model discovery — type the id by hand.`);
		const modelId = await dialog.ask("Model id", fallbackDefault);
		return {
			modelId,
			extraModelIds: [],
			verified: probe.problem === "auth" ? "auth-rejected" : "unreachable",
			probe,
		};
	}
	const served = probe.models;
	const chatServed = served.filter(
		(m) =>
			m === fallbackDefault || !/embed|rerank|tts|whisper|guard|moderation|voice|audio|transcribe|caption/i.test(m),
	);
	const list = chatServed.length > 0 ? chatServed : served;
	const defaultIndex = Math.max(0, list.indexOf(fallbackDefault || list[0]));
	const idx = await dialog.choose(
		"Model (live list from the endpoint)",
		list.map((m) => (m === list[defaultIndex] ? `${m} (preset default)` : m)),
		defaultIndex,
	);
	const modelId = list[idx] ?? fallbackDefault;
	const extraModelIds = list.filter((m) => m !== modelId).slice(0, 24);
	return { modelId, extraModelIds, served, verified: "ok", probe };
}

// ---------------------------------------------------------------------------
// The model-specs gate step (the model-specs round)
// ---------------------------------------------------------------------------

interface SpecStepResult {
	/** The verified spec (absent when the escape hatch let it pass). */
	spec?: ModelSpecDetection;
	/** True when UNOWN_ALLOW_UNVERIFIED_SPECS let an unverified model through. */
	unverifiedAllowed?: boolean;
	/** True when the gate refused — nothing must be written. */
	abort?: true;
}

/**
 * The gate, one shared step for both lanes:
 *
 *   flags win        --context-window + --max-tokens are the user's own
 *                     answer (recorded with user provenance); a half pair
 *                     is a usage error, not a guess.
 *   then the cascade  resolveSpecGate: sidecar → hand-edited models.json
 *                     values → endpoint/curated/models.dev/LiteLLM.
 *   then the ask      interactive: the two numbers, validated, 3 tries each.
 *   then the escape   non-interactive only: UNOWN_ALLOW_UNVERIFIED_SPECS=1
 *                     proceeds LOUDLY unverified.
 *   else refuse       nothing is written; the remediation says exactly what
 *                     to type.
 */
async function runSpecGateStep(
	dialog: SetupDialog | null,
	input: { providerId: string; modelId: string; baseUrl?: string; apiKey?: string; api?: string },
	flags: { contextWindow?: number; maxTokens?: number },
	endpointCatalog?: { data?: unknown[] } & Record<string, unknown>,
): Promise<SpecStepResult> {
	const { providerId, modelId } = input;
	// 1. explicit flags — the user's own answer (both or neither; a half
	//    pair would silently guess the other number, which is what the
	//    gate exists to stop).
	if (flags.contextWindow !== undefined || flags.maxTokens !== undefined) {
		if (flags.contextWindow === undefined || flags.maxTokens === undefined) {
			console.error(
				`unown setup: --context-window and --max-tokens go together (only one was given) — ${specGateRemediation(providerId, modelId)}`,
			);
			return { abort: true };
		}
		const spec = recordUserSpec(UNOWN_AGENT_DIR, providerId, modelId, {
			contextWindow: flags.contextWindow,
			maxTokens: flags.maxTokens,
		});
		if (dialog) dialog.note(`  · specs recorded: ${formatSpecShort(spec)}`);
		return { spec };
	}
	// 2. the cascade.
	const gate = await resolveSpecGate(input, {
		agentDir: UNOWN_AGENT_DIR,
		...(endpointCatalog ? { endpointCatalog } : {}),
	});
	if (gate.status === "verified") {
		if (dialog) dialog.note(`  · specs verified: ${formatSpecShort(gate.spec)}`);
		return { spec: gate.spec };
	}
	// 3. unverified — interactive: ask (the wizard contract: ask BEFORE
	//    the config is written).
	if (dialog) {
		dialog.note(
			`  ⚠ no verifiable source for ${modelId}'s specs (tried: the endpoint's own /models, the curated catalog, models.dev, the LiteLLM database).`,
		);
		dialog.note(
			"  The context window and max output tokens drive auto-compaction and the reply cap — unown refuses to guess.",
		);
		const numbers = await askSpecNumbers(dialog, modelId);
		if (!numbers) {
			dialog.note("  ✗ could not get valid specs — nothing written.");
			return { abort: true };
		}
		const spec = recordUserSpec(UNOWN_AGENT_DIR, providerId, modelId, numbers);
		dialog.note(`  · specs recorded: ${formatSpecShort(spec)}`);
		return { spec };
	}
	// 4. non-interactive: the documented escape, or refuse.
	if (allowUnverifiedSpecs()) {
		console.log(
			"  · specs UNVERIFIED — proceeding because UNOWN_ALLOW_UNVERIFIED_SPECS=1 (compaction and the reply cap run on unown's defaults)",
		);
		return { unverifiedAllowed: true };
	}
	console.error(
		`unown setup: no verifiable source for ${modelId}'s specs — ${specGateRemediation(providerId, modelId)}`,
	);
	return { abort: true };
}

function specGateRemediation(providerId: string, modelId: string): string {
	return `re-run with --context-window <N> --max-tokens <K> (find them in the provider's model docs), or export UNOWN_ALLOW_UNVERIFIED_SPECS=1 to proceed unverified`;
}

/** A verified detection → the upsert's per-model spec shape (cost and the
 *  image modality ride along when a source provided them — new records get
 *  priced models.json entries, not just the two limits). */
function specToModelSpec(spec: ModelSpecDetection): {
	contextWindow: number;
	maxTokens: number;
	cost?: SpecCost;
	imageInput?: boolean;
} {
	return {
		contextWindow: spec.contextWindow!,
		maxTokens: spec.maxTokens!,
		...(spec.cost ? { cost: spec.cost } : {}),
		...(spec.input?.includes("image") ? { imageInput: true } : {}),
	};
}

/** Best-effort spec detection for the discovered extras (never asks — the
 *  bulk-discovery rule; undetected extras are gated at session start if they
 *  ever become active). Reuses the same /models catalog the discovery probe
 *  already fetched. */
async function detectExtraSpecs(
	input: { providerId: string; baseUrl?: string; apiKey?: string; api?: string },
	ids: string[],
	endpointCatalog?: { data?: unknown[] } & Record<string, unknown>,
): Promise<Record<string, { contextWindow: number; maxTokens: number; cost?: SpecCost; imageInput?: boolean }>> {
	const out: Record<string, { contextWindow: number; maxTokens: number; cost?: SpecCost; imageInput?: boolean }> = {};
	for (const id of ids.slice(0, 24)) {
		try {
			const r = await detectModelSpec(id, {
				providerId: input.providerId,
				...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
				...(input.apiKey ? { apiKey: input.apiKey } : {}),
				...(input.api ? { api: input.api } : {}),
				agentDir: UNOWN_AGENT_DIR,
				timeoutMs: 4000,
				stopWhenComplete: true,
				...(endpointCatalog ? { endpointCatalog } : {}),
			});
			if (isCompleteSpec(r.spec))
				out[id] = {
					contextWindow: r.spec!.contextWindow!,
					maxTokens: r.spec!.maxTokens!,
					...(r.spec!.cost ? { cost: r.spec!.cost } : {}),
					...(r.spec!.input?.includes("image") ? { imageInput: true } : {}),
				};
		} catch {
			/* best effort — an undetected extra is not an error */
		}
	}
	return out;
}

async function runBridgeSetup(
	flags: Partial<SetupFlags>,
	preset: ProviderPreset,
	dialog: SetupDialog | null,
	health?: BridgeHealth,
): Promise<number> {
	const h = health ?? (await bridgeHealth());
	console.log(`\nBundled llm-bridge: ${preset.baseUrl}`);
	console.log(
		h.snippet
			? `  status: ${h.snippet}`
			: "  status: not reachable right now (start the stack later: bun run agent:start)",
	);
	if (h.snippet && !h.keySet) {
		console.log("  ⚠ BRIDGE_UPSTREAM_KEY is not set in the repo's .env — chats will fail with 401 until you add it.");
	}
	let modelId = flags.model ?? preset.defaultModel;
	let servedModelIds: string[] = [];
	if (dialog && !flags.model) {
		if (h.models.length >= 2) {
			const defaultIndex = Math.max(0, h.models.indexOf(h.defaultModel || h.models[0]));
			const idx = await dialog.choose(
				"Model (the bridge serves these live)",
				h.models.map((m) => (m === h.models[defaultIndex] ? `${m} (bridge default)` : m)),
				defaultIndex,
			);
			modelId = h.models[idx] ?? preset.defaultModel;
		} else {
			modelId = await dialog.ask("Model to use", preset.defaultModel);
		}
		servedModelIds = h.models;
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
	const providerId = process.env.PI_PROVIDER || "zai-bridge";
	// The model-specs gate: the bridge's own /v1/models is the endpoint
	// lane's source (it passes upstream spec fields through when the
	// upstream publishes them); the curated agnes entries answer offline.
	const bridgeProbe = await probeProviderEndpoint(preset.baseUrl, apiKey, { timeoutMs: 3000, api: preset.api });
	const gate = await runSpecGateStep(
		dialog,
		{ providerId, modelId, baseUrl: preset.baseUrl, apiKey, api: preset.api },
		{ contextWindow: flags.contextWindow, maxTokens: flags.maxTokens },
		bridgeProbe.modelEntries ? { data: bridgeProbe.modelEntries } : undefined,
	);
	if (gate.abort) return 1;
	// Best-effort specs for the bridge's allow-list extras (the chosen
	// model's numbers never leak onto its siblings).
	const extras = bridgeKnownModels(modelId).slice(1);
	const extraSpecs = gate.spec
		? await detectExtraSpecs(
				{ providerId, baseUrl: preset.baseUrl, apiKey, api: preset.api },
				extras,
				bridgeProbe.modelEntries ? { data: bridgeProbe.modelEntries } : undefined,
			)
		: {};
	const modelSpecs = {
		...(gate.spec ? { [modelId]: specToModelSpec(gate.spec) } : {}),
		...extraSpecs,
	};
	writeAgentConfig({
		providerId,
		providerName: "unown llm-bridge",
		baseUrl: preset.baseUrl,
		api: preset.api,
		modelId,
		input: preset.input,
		apiKeyInModelsJson: apiKey,
		// Register every id the bridge serves (its allow-list) so the
		// catalog is routable (/model, --model, agent frontmatter).
		extraModelIds: extras,
		...(Object.keys(modelSpecs).length > 0 ? { modelSpecs } : {}),
		// --force RESETS (drops the other providers — the single-provider
		// escape hatch); without it the bridge merges in alongside them.
		...(flags.force ? { reset: true } : {}),
	});
	console.log(`\n✓ configured the bundled bridge (${modelId})`);
	if (dialog) {
		const theme = await runThemeStep(dialog);
		const file = readAgentModelsFile(UNOWN_AGENT_DIR);
		const kept = file.providers.map((p) => p.id).filter((id) => id !== "zai-bridge");
		printSetupSummary({
			providerId,
			providerName: "unown llm-bridge",
			baseUrl: preset.baseUrl,
			modelId,
			extraModels: servedModelIds.filter((m) => m !== modelId),
			keyDisposition: "bridge",
			theme,
			kept,
			verified: h.upstreamOk ? "ok" : "unreachable",
			served: h.models,
			...(gate.spec
				? { specLine: formatSpecShort(gate.spec) }
				: { specLine: "unverified (UNOWN_ALLOW_UNVERIFIED_SPECS=1)" }),
		});
	} else {
		console.log("  next: unown            # start a session");
		console.log("        unown doctor     # verify the whole path");
	}
	return 0;
}

async function runDirectSetup(
	flags: Partial<SetupFlags>,
	preset: ProviderPreset,
	dialog: SetupDialog | null,
): Promise<number> {
	let baseUrl = flags.baseUrl ?? preset.baseUrl;
	let modelId = flags.model ?? preset.defaultModel;
	let apiKey = flags.apiKey ?? "";
	let providerId = preset.id;
	// Filled by the interactive key step (keep-in-form / replace / clear).
	let keyDecision: KeyDecision | null = null;
	// Filled by the interactive model step (live discovery).
	let modelDecision: ModelDecision | null = null;
	if (dialog) {
		console.log(`\n${preset.label}`);
		console.log(`  endpoint: ${baseUrl}`);
		if (preset.id === "custom") {
			baseUrl = await dialog.ask("Endpoint base URL (OpenAI-compatible, usually ends in /v1)", preset.baseUrl);
			providerId = (await dialog.ask("Provider id (short name used in config files)", "custom-llm")) || "custom-llm";
		}
		// --- key step: existing-secret states, then masked entry ---
		if (!flags.apiKey) {
			keyDecision = await runKeyStep(dialog, preset, preset.id, providerId);
			if (keyDecision.cancelled) {
				console.log("\n✗ cancelled — nothing written. Re-run any time: unown setup");
				return 0;
			}
			apiKey =
				keyDecision.apiKeyInAuthJson ??
				keyDecision.apiKeyInModelsJson ??
				(keyDecision.apiKeyEnvRef ? (process.env[keyDecision.apiKeyEnvRef] ?? "") : "");
		}
		// --- model step: live discovery with the effective key ---
		const probeKey =
			keyDecision?.apiKeyInAuthJson ??
			keyDecision?.apiKeyInModelsJson ??
			(keyDecision?.apiKeyEnvRef ? (process.env[keyDecision.apiKeyEnvRef] ?? "") : undefined) ??
			(flags.apiKey || undefined) ??
			(flags.keyEnv ? process.env[flags.keyEnv] : undefined);
		const decision = await runModelStep(dialog, baseUrl, preset, probeKey, preset.defaultModel);
		modelDecision = decision;
		modelId = decision.modelId;
	}
	if (!baseUrl) {
		console.error("unown setup: no base URL (use --base-url)");
		return 1;
	}
	if (!modelId) {
		console.error("unown setup: no model id (use --model)");
		return 1;
	}
	// URL hygiene: trim paste whitespace + collapse any trailing slashes
	// ("https://x.com/v1/" and "https://x.com/v1" are the same endpoint).
	baseUrl = baseUrl.trim().replace(/\/+$/, "");
	// Flag-path keys get the same paste hygiene the wizard entry has
	// (scripts paste keys too — a trailing newline in --api-key used to
	// become a stored secret that 401s).
	if (apiKey) {
		const clean = sanitizeApiKey(apiKey);
		if (clean.problem) {
			console.error(`unown setup: ${clean.problem}`);
			return 1;
		}
		apiKey = clean.key;
	}
	if (!apiKey && !flags.apiKey && !keyDecision) {
		// Local servers (Ollama, llama.cpp, vLLM) may be keyless — allow it,
		// but say so.
		console.log("  · no API key given — continuing keyless (fine for local servers)");
	}
	// --- the model-specs gate (ask BEFORE the config is written) ---
	// Interactive: the model step's own /models fetch is reused. The
	// non-interactive lane lets the cascade fetch the endpoint itself.
	const gateKey =
		keyDecision?.apiKeyInAuthJson ??
		keyDecision?.apiKeyInModelsJson ??
		(keyDecision?.apiKeyEnvRef ? (process.env[keyDecision.apiKeyEnvRef] ?? "") : undefined) ??
		(apiKey || undefined) ??
		(flags.keyEnv ? process.env[flags.keyEnv] : undefined);
	const gate = await runSpecGateStep(
		dialog,
		{ providerId, modelId, baseUrl, apiKey: gateKey, api: preset.api },
		{ contextWindow: flags.contextWindow, maxTokens: flags.maxTokens },
		modelDecision?.probe?.modelEntries ? { data: modelDecision.probe.modelEntries } : undefined,
	);
	if (gate.abort) return 1;
	// Best-effort specs for the discovered extras (the chosen model's
	// numbers must not leak onto its siblings — a heterogeneous catalog
	// has different limits per id).
	const extraIds = dialog && modelDecision?.extraModelIds?.length ? modelDecision.extraModelIds : [];
	const extraSpecs = gate.spec
		? await detectExtraSpecs(
				{ providerId, baseUrl, apiKey: gateKey, api: preset.api },
				extraIds,
				modelDecision?.probe?.modelEntries ? { data: modelDecision.probe.modelEntries } : undefined,
			)
		: {};
	const modelSpecs = {
		...(gate.spec ? { [modelId]: specToModelSpec(gate.spec) } : {}),
		...extraSpecs,
	};
	const specLine = gate.spec ? formatSpecShort(gate.spec) : "unverified (UNOWN_ALLOW_UNVERIFIED_SPECS=1)";
	writeAgentConfig({
		providerId,
		providerName: preset.id === "custom" ? providerId : preset.label.split(" (")[0],
		baseUrl,
		api: preset.api,
		modelId,
		input: preset.input,
		...(dialog && keyDecision
			? {
					...(keyDecision.apiKeyInAuthJson ? { apiKeyInAuthJson: keyDecision.apiKeyInAuthJson } : {}),
					...(keyDecision.apiKeyInModelsJson ? { apiKeyInModelsJson: keyDecision.apiKeyInModelsJson } : {}),
					...(keyDecision.apiKeyEnvRef ? { apiKeyEnvRef: keyDecision.apiKeyEnvRef } : {}),
				}
			: {
					...(apiKey ? { apiKeyInAuthJson: apiKey } : {}),
					...(flags.keyEnv ? { apiKeyEnvRef: flags.keyEnv } : {}),
				}),
		// The discovered catalog registers alongside the chosen model so
		// /model and --model can route without a manual models.json edit
		// (the bridge preset has done exactly this since M4).
		...(dialog && modelDecision?.extraModelIds?.length ? { extraModelIds: modelDecision.extraModelIds } : {}),
		...(Object.keys(modelSpecs).length > 0 ? { modelSpecs } : {}),
		...(flags.force ? { reset: true } : {}),
	});
	// Verify reachability (best effort, non-fatal). With --key-env, probe
	// with the CURRENT env value so verification works without storing it.
	const verifyKey =
		keyDecision?.apiKeyInAuthJson ??
		keyDecision?.apiKeyInModelsJson ??
		(keyDecision?.apiKeyEnvRef ? (process.env[keyDecision.apiKeyEnvRef] ?? "") : undefined) ??
		(apiKey || undefined) ??
		(flags.keyEnv ? process.env[flags.keyEnv] : undefined);
	const probe = await probeProviderEndpoint(baseUrl, verifyKey, { timeoutMs: 4000, api: preset.api });
	let verified: SetupOutcome["verified"] = "unreachable";
	if (probe.ok) {
		verified = "ok";
		const list =
			probe.models && probe.models.length > 0
				? ` — serves ${probe.models.slice(0, 6).join(", ")}${probe.models.length > 6 ? " …" : ""}`
				: "";
		console.log(`\n✓ configured ${providerId} → ${baseUrl}`);
		console.log(`  endpoint reachable${list}`);
	} else if (probe.problem === "auth") {
		verified = "auth-rejected";
		console.log(`\n✓ wrote the configuration, but the endpoint rejected the key (HTTP ${probe.status}).`);
		console.log("  double-check the API key, then re-run: unown setup");
		if (dialog) {
			const file2 = readAgentModelsFile(UNOWN_AGENT_DIR);
			printSetupSummary({
				providerId,
				providerName: preset.label.split(" (")[0],
				baseUrl,
				modelId,
				extraModels: modelDecision?.extraModelIds,
				keyDisposition: keyDecision?.apiKeyInAuthJson
					? "auth-json"
					: keyDecision?.apiKeyInModelsJson
						? "models-json"
						: keyDecision?.apiKeyEnvRef
							? "env-ref"
							: keyDecision?.cleared
								? "keyless"
								: "keyless",
				keyNote: keyDecision?.note,
				kept: file2.providers.map((p) => p.id).filter((id) => id !== providerId),
				verified,
				specLine,
			});
		}
		return 1;
	} else if (probe.problem === "rate-limit") {
		verified = "ok";
		console.log(`\n✓ configured ${providerId} → ${baseUrl}`);
		console.log(`  endpoint reachable but ${rateLimitNote(probe)}.`);
	} else {
		console.log(`\n✓ wrote the configuration, but could not reach ${baseUrl}.`);
		console.log("  start the endpoint (or point --base-url elsewhere) and re-run: unown setup");
	}
	if (dialog) {
		const theme = await runThemeStep(dialog);
		const file2 = readAgentModelsFile(UNOWN_AGENT_DIR);
		printSetupSummary({
			providerId,
			providerName: preset.label.split(" (")[0],
			baseUrl,
			modelId,
			extraModels: modelDecision?.extraModelIds,
			keyDisposition: keyDecision?.apiKeyInAuthJson
				? "auth-json"
				: keyDecision?.apiKeyInModelsJson
					? "models-json"
					: keyDecision?.apiKeyEnvRef
						? "env-ref"
						: flags.apiKey
							? "auth-json"
							: "keyless",
			keyNote: keyDecision?.note,
			theme,
			kept: file2.providers.map((p) => p.id).filter((id) => id !== providerId),
			verified,
			served: probe.models,
			specLine,
		});
	} else {
		console.log("  next: unown            # start a session");
		console.log("        unown doctor     # verify the whole path");
	}
	return 0;
}

async function runInteractiveSetup(): Promise<number> {
	const dialog = createTerminalDialog();
	try {
		const file = readAgentModelsFile(UNOWN_AGENT_DIR);
		if (file.providers.length > 0) {
			const active = resolveActiveProvider(UNOWN_AGENT_DIR);
			console.log(
				`Current configuration: ${active?.id ?? file.providers[0]?.id} → ${active?.baseUrl ?? "?"} (${active?.modelIds.join(", ") ?? "?"})`,
			);
			console.log(`Files: ${join(UNOWN_AGENT_DIR, "models.json")}\n`);
		} else {
			console.log("No provider connected yet — let's fix that.\n");
		}
		// The recommendation marker: ONE fetch of bridge /health decides
		// whether the bundled stack earns the "recommended" tag (Hermes's
		// Quick Setup slot — the zero-key path when the stack is up).
		const health = await bridgeHealth();
		const bridgeRecommended = health.upstreamOk && health.keySet;
		// dialog.choose owns the numbered-list contract: blank/invalid
		// input falls back to the default instead of the old manual
		// parseInt, where a non-integer ("abc" → NaN → `(NaN || 1)`)
		// silently selected preset 1.
		const options = PRESETS.map(
			(p) =>
				p.label +
				(p.id === "bridge" && bridgeRecommended
					? "  ← recommended (your bundled stack is up, key set — zero extra keys)"
					: ""),
		);
		options.push("Keep the current configuration");
		const idx = await dialog.choose("What should unown talk to?", options, 0);
		if (idx === PRESETS.length) {
			console.log("Keeping the current configuration — nothing written.");
			return 0;
		}
		const preset = PRESETS[idx];
		if (!preset) {
			console.error(`unown setup: invalid choice`);
			return 1;
		}
		if (existsSync(join(UNOWN_AGENT_DIR, "models.json"))) {
			const others = file.providers.map((p) => p.id).filter((id) => id !== "zai-bridge");
			if (others.length > 0) {
				console.log(`\nExisting providers are KEPT (added alongside): ${others.join(", ")}`);
			}
		}
		return preset.id === "bridge" ? runBridgeSetup({}, preset, dialog, health) : runDirectSetup({}, preset, dialog);
	} finally {
		// nothing to close — the dialog restores the terminal per prompt
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
				console.log(
					`  ⚠ --force RESETS ~/.unown/agent/models.json to just ${preset.id} — drops: ${others.join(", ")}`,
				);
			}
		}
	}
	return preset.id === "bridge" ? runBridgeSetup(flags, preset, null) : runDirectSetup(flags, preset, null);
}

// ---------------------------------------------------------------------------
// unown models verify — the explicit detection pass (the model-specs round)
// ---------------------------------------------------------------------------

export interface ModelsVerifyFlags {
	provider?: string;
	model?: string;
	json: boolean;
}

export const MODELS_VERIFY_USAGE = `unown models verify — re-run spec detection for the registered models

usage: unown models verify [--provider P] [--model M] [--json]
  --provider P   verify only this provider's models
  --model M      verify only this model id (with --provider, or matched anywhere)
  --json         machine-readable verdicts (one JSON object)

For every registered model: the shared spec gate runs (the sidecar record,
your hand-edited models.json values, then the detection cascade — the
endpoint's own /models, the curated catalog, models.dev, the LiteLLM
database), recording provenance and healing models.json where a verifiable
source answers. A loopback bridge provider's LEARNED specs (context limits
its upstream 400s revealed) are recorded with learned provenance.

Exits 1 when any model stays unverified — the remediation prints per model.
`;

/** Parse the verify flags (unknown flags error, clig.dev). */
export function parseModelsVerifyFlags(args: string[]): { flags: ModelsVerifyFlags; help: boolean; unknown: string[] } {
	const flags: ModelsVerifyFlags = { json: false };
	const unknown: string[] = [];
	let help = false;
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		const next = args[i + 1];
		if (a === "--json") flags.json = true;
		else if (a === "-h" || a === "--help") help = true;
		else if (a === "--provider" && next) {
			flags.provider = next;
			i++;
		} else if (a === "--model" && next) {
			flags.model = next;
			i++;
		} else unknown.push(a);
	}
	return { flags, help, unknown };
}

/** One verify verdict row (the --json shape and the human line render from it). */
export interface ModelsVerifyRow {
	provider: string;
	model: string;
	status: "verified" | "unverified";
	/** The spec that settled it (verified rows). */
	specLine?: string;
	/** What changed while verifying: healed/recorded/learned notes. */
	notes: string[];
	/** The remediation (unverified rows). */
	remediation?: string;
}

/** A learned spec from the bridge's /health, recorded with learned provenance. */
function learnedDetection(learned: { contextWindow?: number; maxTokens?: number }): ModelSpecDetection {
	return {
		...(learned.contextWindow !== undefined ? { contextWindow: learned.contextWindow } : {}),
		...(learned.maxTokens !== undefined ? { maxTokens: learned.maxTokens } : {}),
		source: "learned",
		match: "exact",
		contributors: [
			{
				source: "learned",
				fields: [
					...(learned.contextWindow !== undefined ? ["contextWindow"] : []),
					...(learned.maxTokens !== undefined ? ["maxTokens"] : []),
				],
				match: "exact",
			},
		],
	};
}

/** The bridge's learned specs (loopback providers only, best effort). */
async function bridgeLearnedSpecs(
	baseUrl: string,
): Promise<Record<string, { contextWindow?: number; maxTokens?: number }>> {
	try {
		const health = new URL("/health", baseUrl).toString();
		const res = await fetch(health, { signal: AbortSignal.timeout(3000) });
		if (!res.ok) return {};
		const body = (await res.json()) as {
			learnedSpecs?: Record<string, { contextWindow?: number; maxTokens?: number }>;
		};
		return body.learnedSpecs ?? {};
	} catch {
		return {};
	}
}

/**
 * Run the shared spec gate for the registered models and report the verdicts.
 * NEVER asks (the ask lives in setup / the session preflight) — this is the
 * explicit "go verify" pass: detect, record provenance, heal models.json,
 * absorb the bridge's learned limits. Returns the rows and whether all
 * models ended verified.
 */
export async function runModelsVerify(
	flags: ModelsVerifyFlags,
): Promise<{ rows: ModelsVerifyRow[]; allVerified: boolean }> {
	const file = readAgentModelsFile(UNOWN_AGENT_DIR);
	const rawProviders = (() => {
		try {
			return JSON.parse(readFileSync(join(UNOWN_AGENT_DIR, "models.json"), "utf8")) as {
				providers?: Record<string, { models?: Array<Record<string, unknown>> }>;
			};
		} catch {
			return {} as { providers?: Record<string, { models?: Array<Record<string, unknown>> }> };
		}
	})();
	const rows: ModelsVerifyRow[] = [];
	for (const p of file.providers) {
		if (flags.provider && p.id !== flags.provider) continue;
		const models = flags.model ? p.modelIds.filter((m) => m === flags.model) : p.modelIds;
		if (models.length === 0) continue;
		const key = resolveProviderKey(UNOWN_AGENT_DIR, p.id).key;
		const rawModels = rawProviders.providers?.[p.id]?.models ?? [];
		const learned = p.baseUrl && isLoopbackProvider(p) ? await bridgeLearnedSpecs(p.baseUrl) : {};
		const probe = p.baseUrl
			? await probeProviderEndpoint(p.baseUrl, key, { timeoutMs: 5000, api: p.api })
			: undefined;
		for (const model of models) {
			const current = rawModels.find((m) => m?.id === model) as
				| { contextWindow?: number; maxTokens?: number }
				| undefined;
			const gate = await resolveSpecGate(
				{
					providerId: p.id,
					modelId: model,
					...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
					...(key ? { apiKey: key } : {}),
					...(p.api ? { api: p.api } : {}),
					...(current?.contextWindow !== undefined && current?.maxTokens !== undefined
						? { current: { contextWindow: current.contextWindow, maxTokens: current.maxTokens } }
						: {}),
				},
				{
					agentDir: UNOWN_AGENT_DIR,
					...(probe?.modelEntries ? { endpointCatalog: { data: probe.modelEntries } } : {}),
				},
			);
			if (gate.status === "verified") {
				rows.push({
					provider: p.id,
					model,
					status: "verified",
					specLine: formatSpecLine(gate.spec),
					notes: [
						...(gate.healed ? ["healed models.json"] : []),
						...(gate.recorded ? ["recorded provenance"] : []),
					],
				});
				continue;
			}
			// The bridge's learned limits — an upstream 400 already told us the
			// real context. Recorded with learned provenance; still unverified
			// when the output cap is missing (the gate stays honest).
			const note = `tried: ${gate.attempts.map((a) => `${a.source} (${a.outcome})`).join(", ")}`;
			const learnedRow = learned[model];
			const learnedNotes: string[] = [];
			if (learnedRow && (learnedRow.contextWindow !== undefined || learnedRow.maxTokens !== undefined)) {
				const spec = learnedDetection(learnedRow);
				recordSpec(UNOWN_AGENT_DIR, p.id, model, spec);
				const applied = applyModelSpecs(UNOWN_AGENT_DIR, p.id, {
					[model]: {
						contextWindow: spec.contextWindow ?? current?.contextWindow ?? modelSpec(model).contextWindow,
						maxTokens: spec.maxTokens ?? current?.maxTokens ?? modelSpec(model).maxTokens,
					},
				});
				learnedNotes.push(
					`learned from an upstream 400: ${learnedRow.contextWindow?.toLocaleString("en-US") ?? "?"} ctx`,
				);
				if (applied.length > 0) learnedNotes.push("healed models.json");
				if (isCompleteSpec(spec)) {
					rows.push({
						provider: p.id,
						model,
						status: "verified",
						specLine: formatSpecLine(spec),
						notes: learnedNotes,
					});
					continue;
				}
			}
			rows.push({
				provider: p.id,
				model,
				status: "unverified",
				notes: [...learnedNotes, note].filter(Boolean),
				remediation: `unown setup --provider ${p.id} --model ${model} --context-window <N> --max-tokens <K> — or export UNOWN_ALLOW_UNVERIFIED_SPECS=1`,
			});
		}
	}
	return { rows, allVerified: rows.length > 0 && rows.every((r) => r.status === "verified") };
}

/** Entry point for `unown models verify [flags]`. Returns the process exit code. */
export async function cmdModelsVerify(args: string[]): Promise<number> {
	const { flags, help, unknown } = parseModelsVerifyFlags(args);
	if (help) {
		console.log(MODELS_VERIFY_USAGE);
		return 0;
	}
	if (unknown.length) {
		console.error(`unown models verify: unknown argument(s): ${unknown.join(" ")}`);
		console.error(MODELS_VERIFY_USAGE);
		return 1;
	}
	const { rows, allVerified } = await runModelsVerify(flags);
	if (rows.length === 0) {
		console.log(
			flags.provider || flags.model
				? "No registered models match the filter."
				: "No provider configured yet — run: unown setup",
		);
		return flags.provider || flags.model ? 1 : 0;
	}
	if (flags.json) {
		console.log(JSON.stringify({ allVerified, rows }, null, 2));
	} else {
		for (const r of rows) {
			const where = `${r.provider}/${r.model}`;
			if (r.status === "verified") {
				const notes = r.notes.length > 0 ? ` (${r.notes.join("; ")})` : "";
				console.log(`  ✓ ${where} — ${r.specLine}${notes}`);
			} else {
				console.log(`  ? ${where} — unverified${r.notes.length > 0 ? ` (${r.notes.join("; ")})` : ""}`);
				if (r.remediation) console.log(`      ${r.remediation}`);
			}
		}
		console.log(
			allVerified
				? `\nAll ${rows.length} model spec${rows.length === 1 ? "" : "s"} verified.`
				: `\n${rows.filter((r) => r.status === "unverified").length} model spec${rows.filter((r) => r.status === "unverified").length === 1 ? "" : "s"} unverified — the session preflight will ask before they are used.`,
		);
	}
	return allVerified ? 0 : 1;
}
