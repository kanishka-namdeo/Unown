import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ScrollView } from "../src/components/scroll-view.ts";
import { Text } from "../src/components/text.ts";
import { VStack } from "../src/components/v-stack.ts";
import { renderTooSmallNotice } from "../src/components/too-small-notice.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("renderTooSmallNotice", () => {
        it("renders exactly height lines, each within the width", () => {
                for (const [width, height] of [
                        [40, 10],
                        [30, 6],
                        [20, 3],
                        [60, 14],
                ]) {
                        const lines = renderTooSmallNotice(width, height);
                        assert.equal(lines.length, height);
                        for (const line of lines) {
                                assert.ok(line.length <= width, `line exceeds width at ${width}x${height}: ${line}`);
                        }
                }
        });

        it("names the requirement and the current geometry", () => {
                const text = renderTooSmallNotice(40, 10).join("\n");
                assert.match(text, /terminal too small/);
                assert.match(text, /48x16/);
                assert.match(text, /40x10/);
                assert.match(text, /session kept/);
        });

        it("is plain text — no ANSI escapes (works in plain/NO_COLOR mode)", () => {
                for (const line of renderTooSmallNotice(40, 10)) {
                        assert.equal(line.includes("\x1b"), false);
                }
        });
});

describe("TuiAltScreen minSizeNotice gate (round 5, R2)", () => {
        function boot(width: number, height: number, options?: { minSizeNotice?: boolean }) {
                const terminal = new VirtualTerminal(width, height);
                const tui = new TuiAltScreen(terminal, false, "/tmp", { minSizeNotice: options?.minSizeNotice });
                const transcript = new ScrollView(new Text("transcript-content", 0, 0), { follow: "end", primary: true });
                const dock = new VStack([new Text("editor", 0, 0)]);
                tui.setLayoutRoot(
                        new VStack([
                                { component: transcript, basis: 0, grow: 1, minSize: 1 },
                                { component: dock, basis: "auto", minSize: 1 },
                        ]),
                );
                tui.start();
                return { terminal, tui };
        }

        it("shows the notice instead of the layout below the minimum geometry (opt-in)", async () => {
                const { terminal, tui } = boot(30, 10, { minSizeNotice: true });
                await terminal.waitForRender();
                const text = terminal.getViewport().join("\n");
                assert.match(text, /terminal too small/);
                assert.equal(text.includes("transcript-content"), false);
                tui.stop();
        });

        it("renders the layout normally above the minimum geometry (opt-in)", async () => {
                const { terminal, tui } = boot(80, 24, { minSizeNotice: true });
                await terminal.waitForRender();
                const text = terminal.getViewport().join("\n");
                assert.equal(text.includes("terminal too small"), false);
                assert.equal(text.includes("transcript-content"), true);
                tui.stop();
        });

        it("stays permissive by default (no flag = no gate, for embedded/test use)", async () => {
                const { terminal, tui } = boot(30, 10);
                await terminal.waitForRender();
                const text = terminal.getViewport().join("\n");
                assert.equal(text.includes("terminal too small"), false);
                tui.stop();
        });

        it("resumes the layout after the terminal grows back — the session survives", async () => {
                const { terminal, tui } = boot(30, 10, { minSizeNotice: true });
                await terminal.waitForRender();
                assert.match(terminal.getViewport().join("\n"), /terminal too small/);

                terminal.resize(80, 24);
                tui.requestRender();
                await terminal.waitForRender();
                const text = terminal.getViewport().join("\n");
                assert.equal(text.includes("terminal too small"), false);
                assert.equal(text.includes("transcript-content"), true);
                tui.stop();
        });
});
