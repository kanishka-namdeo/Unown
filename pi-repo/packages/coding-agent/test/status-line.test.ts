// status-line.test.ts — Da capo R2 (the statusline script contract):
// the payload builder (the JSON contract between host and script), the
// stdout parser (2-line cap, ANSI passthrough), the shell runner (stdin
// wiring, 500 ms timeout, non-zero exit) with BOTH a fake spawn seam and
// real shell round-trips, and the docked component (cache-render, padding,
// the one-time failure notice, re-entrancy guard, timer lifecycle).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
        buildStatusLinePayload,
        parseStatusLineLines,
        runStatusLineCommand,
        StatusLineComponent,
        statusLineFailureNotice,
        type StatusLineInput,
        type StatusLineSpawnFn,
} from "../src/modes/interactive/components/status-line.ts";

const BASE_INPUT: StatusLineInput = {
        sessionId: "sess-1",
        sessionName: "fix-the-thing",
        cwd: "/home/user/projects/Unown",
        modelId: "agnes-3.0-flash",
        modelProvider: "agnes",
        thinkingLevel: "medium",
        permissionMode: "acceptEdits",
        contextUsage: { tokens: 84_000, contextWindow: 200_000, percent: 42.0 },
        tokens: { input: 1000, output: 2000, cacheRead: 3000, cacheWrite: 4000, total: 10_000 },
        turnCount: 7,
        queuedMessages: 1,
        version: "0.0.68",
        bootedAtMs: 1_000,
        nowMs: 61_000,
};

describe("buildStatusLinePayload", () => {
        it("carries every field Unown owns", () => {
                const payload = buildStatusLinePayload(BASE_INPUT);
                expect(payload).toEqual({
                        session: { id: "sess-1", name: "fix-the-thing" },
                        cwd: "/home/user/projects/Unown",
                        project: "Unown",
                        model: { id: "agnes-3.0-flash", provider: "agnes" },
                        thinkingLevel: "medium",
                        permissionMode: "acceptEdits",
                        contextWindow: { usedPercent: 42, tokens: 84_000, window: 200_000 },
                        tokens: { input: 1000, output: 2000, cacheRead: 3000, cacheWrite: 4000, total: 10_000 },
                        turnCount: 7,
                        queuedMessages: 1,
                        version: "0.0.68",
                        uptimeMs: 60_000,
                });
        });

        it("degrades honestly: no model, no context usage, no permission hook", () => {
                const payload = buildStatusLinePayload({
                        ...BASE_INPUT,
                        modelId: undefined,
                        modelProvider: undefined,
                        permissionMode: undefined,
                        contextUsage: undefined,
                        sessionName: undefined,
                });
                expect(payload.model).toEqual({ id: undefined, provider: undefined });
                expect(payload.permissionMode).toBeUndefined();
                expect(payload.contextWindow).toEqual({ usedPercent: null, tokens: null, window: null });
                expect(payload.session.name).toBeUndefined();
        });

        it("keeps unknown context tokens honest (percent null, window known)", () => {
                const payload = buildStatusLinePayload({
                        ...BASE_INPUT,
                        contextUsage: { tokens: null, contextWindow: 200_000, percent: null },
                });
                expect(payload.contextWindow).toEqual({ usedPercent: null, tokens: null, window: 200_000 });
        });

        it("rounds percent to one decimal", () => {
                const payload = buildStatusLinePayload({
                        ...BASE_INPUT,
                        contextUsage: { tokens: 111_111, contextWindow: 200_000, percent: 55.5555 },
                });
                expect(payload.contextWindow.usedPercent).toBe(55.6);
        });

        it("serializes to a single JSON line the script can parse", () => {
                const json = JSON.stringify(buildStatusLinePayload(BASE_INPUT));
                expect(json).not.toContain("\n");
                expect(JSON.parse(json).project).toBe("Unown");
        });
});

