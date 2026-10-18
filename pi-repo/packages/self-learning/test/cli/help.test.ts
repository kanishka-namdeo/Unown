// CLI dispatch tests for the clig.dev help-surface fixes (D4 audit):
//   - `unown help` / `unown help <command>` — help is a COMMAND (the word used
//     to fall through to the generic parser and start a TUI with "help" as
//     the prompt);
//   - `unown doctor --help` / `info --help` / `setup --help` — --help prints
//     usage instead of RUNNING the command (diagnostics used to execute);
//   - `unown setup --bogus` — unknown flags ERROR with usage (they used to be
//     silently dropped and the wizard launched anyway);
//   - completions carry --goal in the session flags (drift fix).
// Same hermetic harness as golden.test.ts: the real bin, private
// UNOWN_HOME, dead engine URL, mock bridge.
import "../_env.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startMockBridge, sweepTestRoots, unown, type UnownRunOptions } from "./helpers.ts";

let bridge: ReturnType<typeof startMockBridge>;
const base = (extra: Partial<UnownRunOptions> = {}): UnownRunOptions => ({ bridge, ...extra });

beforeAll(() => {
        bridge = startMockBridge({ label: "cli-help" });
});
afterAll(() => {
        bridge?.close();
        sweepTestRoots();
});

describe("clig.dev help surface — `unown help`", () => {
	test("`unown help` prints the main help and exits 0 (not a TUI prompt)", async () => {
		const run = await unown(["help"], base());
		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain("unown — a self-improving terminal coding agent");
		expect(run.stdout).toContain("Usage:");
	});

	test("`unown help` lists the session surface (lsp tool, 14 commands, kill-switches — drift guard)", async () => {
		const run = await unown(["help"], base());
		expect(run.exitCode).toBe(0);
		// the session-tools line carries the lsp tool (R-D A1)
		expect(run.stdout).toContain("todo / note / task / fetch_url / lsp");
		// every unown session command is advertised (R-D A1)
		for (const cmd of [
			"/plan",
			"/todos",
			"/note",
			"/agents",
			"/learning",
			"/lsp",
			"/checkpoint",
			"/undo",
			"/restore",
			"/checkpoints",
			"/receipts",
			"/mcp",
			"/goal",
			"/review",
		]) {
			expect(run.stdout).toContain(cmd);
		}
		// the feature kill-switches are in the Environment section (R-D A2)
		expect(run.stdout).toContain("UNOWN_LSP=0");
		expect(run.stdout).toContain("UNOWN_MCP=0");
	});

	test(
		"`unown help doctor|info|update|uninstall|completions|setup` each print their own page",
		async () => {
		for (const [topic, marker] of [
			["doctor", "usage: unown doctor"],
			["info", "usage: unown info"],
			["update", "unown update — check for a newer release"],
			["uninstall", "unown uninstall — remove the unown CLI"],
			["completions", "unown completions <shell>"],
			["setup", "usage: unown setup"],
		] as const) {
			const run = await unown(["help", topic], base());
			expect(run.exitCode).toBe(0);
			expect(run.stdout).toContain(marker);
		}
	},
		// six spawned CLI runs take ~5.4s on the Windows runner — over bun's
		// default 5s test timeout (killed mid-loop there); match golden.test.ts.
		{ timeout: 60_000 },
	);

	test("`unown help <unknown>` exits 1 and suggests `unown --help`", async () => {
		const run = await unown(["help", "definitely-not-a-command"], base());
		expect(run.exitCode).toBe(1);
		expect(run.stderr).toContain('unknown command "definitely-not-a-command"');
		expect(run.stderr).toContain("unown --help");
	});
});

describe("clig.dev help surface — `--help` never RUNS the command", () => {
	test("`unown doctor --help` prints usage, diagnostics never execute", async () => {
		const run = await unown(["doctor", "--help"], base());
		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain("usage: unown doctor");
		expect(run.stdout).not.toContain("agent dir"); // a diagnostics-run marker
	});

	test("`unown info --help` prints usage, no support bundle is gathered", async () => {
		const run = await unown(["info", "--help"], base());
		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain("usage: unown info");
	});

	test("`unown setup --help` prints usage, the wizard never launches", async () => {
		const run = await unown(["setup", "--help"], base());
		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain("usage: unown setup");
		expect(run.stdout).toContain("--provider P");
	});
});

describe("clig.dev — setup unknown flags are ERRORS", () => {
	test("`unown setup --bogus` exits 1 with usage, not a silent wizard", async () => {
		const run = await unown(["setup", "--bogus"], base());
		expect(run.exitCode).toBe(1);
		expect(run.stderr).toContain("unknown argument");
		expect(run.stderr).toContain("usage: unown setup");
	});
});

describe("completions drift — session flags carry --goal", () => {
	test("bash completions include --goal in the session flags", async () => {
		const run = await unown(["completions", "bash"], base());
		expect(run.exitCode).toBe(0);
		expect(run.stdout).toContain("--goal");
	});
});
