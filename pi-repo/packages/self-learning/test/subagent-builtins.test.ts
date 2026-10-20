// Unit tests for src/subagent-builtins.ts — the role-specialized builtin
// agents (pi-cciotti port): shape contracts the task tool + catalog depend on.
//
// Pure module: no pi imports, no engine store.
import { describe, expect, test } from "bun:test";
import { ROLE_BUILTIN_AGENTS } from "../src/subagent-builtins.ts";
import { isBlockedReply, renderAdvertisedCatalog } from "../src/subagent-catalog.ts";

describe("ROLE_BUILTIN_AGENTS", () => {
    test("the expected four roles ship with unique names", () => {
        const names = ROLE_BUILTIN_AGENTS.map((a) => a.name).sort();
        expect(names).toEqual(["planner", "reviewer", "scout", "worker"]);
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
    test("scout: read-only toolset + cheap routing (model, low effort, no MCP, no AGENTS.md)", () => {
        const scout = ROLE_BUILTIN_AGENTS.find((a) => a.name === "scout")!;
        expect(scout.tools).toEqual(["read", "grep", "find", "ls"]);
        expect(scout.model).toBeDefined();
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
