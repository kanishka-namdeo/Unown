// Unit tests for src/fleet.ts — the pure fleet protocols (status machine,
// control inbox, names, loadout, registry, message builders).
// pi-interactive-subagents port, cross-platform substrate.
//
// Pure module: no pi imports; file I/O exercised against temp dirs.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	appendControlCommand,
	atomicWriteFileSync,
	buildFleetQuestionContent,
	buildFleetResultContent,
	classifyFleetStatus,
	consumeControlCommands,
	FLEET_STALL_MS,
	type FleetChildState,
	type FleetLoadout,
	flattenSteerText,
	formatFleetStatusLine,
	formatFleetWidgetLines,
	isTerminalFleetStatus,
	loadoutSidecarPath,
	nextFleetStatus,
	parseControlCommands,
	readFleetRegistry,
	readLoadout,
	resolveFleetTimeoutMs,
	uniqueFleetName,
	writeFleetRegistry,
	writeLoadout,
} from "../src/fleet.ts";

const TMP = mkdtempSync(join(tmpdir(), "unown-fleet-test-"));
afterAll(() => {
	try {
		rmSync(TMP, { recursive: true, force: true });
	} catch {
		/* best effort */
	}
});

const child = (over: Partial<FleetChildState> = {}): FleetChildState => ({
	id: "id1",
	name: "scout",
	agent: "scout",
	task: "map the repo",
	cwd: TMP,
	startedAt: Date.now() - 60_000,
	status: "active",
	toolCount: 3,
	turns: 2,
	usage: { input: 1200, output: 300 },
	sessionFile: join(TMP, "s.jsonl"),
	lastActivityAt: Date.now(),
	steerCount: 0,
	...over,
});

// ---------------------------------------------------------------------------
// Status machine
// ---------------------------------------------------------------------------

describe("nextFleetStatus", () => {
	test("activity transitions", () => {
		expect(nextFleetStatus({ status: "starting" }, "spawned")).toEqual({ status: "starting" });
		expect(nextFleetStatus({ status: "starting" }, "assistant-message").status).toBe("active");
		expect(nextFleetStatus({ status: "active" }, "tool-start").status).toBe("running-tool");
		expect(nextFleetStatus({ status: "running-tool" }, "tool-end").status).toBe("active");
		expect(nextFleetStatus({ status: "stalled" }, "steered").status).toBe("active");
		expect(nextFleetStatus({ status: "active" }, "asked").status).toBe("waiting-for-answer");
		expect(nextFleetStatus({ status: "waiting-for-answer" }, "answered").status).toBe("active");
		expect(nextFleetStatus({ status: "active" }, "error").status).toBe("failed");
	});
});

describe("classifyFleetStatus (the stall watchdog)", () => {
	test("quiet non-terminal child stalls after FLEET_STALL_MS", () => {
		const now = Date.now();
		expect(classifyFleetStatus({ status: "active", lastActivityAt: now - FLEET_STALL_MS - 1 }, now)).toBe("stalled");
		expect(classifyFleetStatus({ status: "active", lastActivityAt: now - 1000 }, now)).toBe("active");
	});
	test("waiting-for-answer and terminal statuses never stall", () => {
		const now = Date.now();
		const quiet = now - FLEET_STALL_MS * 3;
		expect(classifyFleetStatus({ status: "waiting-for-answer", lastActivityAt: quiet }, now)).toBe(
			"waiting-for-answer",
		);
		expect(classifyFleetStatus({ status: "done", lastActivityAt: quiet }, now)).toBe("done");
		expect(classifyFleetStatus({ status: "blocked", lastActivityAt: quiet }, now)).toBe("blocked");
	});
	test("isTerminalFleetStatus matches the four terminal states", () => {
		for (const s of ["done", "failed", "blocked", "stopped"] as const) expect(isTerminalFleetStatus(s)).toBe(true);
		for (const s of ["starting", "active", "running-tool", "waiting-for-answer", "stalled"] as const) {
			expect(isTerminalFleetStatus(s)).toBe(false);
		}
	});
});

// ---------------------------------------------------------------------------
// Widget + footer
// ---------------------------------------------------------------------------

const plainTheme = {
	glyph: () => "⟳",
	dim: (s: string) => s,
	accent: (s: string) => s,
	warn: (s: string) => s,
	title: (s: string) => s,
};

