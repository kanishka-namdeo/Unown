import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { FooterComponent, formatCwdForFooter } from "../src/modes/interactive/components/footer.ts";
import { initTheme, loadThemeFromPath, setThemeInstance } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

type AssistantUsage = {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        cost: { total: number };
};

function createSession(options: {
        sessionName: string;
        modelId?: string;
        provider?: string;
        reasoning?: boolean;
        thinkingLevel?: string;
        usage?: AssistantUsage;
        branchUsage?: AssistantUsage;
        compactionUsage?: AssistantUsage;
        toolUsage?: AssistantUsage;
        usingSubscription?: boolean;
}): AgentSession {
        const usage = options.usage;
        const entries: Array<Record<string, unknown>> = [];

        if (usage !== undefined) {
                entries.push({
                        type: "message",
                        message: {
                                role: "assistant",
                                usage,
                        },
                });
        }

        if (options.branchUsage !== undefined) {
                entries.push({
                        type: "branch_summary",
                        usage: options.branchUsage,
                });
        }

        if (options.compactionUsage !== undefined) {
                entries.push({
                        type: "compaction",
                        usage: options.compactionUsage,
                });
        }

        if (options.toolUsage !== undefined) {
                entries.push({
                        type: "message",
                        message: {
                                role: "toolResult",
                                usage: options.toolUsage,
                        },
                });
        }

        const session = {
                state: {
                        model: {
                                id: options.modelId ?? "test-model",
                                provider: options.provider ?? "test",
                                contextWindow: 200_000,
                                reasoning: options.reasoning ?? false,
                        },
                        thinkingLevel: options.thinkingLevel ?? "off",
                },
                sessionManager: {
                        getEntries: () => entries,
                        getSessionName: () => options.sessionName,
                        getCwd: () => "/tmp/project",
                },
                getContextUsage: () => ({ contextWindow: 200_000, percent: 12.3 }),
                modelRuntime: {
                        isUsingSubscription: () => options.usingSubscription ?? false,
                },
        };

        return session as unknown as AgentSession;
}

function createFooterData(providerCount: number): ReadonlyFooterDataProvider {
        const provider = {
                getGitBranch: () => "main",
                getExtensionStatuses: () => new Map<string, string>(),
                getAvailableProviderCount: () => providerCount,
                onBranchChange: (callback: () => void) => {
                        void callback;
                        return () => {};
                },
        };

        return provider;
}

describe("formatCwdForFooter", () => {
        it("does not abbreviate sibling paths that share the home prefix", () => {
                expect(formatCwdForFooter("/home/user2", "/home/user")).toBe("/home/user2");
        });

        it("abbreviates the home directory and descendants", () => {
                expect(formatCwdForFooter("/home/user", "/home/user")).toBe("~");
                expect(formatCwdForFooter("/home/user/project", "/home/user")).toBe("~/project");
        });
});

