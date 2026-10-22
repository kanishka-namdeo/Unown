// Unit tests for the milestone-2 onboarding tips on top of the "First
// flights" extension: the "You're flying" line fired on agent_settled after
// the first-ever latched task, the rotating session-start tips for returning
// users, and the pure helpers in src/onboarding-tips.ts. Same fake-pi harness
// as test/flights.test.ts (captured handlers, fake ctx.ui spies, fresh
// extension + isolated tmp home per case — never the real ~/.unown).
import "./_env.ts"; // MUST be the first import
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFirstFlightsExtension, type FlightsCatalogResult } from "../src/flights.ts";
import { flyingTipText, FLYING_TIP_ID, nextSessionTip, sessionTips } from "../src/onboarding-tips.ts";
import { defaultOnboardingState, readOnboardingState, writeOnboardingState } from "../src/onboarding-state.ts";

const TMP = mkdtempSync(join(tmpdir(), "unown-flights-tips-"));
afterAll(() => {
        try {
                rmSync(TMP, { recursive: true, force: true });
        } catch {
                /* best effort */
        }
});

let seq = 0;
/** Isolated home per case (the extension writes onboarding.json there). */
function freshHome(): string {
        const dir = join(TMP, `home-${Date.now().toString(36)}-${seq++}`);
        mkdirSync(dir, { recursive: true });
        return dir;
}

type Handler = (event: any, ctx?: any) => any;

/** Fake pi (the mcp.test.ts pattern): records on()/registerCommand() and replays events. */
function makeFakePi() {
        const handlers = new Map<string, Handler[]>();
        const commands = new Map<string, { description: string; handler: Handler }>();
        const pi: any = {
                on: (event: string, handler: Handler) => {
                        if (!handlers.has(event)) handlers.set(event, []);
                        handlers.get(event)!.push(handler);
                },
                registerCommand: (name: string, def: { description: string; handler: Handler }) => commands.set(name, def),
        };
        const emit = async (event: string, payload: any, ctx?: any) => {
                for (const h of handlers.get(event) ?? []) await h(payload, ctx);
        };
        const runCommand = async (name: string, args: string | undefined, ctx: any) => {
                await commands.get(name)!.handler(args, ctx);
        };
        return { pi, emit, runCommand, commands };
}

/** Fake extension ctx: ui.custom mounts the factory's component; notify/custom are the spies under test. */
function makeFakeCtx(overrides: { hasUI?: boolean; mode?: string } = {}) {
        const editorTexts: string[] = [];
        const statuses: Array<[string, string | undefined]> = [];
        const notifications: Array<{ text: string; level: string }> = [];
        const customCalls: Array<Promise<FlightsCatalogResult>> = [];
        const mounted: Array<{ component: any; done: (result: FlightsCatalogResult) => void }> = [];
        const plainTheme: any = {
                fg: (_color: string, text: string) => text,
                bg: (_color: string, text: string) => text,
                bold: (text: string) => text,
        };
        const ctx: any = {
                hasUI: overrides.hasUI ?? true,
                mode: overrides.mode ?? "tui",
                ui: {
                        custom: (factory: any) => {
                                const promise = new Promise<FlightsCatalogResult>((resolve) => {
                                        const done = (result: FlightsCatalogResult) => resolve(result);
                                        mounted.push({ component: factory({}, plainTheme, {}, done), done });
                                });
                                customCalls.push(promise);
                                return promise;
                        },
                        setEditorText: (text: string) => editorTexts.push(text),
                        setStatus: (key: string, text: string | undefined) => statuses.push([key, text]),
                        notify: (text: string, level: string = "info") => notifications.push({ text, level }),
                },
        };
        return { ctx, editorTexts, statuses, notifications, customCalls, mounted };
}

/** Fresh extension + fake pi wired through the factory, with an isolated tmp home. */
function fresh(overrides: { autoShow?: boolean } = {}) {
        const home = freshHome();
        const ext: any = createFirstFlightsExtension({ cwd: TMP, home, ...overrides });
        const fake = makeFakePi();
        ext.factory(fake.pi);
        return { home, fake };
}

/** Boot a FRESH extension instance (new process flags) over an existing home. */
function boot(home: string) {
        const ext: any = createFirstFlightsExtension({ cwd: TMP, home });
        const fake = makeFakePi();
        ext.factory(fake.pi);
        const ui = makeFakeCtx();
        return { fake, ui };
}

const STARTUP = { type: "session_start", reason: "startup" };
const SETTLED = { type: "agent_settled" };
const INPUT = (text: string) => ({ type: "input", text, source: "interactive" });

