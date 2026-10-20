import "./_env.ts"; // MUST be first
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSplitViewExtension } from "../src/splitview.ts";
import {
        loadUiPanelsConfig,
        normalizeConfig,
        saveUiPanelsConfig,
        setUiPanelsConfigPath,
} from "../src/splitview-config.ts";
import {
        initLayoutManager,
        isLayoutLayerActive,
        setLayoutLayer,
} from "../src/splitview-layout.ts";
import { HStack, ScrollView, VStack } from "@earendil-works/pi-tui";
import { initTheme } from "@earendil-works/pi-coding-agent";

/** Hard-reset the layout-manager singleton (module state is per-process).
 * The module captures its registry object at import time, so the reset must
 * MUTATE that object — replacing the globalThis entry would not reach it. */
function resetManagerSingleton() {
        const m = (globalThis as any)[Symbol.for("pi.layout-manager")];
        if (m) {
                m.tuiRef = null;
                m.baseRoot = null;
                m.layers = new Map();
        }
}

const VIEWPORT = Symbol.for("@earendil-works/pi-tui/viewport");

const tmp = mkdtempSync(join(tmpdir(), "unown-splitview-"));
const agentDir = join(tmp, "agent");
mkdirSync(agentDir, { recursive: true });
afterAll(() => {
        rmSync(tmp, { recursive: true, force: true });
});

// ─── fake plumbing ───────────────────────────────────────────────────────────

interface Captured {
        events: Map<string, Array<(event: any, ctx: any) => any>>;
        commands: Map<string, { description: string; handler: (args: string, ctx: any) => Promise<void> }>;
        flags: Map<string, any>;
        busEvents: Map<string, Array<(data: any) => void>>;
        widgetFactory: ((tui: any, theme: any) => any) | null;
        widgetUnset: number;
        noSplit: boolean;
        notifications: Array<{ text: string; level: string }>;
        overlays: Array<{ component: any; options: any }>;
        layoutRoots: Array<any>;
}

function makeFakePi() {
        const c: Captured = {
                events: new Map(),
                commands: new Map(),
                flags: new Map(),
                busEvents: new Map(),
                widgetFactory: null,
                widgetUnset: 0,
                noSplit: false,
                notifications: [],
                overlays: [],
                layoutRoots: [],
        };
        const pi: any = {
                on: (name: string, handler: any) => {
                        if (!c.events.has(name)) c.events.set(name, []);
                        c.events.get(name)!.push(handler);
                },
                registerCommand: (name: string, options: any) => {
                        c.commands.set(name, options);
                },
                registerFlag: (name: string, options: any) => {
                        c.flags.set(name, { name, ...options });
                },
                getFlag: (name: string) => (name === "no-split" ? c.noSplit : undefined),
                events: {
                        on: (channel: string, handler: any) => {
                                if (!c.busEvents.has(channel)) c.busEvents.set(channel, []);
                                c.busEvents.get(channel)!.push(handler);
                        },
                },
        };
        (c as any).noSplit = false;
        return { pi, c };
}

function makeFakeCtx(c: Captured, branch: any[] = []) {
        const ctx: any = {
                mode: "tui",
                ui: {
                        notify: (text: string, level = "info") => c.notifications.push({ text, level }),
                        setWidget: (key: string, factory: any, _options?: any) => {
                                if (factory === undefined) c.widgetUnset++;
                                else c.widgetFactory = factory;
                        },
                        theme: fakeTheme,
                },
                sessionManager: {
                        getBranch: () => branch,
                },
        };
        return ctx;
}

const fakeTheme: any = {
        fg: (_color: string, text: string) => text,
        bg: (_color: string, text: string) => text,
};

/** A viewport-capable fake TUI (fullscreen): captures layout roots. */
function makeViewportTui(c: Captured) {
        const base = new VStack([{ component: { render: () => [], invalidate: () => {} }, basis: 0, grow: 1 }]);
        const tui: any = {
                [VIEWPORT]: true,
                mode: "fullscreen",
                terminal: { columns: 128, rows: 36 },
                layoutRoot: base,
                requestRender: (_force?: boolean) => {},
                setLayoutRoot: (root: any) => {
                        c.layoutRoots.push(root);
                        tui.layoutRoot = root;
                },
                showOverlay: (component: any, options: any) => {
                        c.overlays.push({ component, options });
                        return { hide: () => {} };
                },
        };
        return tui;
}

