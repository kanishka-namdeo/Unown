import { setKeybindings } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import {
        type SettingsCallbacks,
        type SettingsConfig,
        SettingsSelectorComponent,
} from "../src/modes/interactive/components/settings-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

describe("SettingsSelectorComponent", () => {
        beforeAll(() => {
                initTheme("dark");
                setKeybindings(new KeybindingsManager());
        });

        it("cycles through fullscreen settings", () => {
                const onExitOutputChange = vi.fn();
                const onScrollbarChange = vi.fn();
                const onCopyOnSelectChange = vi.fn();
                const config = {
                        fullscreenExitOutput: "transcript",
                        fullscreenScrollbar: "auto",
                        fullscreenCopyOnSelect: true,
                        warnings: {},
                        defaultModel: "not set",
                        availableDefaultModels: [],
                        availableThinkingLevels: [],
                        modelThinkingLevels: {},
                        availableThemes: [],
                } as unknown as SettingsConfig;
                const callbacks = {
                        onFullscreenExitOutputChange: onExitOutputChange,
                        onFullscreenScrollbarChange: onScrollbarChange,
                        onFullscreenCopyOnSelectChange: onCopyOnSelectChange,
                } as unknown as SettingsCallbacks;

                const cycle = (label: string, count: number) => {
                        const list = new SettingsSelectorComponent(config, callbacks).getSettingsList();
                        for (const character of label) list.handleInput(character);
                        for (let i = 0; i < count; i++) list.handleInput("\r");
                };

                cycle("Fullscreen exit output", 2);
                expect(onExitOutputChange.mock.calls.flat()).toEqual(["resume-hint", "transcript"]);
                cycle("Fullscreen scrollbar", 3);
                expect(onScrollbarChange.mock.calls.flat()).toEqual(["always", "hidden", "auto"]);
                cycle("Fullscreen copy on select", 2);
                expect(onCopyOnSelectChange.mock.calls.flat()).toEqual([false, true]);
        });

        it("cycles the Da capo toggle rows (terminal title states, external editor context)", () => {
                const onTerminalTitleStatesChange = vi.fn();
                const onExternalEditorContextChange = vi.fn();
                const config = {
                        fullscreenExitOutput: "transcript",
                        fullscreenScrollbar: "auto",
                        fullscreenCopyOnSelect: true,
                        warnings: {},
                        defaultModel: "not set",
                        availableDefaultModels: [],
                        availableThinkingLevels: [],
                        modelThinkingLevels: {},
                        availableThemes: [],
                        terminalTitleStates: true,
                        externalEditorContext: false,
                } as unknown as SettingsConfig;
                const callbacks = {
                        onTerminalTitleStatesChange,
                        onExternalEditorContextChange,
                } as unknown as SettingsCallbacks;

                const cycle = (label: string, count: number) => {
                        const list = new SettingsSelectorComponent(config, callbacks).getSettingsList();
                        for (const character of label) list.handleInput(character);
                        for (let i = 0; i < count; i++) list.handleInput("\r");
                };

                cycle("Terminal title states", 2);
                expect(onTerminalTitleStatesChange.mock.calls.flat()).toEqual([false, true]);
                cycle("External editor context", 2);
                expect(onExternalEditorContextChange.mock.calls.flat()).toEqual([true, false]);
        });
});
