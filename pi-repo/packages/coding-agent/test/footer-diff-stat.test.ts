import { describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { FooterComponent } from "../src/modes/interactive/components/footer.ts";
import { SessionDiffStats } from "../src/modes/interactive/components/session-diff-stats.ts";
import { initTheme, loadThemeFromPath, setThemeInstance, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const darkThemePath = new URL("../src/modes/interactive/theme/dark.json", import.meta.url).pathname;

/**
 * The diff-stat chip (beauty-4): a `+N -M` chip beside the footer's context
 * meter, accumulated per session from edit/write tool executions. Absent until
 * the session's first successful edit — an empty session keeps the stats line
 * exactly as it was.
 */

function createSession(): AgentSession {
	const entries: Array<Record<string, unknown>> = [
		{
			type: "message",
			message: {
				role: "assistant",
				usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, cost: { total: 0.05 } },
			},
		},
	];
	return {
		state: {
			model: { id: "test-model", provider: "test", contextWindow: 200_000, reasoning: false },
			thinkingLevel: "off",
		},
		sessionManager: {
			getEntries: () => entries,
			getSessionName: () => "",
			getCwd: () => "/tmp/project",
		},
		getContextUsage: () => ({ contextWindow: 200_000, percent: 12.3 }),
		modelRuntime: { isUsingSubscription: () => false },
	} as unknown as AgentSession;
}

function createFooterData(): ReadonlyFooterDataProvider {
	return {
		getGitBranch: () => "main",
		getExtensionStatuses: () => new Map<string, string>(),
		getAvailableProviderCount: () => 1,
		onBranchChange: () => () => {},
	};
}

/** The footer's stats line (line 2), plain text. */
function statsText(footer: FooterComponent, width = 120): string {
	return stripAnsi(footer.render(width)[1]);
}

describe("FooterComponent diff-stat chip (beauty-4)", () => {
	it("stays hidden until the session's first edit/write lands", () => {
		initTheme(undefined, false);
		const stats = new SessionDiffStats();
		const footer = new FooterComponent(createSession(), createFooterData(), stats);

		// No executions at all…
		expect(statsText(footer)).not.toMatch(/\+\d+\s+-\d+/);
		// …and non-mutating tools contribute nothing.
		stats.record("read", { path: "a.ts" }, {});
		stats.record("bash", { command: "ls" }, {});
		expect(statsText(footer)).not.toMatch(/\+\d+\s+-\d+/);
	});

	it("is absent when the footer has no accumulator (pre-beauty-4 callers)", () => {
		initTheme(undefined, false);
		const footer = new FooterComponent(createSession(), createFooterData());
		expect(statsText(footer)).not.toMatch(/\+\d+\s+-\d+/);
	});

	it("renders `+N -M` beside the context meter after an edit", () => {
		initTheme(undefined, false);
		const stats = new SessionDiffStats();
		const footer = new FooterComponent(createSession(), createFooterData(), stats);
		stats.record("edit", { path: "a.ts" }, { details: { diff: "-1  old\n+1  new\n+2  newer\n  3  ctx" } });

		const line = statsText(footer);
		expect(line).toContain("+2 -1");
		// Beside the meter: the chip sits right after `ctx …`, before the token stats.
		expect(line.indexOf("+2 -1")).toBeGreaterThan(line.indexOf("ctx"));
		expect(line.indexOf("+2 -1")).toBeLessThan(line.indexOf("↑"));
	});

	it("accumulates across executions for the session's whole story", () => {
		initTheme(undefined, false);
		const stats = new SessionDiffStats();
		const footer = new FooterComponent(createSession(), createFooterData(), stats);
		stats.record("edit", {}, { details: { diff: "-1  a\n+1  b" } });
		stats.record("write", { content: "one\ntwo\nthree" }, {});
		expect(statsText(footer)).toContain("+4 -1");
	});

	it("paints added in toolDiffAdded and removed in toolDiffRemoved (the edit-block tokens)", () => {
		setThemeInstance(loadThemeFromPath(darkThemePath, "truecolor"));
		const stats = new SessionDiffStats();
		const footer = new FooterComponent(createSession(), createFooterData(), stats);
		stats.record("edit", {}, { details: { diff: "-1  a\n+1  b" } });

		const raw = footer.render(120)[1];
		expect(raw).toContain(theme.fg("toolDiffAdded", "+1"));
		expect(raw).toContain(theme.fg("toolDiffRemoved", "-1"));
	});

	it("keeps the stats line width-safe with the chip present", () => {
		setThemeInstance(loadThemeFromPath(darkThemePath, "truecolor"));
		const stats = new SessionDiffStats();
		const footer = new FooterComponent(createSession(), createFooterData(), stats);
		stats.add({ added: 1234, removed: 987 });

		for (const width of [40, 60, 93, 120]) {
			for (const line of footer.render(width)) {
				const visible = stripAnsi(line);
				expect(visible.length).toBeLessThanOrEqual(width);
			}
		}
	});

	it("disappears again when the session resets its story", () => {
		initTheme(undefined, false);
		const stats = new SessionDiffStats();
		const footer = new FooterComponent(createSession(), createFooterData(), stats);
		stats.add({ added: 5, removed: 2 });
		expect(statsText(footer)).toContain("+5 -2");
		stats.reset();
		expect(statsText(footer)).not.toMatch(/\+\d+\s+-\d+/);
	});

	it("can be (re)attached via setDiffStats after construction", () => {
		initTheme(undefined, false);
		const footer = new FooterComponent(createSession(), createFooterData());
		expect(statsText(footer)).not.toMatch(/\+\d+\s+-\d+/);
		const stats = new SessionDiffStats();
		stats.add({ added: 3, removed: 0 });
		footer.setDiffStats(stats);
		expect(statsText(footer)).toContain("+3 -0");
		footer.setDiffStats(undefined);
		expect(statsText(footer)).not.toMatch(/\+\d+\s+-\d+/);
	});
});