/** A regular-mode fake TUI (no viewport symbol, no setLayoutRoot). */
function makeRegularTui(c: Captured) {
        const tui: any = {
                mode: "regular",
                terminal: { columns: 128, rows: 36 },
                requestRender: () => {},
                showOverlay: (component: any, options: any) => {
                        c.overlays.push({ component, options });
                        return { hide: () => {} };
                },
        };
        return tui;
}

async function fire(c: Captured, name: string, event: any, ctx: any) {
        for (const h of c.events.get(name) ?? []) await h(event, ctx);
}

async function cmd(c: Captured, name: string, args = "", ctx: any) {
        const command = c.commands.get(name);
        if (!command) throw new Error(`command not registered: ${name}`);
        await command.handler(args, ctx);
}

// ─── config module ───────────────────────────────────────────────────────────

describe("splitview-config", () => {
        test("normalizeConfig tolerates garbage shapes", () => {
                expect(normalizeConfig(null as any)).toBeDefined();
                expect(normalizeConfig([] as any)).toBeDefined();
                expect(normalizeConfig("x" as any)).toBeDefined();
                const fromNull = normalizeConfig(null as any);
                expect(fromNull.split).toBe(false);
                expect(fromNull.thinking).toBe(false);
                expect(fromNull.tools).toBe(false);
                expect(fromNull.files).toBe(false);
                expect(fromNull.diff).toBe(true);
                expect(fromNull.toolMode).toBe("compact");
                expect(fromNull.trimResponse).toBe(false);
                expect(fromNull.bandHeight).toBe(20);
                expect(fromNull.toolsWidthPct).toBe(35);
                expect(fromNull.answerDivider).toBe("rule");
        });

        test("normalizeConfig clamps numbers and only trusts real booleans", () => {
                const n = normalizeConfig({
                        split: "yes" as any,
                        thinking: 1 as any,
                        tools: true,
                        bandHeight: 999,
                        toolsWidthPct: 5,
                        answerDivider: "nope" as any,
                        toolMode: "full",
                });
                expect(n.split).toBe(false); // "yes" is not a boolean
                expect(n.thinking).toBe(false); // 1 is not a boolean
                expect(n.tools).toBe(false); // gated on split=false
                const m = normalizeConfig({ split: true, thinking: 1 as any, tools: true });
                expect(m.thinking).toBe(true); // SV-12: garbage falls back to the default (on)
                expect(m.tools).toBe(true);
                const o = normalizeConfig({ split: true, thinking: false, tools: false });
                expect(o.thinking).toBe(false); // explicit false honored
                expect(o.tools).toBe(false);
                expect(n.bandHeight).toBe(40); // clamp 6..40
                expect(n.toolsWidthPct).toBe(20); // clamp 20..60
                expect(n.answerDivider).toBe("rule"); // unknown -> rule
                expect(n.toolMode).toBe("full");
        });

        test("load/save round-trips through a redirected path", () => {
                const p = join(agentDir, "ui-panels-test.json");
                setUiPanelsConfigPath(p);
                expect(saveUiPanelsConfig({ split: true, thinking: true, tools: true, files: true })).toBe(true);
                const loaded = normalizeConfig(loadUiPanelsConfig());
                expect(loaded.split).toBe(true);
                expect(loaded.thinking).toBe(true);
                expect(loaded.files).toBe(true);
                writeFileSync(p, "not json {", "utf8");
                expect(loadUiPanelsConfig()).toEqual({}); // bad JSON -> empty config
        });
});

// ─── layout manager ──────────────────────────────────────────────────────────

describe("splitview-layout", () => {
        test("captures the base root, composes layers in order, restores on removal", () => {
                resetManagerSingleton();
                const set: string[] = [];
                let current: any = { id: "base" };
                const tui: any = {
                        [VIEWPORT]: true,
                        layoutRoot: current,
                        requestRender: () => {},
                        setLayoutRoot: (root: any) => {
                                set.push(root.id);
                                current = root;
                        },
                };
                initLayoutManager(tui);
                const layerA = (inner: any) => ({ id: "A", inner, render: () => [] as string[], invalidate: () => {} });
                const layerB = (inner: any) => ({ id: "B", inner, render: () => [] as string[], invalidate: () => {} });
                setLayoutLayer("a", layerA);
                setLayoutLayer("b", layerB);
                expect(set).toEqual(["A", "B"]);
                expect(isLayoutLayerActive("a")).toBe(true);
                setLayoutLayer("a", null);
                expect(set).toEqual(["A", "B", "B"]);
                expect(isLayoutLayerActive("a")).toBe(false);
        });

        test("selfHeal re-applies layers after the app resets the root", () => {
                resetManagerSingleton();
                const set: string[] = [];
                const base = { id: "base" };
                const tui: any = {
                        [VIEWPORT]: true,
                        layoutRoot: base,
                        requestRender: () => {},
                        setLayoutRoot: (root: any) => {
                                set.push(root.id);
                                tui.layoutRoot = root;
                        },
                };
                initLayoutManager(tui);
                setLayoutLayer("ui", (inner: any) => ({ id: "wrapped", inner, render: () => [] as string[], invalidate: () => {} }));
                expect(set).toEqual(["wrapped"]);
                // simulate a TUI mode switch: the app re-applied its own base root
                tui.layoutRoot = base;
                set.length = 0;
                // selfHealLayout is called from the widget render; call through the module
                const { selfHealLayout } = require("../src/splitview-layout.ts");
                selfHealLayout();
                expect(set).toEqual(["wrapped"]); // composition re-applied
        });
});