describe("FooterComponent width handling", () => {
        beforeAll(() => {
                initTheme(undefined, false);
        });

        it("keeps all lines within width for wide session names", () => {
                const width = 93;
                const session = createSession({ sessionName: "한글".repeat(30) });
                const footer = new FooterComponent(session, createFooterData(1));

                const lines = footer.render(width);
                for (const line of lines) {
                        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
                }
        });

        it("keeps stats line within width for wide model and provider names", () => {
                const width = 60;
                const session = createSession({
                        sessionName: "",
                        modelId: "模".repeat(30),
                        provider: "공급자",
                        reasoning: true,
                        thinkingLevel: "high",
                        usage: {
                                input: 12_345,
                                output: 6_789,
                                cacheRead: 0,
                                cacheWrite: 0,
                                cost: { total: 1.234 },
                        },
                });
                const footer = new FooterComponent(session, createFooterData(2));

                const lines = footer.render(width);
                for (const line of lines) {
                        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
                }
        });

        it("includes summary and tool result usage in the total cost", () => {
                const session = createSession({
                        sessionName: "",
                        usage: {
                                input: 100,
                                output: 10,
                                cacheRead: 0,
                                cacheWrite: 0,
                                cost: { total: 0.5 },
                        },
                        branchUsage: {
                                input: 20,
                                output: 5,
                                cacheRead: 0,
                                cacheWrite: 0,
                                cost: { total: 0.25 },
                        },
                        compactionUsage: {
                                input: 5,
                                output: 2,
                                cacheRead: 0,
                                cacheWrite: 0,
                                cost: { total: 0.125 },
                        },
                        toolUsage: {
                                input: 15,
                                output: 3,
                                cacheRead: 0,
                                cacheWrite: 0,
                                cost: { total: 0.375 },
                        },
                });
                const footer = new FooterComponent(session, createFooterData(1));

                const statsLine = stripAnsi(footer.render(120)[1]);
                expect(statsLine).toContain("$1.250");
        });

        it("shows the latest cache hit rate when cache usage is present", () => {
                const session = createSession({
                        sessionName: "",
                        usage: {
                                input: 100,
                                output: 10,
                                cacheRead: 50,
                                cacheWrite: 50,
                                cost: { total: 0.001 },
                        },
                });
                const footer = new FooterComponent(session, createFooterData(1));

                const statsLine = stripAnsi(footer.render(120)[1]);
                expect(statsLine).toContain("CH25.0%");
        });

        it("marks Kimi Coding costs as subscription estimates", () => {
                const session = createSession({
                        sessionName: "",
                        provider: "kimi-coding",
                        usage: {
                                input: 100,
                                output: 10,
                                cacheRead: 0,
                                cacheWrite: 0,
                                cost: { total: 1.234 },
                        },
                });
                const footer = new FooterComponent(session, createFooterData(1));

                expect(stripAnsi(footer.render(120)[1])).toContain("$1.234 (sub)");
        });

        it("marks explicitly identified subscription auth", () => {
                const session = createSession({ sessionName: "", provider: "anthropic", usingSubscription: true });
                const footer = new FooterComponent(session, createFooterData(1));

                expect(stripAnsi(footer.render(120)[1])).toContain("$0.000 (sub)");
        });

        it("does not mark generic OAuth sign-in as a subscription", () => {
                const session = createSession({
                        sessionName: "",
                        provider: "openrouter",
                        usage: {
                                input: 100,
                                output: 10,
                                cacheRead: 0,
                                cacheWrite: 0,
                                cost: { total: 1.234 },
                        },
                });
                const footer = new FooterComponent(session, createFooterData(1));
                const stats = stripAnsi(footer.render(120)[1]);

                expect(stats).toContain("$1.234");
                expect(stats).not.toContain("(sub)");
        });
});

describe("FooterComponent responsive tiers (round 5, R3)", () => {
        beforeAll(() => {
                initTheme(undefined, false);
        });

        const usage = {
                input: 4700,
                output: 5,
                cacheRead: 4100,
                cacheWrite: 0,
                cost: { total: 0.123 },
        };

        function renderStats(width: number, options: { modelId?: string; sessionName?: string } = {}): string {
                const session = createSession({
                        sessionName: options.sessionName ?? "",
                        modelId: options.modelId ?? "agnes-3.0-flash",
                        usage,
                });
                const footer = new FooterComponent(session, createFooterData(1));
                return stripAnsi(footer.render(width)[1]);
        }

        it("narrow (<80): compact meter + model survive, optional stats drop", () => {
                const line = renderStats(56);
                // compact meter: numbers without the bar
                expect(line).toContain("ctx ");
                expect(line).not.toContain("▕");
                // the model identity is always present
                expect(line).toContain("agnes-3.0-flash");
                // optional stats are gated off at the narrow tier
                expect(line).not.toContain("↑");
                expect(line).not.toContain("↓");
                expect(line).not.toContain("R4.1k");
                expect(line).not.toContain("$0.123");
        });

        it("narrow: drops the session name from the location line", () => {
                const session = createSession({ sessionName: "very-long-session-name-here", usage });
                const footer = new FooterComponent(session, createFooterData(1));
                const location = stripAnsi(footer.render(56)[0]);
                expect(location).not.toContain("very-long-session-name");
        });

        it("regular (80-109): bar meter + tokens + model, cache/cost drop by fit", () => {
                const line = renderStats(72 + 8); // 80 — the regular floor
                expect(line).toContain("▕");
                expect(line).toContain("↑4.7k");
                expect(line).toContain("agnes-3.0-flash");
        });

        it("truncates the model with an ellipsis, never a bare mid-word cut", () => {
                const line = renderStats(72, { modelId: "agnes-3.0-flash-long-suffix" });
                if (!line.includes("agnes-3.0-flash-long-suffix")) {
                        // truncated: must end in an ellipsis
                        expect(line.trimEnd().endsWith("…")).toBe(true);
                }
        });

        it("wide (110+) and ultra (144+): every segment fits", () => {
                for (const width of [112, 148]) {
                        const line = renderStats(width);
                        expect(line).toContain("▕");
                        expect(line).toContain("↑4.7k");
                        expect(line).toContain("R4.1k");
                        expect(line).toContain("CH");
                        expect(line).toContain("$0.123");
                        expect(line).toContain("agnes-3.0-flash");
                        // the full line stays within the width
                        expect(line.length).toBeLessThanOrEqual(width);
                }
        });

        it("ultra-narrow (<48): still renders a line exactly the terminal width", () => {
                const width = 40;
                const session = createSession({ sessionName: "", usage });
                const footer = new FooterComponent(session, createFooterData(1));
                const lines = footer.render(width);
                for (const line of lines) {
                        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
                }
        });
});

