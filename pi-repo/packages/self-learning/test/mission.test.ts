/**
 * mission.test.ts — the observability round's pure core: the mission panel
 * (objective resolution, derived progress, deterministic confidence, composed
 * risks) and the 60-second brief (docs/tui-observability-audit.md).
 */
import { describe, expect, test } from "bun:test";
import {
        buildBrief,
        deriveConfidence,
        deriveProgress,
        deriveRisks,
        formatMissionAge,
        missionPanelEnabled,
        renderConfidenceChip,
        renderMissionPanel,
        renderProgressMeter,
        resolveMission,
} from "../src/mission.ts";

const NOW = 1_700_000_000_000;

describe("resolveMission — precedence: goal > pin > title, never invented", () => {
        test("an ACTIVE goal is the mission; paused/complete goals are not", () => {
                const goal = { text: "fix the auth tests", status: "active", createdAt: NOW - 60_000 };
                const mission = resolveMission({ goal, userMission: null, sessionName: "other" });
                expect(mission?.text).toBe("fix the auth tests");
                expect(mission?.source).toBe("goal");
                const paused = resolveMission({ goal: { ...goal, status: "paused" }, userMission: null, sessionName: null });
                expect(paused).toBeNull();
        });
        test("a /mission pin beats the auto-title but loses to the goal", () => {
                const pinned = resolveMission({
                        goal: null,
                        userMission: { text: "ship the dashboard", source: "user", createdAt: NOW },
                        sessionName: "some session title",
                });
                expect(pinned?.text).toBe("ship the dashboard");
                expect(pinned?.source).toBe("user");
        });
        test("the session title is the fallback (audit flag E1)", () => {
                const mission = resolveMission({ goal: null, userMission: null, sessionName: "add the export button" });
                expect(mission?.text).toBe("add the export button");
                expect(mission?.source).toBe("auto");
        });
        test("absent everywhere = no mission, never invented", () => {
                expect(resolveMission({ goal: null, userMission: null, sessionName: undefined })).toBeNull();
                expect(resolveMission({ goal: null, userMission: null, sessionName: "   " })).toBeNull();
        });
});

describe("deriveProgress — plan beats todos; honest absence otherwise", () => {
        test("an executing plan wins", () => {
                const p = deriveProgress({ plan: { done: 2, total: 5 }, todos: { done: 3, total: 4 } });
                expect(p).toEqual({ done: 2, total: 5, source: "plan" });
        });
        test("todos carry ordinary sessions", () => {
                const p = deriveProgress({ plan: null, todos: { done: 1, total: 3 } });
                expect(p).toEqual({ done: 1, total: 3, source: "todos" });
        });
        test("zero-total inputs are absent, not zero progress", () => {
                expect(deriveProgress({ plan: { done: 0, total: 0 }, todos: { done: 0, total: 0 } })).toBeNull();
                expect(deriveProgress({})).toBeNull();
        });
        test("the meter fills proportionally and clamps", () => {
                expect(renderProgressMeter({ done: 2, total: 8, source: "todos" })).toContain("▕██░░░░░░▏ 2/8");
                expect(renderProgressMeter({ done: 8, total: 8, source: "todos" })).toContain("8/8");
        });
});

describe("deriveConfidence — deterministic receipts only", () => {
        test("a quiet session is high with no drivers", () => {
                const c = deriveConfidence({ toolErrors: 0, verifyFailures: 0, denials: 0 });
                expect(c.level).toBe("high");
                expect(c.drivers).toEqual([]);
        });
        test("1-2 tool errors or any denial = medium with named drivers", () => {
                expect(deriveConfidence({ toolErrors: 1, verifyFailures: 0, denials: 0 }).level).toBe("medium");
                expect(deriveConfidence({ toolErrors: 0, verifyFailures: 0, denials: 2 }).level).toBe("medium");
                expect(deriveConfidence({ toolErrors: 2, verifyFailures: 0, denials: 0 }).drivers).toEqual(["2 tool errors"]);
        });
        test("any verify failure or >=3 errors = low", () => {
                expect(deriveConfidence({ toolErrors: 0, verifyFailures: 1, denials: 0 }).level).toBe("low");
                expect(deriveConfidence({ toolErrors: 3, verifyFailures: 0, denials: 0 }).level).toBe("low");
        });
        test("the chip vocabulary", () => {
                expect(renderConfidenceChip({ level: "high", drivers: [] })).toBe("conf ✓");
                expect(renderConfidenceChip({ level: "medium", drivers: ["x"] })).toBe("conf ◐");
                expect(renderConfidenceChip({ level: "low", drivers: ["x"] })).toBe("conf ✗");
        });
});

