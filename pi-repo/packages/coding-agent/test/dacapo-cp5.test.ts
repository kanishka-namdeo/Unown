import { describe, expect, test, vi } from "vitest";
import { Container, Text, VStack, findComponentRect } from "@earendil-works/pi-tui";
import { ScrollView } from "../../tui/src/components/scroll-view.ts";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { TuiAltScreen } from "../../tui/src/tui-alt-screen.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import {
        MIN_TURNS,
        PREVIEW_CHARS,
        renderRefocusRecapLine,
        resolveIdleMinutes,
        shouldShowRefocusRecap,
} from "../src/modes/interactive/refocus-recap.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function stripAnsi(text: string): string {
        // The theme wraps hint lines in dim SGR; the CONTENT is what the tests pin.
        return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function renderContainer(container: Container, width = 120): string[] {
        return container.children.flatMap((child) => child.render(width));
}

describe("refocus-recap (Da capo R16) — the pure decision matrix", () => {
        test("the shared env knob resolves minutes, fraction, and the kill switch", () => {
                expect(resolveIdleMinutes({})).toBe(3);
                expect(resolveIdleMinutes({ UNOWN_RECAP_IDLE_MINUTES: "10" })).toBe(10);
                expect(resolveIdleMinutes({ UNOWN_RECAP_IDLE_MINUTES: "0.05" })).toBeCloseTo(0.05);
                expect(resolveIdleMinutes({ UNOWN_RECAP_IDLE_MINUTES: "0" })).toBe(0);
                expect(resolveIdleMinutes({ UNOWN_RECAP_IDLE_MINUTES: "garbage" })).toBe(3);
        });

        test("shows at the CC contract: away >= 3 min AND >= 3 turns", () => {
                expect(shouldShowRefocusRecap(3 * 60_000, 3).action).toBe("show");
                expect(shouldShowRefocusRecap(10 * 60_000, 7).action).toBe("show");
        });

        test("skips below either gate", () => {
                const shortAway = shouldShowRefocusRecap(3 * 60_000 - 1, 5);
                expect(shortAway.action).toBe("skip");
                expect(shortAway.reason).toContain("threshold");

                const fewTurns = shouldShowRefocusRecap(9 * 60_000, MIN_TURNS - 1);
                expect(fewTurns.action).toBe("skip");
                expect(fewTurns.reason).toContain("turn");
        });

        test("the kill switch wins over everything", () => {
                const decision = shouldShowRefocusRecap(60 * 60_000, 20, { minutes: 0 });
                expect(decision.action).toBe("skip");
                expect(decision.reason).toContain("UNOWN_RECAP_IDLE_MINUTES=0");
        });

        test("the rendered line carries the three facts, one line, under 400 chars", () => {
                const line = renderRefocusRecapLine(5 * 60_000 + 20_000, 4, "The build passed and tests are green.\nAll 1090 cases.");
                expect(line).toBe("back after 5 min · 4 turns this session · last: The build passed and tests are green. All 1090 cases.");
                expect(line.length).toBeLessThan(400);
                expect(line.split("\n")).toHaveLength(1);
        });

        test("the preview collapses whitespace and truncates with an ellipsis", () => {
                const long = "x".repeat(PREVIEW_CHARS + 10);
                const line = renderRefocusRecapLine(3 * 60_000, 3, long);
                expect(line.endsWith("…")).toBe(true);
                expect(line.length).toBeLessThan(400);
        });

        test("no last reply drops the last segment instead of rendering an empty quote", () => {
                expect(renderRefocusRecapLine(4 * 60_000, 3, "")).toBe("back after 4 min · 3 turns this session");
                expect(renderRefocusRecapLine(4 * 60_000, 3, undefined)).toBe("back after 4 min · 3 turns this session");
        });
});

