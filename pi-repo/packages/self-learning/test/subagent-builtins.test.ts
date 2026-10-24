// Unit tests for src/subagent-builtins.ts — the role-specialized builtin
// agents (pi-cciotti port): shape contracts the task tool + catalog depend on.
//
// Pure module: no pi imports, no engine store.
import { describe, expect, test } from "bun:test";
import { ROLE_BUILTIN_AGENTS } from "../src/subagent-builtins.ts";
import { isBlockedReply, renderAdvertisedCatalog } from "../src/subagent-catalog.ts";

describe("ROLE_BUILTIN_AGENTS", () => {
	test("the expected five roles ship with unique names", () => {
		const names = ROLE_BUILTIN_AGENTS.map((a) => a.name).sort();
		expect(names).toEqual(["browser", "planner", "reviewer", "scout", "worker"]);
	});
	test("every agent carries name + description + systemPrompt + built-in source", () => {
		for (const agent of ROLE_BUILTIN_AGENTS) {
			expect(agent.name.length).toBeGreaterThan(2);
			expect(agent.description.length).toBeGreaterThan(40);
			expect(agent.systemPrompt.length).toBeGreaterThan(200);
			expect(agent.source).toBe("built-in");
		}
	});
	test("worker: completion guard ON by default + a fallback chain", () => {
		const worker = ROLE_BUILTIN_AGENTS.find((a) => a.name === "worker")!;
		expect(worker.completionGuard).toBe(true);
		expect(worker.fallbackModels).toBeDefined();
		expect(worker.fallbackModels!.length).toBeGreaterThan(0);
	});
	test("scout: read-only toolset + minimal overhead (low effort, no MCP, no AGENTS.md, no model override — resolves the session default)", () => {
		const scout = ROLE_BUILTIN_AGENTS.find((a) => a.name === "scout")!;
		expect(scout.tools).toEqual(["read", "grep", "find", "ls"]);
		expect(scout.model).toBeUndefined(); // no model override — the child resolves the session default (the qwen hardcode died with the Dashscope upstream: it only existed via bridge routing)
		expect(scout.effort).toBe("low");
		expect(scout.mcpServers).toEqual([]);
		expect(scout.injectAgentsMd).toBe(false);
	});
	test("planner: unadvertised (the model reaches it explicitly, not by browsing)", () => {
		const planner = ROLE_BUILTIN_AGENTS.find((a) => a.name === "planner")!;
		expect(planner.advertise).toBe(false);
		const block = renderAdvertisedCatalog(ROLE_BUILTIN_AGENTS, "standard");
		expect(block).toBeDefined();
		expect(block!.includes("- name: planner")).toBe(false);
		expect(block!.includes("- name: worker")).toBe(true);
	});
	test("role prompts carry their output contracts (cciotti shapes)", () => {
		const worker = ROLE_BUILTIN_AGENTS.find((a) => a.name === "worker")!;
		expect(worker.systemPrompt.includes("Changed:")).toBe(true);
		expect(worker.systemPrompt.includes("Residual risks:")).toBe(true);
		const reviewer = ROLE_BUILTIN_AGENTS.find((a) => a.name === "reviewer")!;
		expect(reviewer.systemPrompt.includes("Verdict:")).toBe(true);
		expect(reviewer.systemPrompt.includes("P0")).toBe(true);
		const planner = ROLE_BUILTIN_AGENTS.find((a) => a.name === "planner")!;
		expect(planner.systemPrompt.includes("plan.md")).toBe(true);
		// The BLOCKED marker parses with the shared protocol parser.
		expect(isBlockedReply("BLOCKED: test").blocked).toBe(true);
	});
});

describe("browser agent (the interactive-web specialist)", () => {
	const browser = ROLE_BUILTIN_AGENTS.find((a) => a.name === "browser")!;

	test("ships with the browser tool + read-only FS context tools", () => {
		expect(browser.tools).toEqual(["browser", "read", "grep", "find", "ls"]);
	});

	test("is advertised in the catalog (the model can find it by browsing)", () => {
		expect(browser.advertise).toBe(true);
		const block = renderAdvertisedCatalog(ROLE_BUILTIN_AGENTS, "standard");
		expect(block).toBeDefined();
		expect(block!.includes("- name: browser")).toBe(true);
	});

	test("runs lean: no MCP servers, no AGENTS.md injection", () => {
		expect(browser.mcpServers).toEqual([]);
		expect(browser.injectAgentsMd).toBe(false);
	});

	test("carries a fallback model chain like the worker", () => {
		expect(browser.fallbackModels).toBeDefined();
		expect(browser.fallbackModels!.length).toBeGreaterThan(0);
	});

	test("10-minute budget: the Gemini browser_agent wall clock, double the default", () => {
		expect(browser.timeoutMs).toBe(600_000);
	});

	test("the routing description says what NOT to delegate (the Gemini contract)", () => {
		expect(browser.description.toLowerCase()).toContain("do not delegate");
		expect(browser.description.toLowerCase()).toContain("webfetch");
	});

	test("the system prompt carries the work loop, the fixed report shape and the terminal-failure contract", () => {
		const p = browser.systemPrompt;
		expect(p.includes("THE WORK LOOP")).toBe(true);
		expect(p.includes("Outcome:")).toBe(true);
		expect(p.includes("NEVER enter credentials")).toBe(true);
		expect(p.includes("net::ERR_")).toBe(true);
		expect(p.includes("Stale-ref")).toBe(true);
		// Snapshot hygiene: the parent's window is the scarce resource.
		expect(p.includes("stay HERE")).toBe(true);
	});
});
