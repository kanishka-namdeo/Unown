// CLI golden tests — the model-specs gate (the model-specs round).
//
// End to end through the REAL bin/unown with a private UNOWN_HOME, the local
// mock bridge as the provider endpoint, and the spec registries pointed at a
// dead loopback port (no real network — the cascade marks them unreachable
// and the gate's verdict comes from the curated catalog / the endpoint / the
// flags / the escape hatch, exactly the lanes under test).
//
// What is pinned here:
//   1. `unown setup` non-interactive with an UNKNOWN model and no specs
//      anywhere → exit 1, the remediation names --context-window/--max-tokens
//      (nothing written — the gate fires before the config)
//   2. the same command WITH the two flags → exit 0; models.json carries the
//      user's numbers; the sidecar records them with user provenance
//   3. a half flag pair is a usage error, not a guess
//   4. a CURATED model id → exit 0; the sidecar records the curated source
//   5. UNOWN_ALLOW_UNVERIFIED_SPECS=1 → exit 0, the loud unverified note
//   6. print-mode session preflight: an unverified default model → exit 1
//      with the remediation (the gate is real)
//   7. the preflight SELF-HEALS: an unknown model with a models.dev record
//      (local mock) → verified, models.json healed, the session runs
//   8. the escape hatch lets the unverified session run
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type MockBridge, runUnown, startMockBridge, sweepTestRoots } from "./helpers.ts";

const LONG = { timeout: 150_000 } as const; // spawned CLI runs take seconds
const DEAD_REGISTRIES = {
	UNOWN_SPEC_MODELSDEV_URL: "http://127.0.0.1:9/api.json",
	UNOWN_SPEC_LITELLM_URL: "http://127.0.0.1:9/db.json",
};

let bridge: MockBridge;
/** A local models.dev mock for the self-heal lane. */
let registry: { port: number; stop: () => void };

beforeAll(() => {
	bridge = startMockBridge();
	const server = Bun.serve({
		port: 0,
		fetch() {
			// The REAL models.dev api.json shape: providers → models → entry.
			return Response.json({
				"the-lab": {
					models: {
						"lab-7b": { limit: { context: 262144, output: 32768 } },
					},
				},
			});
		},
	});
	registry = { port: server.port, stop: () => server.stop(true) };
});

afterAll(() => {
	bridge?.close();
	registry?.stop();
	sweepTestRoots();
});

const base = (extra: Record<string, string> = {}) => ({
	bridge,
	env: { ...DEAD_REGISTRIES, ...extra },
});

function readModelsJson(run: { unownHome: string }): any {
	return JSON.parse(readFileSync(join(run.unownHome, "agent", "models.json"), "utf8"));
}

// ---------------------------------------------------------------------------
// unown setup — the non-interactive gate
// ---------------------------------------------------------------------------
describe("CLI golden — the setup model-specs gate", () => {
	test(
		"unknown model, nothing verifiable → exit 1 with the flag remediation",
		async () => {
			const run = await runUnown(
				["setup", "--provider", "custom", "--base-url", `${bridge.url}/v1`, "--model", "mystery-7b", "--api-key", "k-1"],
				base(),
			);
			try {
				expect(run.exitCode).toBe(1);
				expect(run.stderr).toContain("no verifiable source");
				expect(run.stderr).toContain("--context-window");
				expect(run.stderr).toContain("--max-tokens");
				expect(run.stderr).toContain("UNOWN_ALLOW_UNVERIFIED_SPECS=1");
				// nothing was written — the gate fires BEFORE the config
				expect(existsSync(join(run.unownHome, "agent", "models.json"))).toBe(false);
			} finally {
				run.release();
			}
		},
		LONG,
	);

	test(
		"the two flags are the user's answer → exit 0, numbers stamped + recorded",
		async () => {
			const run = await runUnown(
				[
					"setup",
					"--provider",
					"custom",
					"--base-url",
					`${bridge.url}/v1`,
					"--model",
					"mystery-7b",
					"--api-key",
					"k-1",
					"--context-window",
					"200000",
					"--max-tokens",
					"16384",
				],
				base(),
			);
			try {
				expect(run.exitCode).toBe(0);
				const models = readModelsJson(run);
				const m = models.providers.custom.models.find((x: any) => x.id === "mystery-7b");
				expect(m.contextWindow).toBe(200000);
				expect(m.maxTokens).toBe(16384);
				const sidecar = JSON.parse(readFileSync(join(run.unownHome, "agent", "model-specs.json"), "utf8"));
				expect(sidecar.specs["custom/mystery-7b"].source).toBe("user");
				expect(sidecar.specs["custom/mystery-7b"].contextWindow).toBe(200000);
			} finally {
				run.release();
			}
		},
		LONG,
	);

	test(
		"a half flag pair is a usage error, not a guess",
		async () => {
			const run = await runUnown(
				[
					"setup",
					"--provider",
					"custom",
					"--base-url",
					`${bridge.url}/v1`,
					"--model",
					"mystery-7b",
					"--context-window",
					"200000",
				],
				base(),
			);
			try {
				expect(run.exitCode).toBe(1);
				expect(run.stderr).toContain("go together");
				expect(existsSync(join(run.unownHome, "agent", "models.json"))).toBe(false);
			} finally {
				run.release();
			}
		},
		LONG,
	);

	test(
		"a curated model id verifies offline → exit 0 with curated provenance",
		async () => {
			const run = await runUnown(
				["setup", "--provider", "custom", "--base-url", `${bridge.url}/v1`, "--model", "agnes-3.0-flash", "--api-key", "k-1"],
				base(),
			);
			try {
				expect(run.exitCode).toBe(0);
				const sidecar = JSON.parse(readFileSync(join(run.unownHome, "agent", "model-specs.json"), "utf8"));
				expect(sidecar.specs["custom/agnes-3.0-flash"].source).toBe("curated");
				expect(sidecar.specs["custom/agnes-3.0-flash"].contextWindow).toBe(524288);
				const models = readModelsJson(run);
				const m = models.providers.custom.models.find((x: any) => x.id === "agnes-3.0-flash");
				expect(m.contextWindow).toBe(524288);
				expect(m.maxTokens).toBe(65536);
			} finally {
				run.release();
			}
		},
		LONG,
	);

	test(
		"UNOWN_ALLOW_UNVERIFIED_SPECS=1 proceeds loudly unverified",
		async () => {
			const run = await runUnown(
				["setup", "--provider", "custom", "--base-url", `${bridge.url}/v1`, "--model", "mystery-7b", "--api-key", "k-1"],
				base({ UNOWN_ALLOW_UNVERIFIED_SPECS: "1" }),
			);
			try {
				expect(run.exitCode).toBe(0);
				expect(run.stdout).toContain("UNVERIFIED");
				// no sidecar record for the model — it stays honestly unverified
				const sidecarPath = join(run.unownHome, "agent", "model-specs.json");
				if (existsSync(sidecarPath)) {
					const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8"));
					expect(sidecar.specs["custom/mystery-7b"]).toBeUndefined();
				}
			} finally {
				run.release();
			}
		},
		LONG,
	);
});

