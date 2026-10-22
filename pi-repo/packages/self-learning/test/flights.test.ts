// Unit tests for src/flights.ts — the "First flights" guided first-task
// extension, driven through a fake pi + a fake extension ctx (the
// fleet-child/mcp harness pattern): the session_start auto-show gate, the
// input-event firstTaskAt latch, the /flights command, and the catalog
// component's key routing. No real TUI, no network; every case gets a fresh
// extension instance and an isolated tmp home (never the real ~/.unown).
import "./_env.ts"; // MUST be the first import
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFirstFlightsExtension, type FlightsCatalogResult } from "../src/flights.ts";
import { firstFlightCatalog } from "../src/flights-core.ts";
import { defaultOnboardingState, readOnboardingState, writeOnboardingState } from "../src/onboarding-state.ts";

const TMP = mkdtempSync(join(tmpdir(), "unown-flights-"));
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

/** Pass-through theme (pi's plain mode): styles are identity so assertions read plain text. */
const plainTheme: any = {
        fg: (_color: string, text: string) => text,
        bg: (_color: string, text: string) => text,
        bold: (text: string) => text,
};

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

/** Fake extension ctx: ui.custom mounts the factory's component with a captured done; the rest are spies. */
function makeFakeCtx(overrides: { hasUI?: boolean; mode?: string } = {}) {
        const editorTexts: string[] = [];
        const statuses: Array<[string, string | undefined]> = [];
        const notifications: Array<{ text: string; level: string }> = [];
        const customCalls: Array<Promise<FlightsCatalogResult>> = [];
        const mounted: Array<{ component: any; done: (result: FlightsCatalogResult) => void }> = [];
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

/** Let showCatalog's post-custom continuation (setEditorText / setStatus) run. */
async function settle(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 0));
}

const STARTUP = { type: "session_start", reason: "startup" };

