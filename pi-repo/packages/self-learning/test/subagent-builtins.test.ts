// Unit tests for src/subagent-builtins.ts — the role-specialized builtin
// agents (pi-cciotti port): shape contracts the task tool + catalog depend on.
//
// Pure module: no pi imports, no engine store.
import { describe, expect, test } from "bun:test";
import { PLANNING_BUILTIN_AGENTS, ROLE_BUILTIN_AGENTS } from "../src/subagent-builtins.ts";
import { isBlockedReply, renderAdvertisedCatalog } from "../src/subagent-catalog.ts";

describe("ROLE_BUILTIN_AGENTS", () => {
        test("the expected nine roles ship with unique names", () => {
                const names = ROLE_BUILTIN_AGENTS.map((a) => a.name).sort();
                // The delegation round (2026-10-30) added the four specialist roles:
                // debug, test, security-reviewer, documenter.
                expect(names).toEqual([
                        "browser",
                        "debug",
                        "documenter",
                        "planner",
                        "reviewer",
                        "scout",
                        "security-reviewer",
                        "test",
                        "worker",
                ]);
        });
        test("the delegation round's specialists carry their role contracts", () => {
                const debug = ROLE_BUILTIN_AGENTS.find((a) => a.name === "debug")!;
                expect(debug.tools).toEqual(["read", "grep", "find", "ls", "bash"]);
                expect(debug.maxTurns).toBe(30);
                expect(debug.systemPrompt).toContain("Diagnosis:");
                expect(debug.systemPrompt).toContain("Alternatives ruled out:");
                const tester = ROLE_BUILTIN_AGENTS.find((a) => a.name === "test")!; // not `test` — the runner owns that name
                expect(tester.completionGuard).toBe(true); // a test run that writes nothing is a failure
                expect(tester.systemPrompt).toContain("Baseline:");
                expect(tester.systemPrompt).toContain("Collateral:");
                expect(tester.systemPrompt).toContain("do not fix the code");
                const sec = ROLE_BUILTIN_AGENTS.find((a) => a.name === "security-reviewer")!;
                expect(sec.tools).toEqual(["read", "grep", "find", "ls", "bash"]);
                expect(sec.maxTurns).toBe(24);
                expect(sec.systemPrompt).toContain("EXPLOIT PRECONDITIONS");
                expect(sec.systemPrompt).toContain("INSUFFICIENT CONTEXT");
                const doc = ROLE_BUILTIN_AGENTS.find((a) => a.name === "documenter")!;
                expect(doc.tools).toEqual(["read", "grep", "find", "ls", "write"]);
                expect(doc.systemPrompt).toContain("NEVER invent an API, flag, default, or number");
                expect(doc.systemPrompt).toContain("Unverified / flagged:");
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

describe("PLANNING_BUILTIN_AGENTS (the Plan Mode V3 specialist bench)", () => {
        test("the eight V3 specialists ship, uniquely named, disjoint from the role agents", () => {
                const names = PLANNING_BUILTIN_AGENTS.map((a) => a.name).sort();
                expect(names).toEqual([
                        "delivery-manager",
                        "devils-advocate",
                        "learning-analyst",
                        "memory-auditor",
                        "product-strategist",
                        "qa-architect",
                        "skill-architect",
                        "solution-architect",
                ]);
                const roleNames = new Set(ROLE_BUILTIN_AGENTS.map((a) => a.name));
                for (const name of names) expect(roleNames.has(name)).toBe(false);
        });
        test("the bench is strictly read-only — the plan-mode delegation guard's admitted set", () => {
                for (const agent of PLANNING_BUILTIN_AGENTS) {
                        expect(agent.tools).toEqual(["read", "grep", "find", "ls"]);
                }
        });
        test("unadvertised: the orchestrator reaches them by name, the catalog never lists them", () => {
                for (const agent of PLANNING_BUILTIN_AGENTS) {
                        expect(agent.advertise).toBe(false);
                }
                const block = renderAdvertisedCatalog(PLANNING_BUILTIN_AGENTS, "standard");
                expect(block).toBeUndefined(); // nothing advertised → no block at all
        });
        test("every specialist answers with a verdict-first fixed contract", () => {
                const verdicts: Record<string, string> = {
                        "product-strategist": "Verdict: ALIGNED | DRIFT | OUT OF SCOPE",
                        "solution-architect": "Verdict: SOUND | CONCERNS | UNSOUND",
                        "delivery-manager": "Verdict: DELIVERABLE | RISKY | BLOCKED",
                        "qa-architect": "Verdict: TESTABLE | GAPS",
                        "devils-advocate": "Verdict: FLAWS FOUND | PLAN HOLDS",
                        "learning-analyst": "Learning candidates:",
                        "memory-auditor": "Missing knowledge:",
                        "skill-architect": "Skill candidates:",
                };
                for (const agent of PLANNING_BUILTIN_AGENTS) {
                        expect(agent.systemPrompt).toContain(verdicts[agent.name]);
                        expect(agent.systemPrompt.length).toBeGreaterThan(200);
                        expect(agent.description.length).toBeGreaterThan(40);
                        expect(agent.source).toBe("built-in");
                }
        });
        test("the devil's advocate is chartered to find flaws (success means finding them)", () => {
                const devil = PLANNING_BUILTIN_AGENTS.find((a) => a.name === "devils-advocate")!;
                expect(devil.systemPrompt).toContain("SUCCESS CRITERION IS FINDING FLAWS");
                expect(devil.systemPrompt).toContain("PLAN HOLDS is a legitimate answer");
        });
        test("the architect must read the files it judges (no rubber-stamp review)", () => {
                const architect = PLANNING_BUILTIN_AGENTS.find((a) => a.name === "solution-architect")!;
                expect(architect.systemPrompt).toContain("READ the files the plan names");
                expect(architect.systemPrompt).toContain("Simpler alternative:");
        });
        test("the learning specialists honor the memory/skill boundaries", () => {
                const memory = PLANNING_BUILTIN_AGENTS.find((a) => a.name === "memory-auditor")!;
                expect(memory.systemPrompt).toContain("Never recommend memorizing untrusted text");
                const skill = PLANNING_BUILTIN_AGENTS.find((a) => a.name === "skill-architect")!;
                expect(skill.systemPrompt).toContain("staged");
                expect(skill.systemPrompt).toContain("human mv");
        });
        test("the bench runs lean: low effort, no MCP, no AGENTS.md, bounded turns", () => {
                for (const agent of PLANNING_BUILTIN_AGENTS) {
                        expect(agent.effort).toBe("low");
                        expect(agent.mcpServers).toEqual([]);
                        expect(agent.injectAgentsMd).toBe(false);
                        expect(agent.maxTurns).toBeGreaterThanOrEqual(16);
                        expect(agent.maxTurns).toBeLessThanOrEqual(24);
                }
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