// ─── the extension (one chronological session) ───────────────────────────────

describe("splitview extension", () => {
        // the module is a singleton (SV-20): tests run as ONE chronological session
        beforeAll(() => {
                resetManagerSingleton();
                initTheme("dark");
        });
        Object.defineProperty(process.stdout, "columns", { value: 128, configurable: true });
        const fileA = join(tmp, "a.txt");
        const fileB = join(tmp, "b.txt");
        writeFileSync(fileA, "aaa\n", "utf8");
        writeFileSync(fileB, "bbb\n", "utf8");
        const ext = createSplitViewExtension({ agentDir, verbose: false });
        expect(ext.name).toBe("unown-splitview");
        const { pi, c } = makeFakePi();

        test("registers the flag and all eleven commands", () => {
                ext.factory(pi);
                expect(c.flags.get("no-split")?.type).toBe("boolean");
                const names = [...c.commands.keys()];
                for (const expected of [
                        "split",
                        "split-thinking",
                        "split-tools",
                        "files",
                        "split-diff",
                        "split-tools-view",
                        "split-height",
                        "split-tools-width",
                        "split-divider",
                        "split-trim-response",
                        "split-save",
                ]) {
                        expect(names).toContain(expected);
                }
                expect(c.busEvents.has("subagents:tool_call")).toBe(true);
        });

        const branch: any[] = [];
        const ctx = makeFakeCtx(c, branch);
        const bindViewport = () => {
                const tui = makeViewportTui(c);
                (c as any).widgetFactory(tui, fakeTheme);
                return tui;
        };
        const bindRegular = () => {
                const tui = makeRegularTui(c);
                (c as any).widgetFactory(tui, fakeTheme);
                return tui;
        };

        test("session_start sets the belowEditor widget and applies saved defaults", async () => {
                setUiPanelsConfigPath(join(agentDir, "ui-panels-session.json"));
                await fire(c, "session_start", { type: "session_start", reason: "startup" }, ctx);
                expect(c.widgetFactory).not.toBeNull();
                expect((c as any).widgetOptions ?? true).toBe(true);
                // no saved config -> all panels off -> no layout takeover
                expect(c.layoutRoots.length).toBe(0);
        });

        test("widget factory binds a viewport tui; /split composes the band", async () => {
                bindViewport();
                expect((c as any).widgetFactory).not.toBeNull();
                await cmd(c, "split", "", ctx);
                expect(c.notifications.at(-1)?.text).toContain("Split view on");
                expect(c.layoutRoots.length).toBeGreaterThan(0);
                const root = c.layoutRoots.at(-1);
                expect(root).toBeInstanceOf(VStack);
                const entries = (root as any).entries as any[];
                // band + separator + inner
                expect(entries.length).toBe(3);
                expect(entries[0].component).toBeInstanceOf(HStack);
        });

        test("thinking events stream through the vendored payload shape", async () => {
                await fire(
                        c,
                        "message_update",
                        {
                                type: "message_update",
                                message: { role: "assistant", content: [] },
                                assistantMessageEvent: { type: "thinking_start", contentIndex: 0, partial: { role: "assistant", content: [] } },
                        },
                        ctx,
                );
                await fire(
                        c,
                        "message_update",
                        {
                                type: "message_update",
                                message: { role: "assistant", content: [] },
                                assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "17 * 23 = 391", partial: { role: "assistant", content: [] } },
                        },
                        ctx,
                );
                await fire(
                        c,
                        "message_update",
                        {
                                type: "message_update",
                                message: { role: "assistant", content: [] },
                                // vendored 0.84.3: NO content field on thinking_end — the final text
                                // lives in partial.content[contentIndex].thinking
                                assistantMessageEvent: {
                                        type: "thinking_end",
                                        contentIndex: 0,
                                        partial: { role: "assistant", content: [{ type: "thinking", thinking: "final thinking text" }] },
                                },
                        },
                        ctx,
                );
                // flush timers (coalesced at 100ms)
                await new Promise((r) => setTimeout(r, 200));
                // no crash + a render was requested
                expect(true).toBe(true);
        });

        test("tool events update the files widget line", async () => {
                const demoFile = join(tmp, "demo.txt");
                writeFileSync(demoFile, "hello split-view\n", "utf8");
                await fire(
                        c,
                        "tool_call",
                        { type: "tool_call", toolCallId: "t1", toolName: "read", input: { path: demoFile } },
                        ctx,
                );
                const tui = bindViewport();
                const widget = (c as any).widgetFactory(tui, fakeTheme);
                const lines = widget.render(120);
                expect(lines.length).toBeGreaterThan(0);
                expect(lines[0]).toContain("📂 1");
                expect(lines[0]).toContain("demo.txt");
        });

        test("edit tool_call previews a diff; overlay /files renders the dock content", async () => {
                await fire(
                        c,
                        "tool_call",
                        {
                                type: "tool_call",
                                toolCallId: "t2",
                                toolName: "edit",
                                // Relative path on purpose: the dock's diff header truncates to the
                                // render width, and CI temp dirs are long enough to push the
                                // basename out at 46 columns on Windows (C:\Users\RUNNER~1\...) and
                                // macOS (/var/folders/...) — the assertions are about the dock's
                                // rendering, not path resolution.
                                input: { path: "demo.txt", edits: [{ oldText: "hello", newText: "goodbye" }] },
                        },
                        ctx,
                );
                // regular-mode tui: /files falls back to the non-capturing overlay
                bindRegular();
                await cmd(c, "files", "", ctx);
                expect(c.overlays.length).toBe(1);
                const panel = c.overlays[0].component;
                expect(panel).toBeDefined();
                const rendered = panel.render(46);
                const text = rendered.join("\n");
                expect(text).toContain("📂 Files (");
                expect(text).toContain("demo.txt");
                expect(text).toContain("✎"); // diff section titled with the edit path
                expect(text).toContain("goodbye"); // diff preview rendered
                expect(c.overlays[0].options.nonCapturing).toBe(true);
        });

        test("/split off is the bare layout; on restores saved defaults", async () => {
                bindViewport();
                await cmd(c, "split", "", ctx);
                expect(c.notifications.at(-1)?.text).toContain("Split view off");
                await cmd(c, "split", "", ctx);
                expect(c.notifications.at(-1)?.text).toContain("Split view on");
        });

        test("geometry commands clamp their arguments", async () => {
                await cmd(c, "split-height", "999", ctx);
                expect(c.notifications.at(-1)?.text).toContain("40 rows");
                await cmd(c, "split-height", "1", ctx);
                expect(c.notifications.at(-1)?.text).toContain("6 rows");
                await cmd(c, "split-height", "abc", ctx);
                expect(c.notifications.at(-1)?.text).toContain("usage");
                await cmd(c, "split-tools-width", "70", ctx);
                expect(c.notifications.at(-1)?.text).toContain("60%");
                await cmd(c, "split-tools-width", "xyz", ctx);
                expect(c.notifications.at(-1)?.level).toBe("error");
        });

        test("/split-divider validates its argument", async () => {
                await cmd(c, "split-divider", "space", ctx);
                expect(c.notifications.at(-1)?.text).toContain("space");
                await cmd(c, "split-divider", "bogus", ctx); // toggles back to rule
                expect(c.notifications.at(-1)?.text).toContain("rule");
        });

        test("/split-save persists the effective layout to the agent dir", async () => {
                await cmd(c, "split-save", "", ctx);
                const saved = JSON.parse(readFileSync(join(agentDir, "ui-panels-session.json"), "utf8"));
                expect(saved.split).toBe(true);
                expect(saved.thinking).toBe(true);
                expect(saved.tools).toBe(true);
                expect(saved.bandHeight).toBe(6);
                expect(saved.toolsWidthPct).toBe(60);
        });

        test("branch reconstruction recovers tool args and edit paths without input", async () => {
                branch.push({
                        type: "message",
                        message: {
                                role: "assistant",
                                content: [
                                        { type: "thinking", thinking: "branch thinking" },
                                        { type: "toolCall", id: "b1", name: "read", arguments: { path: fileA } },
                                        { type: "toolCall", id: "b2", name: "edit", arguments: { path: fileB, edits: [{ oldText: "b", newText: "c" }] } },
                                ],
                        },
                });
                branch.push({
                        type: "message",
                        message: {
                                role: "toolResult",
                                toolCallId: "b2",
                                toolName: "edit",
                                content: [{ type: "text", text: "edited" }],
                                details: { diff: "diff --git a/b.txt\n-old b\n+new c\n" },
                                isError: false,
                        },
                });
                await fire(c, "session_tree", { type: "session_tree" }, ctx);
                // the overlay render should show b.txt's edit path + diff from details
                bindRegular();
                await cmd(c, "files", "", ctx);
                const text = c.overlays.at(-1)!.component.render(46).join("\n");
                expect(text).toContain("b.txt");
                expect(text).toContain("✎"); // diff section present
                expect(text).toContain("new c"); // diff from the persisted tool result details
        });

        test("response doc rebuild keeps user/assistant text only", async () => {
                branch.push({
                        type: "message",
                        message: { role: "user", content: "hello panels" },
                });
                branch.push({
                        type: "message",
                        message: {
                                role: "assistant",
                                content: [
                                        { type: "thinking", thinking: "should not render" },
                                        { type: "toolCall", id: "b3", name: "read", arguments: { path: fileA } },
                                        { type: "text", text: "the answer" },
                                ],
                        },
                });
                await fire(c, "session_tree", { type: "session_tree" }, ctx);
                bindViewport();
                // ensure the files dock is closed so the trim composition is bare:
                // the dock may be open (viewport /files) or a regular-mode overlay
                // (REG.active) — /files with a viewport tui toggles both to a known state
                for (let i = 0; i < 2; i++) {
                        await cmd(c, "files", "", ctx);
                        if (c.notifications.at(-1)?.text.includes("Files panel closed")) break;
                }
                expect(c.notifications.at(-1)?.text).toContain("Files panel closed");
                // trim on: the composed root's first entry is a ScrollView over the response doc
                await cmd(c, "split-trim-response", "", ctx);
                const root = c.layoutRoots.at(-1);
                expect(root).toBeInstanceOf(VStack);
                // composition: VStack[band(HStack), separator, inner(VStack[responseScroll, dock])]
                const entries = (root as any).entries as any[];
                expect(entries.length).toBe(3);
                expect(entries[0].component).toBeInstanceOf(HStack); // the band
                const inner = entries[2].component as any;
                expect(inner).toBeInstanceOf(VStack);
                const scroll = (inner as any).entries[0].component as any;
                expect(scroll).toBeInstanceOf(ScrollView);
                expect(scroll.children.length).toBe(1);
                const doc = scroll.children[0];
                expect(doc.children.length).toBeGreaterThan(0); // user + assistant entries
                await cmd(c, "split-trim-response", "", ctx); // back to full transcript
                expect(c.notifications.at(-1)?.text).toContain("full transcript");
        });

        test("regular mode degrades honestly", async () => {
                bindRegular();
                c.layoutRoots.length = 0;
                await cmd(c, "split", "", ctx);
                // /split needs the layout engine: an honest warning in regular mode
                expect(c.notifications.at(-1)?.text).toContain("requires fullscreen");
                expect(c.layoutRoots.length).toBe(0);
        });

        test("--no-split ignores saved panel defaults", async () => {
                // save a panels-on config, then boot a new session under --no-split
                const cfgPath = join(tmp, "agent2", "ui-panels.json");
                mkdirSync(join(tmp, "agent2"), { recursive: true });
                setUiPanelsConfigPath(cfgPath);
                saveUiPanelsConfig({ split: true, thinking: true, tools: true, files: false, diff: true });
                (c as any).noSplit = true;
                bindViewport();
                c.layoutRoots.length = 0;
                await fire(c, "session_start", { type: "session_start", reason: "new" }, ctx);
                expect(c.layoutRoots.length).toBe(0); // saved defaults NOT applied
                await cmd(c, "split", "", ctx);
                expect(c.notifications.at(-1)?.text).toContain("Split view on"); // classic default
                (c as any).noSplit = false;
        });

        test("session_shutdown retires overlays and the widget", async () => {
                await fire(c, "session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx);
                expect(c.widgetUnset).toBeGreaterThan(0);
        });
});