describe("createFirstFlightsExtension — onboarding tips", () => {
        test("fresh boot: the catalog shows and NO tip fires (one surface per boot)", async () => {
                const { fake } = fresh();
                const ui = makeFakeCtx();
                await fake.emit("session_start", STARTUP, ui.ctx);
                expect(ui.customCalls.length).toBe(1);
                expect(ui.notifications.length).toBe(0);
        });

        test("the first task latched in THIS process earns the flying tip on agent_settled", async () => {
                const { home, fake } = fresh();
                const ui = makeFakeCtx();
                await fake.emit("input", INPUT("hello"), ui.ctx);
                await fake.emit("agent_settled", SETTLED, ui.ctx);
                expect(ui.notifications.length).toBe(1);
                expect(ui.notifications[0]!.text).toBe(flyingTipText());
                expect(ui.notifications[0]!.level).toBe("info");
                const state = readOnboardingState(home);
                expect(state.tipsSeen).toEqual([FLYING_TIP_ID]);
                expect(typeof state.firstTaskAt).toBe("string");
        });

        test("a pre-existing firstTaskAt never re-triggers the flying tip", async () => {
                const home = freshHome();
                writeOnboardingState(
                        { ...defaultOnboardingState(), firstTaskAt: "2026-01-01T00:00:00.000Z" },
                        home,
                );
                const ext: any = createFirstFlightsExtension({ cwd: TMP, home });
                const fake = makeFakePi();
                ext.factory(fake.pi);
                const ui = makeFakeCtx();
                // No input event this process — settle must be a no-op.
                await fake.emit("agent_settled", SETTLED, ui.ctx);
                expect(ui.notifications.length).toBe(0);
                expect(readOnboardingState(home).tipsSeen).toEqual([]);
        });

        test("a second agent_settled never repeats the flying tip", async () => {
                const { home, fake } = fresh();
                const ui = makeFakeCtx();
                await fake.emit("input", INPUT("hello"), ui.ctx);
                await fake.emit("agent_settled", SETTLED, ui.ctx);
                await fake.emit("agent_settled", SETTLED, ui.ctx);
                expect(ui.notifications.length).toBe(1);
                expect(readOnboardingState(home).tipsSeen).toEqual([FLYING_TIP_ID]);
        });

        test("returning boot: exactly one rotating tip (undo), once per process", async () => {
                const home = freshHome();
                writeOnboardingState(
                        { ...defaultOnboardingState(), firstTaskAt: "2026-01-01T00:00:00.000Z" },
                        home,
                );
                const { fake, ui } = boot(home);
                await fake.emit("session_start", STARTUP, ui.ctx);
                expect(ui.notifications.length).toBe(1);
                expect(ui.notifications[0]!.text).toBe(
                        "Tip — /undo reverts the last turn's file changes; /checkpoint snapshots before a risky edit.",
                );
                expect(ui.notifications[0]!.level).toBe("info");
                expect(ui.customCalls.length).toBe(0); // returning users never get the card
                expect(readOnboardingState(home).tipsSeen).toEqual(["undo"]);
                // A second session_start in the SAME process: the per-process flag wins.
                const ui2 = makeFakeCtx();
                await fake.emit("session_start", STARTUP, ui2.ctx);
                expect(ui2.notifications.length).toBe(0);
                expect(readOnboardingState(home).tipsSeen).toEqual(["undo"]);
        });

        test("boot sequence: catalog → undo → palette → plan → memory → silence", async () => {
                const home = freshHome();
                // Boot 1: the fresh user — catalog, no tip.
                {
                        const { fake, ui } = boot(home);
                        await fake.emit("session_start", STARTUP, ui.ctx);
                        expect(ui.customCalls.length).toBe(1);
                        expect(ui.notifications.length).toBe(0);
                        // The first task flies: the input event latches firstTaskAt.
                        await fake.emit("input", INPUT("hello"), ui.ctx);
                        expect(typeof readOnboardingState(home).firstTaskAt).toBe("string");
                }
                // Boots 2-5: exactly one tip each, in list order.
                const texts = [
                        "Tip — /undo reverts the last turn's file changes; /checkpoint snapshots before a risky edit.",
                        "Tip — ctrl+k opens the command palette; every command is one search away.",
                        "Tip — /plan explores read-only first, then proposes a numbered plan you approve before execution.",
                        "Tip — sessions leave notes for tomorrow: .unown/memory/project.md remembers what mattered.",
                ];
                for (const text of texts) {
                        const { fake, ui } = boot(home);
                        await fake.emit("session_start", STARTUP, ui.ctx);
                        expect(ui.customCalls.length).toBe(0);
                        expect(ui.notifications.length).toBe(1);
                        expect(ui.notifications[0]!.text).toBe(text);
                }
                expect(readOnboardingState(home).tipsSeen).toEqual(["undo", "palette", "plan", "memory"]);
                // Boot 6: the list is exhausted — nothing at all.
                {
                        const { fake, ui } = boot(home);
                        await fake.emit("session_start", STARTUP, ui.ctx);
                        expect(ui.customCalls.length).toBe(0);
                        expect(ui.notifications.length).toBe(0);
                        expect(readOnboardingState(home).tipsSeen).toEqual(["undo", "palette", "plan", "memory"]);
                }
        });

        test("autoShow: false — no catalog AND no session tip; the flying tip still earns itself", async () => {
                // The `unown "prompt"` initialMessage lane: mid-task from t=0, so
                // neither onboarding surface may interrupt — but its message
                // latches and settles like any first task.
                const { home, fake } = fresh({ autoShow: false });
                const ui = makeFakeCtx();
                await fake.emit("session_start", STARTUP, ui.ctx);
                expect(ui.customCalls.length).toBe(0);
                expect(ui.notifications.length).toBe(0);
                await fake.emit("input", INPUT("do the thing"), ui.ctx);
                await fake.emit("agent_settled", SETTLED, ui.ctx);
                expect(ui.notifications.length).toBe(1);
                expect(ui.notifications[0]!.text).toBe(flyingTipText());
                expect(readOnboardingState(home).tipsSeen).toEqual([FLYING_TIP_ID]);
        });

        test("non-tui or UI-less contexts never see tips of any kind", async () => {
                // mode "cli": catalog, session tip and flying tip are all TUI-only.
                {
                        const { home, fake } = fresh();
                        const ui = makeFakeCtx({ mode: "cli" });
                        await fake.emit("session_start", STARTUP, ui.ctx);
                        await fake.emit("input", INPUT("hello"), ui.ctx);
                        await fake.emit("agent_settled", SETTLED, ui.ctx);
                        expect(ui.customCalls.length).toBe(0);
                        expect(ui.notifications.length).toBe(0);
                        // The latch itself still happened (state, not UI).
                        expect(typeof readOnboardingState(home).firstTaskAt).toBe("string");
                }
                // hasUI false with NO ui object at all — the guards must not touch it.
                {
                        const { home, fake } = fresh();
                        const bare: any = { hasUI: false, mode: "tui" };
                        await fake.emit("session_start", STARTUP, bare);
                        await fake.emit("input", INPUT("hello"), bare);
                        await fake.emit("agent_settled", SETTLED, bare);
                        expect(typeof readOnboardingState(home).firstTaskAt).toBe("string");
                }
        });
});

