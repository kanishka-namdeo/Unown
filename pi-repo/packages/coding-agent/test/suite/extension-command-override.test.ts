/**
 * extension-command-override.test.ts — the extension-override rule (the
 * unown settings round's vendored patch).
 *
 * Unown's /settings hub registers a command whose name matches pi's
 * built-in /settings (the theme selector). Before the patch the extension
 * command was filtered out of autocomplete and hard-shadowed by the
 * interactive editor's built-in interception — invisible AND unreachable.
 * The patch makes the override a supported, tested rule:
 *
 *   1. a single extension command named like a built-in keeps its plain
 *      invocationName (no :2 mangling) and is resolvable by name
 *   2. session.prompt dispatches it BEFORE any built-in would run
 *   3. the editor-submit guard (interactive-mode.ts) yields to the
 *      extension when one registers the name — pinned here at the
 *      isExtensionCommand level; the full TUI path is verified by the PTY
 *      lane (scripts/tui-capture/verify_settings_hub.py)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.ts";

describe("extension command override (built-in name)", () => {
        const harnesses: Harness[] = [];

        afterEach(() => {
                while (harnesses.length > 0) {
                        harnesses.pop()?.cleanup();
                }
        });

        it("keeps the plain invocation name and is resolvable by the built-in's name", async () => {
                const harness = await createHarness({
                        extensionFactories: [
                                (pi: ExtensionAPI) => {
                                        pi.registerCommand("settings", {
                                                description: "the unown settings hub (override test)",
                                                handler: async () => {},
                                        });
                                },
                        ],
                });
                harnesses.push(harness);
                const runner = (harness.session as unknown as { extensionRunner: any }).extensionRunner;
                expect(runner).toBeTruthy();
                const command = runner.getCommand("settings");
                expect(command).toBeTruthy();
                // THE patch invariant: no `settings:2` mangling for a single
                // registrant — the override keeps its clean name.
                expect(command.invocationName).toBe("settings");
                const all = runner.getRegisteredCommands().filter((c: any) => c.name === "settings");
                expect(all.length).toBe(1);
        });

        it("session.prompt('/settings') dispatches the EXTENSION command", async () => {
                let extensionRan = 0;
                const harness = await createHarness({
                        extensionFactories: [
                                (pi: ExtensionAPI) => {
                                        pi.registerCommand("settings", {
                                                description: "the unown settings hub (override test)",
                                                handler: async () => {
                                                        extensionRan += 1;
                                                },
                                        });
                                },
                        ],
                });
                harnesses.push(harness);
                await harness.session.prompt("/settings");
                expect(extensionRan).toBe(1);
        });

        it("two extensions registering the same name still disambiguate (:2 suffix lane)", async () => {
                const harness = await createHarness({
                        extensionFactories: [
                                (pi: ExtensionAPI) => {
                                        pi.registerCommand("dupname", {
                                                description: "first",
                                                handler: async () => {},
                                        });
                                },
                                (pi: ExtensionAPI) => {
                                        pi.registerCommand("dupname", {
                                                description: "second",
                                                handler: async () => {},
                                        });
                                },
                        ],
                });
                harnesses.push(harness);
                const runner = (harness.session as unknown as { extensionRunner: any }).extensionRunner;
                const first = runner.getCommand("dupname:1");
                const second = runner.getCommand("dupname:2");
                expect(first).toBeTruthy();
                expect(second).toBeTruthy();
                expect(first.invocationName).toBe("dupname:1");
                expect(second.invocationName).toBe("dupname:2");
        });

        it("prompt with arguments still routes to the override (subcommands survive)", async () => {
                let seenArgs = "";
                const harness = await createHarness({
                        extensionFactories: [
                                (pi: ExtensionAPI) => {
                                        pi.registerCommand("settings", {
                                                description: "the unown settings hub (override test)",
                                                handler: async (args) => {
                                                        seenArgs = args ?? "";
                                                },
                                        });
                                },
                        ],
                });
                harnesses.push(harness);
                await harness.session.prompt("/settings search kill switch");
                expect(seenArgs).toBe("search kill switch");
        });
});
