// interactive-mode-external-editor-context.test.ts — Da capo R4's wiring:
// handleOpenExternalEditor prepends the last assistant reply as '#'-commented
// context when `externalEditorContext` is on (and a reply exists), and strips
// the exact block on save — via the REAL editInExternalEditor with the fixture
// editor (the prototype-call harness from interactive-mode-status.test.ts).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { buildExternalEditorContextBlock } from "../src/modes/interactive/external-editor.ts";

const FIXTURE = join(import.meta.dirname, "fixtures", "fake-external-editor.mjs");

let tmpRoot: string | undefined;
afterEach(() => {
        if (tmpRoot) {
                rmSync(tmpRoot, { recursive: true, force: true });
                tmpRoot = undefined;
        }
});

/** A fixture editor command: appends "my reply" under the seeded content. */
function fixtureEditorCommand(flag?: "--append-reply"): string {
        tmpRoot = mkdtempSync(join(tmpdir(), "pi-ctx-wire-"));
        return `${process.execPath} ${FIXTURE} ${join(tmpRoot, "capture.json")}${flag ? ` ${flag}` : ""}`;
}

type FakeThis = {
        settingsManager: {
                getExternalEditorCommand: () => string;
                getExternalEditorContext: () => boolean;
        };
        editor: {
                getExpandedText?: () => string;
                getText: () => string;
                setText: (text: string) => void;
        };
        ui: {
                stop: () => void;
                start: () => void;
                requestRender: () => void;
        };
        session: {
                getLastAssistantText: () => string | undefined;
        };
};

function makeFakeThis(overrides: Partial<FakeThis> = {}): FakeThis {
        return {
                settingsManager: {
                        getExternalEditorCommand: () => fixtureEditorCommand("--append-reply"),
                        getExternalEditorContext: () => true,
                },
                editor: {
                        getExpandedText: () => "the prompt",
                        getText: () => "the prompt",
                        setText: vi.fn(),
                },
                ui: {
                        stop: vi.fn(),
                        start: vi.fn(),
                        requestRender: vi.fn(),
                },
                session: {
                        getLastAssistantText: () => "the previous assistant reply",
                },
                ...overrides,
        };
}

async function callOpen(fakeThis: FakeThis): Promise<void> {
        const prototype = (
                InteractiveMode as unknown as {
                        prototype: { handleOpenExternalEditor: (this: FakeThis) => Promise<void> };
                }
        ).prototype;
        await prototype.handleOpenExternalEditor.call(fakeThis);
}

describe("handleOpenExternalEditor — the Da capo R4 context block", () => {
        it("prepends the '#' commented reply and strips it on save (the happy lane)", async () => {
                const fakeThis = makeFakeThis();
                await callOpen(fakeThis);

                // The fixture appended "my reply" under the seeded content; the block
                // strips and the reply survives above the original prompt text.
                expect(fakeThis.editor.setText).toHaveBeenCalledTimes(1);
                expect(fakeThis.editor.setText).toHaveBeenCalledWith("the promptmy reply");
                // The stop/start dance ran exactly once around the editor.
                expect(fakeThis.ui.stop).toHaveBeenCalledTimes(1);
                expect(fakeThis.ui.start).toHaveBeenCalledTimes(1);
        });

        it("seeds the exact block bytes (byte-exact bookkeeping)", async () => {
                const fakeThis = makeFakeThis();
                await callOpen(fakeThis);
                const capturePath = join(tmpRoot!, "capture.json");
                const captured = JSON.parse(readFileSync(capturePath, "utf-8")) as { content: string };
                const expectedBlock = buildExternalEditorContextBlock("the previous assistant reply");
                expect(captured.content).toBe(`${expectedBlock}the prompt`);
        });

        it("does NOT prepend when the setting is off (the default)", async () => {
                const fakeThis = makeFakeThis({
                        settingsManager: {
                                getExternalEditorCommand: () => fixtureEditorCommand("--append-reply"),
                                getExternalEditorContext: () => false,
                        },
                });
                await callOpen(fakeThis);
                expect(fakeThis.editor.setText).toHaveBeenCalledWith("the promptmy reply");
                const capturePath = join(tmpRoot!, "capture.json");
                const captured = JSON.parse(readFileSync(capturePath, "utf-8")) as { content: string };
                expect(captured.content.startsWith("# --- previous reply")).toBe(false);
                expect(captured.content).toBe("the prompt");
        });

        it("does NOT prepend when no assistant reply exists yet", async () => {
                const fakeThis = makeFakeThis({
                        session: { getLastAssistantText: () => undefined },
                });
                await callOpen(fakeThis);
                const capturePath = join(tmpRoot!, "capture.json");
                const captured = JSON.parse(readFileSync(capturePath, "utf-8")) as { content: string };
                expect(captured.content).toBe("the prompt");
        });

        it("leaves the saved content untouched when the user deleted the block", async () => {
                // The default fixture mode rewrites the file as "edited\n".
                const fakeThis = makeFakeThis({
                        settingsManager: {
                                getExternalEditorCommand: () => fixtureEditorCommand(),
                                getExternalEditorContext: () => true,
                        },
                });
                await callOpen(fakeThis);
                // "edited" does not start with the block → nothing strips.
                expect(fakeThis.editor.setText).toHaveBeenCalledWith("edited");
        });

        it("never calls setText when the editor fails (non-zero exit)", async () => {
                const fakeThis = makeFakeThis({
                        settingsManager: {
                                getExternalEditorCommand: () => `${fixtureEditorCommand()} --fail`,
                                getExternalEditorContext: () => true,
                        },
                });
                await callOpen(fakeThis);
                expect(fakeThis.editor.setText).not.toHaveBeenCalled();
                // The stop/start dance still unwinds (finally).
                expect(fakeThis.ui.start).toHaveBeenCalledTimes(1);
        });
});