describe("the pending strip's send-now hint (Da capo R8)", () => {
        test("renders the send-now hint in its own container when the queue is non-empty", () => {
                initTheme("dark");
                const fakeThis: any = {
                        pendingMessagesContainer: new Container(),
                        pendingSendNowContainer: new Container(),
                        getAllQueuedMessages: () => ({ steering: ["adjust the plan"], followUp: [] }),
                        getAppKeyDisplay: () => "ctrl+enter/alt+s",
                        renderer: { mode: "regular" },
                        clickRegionUnsubscribe: undefined,
                };

                (InteractiveMode as any).prototype.updatePendingMessagesDisplay.call(fakeThis);

                const strip = renderContainer(fakeThis.pendingMessagesContainer).map(stripAnsi).join("\n");
                expect(strip).toContain("Steering: adjust the plan");
                expect(strip).toContain("to edit all queued messages");

                const sendNow = renderContainer(fakeThis.pendingSendNowContainer).map(stripAnsi).join("\n");
                expect(sendNow).toContain("ctrl+enter/alt+s to send now");
                // Regular mode delegates mouse to the terminal: no click affordance.
                expect(sendNow).not.toContain("click here");
        });

        test("fullscreen + a bound click region advertises the click affordance", () => {
                initTheme("dark");
                const fakeThis: any = {
                        pendingMessagesContainer: new Container(),
                        pendingSendNowContainer: new Container(),
                        getAllQueuedMessages: () => ({ steering: [], followUp: ["run the tests"] }),
                        getAppKeyDisplay: () => "alt+s",
                        renderer: { mode: "fullscreen" },
                        clickRegionUnsubscribe: () => {},
                };

                (InteractiveMode as any).prototype.updatePendingMessagesDisplay.call(fakeThis);

                const sendNow = renderContainer(fakeThis.pendingSendNowContainer).map(stripAnsi).join("\n");
                expect(sendNow).toContain("alt+s to send now");
                expect(sendNow).toContain("click here to send");
        });

        test("an empty queue clears both containers", () => {
                initTheme("dark");
                const fakeThis: any = {
                        pendingMessagesContainer: new Container(),
                        pendingSendNowContainer: new Container(),
                        getAllQueuedMessages: () => ({ steering: [], followUp: [] }),
                        getAppKeyDisplay: () => "alt+s",
                        renderer: { mode: "fullscreen" },
                        clickRegionUnsubscribe: () => {},
                };

                (InteractiveMode as any).prototype.updatePendingMessagesDisplay.call(fakeThis);
                expect(fakeThis.pendingMessagesContainer.children).toHaveLength(0);
                expect(fakeThis.pendingSendNowContainer.children).toHaveLength(0);
        });
});