// ---------------------------------------------------------------------------
// unown -p — the session-preflight gate
// ---------------------------------------------------------------------------
describe("CLI golden — the session-preflight spec gate", () => {
	/** A private root with a hand-seeded registry: the given default model on
	 *  a reachable, spec-less endpoint (the mock bridge), carrying the
	 *  historical 131072/8192 guess stamp — the pre-round state. */
	const seededRoot = (modelId: string): string => {
		const root = mkdtempSync(join(tmpdir(), "unown-spec-gate-"));
		const agentDir = join(root, "home", "agent");
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(
			join(agentDir, "models.json"),
			JSON.stringify(
				{
					providers: {
						"custom-llm": {
							name: "Custom LLM",
							baseUrl: `${bridge.url}/v1`,
							api: "openai-completions",
							apiKey: "bridge-local",
							models: [{ id: modelId, name: `${modelId} (via unown)`, contextWindow: 131072, maxTokens: 8192, input: ["text"] }],
						},
					},
				},
				null,
				2,
			) + "\n",
		);
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "custom-llm", defaultModel: modelId }, null, 2) + "\n");
		return root;
	};

	test(
		"an unverified default model aborts the print session with the remediation",
		async () => {
			const run = await runUnown(["-p", "say hi"], { ...base(), root: seededRoot("mystery-7b") });
			try {
				expect(run.exitCode).toBe(1);
				expect(run.stderr).toContain("no verifiable specs");
				expect(run.stderr).toContain("--context-window");
				expect(run.stderr).toContain("UNOWN_ALLOW_UNVERIFIED_SPECS=1");
			} finally {
				run.release();
				rmSync(run.root, { recursive: true, force: true });
			}
		},
		LONG,
	);

	test(
		"the preflight SELF-HEALS from models.dev (local mock) and the session runs",
		async () => {
			const env = {
				...DEAD_REGISTRIES,
				UNOWN_SPEC_MODELSDEV_URL: `http://127.0.0.1:${registry.port}/api.json`,
			};
			const run = await runUnown(["-p", "say hi"], { bridge, env, root: seededRoot("lab-7b") });
			try {
				expect(run.exitCode).toBe(0);
				// the self-heal note says where the numbers came from
				expect(run.stderr).toContain("model specs for custom-llm/lab-7b verified");
				// models.json healed: the guess stamp replaced by the registry numbers
				const healed = readModelsJson(run);
				expect(healed.providers["custom-llm"].models[0].contextWindow).toBe(262144);
				expect(healed.providers["custom-llm"].models[0].maxTokens).toBe(32768);
				// the sidecar carries the provenance
				const sidecar = JSON.parse(readFileSync(join(run.unownHome, "agent", "model-specs.json"), "utf8"));
				expect(sidecar.specs["custom-llm/lab-7b"].source).toBe("models-dev");
			} finally {
				run.release();
				rmSync(run.root, { recursive: true, force: true });
			}
		},
		LONG,
	);

	test(
		"UNOWN_ALLOW_UNVERIFIED_SPECS=1 lets the unverified session run",
		async () => {
			const run = await runUnown(["-p", "say hi"], {
				bridge,
				env: { ...DEAD_REGISTRIES, UNOWN_ALLOW_UNVERIFIED_SPECS: "1" },
				root: seededRoot("mystery-7b"),
			});
			try {
				expect(run.exitCode).toBe(0);
				expect(run.stdout.length).toBeGreaterThan(0);
			} finally {
				run.release();
				rmSync(run.root, { recursive: true, force: true });
			}
		},
		LONG,
	);
});