describe("createFirstFlightsExtension", () => {
        test("session_start (startup, tui, fresh state) auto-shows the catalog", async () => {
                const { fake } = fresh();
                const ui = makeFakeCtx();
                await fake.emit("session_start", STARTUP, ui.ctx);
                expect(ui.customCalls.length).toBe(1);
                expect(ui.mounted.length).toBe(1);
                // Render smoke: the card carries the title, the intro and every flight row.
                const card = ui.mounted[0]!.component.render(100).join("\n");
                expect(card).toContain("First flights");
                expect(card).toContain("Pick a starter task — it lands in the editor, ready to send.");
                expect(card).toContain("x  don't show this again");
                for (const flight of firstFlightCatalog()) {
                        expect(card).toContain(flight.title);
                        expect(card).toContain(flight.blurb);
                }
        });

        test("picking a flight prefills the editor and leaves the hint", async () => {
                const { fake } = fresh();
                const ui = makeFakeCtx();
                await fake.emit("session_start", STARTUP, ui.ctx);
                const flights = firstFlightCatalog();
                ui.mounted[0]!.component.handleInput("2");
                const result = await ui.customCalls[0];
                expect(result).toEqual(flights[1]);
                await settle();
                expect(ui.editorTexts).toEqual([flights[1]!.prompt]);
                expect(ui.statuses.some(([key, text]) => key === "flights" && String(text).includes("Enter to send"))).toBe(
                        true,
                );
        });

        test("Esc dismisses without writing any state", async () => {
                const { home, fake } = fresh();
                const ui = makeFakeCtx();
                await fake.emit("session_start", STARTUP, ui.ctx);
                ui.mounted[0]!.component.handleInput("\x1b");
                const result = await ui.customCalls[0];
                expect(result).toBeUndefined();
                await settle();
                expect(readOnboardingState(home)).toEqual(defaultOnboardingState());
        });

        test("'x' settles never-again and persists flightsDismissed", async () => {
                const { home, fake } = fresh();
                const ui = makeFakeCtx();
                await fake.emit("session_start", STARTUP, ui.ctx);
                ui.mounted[0]!.component.handleInput("x");
                const result = await ui.customCalls[0];
                expect(result).toBe("never-again");
                await settle();
                const state = readOnboardingState(home);
                expect(state.flightsDismissed).toBe(true);
                expect(state.firstTaskAt).toBeUndefined();
        });

        test("arrow-up clamps at the top; enter picks the still-selected flight 0", async () => {
                const { fake } = fresh();
                const ui = makeFakeCtx();
                await fake.emit("session_start", STARTUP, ui.ctx);
                const component = ui.mounted[0]!.component;
                component.handleInput("\x1b[A"); // up from index 0 — clamped
                component.handleInput("\r");
                const result = await ui.customCalls[0];
                expect(result).toEqual(firstFlightCatalog()[0]);
        });

        test("the first real interactive input latches firstTaskAt and stops future auto-shows", async () => {
                const { home, fake } = fresh();
                const ui = makeFakeCtx();
                await fake.emit("session_start", STARTUP, ui.ctx);
                expect(ui.customCalls.length).toBe(1);
                await fake.emit("input", { type: "input", text: "hello", source: "interactive" }, ui.ctx);
                const state = readOnboardingState(home);
                expect(typeof state.firstTaskAt).toBe("string");
                expect(Number.isNaN(Date.parse(state.firstTaskAt!))).toBe(false);
                // The prefill hint is cleared with the latch.
                expect(ui.statuses.some(([key, text]) => key === "flights" && text === undefined)).toBe(true);
                // At most one write per process: a second input leaves the timestamp alone.
                await fake.emit("input", { type: "input", text: "more", source: "interactive" }, ui.ctx);
                expect(readOnboardingState(home).firstTaskAt).toBe(state.firstTaskAt);
                // A later session_start never auto-shows again (the latch persisted).
                const ui2 = makeFakeCtx();
                await fake.emit("session_start", STARTUP, ui2.ctx);
                expect(ui2.customCalls.length).toBe(0);
        });

        test("extension-sourced input never latches", async () => {
                const { home, fake } = fresh();
                await fake.emit("input", { type: "input", text: "hello", source: "extension" }, makeFakeCtx().ctx);
                expect(readOnboardingState(home)).toEqual(defaultOnboardingState());
        });

        test("no auto-show for reason 'new', mode 'cli', or a UI-less context", async () => {
                // reason "new" (a /new session — not the boot the card is for)
                {
                        const { fake } = fresh();
                        const ui = makeFakeCtx();
                        await fake.emit("session_start", { type: "session_start", reason: "new" }, ui.ctx);
                        expect(ui.customCalls.length).toBe(0);
                }
                // mode "cli" (print/ACP lanes never see the card)
                {
                        const { fake } = fresh();
                        const ui = makeFakeCtx({ mode: "cli" });
                        await fake.emit("session_start", STARTUP, ui.ctx);
                        expect(ui.customCalls.length).toBe(0);
                }
                // hasUI false with NO ui object at all — the guard must not touch it
                {
                        const { fake } = fresh();
                        const bare: any = { hasUI: false, mode: "tui" };
                        await fake.emit("session_start", STARTUP, bare);
                }
        });

        test("autoShow: false never auto-shows, even with fresh state", async () => {
                const { fake } = fresh({ autoShow: false });
                const ui = makeFakeCtx();
                await fake.emit("session_start", STARTUP, ui.ctx);
                expect(ui.customCalls.length).toBe(0);
        });

        test("flightsDismissed blocks auto-show but /flights still reopens (no latch flips)", async () => {
                const home = freshHome();
                writeOnboardingState({ ...defaultOnboardingState(), flightsDismissed: true }, home);
                const ext: any = createFirstFlightsExtension({ cwd: TMP, home });
                const fake = makeFakePi();
                ext.factory(fake.pi);
                const ui = makeFakeCtx();
                await fake.emit("session_start", STARTUP, ui.ctx);
                expect(ui.customCalls.length).toBe(0);
                // Manual reopen works (the command mounts the catalog synchronously;
                // the fake's promise only settles when done is called)…
                const commandPromise = fake.runCommand("flights", undefined, ui.ctx);
                expect(ui.customCalls.length).toBe(1);
                ui.mounted[0]!.done(undefined); // Esc closes it
                await commandPromise;
                // …and does not flip any latch.
                const state = readOnboardingState(home);
                expect(state.flightsDismissed).toBe(true);
                expect(state.firstTaskAt).toBeUndefined();
        });

        test("/flights is registered with the exact name and degrades outside the TUI", async () => {
                const { fake } = fresh();
                expect(fake.commands.has("flights")).toBe(true);
                expect(fake.commands.get("flights")!.description).toBe("Reopen the First flights starter catalog");
                const ui = makeFakeCtx({ hasUI: false, mode: "print" });
                await fake.runCommand("flights", undefined, ui.ctx); // must not throw
                expect(ui.notifications.length).toBe(1);
                expect(ui.notifications[0]!.text).toContain("First flights lives inside the TUI");
        });

        test("whitespace-only input never latches", async () => {
                const { home, fake } = fresh();
                const ui = makeFakeCtx();
                await fake.emit("input", { type: "input", text: "   ", source: "interactive" }, ui.ctx);
                expect(readOnboardingState(home)).toEqual(defaultOnboardingState());
        });
});