describe("formatFleetWidgetLines subagent lanes (beauty-4)", () => {
	// Identity colors + a lane fn that marks its calls: (name, s) -> [name]s[/]
	const laneTheme = {
		...plainTheme,
		lane: (name: string, s: string) => `[${name}]${s}[/]`,
	};

	test("prepends the child's rail and colors its name when a lane fn is present", () => {
		const lines = formatFleetWidgetLines([child({ name: "scout", status: "active" })], laneTheme, 80);
		const row = lines.find((l) => l.includes("scout"))!;
		expect(row.startsWith("[scout]▌[/] ")).toBe(true);
		expect(row).toContain("[scout]scout[/]");
		// The pre-lane shape is still there underneath: status glyph + elapsed + phrase.
		expect(row).toContain("⟳");
		expect(row).toContain("01:00");
		expect(row).toContain("[/] — thinking");
	});

	test("keeps rows byte-identical without a lane fn (the pre-lane shape)", () => {
		const noLane = formatFleetWidgetLines([child({ name: "scout", status: "active" })], plainTheme, 80);
		const row = noLane.find((l) => l.includes("scout"))!;
		expect(row.startsWith("⟳")).toBe(true);
		expect(row).not.toContain("▌");
	});

	test("budgets the 2-cell rail inside the cap: rows never run past the box edge", () => {
		// Identity lane so marker text cannot fake the width (colors are zero-width).
		const identityLane = { ...plainTheme, lane: (_name: string, s: string) => s };
		const long = child({ name: "n".repeat(90), status: "running-tool", currentTool: "bash" });
		const lines = formatFleetWidgetLines([long], identityLane, 80);
		const inner = 76; // min(80,120) - 4
		for (const line of lines) {
			expect(line.length).toBeLessThanOrEqual(inner);
		}
		const row = lines.find((l) => l.includes("▌"))!;
		expect(row.startsWith("▌ ")).toBe(true);
		expect(row).toContain("…"); // the content truncated, never the row
	});

	test("keeps the rail colored when the name itself is truncated away", () => {
		const long = child({ name: "n".repeat(90), status: "active" });
		const lines = formatFleetWidgetLines([long], laneTheme, 80);
		const row = lines.find((l) => l.includes("▌"))!;
		expect(row.startsWith(`[${"n".repeat(90)}]▌[/] `)).toBe(true);
		// The truncated name cannot be wrapped — but the rail still names the lane.
		expect(row).not.toContain(`]${"n".repeat(90)}[/]`);
	});

	test("colors each child with its own lane (siblings stay distinguishable)", () => {
		const lines = formatFleetWidgetLines(
			[child({ name: "scout", status: "active" }), child({ name: "worker", status: "active" })],
			laneTheme,
			80,
		);
		const scoutRow = lines.find((l) => l.startsWith("[scout]▌[/] "))!;
		const workerRow = lines.find((l) => l.startsWith("[worker]▌[/] "))!;
		expect(scoutRow).toBeDefined();
		expect(workerRow).toBeDefined();
		expect(scoutRow).toContain("[scout]scout[/]");
		expect(workerRow).toContain("[worker]worker[/]");
		expect(scoutRow).not.toContain("[worker]");
		expect(workerRow).not.toContain("[scout]");
	});
});

describe("formatFleetWidgetLines", () => {
	test("empty when nothing is running; terminal children are not shown", () => {
		expect(formatFleetWidgetLines([], plainTheme)).toEqual([]);
		expect(formatFleetWidgetLines([child({ status: "done" })], plainTheme)).toEqual([]);
	});
	test("shows the header, one row per running child, and caps at 8 rows", () => {
		const many = Array.from({ length: 12 }, (_, i) => child({ name: `scout-${i}`, status: "active" }));
		const lines = formatFleetWidgetLines(many, plainTheme, 80);
		expect(lines[0]).toContain("Subagents");
		expect(lines[0]).toContain("12 running");
		expect(lines.filter((l) => l.startsWith("⟳")).length).toBe(8);
		expect(lines.some((l) => l.includes("+4 more running"))).toBe(true);
	});
	test("row content carries elapsed, name and a status phrase", () => {
		const lines = formatFleetWidgetLines(
			[child({ name: "worker", status: "running-tool", currentTool: "bash" })],
			plainTheme,
			100,
		);
		const row = lines.find((l) => l.includes("worker"))!;
		expect(row).toContain("01:00");
		expect(row).toContain("running · bash");
	});
	test("waiting-for-answer is called out for the parent to see", () => {
		const lines = formatFleetWidgetLines([child({ status: "waiting-for-answer" })], plainTheme, 100);
		expect(lines.some((l) => l.includes("waiting for your answer"))).toBe(true);
	});
});