describe("FooterComponent contextual hint line (round 5, I3)", () => {
        beforeAll(() => {
                initTheme(undefined, false);
        });

        function makeFooter(): FooterComponent {
                return new FooterComponent(createSession({ sessionName: "" }), createFooterData(1));
        }

        it("appends the hint line at regular and wider tiers", () => {
                const footer = makeFooter();
                const withoutHint = footer.render(96).length;
                footer.setHintProvider(() => "? help · ctrl+k palette");
                const withHint = footer.render(96);
                expect(withHint.length).toBe(withoutHint + 1);
                expect(stripAnsi(withHint[withHint.length - 1]!)).toContain("? help");
        });

        it("hides the hint line at the narrow tier (chrome budget)", () => {
                const footer = makeFooter();
                footer.setHintProvider(() => "? help · ctrl+k palette");
                const lines = footer.render(72);
                expect(stripAnsi(lines[lines.length - 1]!)).not.toContain("? help");
        });

        it("survives a throwing provider (no hint, no crash)", () => {
                const footer = makeFooter();
                footer.setHintProvider(() => {
                        throw new Error("boom");
                });
                const lines = footer.render(96);
                expect(stripAnsi(lines[lines.length - 1]!)).not.toContain("?");
                for (const line of lines) {
                        expect(visibleWidth(line)).toBe(96);
                }
        });

        it("renders no extra line when no provider is installed", () => {
                const footer = makeFooter();
                const lines = footer.render(96);
                expect(stripAnsi(lines[lines.length - 1]!)).not.toContain("?");
        });
});

describe("FooterComponent chrome band (move 2)", () => {
        const width = 60;
        const darkThemePath = new URL("../src/modes/interactive/theme/dark.json", import.meta.url).pathname;
        const tempDirs: string[] = [];

        function renderFooter(sessionName: string): string[] {
                const session = createSession({ sessionName });
                const footer = new FooterComponent(session, createFooterData(1));
                return footer.render(width);
        }

        function writeLegacyTheme(): string {
                const themeJson = JSON.parse(
                        readFileSync(new URL("../src/modes/interactive/theme/dark.json", import.meta.url), "utf-8"),
                ) as { name: string; colors: Record<string, string | number> };
                themeJson.name = "legacy-chrome-footer-theme";
                delete themeJson.colors.chromeBg;
                const testDir = mkdtempSync(join(tmpdir(), "pi-footer-chrome-"));
                tempDirs.push(testDir);
                const themePath = join(testDir, `${themeJson.name}.json`);
                writeFileSync(themePath, JSON.stringify(themeJson));
                return themePath;
        }

        afterEach(() => {
                for (const dir of tempDirs.splice(0)) {
                        rmSync(dir, { recursive: true, force: true });
                }
        });

        it("pads every footer line to the full terminal width", () => {
                initTheme(undefined, false);
                const lines = renderFooter("chrome");
                expect(lines.length).toBeGreaterThanOrEqual(2);
                for (const line of lines) {
                        expect(visibleWidth(line)).toBe(width);
                }
        });

        it("paints each line with the chromeBg background in truecolor mode", () => {
                setThemeInstance(loadThemeFromPath(darkThemePath, "truecolor"));
                // dark.json chrome #16161c -> truecolor background escape
                const chromePrefix = "\x1b[48;2;22;22;28m";
                for (const line of renderFooter("chrome")) {
                        expect(line.startsWith(chromePrefix)).toBe(true);
                        expect(line.endsWith("\x1b[49m")).toBe(true);
                }
        });

        it("keeps full-width padding for legacy themes without chromeBg", () => {
                // chromeBg omitted -> "" -> theme.bg passes the line through (default-bg
                // bookends only), but the padding to full width still applies.
                setThemeInstance(loadThemeFromPath(writeLegacyTheme(), "truecolor"));
                const lines = renderFooter("legacy");
                expect(lines.length).toBeGreaterThanOrEqual(2);
                for (const line of lines) {
                        expect(visibleWidth(line)).toBe(width);
                        expect(line.startsWith("\x1b[49m")).toBe(true);
                }
        });

        it("keeps the chrome band unstyled in plain mode while still padding", () => {
                setThemeInstance(loadThemeFromPath(darkThemePath, "plain"));
                for (const line of renderFooter("plain")) {
                        expect(line.includes("\x1b")).toBe(false);
                        expect(visibleWidth(line)).toBe(width);
                }
        });
});