describe("parseStatusLineLines", () => {
        it("splits on newlines and drops trailing empties", () => {
                expect(parseStatusLineLines("one\ntwo\n\n\n")).toEqual(["one", "two"]);
        });

        it("caps at 2 lines", () => {
                expect(parseStatusLineLines("a\nb\nc")).toEqual(["a", "b"]);
        });

        it("keeps ANSI escapes untouched (passthrough)", () => {
                const line = "\x1b[32mgreen\x1b[0m";
                expect(parseStatusLineLines(`${line}\n`)).toEqual([line]);
        });

        it("handles CRLF and all-empty output", () => {
                expect(parseStatusLineLines("one\r\ntwo\r\n")).toEqual(["one", "two"]);
                expect(parseStatusLineLines("\n\n")).toEqual([]);
                expect(parseStatusLineLines("")).toEqual([]);
        });
});

/** A fake spawn that emulates a shell script: prints `script` and exits. Script and
 *  exitCode may be functions evaluated AT SPAWN TIME (for state-flipping tests). */
function makeSpawnScript(
        script: string | (() => string),
        opts: { exitCode?: number | (() => number) } = {},
): StatusLineSpawnFn {
        return () => {
                const text = typeof script === "function" ? script() : script;
                const exitCode = typeof opts.exitCode === "function" ? opts.exitCode() : (opts.exitCode ?? 0);
                const stdoutHandlers: Array<(data: Buffer) => void> = [];
                const closeHandlers: Array<(...args: never[]) => void> = [];
                queueMicrotask(() => {
                        stdoutHandlers.forEach((h) => h(Buffer.from(text)));
                        closeHandlers.forEach((h) => h(exitCode as never));
                });
                return {
                        stdin: { write: () => {}, end: () => {}, on: () => {} },
                        stdout: { on: (_event: "data", listener: (data: Buffer) => void) => void stdoutHandlers.push(listener) },
                        on: (event: "error" | "close", listener: (...args: never[]) => void) => {
                                if (event === "close") closeHandlers.push(listener);
                        },
                        kill: () => {},
                };
        };
}

describe("runStatusLineCommand (fake spawn seam)", () => {
        it("writes the JSON payload to stdin and resolves stdout on exit 0", async () => {
                let received: string | undefined;
                const stdoutHandlers: Array<(data: Buffer) => void> = [];
                const closeHandlers: Array<(...args: never[]) => void> = [];
                const spawnFn: StatusLineSpawnFn = () => ({
                        stdin: {
                                write: (data: string) => {
                                        received = data;
                                },
                                end: () => {},
                                on: () => {},
                        },
                        stdout: { on: (_event: "data", listener: (data: Buffer) => void) => void stdoutHandlers.push(listener) },
                        on: (event: "error" | "close", listener: (...args: never[]) => void) => {
                                if (event === "close") closeHandlers.push(listener);
                        },
                        kill: () => {},
                });
                const payload = buildStatusLinePayload(BASE_INPUT);
                const promise = runStatusLineCommand("whatever", payload, { spawnFn });
                await Promise.resolve();
                stdoutHandlers.forEach((h) => h(Buffer.from("the line")));
                closeHandlers.forEach((h) => h(0 as never));
                const result = await promise;
                expect(result).toEqual({ ok: true, stdout: "the line" });
                expect(received).toBe(JSON.stringify(payload));
        });

        it("fails on non-zero exit", async () => {
                const spawnFn = makeSpawnScript("ignored", { exitCode: 3 });
                const result = await runStatusLineCommand("cmd", buildStatusLinePayload(BASE_INPUT), { spawnFn });
                expect(result).toEqual({ ok: false, reason: "nonzero" });
        });

        it("fails on timeout and kills the process", async () => {
                let killed = false;
                const spawnFn: StatusLineSpawnFn = () => ({
                        stdin: { write: () => {}, end: () => {}, on: () => {} },
                        stdout: { on: () => {} },
                        on: () => {},
                        kill: () => {
                                killed = true;
                        },
                });
                const result = await runStatusLineCommand("sleep", buildStatusLinePayload(BASE_INPUT), { spawnFn, timeoutMs: 20 });
                expect(result).toEqual({ ok: false, reason: "timeout" });
                expect(killed).toBe(true);
        });
});

