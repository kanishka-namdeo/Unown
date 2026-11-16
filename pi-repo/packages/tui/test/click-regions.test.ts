import assert from "node:assert";
import { describe, it } from "node:test";
import { ScrollView } from "../src/components/scroll-view.ts";
import { Text } from "../src/components/text.ts";
import { VStack } from "../src/components/v-stack.ts";
import { findComponentRect, renderLayoutFrame } from "../src/layout.ts";
import { Container } from "../src/tui.ts";
import { type AltScreenClickRegion, TuiAltScreen } from "../src/tui-alt-screen.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

/** SGR mouse press at (col, row), 0-based → the terminal's 1-based sequence. */
function sgrPress(col: number, row: number): string {
        return `\x1b[<0;${col + 1};${row + 1}M`;
}

/** SGR mouse release at (col, row), 0-based. */
function sgrRelease(col: number, row: number): string {
        return `\x1b[<0;${col + 1};${row + 1}m`;
}

/** SGR motion-while-pressed at (col, row), 0-based (button bit 32). */
function sgrMotion(col: number, row: number): string {
        return `\x1b[<32;${col + 1};${row + 1}M`;
}

interface DockedSetup {
        terminal: VirtualTerminal;
        tui: TuiAltScreen;
        hint: Container;
        regionRow: () => number | undefined;
        fired: () => number;
}

/**
 * The minimal fullscreen shape the coding agent uses: a scrollable document
 * plus a docked strip whose rows own a click region. The provider mirrors
 * InteractiveMode's wiring — findComponentRect on the hint container, region
 * over its rows, a counter as the action.
 */