describe("formatFleetStatusLine", () => {
	test("undefined when idle; carries counts when running", () => {
		expect(formatFleetStatusLine([], plainTheme)).toBeUndefined();
		const line = formatFleetStatusLine(
			[child({ status: "active" }), child({ name: "w2", status: "waiting-for-answer" })],
			plainTheme,
		);
		expect(line).toContain("2 subagents running");
		expect(line).toContain("1 awaiting answer");
	});
});

// ---------------------------------------------------------------------------
// Steer text + control inbox
// ---------------------------------------------------------------------------

describe("flattenSteerText", () => {
	test("newlines collapse to single spaces (each would submit a turn)", () => {
		expect(flattenSteerText("line one\nline two\n\n  line three  ")).toBe("line one line two line three");
	});
});

describe("control inbox protocol", () => {
	test("parse: valid, empty, corrupt, and unknown shapes", () => {
		expect(parseControlCommands("")).toEqual([]);
		expect(parseControlCommands("{broken")).toEqual([]);
		expect(parseControlCommands('{"not":"an array"}')).toEqual([]);
		expect(parseControlCommands("[]")).toEqual([]);
		const cmds = parseControlCommands(
			JSON.stringify([
				{ kind: "steer", text: "focus\non auth", ts: 1 },
				{ kind: "answer", text: "yes", ts: 2 },
				{ kind: "stop", ts: 3 },
				{ kind: "bogus", text: "x" },
				{ kind: "steer", text: "   " },
			]),
		);
		expect(cmds).toHaveLength(3);
		expect(cmds[0]).toEqual({ kind: "steer", text: "focus on auth", ts: 1 });
		expect(cmds[1]).toEqual({ kind: "answer", text: "yes", ts: 2 });
		expect(cmds[2]).toEqual({ kind: "stop", ts: 3 });
	});
	test("append + consume round-trip truncates the inbox", () => {
		const file = join(TMP, "c1.control.json");
		rmSync(file, { force: true });
		appendControlCommand(file, { kind: "steer", text: "hello" });
		appendControlCommand(file, { kind: "stop" });
		expect(existsSync(file)).toBe(true);
		const consumed = consumeControlCommands(file);
		expect(consumed).toHaveLength(2);
		expect(consumed[0].kind).toBe("steer");
		// Second consume is empty (the file was truncated).
		expect(consumeControlCommands(file)).toEqual([]);
	});
	test("consume on a missing file is an empty list, never a throw", () => {
		expect(consumeControlCommands(join(TMP, "never.control.json"))).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Names, loadout, registry
// ---------------------------------------------------------------------------

describe("uniqueFleetName", () => {
	test("dedups against taken names and sanitizes", () => {
		expect(uniqueFleetName("scout", new Set())).toBe("scout");
		expect(uniqueFleetName("scout", new Set(["scout"]))).toBe("scout-2");
		expect(uniqueFleetName("scout", new Set(["scout", "scout-2"]))).toBe("scout-3");
		expect(uniqueFleetName("weird name!!", new Set())).toBe("weird-name");
		expect(uniqueFleetName("", new Set())).toBe("agent");
	});
});

describe("loadout sidecar", () => {
	test("write + read round-trip; missing/corrupt returns null", () => {
		const sessionFile = join(TMP, "sess-a.jsonl");
		const loadout: FleetLoadout = {
			version: 1,
			name: "worker",
			agentName: "worker",
			task: "fix the bug",
			cwd: TMP,
			model: "kimi-k2.5",
			systemPrompt: "You are a worker.",
			sessionFile,
			createdAt: Date.now(),
			tools: ["read", "bash"],
		};
		writeLoadout(loadout);
		expect(existsSync(loadoutSidecarPath(sessionFile))).toBe(true);
		const back = readLoadout(sessionFile);
		expect(back).not.toBeNull();
		expect(back!.agentName).toBe("worker");
		expect(back!.tools).toEqual(["read", "bash"]);
		expect(readLoadout(join(TMP, "no-such.jsonl"))).toBeNull();
		atomicWriteFileSync(loadoutSidecarPath(join(TMP, "corrupt.jsonl")), "{nope");
		expect(readLoadout(join(TMP, "corrupt.jsonl"))).toBeNull();
	});
});

describe("fleet registry", () => {
	test("round-trip + 32-entry bound", () => {
		const dir = join(TMP, "reg");
		const registry = readFleetRegistry(dir);
		expect(registry.names).toEqual({});
		for (let i = 0; i < 40; i++) {
			registry.names[`n${String(i).padStart(2, "0")}`] = {
				sessionFile: join(dir, `s${i}.jsonl`),
				id: `id${i}`,
				status: "done",
				finishedAt: 1000 + i,
			};
		}
		writeFleetRegistry(dir, registry);
		const back = readFleetRegistry(dir);
		expect(Object.keys(back.names).length).toBe(32);
		// The 32 MOST RECENT survive.
		expect(back.names["n39"]).toBeDefined();
		expect(back.names["n00"]).toBeUndefined();
	});
});

describe("resolveFleetTimeoutMs (UNOWN_FLEET_TIMEOUT_MS)", () => {
	test("FLEET_TIMEOUT_MS is the documented default", () => {
		// The public knob (UNOWN_FLEET_TIMEOUT_MS) documents 900000 as the
		// default — pin it so docs + code can never drift apart silently.
		expect(resolveFleetTimeoutMs({})).toBe(900_000);
		expect(resolveFleetTimeoutMs({ UNOWN_FLEET_TIMEOUT_MS: "" })).toBe(900_000);
	});

	test("UNOWN_FLEET_TIMEOUT_MS overrides when it parses to >= 1000ms", () => {
		expect(resolveFleetTimeoutMs({ UNOWN_FLEET_TIMEOUT_MS: "120000" })).toBe(120_000);
		expect(resolveFleetTimeoutMs({ UNOWN_FLEET_TIMEOUT_MS: " 3600000 " })).toBe(3_600_000);
	});

	test("garbage and sub-second values fall back to the default (a typo can never zero the watchdog)", () => {
		expect(resolveFleetTimeoutMs({ UNOWN_FLEET_TIMEOUT_MS: "soon" })).toBe(900_000);
		expect(resolveFleetTimeoutMs({ UNOWN_FLEET_TIMEOUT_MS: "999" })).toBe(900_000);
		expect(resolveFleetTimeoutMs({ UNOWN_FLEET_TIMEOUT_MS: "-5" })).toBe(900_000);
		expect(resolveFleetTimeoutMs({ UNOWN_FLEET_TIMEOUT_MS: "0" })).toBe(900_000);
	});
});

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

describe("buildFleetResultContent", () => {
	test("done carries vitals + follow-up hint", () => {
		const text = buildFleetResultContent(child({ status: "done", lastText: "Found 3 call sites." }));
		expect(text).toContain("finished in");
		expect(text).toContain("2 turns · 3 tool calls");
		expect(text).toContain("Found 3 call sites.");
		expect(text).toContain('task_control {action:"steer"');
	});
	test("blocked and failed carry their statuses", () => {
		const blocked = buildFleetResultContent(
			child({ status: "blocked", blockReason: "no access", lastText: "BLOCKED: no access" }),
		);
		expect(blocked).toContain("BLOCKED");
		expect(blocked).toContain("no access");
		const failed = buildFleetResultContent(child({ status: "failed", stderr: "boom" }));
		expect(failed).toContain("FAILED");
	});
});

describe("buildFleetQuestionContent", () => {
	test("carries the question + the steer-back instruction", () => {
		const text = buildFleetQuestionContent(child({ name: "worker" }), "Which database: prod or staging?");
		expect(text).toContain("worker (scout) asks a question");
		expect(text).toContain("Which database: prod or staging?");
		expect(text).toContain('task_control {action:"steer"');
	});
});

// ---------------------------------------------------------------------------
// Browser-active children + live token counts (the browser-subagent round)
// ---------------------------------------------------------------------------
import { isBrowserChild } from "../src/fleet.ts";

describe("isBrowserChild", () => {
	test("the browser agent is browser-active regardless of current tool", () => {
		expect(isBrowserChild({ agent: "browser", currentTool: undefined })).toBe(true);
		expect(isBrowserChild({ agent: "browser", currentTool: "" })).toBe(true);
		expect(isBrowserChild({ agent: "browser", currentTool: "read: x.ts" })).toBe(true);
	});
	test("a child currently driving the browser tool is browser-active", () => {
		expect(isBrowserChild({ agent: "general", currentTool: "browser" })).toBe(true);
		expect(isBrowserChild({ agent: "general", currentTool: "browser: navigate example.com" })).toBe(true);
	});
	test("repo work is not browser-active", () => {
		expect(isBrowserChild({ agent: "scout", currentTool: "grep: browser:" })).toBe(false);
		expect(isBrowserChild({ agent: "worker", currentTool: "bash: npm test" })).toBe(false);
		expect(isBrowserChild({ agent: "general", currentTool: "read: a.ts" })).toBe(false);
	});
});

describe("formatFleetWidgetLines: browser glyph + tokens", () => {
	const browserTheme = {
		...plainTheme,
		browserGlyph: () => "◉",
	};

	test("a browser child renders the browser glyph and the humanized tool detail", () => {
		const lines = formatFleetWidgetLines(
			[
				child({
					name: "browser",
					agent: "browser",
					status: "running-tool",
					currentTool: "browser: navigate example.com",
				}),
			],
			browserTheme,
			100,
		);
		const row = lines.find((l) => l.includes("browser"))!;
		expect(row.startsWith("◉ ")).toBe(true);
		expect(row).toContain("running · browser: navigate example.com");
	});

	test("a general child driving the browser tool also gets the browser glyph", () => {
		const lines = formatFleetWidgetLines(
			[child({ name: "researcher", agent: "general", status: "running-tool", currentTool: "browser: click [e12]" })],
			browserTheme,
			100,
		);
		const row = lines.find((l) => l.includes("researcher"))!;
		expect(row.startsWith("◉ ")).toBe(true);
	});

	test("non-browser children keep the generic glyph when a browserGlyph is themed", () => {
		const lines = formatFleetWidgetLines(
			[child({ name: "scout", status: "running-tool", currentTool: "grep: foo" })],
			browserTheme,
			100,
		);
		const row = lines.find((l) => l.includes("scout"))!;
		expect(row.startsWith("⟳ ")).toBe(true);
	});

	test("a theme WITHOUT browserGlyph falls back to the generic glyph (no crash)", () => {
		const lines = formatFleetWidgetLines(
			[child({ name: "browser", agent: "browser", status: "running-tool", currentTool: "browser: snapshot" })],
			plainTheme,
			100,
		);
		const row = lines.find((l) => l.includes("browser"))!;
		expect(row.startsWith("⟳ ")).toBe(true);
	});

	test("rows carry the compact live token count once usage exists", () => {
		const lines = formatFleetWidgetLines(
			[child({ name: "scout", usage: { input: 1200, output: 300 } })],
			plainTheme,
			100,
		);
		const row = lines.find((l) => l.includes("scout"))!;
		expect(row).toContain("1.5k tok");
	});

	test("zero-usage rows omit the token suffix (starting children stay clean)", () => {
		const lines = formatFleetWidgetLines(
			[child({ name: "scout", status: "starting", usage: { input: 0, output: 0 } })],
			plainTheme,
			100,
		);
		const row = lines.find((l) => l.includes("scout"))!;
		expect(row).not.toContain("tok");
	});

	test("long browser URLs are width-capped, never wrap", () => {
		const long = "browser: navigate " + "a".repeat(90) + ".com/page";
		const lines = formatFleetWidgetLines(
			[child({ name: "browser", agent: "browser", status: "running-tool", currentTool: long })],
			browserTheme,
			80,
		);
		const row = lines.find((l) => l.includes("browser"))!;
		expect(row.length).toBeLessThanOrEqual(80 + 20); // glyph+dim allow small slack; no ANSI in plainTheme
		expect(row).not.toContain("\n");
	});
});