describe("runStatusLineCommand (real shell)", () => {
        it("round-trips the payload through a script that reads stdin (the contract)", async () => {
                const command = `node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=JSON.parse(d);process.stdout.write(p.project+' '+p.permissionMode)})"`;
                const payload = buildStatusLinePayload(BASE_INPUT);
                const result = await runStatusLineCommand(command, payload, { timeoutMs: 4000 });
                expect(result).toEqual({ ok: true, stdout: "Unown acceptEdits" });
        }, 10_000);

        it("resolves ok with multi-line echo output", async () => {
                const result = await runStatusLineCommand(`printf 'one\\ntwo\\nthree\\n'`, buildStatusLinePayload(BASE_INPUT), {
                        timeoutMs: 4000,
                });
                expect(result.ok).toBe(true);
                if (result.ok) expect(parseStatusLineLines(result.stdout)).toEqual(["one", "two"]);
        }, 10_000);

        it("fails on a non-zero exit", async () => {
                const result = await runStatusLineCommand("exit 3", buildStatusLinePayload(BASE_INPUT), { timeoutMs: 4000 });
                expect(result).toEqual({ ok: false, reason: "nonzero" });
        }, 10_000);

        it("fails on timeout against a sleeping command", async () => {
                const result = await runStatusLineCommand("sleep 2", buildStatusLinePayload(BASE_INPUT), { timeoutMs: 100 });
                expect(result).toEqual({ ok: false, reason: "timeout" });
        }, 10_000);
});