async function bootDockedStrip(withOverlay = false): Promise<DockedSetup> {
        const terminal = new VirtualTerminal(40, 10);
        const tui = new TuiAltScreen(terminal);
        const document = new Text(Array.from({ length: 30 }, (_, i) => `doc line ${i + 1}`).join("\n"), 0, 0);
        const scrollView = new ScrollView(document, { follow: "end", primary: true });
        const hint = new Container();
        hint.addChild(new Text("ctrl+enter to send now", 1, 0));
        const status = new Text("status", 1, 0);
        const dock = new VStack([
                { component: hint, shrink: 1, minSize: 0 },
                { component: status, shrink: 1, minSize: 0 },
        ]);
        const root = new VStack([
                { component: scrollView, basis: 0, grow: 1, shrink: 1, minSize: 1 },
                { component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
        ]);
        tui.setLayoutRoot(root);

        let regionRow: number | undefined;
        let fired = 0;
        tui.addClickRegionProvider((layout) => {
                const rect = findComponentRect(layout, hint);
                if (!rect || rect.height < 1) return undefined;
                regionRow = rect.y;
                const region: AltScreenClickRegion = {
                        id: "send-now",
                        startRow: rect.y,
                        endRow: rect.y + rect.height,
                        onSelect: () => {
                                fired += 1;
                        },
                };
                return region;
        });

        tui.start();
        await terminal.waitForRender();
        if (withOverlay) {
                const overlay = new (class {
                        focused = false;
                        render(): string[] {
                                return ["overlay"];
                        }
                        invalidate(): void {}
                })();
                tui.showOverlay(overlay as never, { width: 20 });
                tui.requestRender(true);
                await terminal.waitForRender();
        }
        return { terminal, tui, hint, regionRow: () => regionRow, fired: () => fired };
}

describe("AltScreen click regions (Da capo R8)", () => {
        it("fires onSelect when press and release both land in the region", async () => {
                const setup = await bootDockedStrip();
                try {
                        const row = setup.regionRow();
                        assert.ok(typeof row === "number", "the provider resolved the hint rows");
                        setup.terminal.sendInput(sgrPress(5, row!));
                        await setup.terminal.waitForRender();
                        assert.strictEqual(setup.fired(), 0, "the press alone never fires");
                        setup.terminal.sendInput(sgrRelease(5, row!));
                        await setup.terminal.waitForRender();
                        assert.strictEqual(setup.fired(), 1, "the release inside the region fires once");
                        // A second full click fires again — the region re-arms.
                        setup.terminal.sendInput(sgrPress(5, row!));
                        setup.terminal.sendInput(sgrRelease(5, row!));
                        await setup.terminal.waitForRender();
                        assert.strictEqual(setup.fired(), 2);
                } finally {
                        setup.tui.stop();
                }
        });

        it("cancels when the release lands outside the region (2.1.311 release-commit)", async () => {
                const setup = await bootDockedStrip();
                try {
                        const row = setup.regionRow()!;
                        assert.ok(row > 0, "hint is docked below the document");
                        setup.terminal.sendInput(sgrPress(5, row));
                        setup.terminal.sendInput(sgrRelease(5, row - 1));
                        await setup.terminal.waitForRender();
                        assert.strictEqual(setup.fired(), 0, "release off the region cancels");
                        // And the cancelled press does not arm the next click.
                        setup.terminal.sendInput(sgrRelease(5, row));
                        await setup.terminal.waitForRender();
                        assert.strictEqual(setup.fired(), 0, "a stray release after a cancel never fires");
                } finally {
                        setup.tui.stop();
                }
        });

        it("ignores a press that starts outside every region", async () => {
                const setup = await bootDockedStrip();
                try {
                        const row = setup.regionRow()!;
                        setup.terminal.sendInput(sgrPress(5, row - 2));
                        setup.terminal.sendInput(sgrRelease(5, row));
                        await setup.terminal.waitForRender();
                        assert.strictEqual(setup.fired(), 0, "release inside without a region press never fires");
                } finally {
                        setup.tui.stop();
                }
        });

        it("keeps consuming motion while a region press is active", async () => {
                const setup = await bootDockedStrip();
                try {
                        const row = setup.regionRow()!;
                        setup.terminal.sendInput(sgrPress(5, row));
                        setup.terminal.sendInput(sgrMotion(10, row));
                        setup.terminal.sendInput(sgrRelease(10, row));
                        await setup.terminal.waitForRender();
                        assert.strictEqual(setup.fired(), 1, "motion inside the region rows keeps the press armed");
                } finally {
                        setup.tui.stop();
                }
        });

        it("never fires on wheel events over the region", async () => {
                const setup = await bootDockedStrip();
                try {
                        const row = setup.regionRow()!;
                        setup.terminal.sendInput(`\x1b[<64;6;${row + 1}M`);
                        await setup.terminal.waitForRender();
                        assert.strictEqual(setup.fired(), 0);
                } finally {
                        setup.tui.stop();
                }
        });

        it("does not fire while an overlay owns the screen", async () => {
                const setup = await bootDockedStrip(true);
                try {
                        const row = setup.regionRow()!;
                        setup.terminal.sendInput(sgrPress(5, row));
                        setup.terminal.sendInput(sgrRelease(5, row));
                        await setup.terminal.waitForRender();
                        assert.strictEqual(setup.fired(), 0, "the overlay gate holds");
                } finally {
                        setup.tui.stop();
                }
        });

        it("survives a provider that throws (rendering is never broken)", async () => {
                const terminal = new VirtualTerminal(40, 8);
                const tui = new TuiAltScreen(terminal);
                const text = new Text("hello", 0, 0);
                tui.addChild(text);
                tui.addClickRegionProvider(() => {
                        throw new Error("provider bug");
                });
                tui.start();
                await terminal.waitForRender();
                try {
                        const viewport = terminal.getViewport().map((line) => line.trimEnd());
                        assert.ok(viewport.some((line) => line.includes("hello")), "the render pass completed");
                } finally {
                        tui.stop();
                }
        });

        it("drops malformed regions from a provider", async () => {
                const terminal = new VirtualTerminal(40, 8);
                const tui = new TuiAltScreen(terminal);
                tui.addChild(new Text("hello", 0, 0));
                let calls = 0;
                tui.addClickRegionProvider(() => {
                        calls += 1;
                        return [
                                { id: "", startRow: 0, endRow: 1, onSelect: () => {} },
                                { id: "inverted", startRow: 3, endRow: 3, onSelect: () => {} },
                        ];
                });
                tui.start();
                await terminal.waitForRender();
                try {
                        assert.ok(calls > 0, "the provider ran");
                        // Clicking anywhere must not throw and must not fire anything.
                        setup_safe_click(terminal, 0, 0);
                        await terminal.waitForRender();
                } finally {
                        tui.stop();
                }
        });

        it("findComponentRect resolves a stack entry but not a nested leaf", () => {
                const leaf = new Container();
                leaf.addChild(new Text("deep", 0, 0));
                const entry = new Container();
                entry.addChild(new Text("inside", 0, 0));
                entry.addChild(leaf);
                const stack = new VStack([{ component: entry, shrink: 1, minSize: 0 }]);
                const frame = renderLayoutFrame(stack, 40, 6, () => {});
                const rect = findComponentRect(frame, entry);
                assert.ok(rect, "the stack entry is findable");
                assert.strictEqual(rect!.height, 2, "both child lines render inside the entry");
                assert.strictEqual(findComponentRect(frame, leaf), undefined, "a nested leaf has no box of its own");
        });
});

describe("AltScreen focus events (Da capo R16)", () => {
        it("surfaces FOCUS_OUT / FOCUS_IN through onFocusChange", async () => {
                const terminal = new VirtualTerminal(40, 8);
                const events: boolean[] = [];
                const tui = new TuiAltScreen(terminal, undefined, undefined, {
                        onFocusChange: (focused) => events.push(focused),
                });
                tui.addChild(new Text("hello", 0, 0));
                tui.start();
                await terminal.waitForRender();
                try {
                        terminal.sendInput("\x1b[O");
                        terminal.sendInput("\x1b[I");
                        terminal.sendInput("\x1b[O");
                        terminal.sendInput("\x1b[I");
                        await new Promise<void>((resolve) => setTimeout(resolve, 20));
                        assert.deepStrictEqual(events, [false, true, false, true]);
                } finally {
                        tui.stop();
                }
        });

        it("is silent when no onFocusChange is wired", async () => {
                const terminal = new VirtualTerminal(40, 8);
                const tui = new TuiAltScreen(terminal);
                tui.addChild(new Text("hello", 0, 0));
                tui.start();
                await terminal.waitForRender();
                try {
                        terminal.sendInput("\x1b[O");
                        terminal.sendInput("\x1b[I");
                        await terminal.waitForRender();
                        const viewport = terminal.getViewport().map((line) => line.trimEnd());
                        assert.ok(viewport.some((line) => line.includes("hello")));
                } finally {
                        tui.stop();
                }
        });
});

function setup_safe_click(terminal: VirtualTerminal, col: number, row: number): void {
        terminal.sendInput(sgrPress(col, row));
        terminal.sendInput(sgrRelease(col, row));
}