describe("bindFullscreenClickRegions (Da capo R8) — the real renderer", () => {
        function bootFullscreen() {
                const terminal = new VirtualTerminal(60, 12);
                const tui = new TuiAltScreen(terminal);
                const document = new Text(Array.from({ length: 20 }, (_, i) => `doc ${i + 1}`).join("\n"), 0, 0);
                const scrollView = new ScrollView(document, { follow: "end", primary: true });
                const sendNow = new Container();
                const status = new Text("status", 1, 0);
                const dock = new VStack([
                        { component: sendNow, shrink: 1, minSize: 0 },
                        { component: status, shrink: 1, minSize: 0 },
                ]);
                tui.setLayoutRoot(
                        new VStack([
                                { component: scrollView, basis: 0, grow: 1, shrink: 1, minSize: 1 },
                                { component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
                        ]),
                );
                return { terminal, tui, sendNow };
        }

        test("binds a provider whose region covers the hint and fires handleSendQueued on click", async () => {
                const { terminal, tui, sendNow } = bootFullscreen();
                const handleSendQueued = vi.fn().mockResolvedValue(undefined);
                const fakeThis: any = {
                        renderer: tui,
                        pendingSendNowContainer: sendNow,
                        clickRegionUnsubscribe: undefined,
                        handleSendQueued,
                };

                (InteractiveMode as any).prototype.bindFullscreenClickRegions.call(fakeThis);
                expect(fakeThis.clickRegionUnsubscribe).toBeTypeOf("function");

                sendNow.addChild(new Text("alt+s to send now — click here to send", 1, 0));
                tui.start();
                await terminal.waitForRender();

                // Where did the hint land? Ask the same seam the provider uses.
                const frame = (tui as any).currentLayout;
                expect(frame).toBeTruthy();
                const rect = findComponentRect(frame, sendNow);
                expect(rect).toBeTruthy();
                expect(rect!.height).toBeGreaterThan(0);

                terminal.sendInput(`\x1b[<0;3;${rect!.y + 1}M`);
                terminal.sendInput(`\x1b[<0;3;${rect!.y + 1}m`);
                await terminal.waitForRender();
                expect(handleSendQueued).toHaveBeenCalledTimes(1);

                fakeThis.clickRegionUnsubscribe();
                tui.stop();
        });

        test("clearing the queue un-registers the region (a later click is inert)", async () => {
                const { terminal, tui, sendNow } = bootFullscreen();
                const handleSendQueued = vi.fn().mockResolvedValue(undefined);
                const fakeThis: any = {
                        renderer: tui,
                        pendingSendNowContainer: sendNow,
                        clickRegionUnsubscribe: undefined,
                        handleSendQueued,
                };
                (InteractiveMode as any).prototype.bindFullscreenClickRegions.call(fakeThis);

                const hint = new Text("alt+s to send now — click here to send", 1, 0);
                sendNow.addChild(hint);
                tui.start();
                await terminal.waitForRender();
                const frame1 = (tui as any).currentLayout;
                const rect1 = findComponentRect(frame1, sendNow)!;

                // The queue empties: the strip clears and re-renders.
                sendNow.clear();
                tui.requestRender(true);
                await terminal.waitForRender();

                terminal.sendInput(`\x1b[<0;3;${rect1.y + 1}M`);
                terminal.sendInput(`\x1b[<0;3;${rect1.y + 1}m`);
                await terminal.waitForRender();
                expect(handleSendQueued).not.toHaveBeenCalled();

                fakeThis.clickRegionUnsubscribe();
                tui.stop();
        });

        test("a regular-mode renderer leaves no region bound", () => {
                const fakeThis: any = {
                        renderer: { mode: "regular" },
                        pendingSendNowContainer: new Container(),
                        clickRegionUnsubscribe: undefined,
                };
                (InteractiveMode as any).prototype.bindFullscreenClickRegions.call(fakeThis);
                expect(fakeThis.clickRegionUnsubscribe).toBeUndefined();
        });
});

describe("handleFocusChange → maybeShowRefocusRecap (Da capo R16)", () => {
        const proto = (InteractiveMode as any).prototype;

        function makeFakeThis(assistantMessages: number, lastText: string) {
                return {
                        focusLostAtMs: undefined as number | undefined,
                        session: {
                                getSessionStats: () => ({ assistantMessages }),
                                getLastAssistantText: () => lastText,
                        },
                        chatContainer: new Container(),
                        ui: { requestRender: vi.fn() },
                        lastStatusSpacer: undefined,
                        lastStatusText: undefined,
                        lastStatusMessage: undefined,
                        // The prototype chain, bound for the .call() harness.
                        handleFocusChange: proto.handleFocusChange,
                        maybeShowRefocusRecap: proto.maybeShowRefocusRecap,
                        showStatus: proto.showStatus,
                };
        }

        test("a long away gap with history renders the recap line through showStatus", () => {
                initTheme("dark");
                const fakeThis: any = makeFakeThis(4, "Tests pass.");
                const before = Date.now() - 5 * 60_000;

                fakeThis.handleFocusChange.call(fakeThis, false);
                expect(fakeThis.focusLostAtMs).toBeTypeOf("number");
                fakeThis.focusLostAtMs = before; // pin the away span deterministically
                fakeThis.handleFocusChange.call(fakeThis, true);
                expect(fakeThis.focusLostAtMs).toBeUndefined();

                const rendered = renderContainer(fakeThis.chatContainer).map(stripAnsi).join("\n");
                expect(rendered).toContain("back after 5 min");
                expect(rendered).toContain("4 turns this session");
                expect(rendered).toContain("last: Tests pass.");
        });

        test("a short gap stays silent", () => {
                initTheme("dark");
                const fakeThis: any = makeFakeThis(9, "text");
                fakeThis.handleFocusChange.call(fakeThis, false);
                fakeThis.focusLostAtMs = Date.now() - 10_000;
                fakeThis.handleFocusChange.call(fakeThis, true);
                expect(fakeThis.chatContainer.children).toHaveLength(0);
        });

        test("a session without enough turns stays silent", () => {
                initTheme("dark");
                const fakeThis: any = makeFakeThis(2, "text");
                fakeThis.handleFocusChange.call(fakeThis, false);
                fakeThis.focusLostAtMs = Date.now() - 30 * 60_000;
                fakeThis.handleFocusChange.call(fakeThis, true);
                expect(fakeThis.chatContainer.children).toHaveLength(0);
        });

        test("a focus-in without a recorded blur is inert", () => {
                initTheme("dark");
                const fakeThis: any = makeFakeThis(9, "text");
                fakeThis.handleFocusChange.call(fakeThis, true);
                expect(fakeThis.chatContainer.children).toHaveLength(0);
        });

        test("the kill switch suppresses the refocus line", () => {
                initTheme("dark");
                const previous = process.env.UNOWN_RECAP_IDLE_MINUTES;
                process.env.UNOWN_RECAP_IDLE_MINUTES = "0";
                try {
                        const fakeThis: any = makeFakeThis(9, "text");
                        fakeThis.handleFocusChange.call(fakeThis, false);
                        fakeThis.focusLostAtMs = Date.now() - 30 * 60_000;
                        fakeThis.handleFocusChange.call(fakeThis, true);
                        expect(fakeThis.chatContainer.children).toHaveLength(0);
                } finally {
                        if (previous === undefined) delete process.env.UNOWN_RECAP_IDLE_MINUTES;
                        else process.env.UNOWN_RECAP_IDLE_MINUTES = previous;
                }
        });
});