describe("StatusLineComponent", () => {
        beforeEach(() => {
                vi.useFakeTimers();
        });
        afterEach(() => {
                vi.useRealTimers();
        });

        function makeComponent(overrides: Record<string, unknown> = {}) {
                const renders: number[] = [];
                const component = new StatusLineComponent({
                        command: "echo hi",
                        payloadProvider: () => ({ ...BASE_INPUT }),
                        onRequestRender: () => renders.push(Date.now()),
                        ...overrides,
                });
                return { component, renders };
        }

        it("renders nothing before the first run", () => {
                const { component } = makeComponent();
                expect(component.render(40)).toEqual([]);
        });

        it("caches the script's lines and pads them to the viewport width", async () => {
                const spawnFn = makeSpawnScript("my-bar");
                const { component, renders } = makeComponent({ spawnFn });
                await component.refresh();
                const lines = component.render(20);
                expect(lines).toHaveLength(1);
                expect(lines[0]).toBe("my-bar".padEnd(20));
                expect(renders.length).toBeGreaterThan(0);
        });

        it("truncates over-wide lines", async () => {
                const spawnFn = makeSpawnScript("a-very-long-statusline-row");
                const { component } = makeComponent({ spawnFn });
                await component.refresh();
                const lines = component.render(10);
                expect(lines[0]!.length).toBeGreaterThanOrEqual(10);
                expect(lines[0]).toContain("...");
        });

        it("pads by VISIBLE width, not byte length (ANSI passthrough)", async () => {
                const spawnFn = makeSpawnScript("\x1b[32mab\x1b[0m");
                const { component } = makeComponent({ spawnFn });
                await component.refresh();
                const lines = component.render(6);
                // visible width 2 → 4 trailing spaces; the escapes stay inline.
                expect(lines[0]).toBe("\x1b[32mab\x1b[0m    ");
        });

        it("caps the cached lines at two", async () => {
                const spawnFn = makeSpawnScript("one\ntwo\nthree");
                const { component } = makeComponent({ spawnFn });
                await component.refresh();
                expect(component.render(40)).toHaveLength(2);
        });

        it("shows the one-time dim notice when the first run fails", async () => {
                const failing = makeSpawnScript("boom", { exitCode: 1 });
                const { component } = makeComponent({ spawnFn: failing });
                await component.refresh();
                // Render wide so truncation never muddies the notice assertion.
                expect(component.render(200)[0]!.trimEnd()).toBe(statusLineFailureNotice("echo hi"));
        });

        it("replaces the notice with the first successful line", async () => {
                let succeedNow = false;
                const spawnFn = makeSpawnScript(() => (succeedNow ? "recovered" : "boom"), {
                        exitCode: () => (succeedNow ? 0 : 1),
                });
                const { component } = makeComponent({ spawnFn });
                await component.refresh();
                expect(component.render(200)[0]!.trimEnd()).toBe(statusLineFailureNotice("echo hi"));
                succeedNow = true;
                await component.refresh();
                expect(component.render(20)).toEqual(["recovered".padEnd(20)]);
        });

        it("keeps the last good lines on a later failure (no flicker, no notice)", async () => {
                let failNow = false;
                const spawnFn = makeSpawnScript(() => "good-line", { exitCode: () => (failNow ? 1 : 0) });
                const { component } = makeComponent({ spawnFn });
                await component.refresh();
                expect(component.render(20)).toEqual(["good-line".padEnd(20)]);
                failNow = true;
                await component.refresh();
                expect(component.render(20)).toEqual(["good-line".padEnd(20)]);
        });

        it("treats empty stdout as a legitimate (blank) statusline, not a failure", async () => {
                const spawnFn = makeSpawnScript("");
                const { component } = makeComponent({ spawnFn });
                await component.refresh();
                expect(component.render(20)).toEqual([]);
        });

        it("treats a throwing payload provider as a failed run", async () => {
                const { component } = makeComponent({
                        payloadProvider: () => {
                                throw new Error("boom");
                        },
                });
                await component.refresh();
                expect(component.render(200)[0]!.trimEnd()).toBe(statusLineFailureNotice("echo hi"));
        });

        it("skips a refresh while one is in flight", async () => {
                let spawns = 0;
                let release: (() => void) | undefined;
                const spawnFn: StatusLineSpawnFn = () => {
                        spawns++;
                        const stdoutHandlers: Array<(data: Buffer) => void> = [];
                        const closeHandlers: Array<(...args: never[]) => void> = [];
                        release = () => {
                                stdoutHandlers.forEach((h) => h(Buffer.from("late")));
                                closeHandlers.forEach((h) => h(0 as never));
                        };
                        return {
                                stdin: { write: () => {}, end: () => {}, on: () => {} },
                                stdout: { on: (_event: "data", listener: (data: Buffer) => void) => void stdoutHandlers.push(listener) },
                                on: (event: "error" | "close", listener: (...args: never[]) => void) => {
                                        if (event === "close") closeHandlers.push(listener);
                                },
                                kill: () => {},
                        };
                };
                const { component } = makeComponent({ spawnFn });
                const first = component.refresh();
                const second = component.refresh(); // in-flight guard: resolves without spawning
                await second;
                expect(spawns).toBe(1);
                release!();
                await first;
                expect(component.render(20)).toEqual(["late".padEnd(20)]);
        });

        it("starts the refreshMs timer and stops it on stop()", async () => {
                const spawnFn = makeSpawnScript("tick");
                const { component } = makeComponent({ spawnFn, refreshMs: 1000 });
                const refreshSpy = vi.spyOn(component, "refresh");
                component.start();
                await vi.advanceTimersByTimeAsync(2500);
                expect(refreshSpy.mock.calls.length).toBeGreaterThanOrEqual(3); // start + ~2 ticks
                component.stop();
                const callsAtStop = refreshSpy.mock.calls.length;
                await vi.advanceTimersByTimeAsync(3000);
                expect(refreshSpy.mock.calls.length).toBe(callsAtStop);
        });

        it("ignores a refresh after stop()", async () => {
                const spawnFn = makeSpawnScript("after-stop");
                const { component } = makeComponent({ spawnFn });
                component.stop();
                await component.refresh();
                expect(component.render(20)).toEqual([]);
        });

        it("round-trips through a REAL shell command (the docked contract)", async () => {
                const { component } = makeComponent({ command: "echo real-bar" });
                await component.refresh();
                expect(component.render(20)).toEqual(["real-bar".padEnd(20)]);
        }, 10_000);
});

describe("statusLineFailureNotice", () => {
        it("names the command and the investigation path", () => {
                const notice = statusLineFailureNotice("my-statusline-script --flag");
                expect(notice).toContain("my-statusline-script --flag");
                expect(notice).toContain("/statusline");
        });

        it("shortens very long commands", () => {
                const notice = statusLineFailureNotice("x".repeat(80));
                expect(notice).toContain("…");
                expect(notice).not.toContain("x".repeat(41)); // the command itself is cut at 40
        });
});
