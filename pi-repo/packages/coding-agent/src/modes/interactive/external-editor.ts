import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripBom } from "../../utils/text.ts";

export interface ExternalEditorOptions {
        command: string;
        content: string;
}

export type ExternalEditorResult = { status: "complete"; content: string } | { status: "failed" };

export interface EditExistingFileOptions {
        /** The $VISUAL/$EDITOR command line (first token is the binary). */
        command: string;
        /** The EXISTING file to open (edited in place — Da capo R10's /keybindings lane). */
        filePath: string;
}

/**
 * Open an EXISTING file in the external editor and await its exit (Da capo
 * R10 — Claude Code's /keybindings: "Open your keyboard shortcuts file").
 * Unlike editInExternalEditor this never writes content or cleans up — the
 * caller owns the file. Returns true when the editor exited 0.
 */
export async function editExistingFileInExternalEditor(options: EditExistingFileOptions): Promise<boolean> {
        const [editor, ...editorArgs] = options.command.split(" ");
        process.stdout.write(`Launching external editor: ${options.command}\nPi will resume when the editor exits.\n`);
        // Do not use spawnSync here. On Windows, synchronous child_process calls can keep
        // Node/libuv's console input read active after the parent pauses stdin, racing
        // vim/nvim for the console input buffer until Ctrl+C cancels the pending read.
        const exitCode = await new Promise<number | null>((resolve) => {
                const child = spawn(editor, [...editorArgs, options.filePath], {
                        stdio: "inherit",
                        shell: process.platform === "win32",
                });
                child.on("error", () => resolve(null));
                child.on("close", (code) => resolve(code));
        });
        return exitCode === 0;
}

export async function editInExternalEditor(options: ExternalEditorOptions): Promise<ExternalEditorResult> {
        const directory = mkdtempSync(join(tmpdir(), "pi-editor-"));
        const filePath = join(directory, "prompt.md");
        try {
                writeFileSync(filePath, options.content, "utf-8");
                const [editor, ...editorArgs] = options.command.split(" ");
                process.stdout.write(`Launching external editor: ${options.command}\nPi will resume when the editor exits.\n`);

                // Do not use spawnSync here. On Windows, synchronous child_process calls can keep
                // Node/libuv's console input read active after the parent pauses stdin, racing
                // vim/nvim for the console input buffer until Ctrl+C cancels the pending read.
                const exitCode = await new Promise<number | null>((resolve) => {
                        const child = spawn(editor, [...editorArgs, filePath], {
                                stdio: "inherit",
                                shell: process.platform === "win32",
                        });
                        child.on("error", () => resolve(null));
                        child.on("close", (code) => resolve(code));
                });

                if (exitCode !== 0) {
                        return { status: "failed" };
                }

                return { status: "complete", content: stripBom(readFileSync(filePath, "utf-8")).replace(/\n$/, "") };
        } finally {
                try {
                        rmSync(directory, { recursive: true, force: true });
                } catch {
                        // Cleanup is best effort.
                }
        }
}