describe("deriveRisks — composed worst-first, each with its fix", () => {
        test("an empty session renders no risks", () => {
                expect(deriveRisks({ engineState: "up" })).toEqual([]);
        });
        test("engine states carry their consequence + command", () => {
                const risks = deriveRisks({ engineState: "down" });
                expect(risks[0]).toContain("engine down");
                expect(risks[0]).toContain("/engine");
        });
        test("context pressure bands and dead letters", () => {
                expect(deriveRisks({ ctxPct: 91 })[0]).toContain("compact now");
                expect(deriveRisks({ ctxPct: 75 })[0]).toContain("compaction soon");
                expect(deriveRisks({ outboxDead: 2 })[0]).toContain("2 dead-lettered notes");
        });
});

describe("renderMissionPanel — 2-4 lines, composed not competing", () => {
        const high = { level: "high" as const, drivers: [] };
        test("no mission renders the status row only, honestly", () => {
                const lines = renderMissionPanel({ mission: null, progress: null, confidence: high, risks: [], now: NOW });
                expect(lines[0].text).toContain("no tracked steps");
                expect(lines.some((l) => l.text.startsWith("●"))).toBe(false);
        });
        test("mission first, progress + confidence + telemetry second", () => {
                const lines = renderMissionPanel({
                        mission: { text: "ship it", source: "user", createdAt: NOW - 25 * 60_000 },
                        progress: { done: 3, total: 7, source: "todos" },
                        confidence: high,
                        risks: [],
                        telemetry: { sessionMs: 42 * 60_000, costUsd: 0.31, turns: 4 },
                        now: NOW,
                });
                expect(lines[0].text).toContain("● mission — ship it (user · 25m)");
                expect(lines[1].text).toContain("3/7");
                expect(lines[1].text).toContain("conf ✓");
                expect(lines[1].text).toContain("~$0.31");
        });
        test("risks cap at two with a pointer row; learning rides its own line", () => {
                const lines = renderMissionPanel({
                        mission: null,
                        progress: null,
                        confidence: { level: "low", drivers: ["1 verify failure"] },
                        risks: ["r1", "r2", "r3"],
                        learned: "dream shipped v18",
                        now: NOW,
                });
                expect(lines.some((l) => l.text === "✦ dream shipped v18")).toBe(true);
                expect(lines.filter((l) => l.text.startsWith("✗")).length).toBe(2);
                expect(lines.some((l) => l.text.includes("+1 more (/recovery)"))).toBe(true);
        });
});

describe("buildBrief — the 60-second answer, ordered by the IA", () => {
        const inputs = {
                mission: { text: "fix the failing auth tests", source: "goal", createdAt: NOW - 30 * 60_000 },
                digest: {
                        turns: 3,
                        toolCalls: 14,
                        toolsUsed: ["bash×8", "edit×4"],
                        filesTouched: ["src/auth.ts", "src/auth.test.ts"],
                        lastAssistantPreview: "Tests pass now",
                },
                confidence: { level: "high", drivers: [] },
                risks: ["engine down — learning paused (/engine)"],
                remains: { openTodos: ["wire the OAuth refresh path"], planRemaining: 0, goal: null },
                learned: ["AutoDream shipped v18 (+3 rules)"],
                telemetry: { sessionMs: 42 * 60_000, costUsd: 0.31, tokensIn: "45.2k", tokensOut: "1.1k" },
        };
        test("answers all five mission questions in order", () => {
                const brief = buildBrief({ ...inputs, awayMs: 32 * 60_000 });
                expect(brief).toContain("back after 32m");
                expect(brief).toContain("mission: fix the failing auth tests (goal)");
                expect(brief).toContain("happened: 3 turns · 14 tool calls");
                expect(brief).toContain("changed:  src/auth.ts · src/auth.test.ts");
                expect(brief).toContain("risks:    engine down");
                expect(brief).toContain("learned:  AutoDream shipped v18");
                expect(brief).toContain("session:  42m · 45.2k in / 1.1k out · ~$0.31");
                expect(brief).toContain('remains:  "wire the OAuth refresh path"');
        });
        test("remains is always the last line and never empty", () => {
                const settled = buildBrief({
                        ...inputs,
                        remains: { openTodos: [], planRemaining: 0, goal: null },
                        risks: [],
                        learned: [],
                });
                const last = settled.split("\n").at(-1) ?? "";
                expect(last).toContain("nothing open — the last turn settled");
        });
        test("no learned events is honest, not silent", () => {
                expect(buildBrief({ ...inputs, learned: [] })).toContain("learned:  nothing new while you were away");
        });
});

describe("knobs and ages", () => {
        test("UNOWN_MISSION_PANEL=0 disables the panel; formatMissionAge buckets", () => {
                const prev = process.env.UNOWN_MISSION_PANEL;
                process.env.UNOWN_MISSION_PANEL = "0";
                try {
                        expect(missionPanelEnabled()).toBe(false);
                } finally {
                        process.env.UNOWN_MISSION_PANEL = prev;
                }
                expect(missionPanelEnabled()).toBe(true);
                expect(formatMissionAge(90_000)).toBe("1m");
                expect(formatMissionAge(90 * 60_000)).toBe("1.5h");
        });
});