describe("onboarding-tips (pure helpers)", () => {
        test("flyingTipText is the pinned copy", () => {
                expect(flyingTipText()).toBe(
                        "You're flying — the first task is done. /flights has more starters · /help lists everything · ctrl+k searches commands.",
                );
        });

        test("sessionTips pins the ids, the order and the copy", () => {
                expect(sessionTips()).toEqual([
                        {
                                id: "undo",
                                text: "Tip — /undo reverts the last turn's file changes; /checkpoint snapshots before a risky edit.",
                        },
                        {
                                id: "palette",
                                text: "Tip — ctrl+k opens the command palette; every command is one search away.",
                        },
                        {
                                id: "plan",
                                text: "Tip — /plan explores read-only first, then proposes a numbered plan you approve before execution.",
                        },
                        {
                                id: "memory",
                                text: "Tip — sessions leave notes for tomorrow: .unown/memory/project.md remembers what mattered.",
                        },
                ]);
                const ids = sessionTips().map((tip) => tip.id);
                expect(new Set(ids).size).toBe(ids.length); // ids unique
                expect(ids).not.toContain(FLYING_TIP_ID); // the flying tip is not a rotating tip
        });

        test("nextSessionTip: list order, dedupe, unknown ids, exhaustion", () => {
                expect(nextSessionTip([])!.id).toBe("undo");
                expect(nextSessionTip(["flying"])!.id).toBe("undo"); // flying never counts toward the rotation
                expect(nextSessionTip(["undo"])!.id).toBe("palette");
                expect(nextSessionTip(["undo", "palette"])!.id).toBe("plan");
                expect(nextSessionTip(["palette", "undo"])!.id).toBe("plan"); // seen order is irrelevant
                expect(nextSessionTip(["undo", "palette", "plan"])!.id).toBe("memory");
                expect(nextSessionTip(["nonsense", "undo"])!.id).toBe("palette"); // unknown ids ignored
                expect(nextSessionTip(["undo", "palette", "plan", "memory"])).toBeNull();
                expect(nextSessionTip(["memory", "plan", "palette", "undo"])).toBeNull();
                expect(nextSessionTip(["flying", "memory", "plan", "palette", "undo"])).toBeNull();
        });

        test("nextSessionTip never returns the flying tip", () => {
                const ids = sessionTips().map((tip) => tip.id);
                const subsets = [[], ["undo"], ["palette"], ["flying"], ids.slice(0, 3), ids.slice(1), ids];
                for (const seen of subsets) {
                        const tip = nextSessionTip(seen);
                        if (tip !== null) expect(tip.id).not.toBe(FLYING_TIP_ID);
                }
        });
});
