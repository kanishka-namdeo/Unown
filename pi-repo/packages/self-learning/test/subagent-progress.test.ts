/**
 * subagent-progress.test.ts — hermetic tests for the live tool-label
 * humanization (the fleet widget / task-tool "running · …" detail).
 *
 * Imports ONLY the pure module (no pi, no fs, no network) — the standing
 * pattern of subagent-routing.test.ts. Every case pins a real shape off the
 * child's JSONL `tool_execution_start` event wire (toolName + args).
 */
import { describe, expect, test } from "bun:test";
import {
	compactTokens,
	compactUrl,
	formatElapsedCompact,
	humanizeBrowserAction,
	humanizeToolLabel,
	LABEL_MAX,
	shortenPath,
	truncateLabel,
} from "../src/subagent-progress.ts";

describe("truncateLabel", () => {
	test("short strings pass through untouched", () => {
		expect(truncateLabel("browser: click [e12]")).toBe("browser: click [e12]");
	});
	test("long strings ellipsize at LABEL_MAX and never grow", () => {
		const long = "x".repeat(200);
		const out = truncateLabel(long);
		expect(out.length).toBe(LABEL_MAX);
		expect(out.endsWith("…")).toBe(true);
	});
	test("whitespace collapses so labels stay one line", () => {
		expect(truncateLabel("a\n b   c")).toBe("a b c");
	});
	test("empty input stays empty (callers omit the detail)", () => {
		expect(truncateLabel("   ")).toBe("");
	});
});

describe("compactUrl", () => {
	test("https + www are stripped to host+path", () => {
		expect(compactUrl("https://www.example.com/a/b")).toBe("example.com/a/b");
	});
	test("query string dropped when a path exists", () => {
		expect(compactUrl("https://example.com/a?x=1&y=2")).toBe("example.com/a");
	});
	test("bare host passes through with the query kept (SPA search URLs)", () => {
		expect(compactUrl("https://example.com/?q=1")).toBe("example.com/?q=1");
	});
	test("bare host without scheme still parses", () => {
		expect(compactUrl("localhost:3000/dashboard")).toBe("localhost:3000/dashboard");
	});
	test("unparsable input returns the input unchanged, never throws", () => {
		expect(compactUrl(":://::")).toBe(":://::");
	});
});

describe("compactTokens", () => {
	test("zero / negative / NaN produce an empty string", () => {
		expect(compactTokens(0)).toBe("");
		expect(compactTokens(-5)).toBe("");
		expect(compactTokens(Number.NaN)).toBe("");
	});
	test("sub-thousand counts render bare", () => {
		expect(compactTokens(832)).toBe("832 tok");
	});
	test("thousands render with one decimal", () => {
		expect(compactTokens(1234)).toBe("1.2k tok");
		expect(compactTokens(10_000)).toBe("10k tok");
	});
	test("millions render with one decimal", () => {
		expect(compactTokens(2_500_000)).toBe("2.5M tok");
	});
});

describe("formatElapsedCompact", () => {
	test("seconds under a minute render bare", () => {
		expect(formatElapsedCompact(42_000)).toBe("42s");
		expect(formatElapsedCompact(0)).toBe("0s");
	});
	test("minutes pad seconds (Codex '1m 00s' shape)", () => {
		expect(formatElapsedCompact(60_000)).toBe("1m 00s");
		expect(formatElapsedCompact(134_000)).toBe("2m 14s");
	});
	test("hours pad minutes", () => {
		expect(formatElapsedCompact(3_780_000)).toBe("1h 03m");
	});
});

describe("humanizeBrowserAction", () => {
	test("navigate carries the compacted url", () => {
		expect(humanizeBrowserAction({ action: "navigate", url: "https://example.com/x?y=1" })).toBe(
			"navigate example.com/x",
		);
	});
	test("click prefers ref over selector, refs render [e12]", () => {
		expect(humanizeBrowserAction({ action: "click", ref: "e12" })).toBe("click [e12]");
		expect(humanizeBrowserAction({ action: "click", ref: "e3", selector: "#login" })).toBe("click [e3]");
	});
	test("selector is the fallback when no ref", () => {
		expect(humanizeBrowserAction({ action: "click", selector: "#login" })).toBe("click #login");
	});
	test("type shows a quoted snippet of the text", () => {
		expect(humanizeBrowserAction({ action: "type", ref: "e5", text: "hello world" })).toBe('type [e5] "hello world"');
	});
	test("press_key shows the combo", () => {
		expect(humanizeBrowserAction({ action: "press_key", key: "Control+a" })).toBe("press_key Control+a");
	});
	test("eval falls back to the first line of code", () => {
		expect(humanizeBrowserAction({ action: "eval", code: "document.title = 1;\nmore()" })).toBe(
			"eval document.title = 1;",
		);
	});
	test("screenshot with filename shows the filename", () => {
		expect(humanizeBrowserAction({ action: "screenshot", filename: "shot.png" })).toBe("screenshot shot.png");
	});
	test("bare actions render as the action alone", () => {
		expect(humanizeBrowserAction({ action: "snapshot" })).toBe("snapshot");
		expect(humanizeBrowserAction({})).toBe("");
		expect(humanizeBrowserAction(null)).toBe("");
	});
});

describe("humanizeToolLabel", () => {
	test("browser tool renders action + operand", () => {
		expect(humanizeToolLabel("browser", { action: "navigate", url: "https://example.com" })).toBe(
			"browser: navigate example.com",
		);
	});
	test("bash shows the first line of the command", () => {
		expect(humanizeToolLabel("bash", { command: "npm test\n&& echo done" })).toBe("bash: npm test");
	});
	test("read shows a shortened path", () => {
		expect(humanizeToolLabel("read", { path: "src/foo.ts" })).toBe("read: src/foo.ts");
	});
	test("long paths shorten to parent/…/basename", () => {
		expect(humanizeToolLabel("read", { path: "packages/self-learning/src/browser/tools.ts" })).toBe(
			"read: browser/…/tools.ts",
		);
	});
	test("grep shows the pattern", () => {
		expect(humanizeToolLabel("grep", { pattern: "browser:" })).toBe("grep: browser:");
	});
	test("fetch-style tools show the compacted url", () => {
		expect(humanizeToolLabel("webfetch", { url: "https://example.com/page" })).toBe("webfetch: example.com/page");
	});
	test("an explicit description wins for non-browser tools", () => {
		expect(humanizeToolLabel("bash", { command: "rm -rf /", description: "clean build dir" })).toBe(
			"bash: clean build dir",
		);
	});
	test("browser ignores description (the action IS the description)", () => {
		expect(humanizeToolLabel("browser", { action: "click", ref: "e1", description: "x" })).toBe(
			"browser: click [e1]",
		);
	});
	test("todo/note show the first words of text", () => {
		expect(humanizeToolLabel("todo", { text: "write tests for the widget" })).toBe(
			"todo: write tests for the widget",
		);
	});
	test("junk args degrade to the bare tool name, never throw", () => {
		expect(humanizeToolLabel("browser", "nonsense")).toBe("browser");
		expect(humanizeToolLabel("browser", 42)).toBe("browser");
		expect(humanizeToolLabel("browser", ["array"])).toBe("browser");
		expect(humanizeToolLabel("", { a: 1 })).toBe("tool");
		expect(humanizeToolLabel("task", null)).toBe("task");
	});
	test("last resort: the first short string operand keeps new tools readable", () => {
		expect(humanizeToolLabel("future_tool", { target: "the-thing", deep: { nested: true } })).toBe(
			"future_tool: the-thing",
		);
	});
	test("labels never exceed LABEL_MAX", () => {
		const out = humanizeToolLabel("bash", { command: "echo " + "a".repeat(300) });
		expect(out.length).toBeLessThanOrEqual(LABEL_MAX);
	});
});

describe("shortenPath", () => {
	test("short paths untouched", () => {
		expect(shortenPath("foo.ts")).toBe("foo.ts");
		expect(shortenPath("src/foo.ts")).toBe("src/foo.ts");
	});
	test("windows separators normalize", () => {
		const deep = ["a", "very", "long", "windows", "path", "to", "the", "file.ts"].join("\\");
		expect(shortenPath(deep)).toContain("…/file.ts");
	});
});
