/**
 * setup-dialog.ts — interactive dialog primitives for the setup wizard.
 *
 * Extracted from setup.ts so the wizard's state machine can be unit-tested
 * against a scripted dialog (the providers-command.test.ts posture) while the
 * real terminal implementation lives in exactly one place.
 *
 * WHY this does not use readline/promises for the TTY path: bun's
 * readline/promises `question()` chain proved unreliable under a real PTY in
 * the full CLI import graph — the second pending question can drain the event
 * loop and exit(0) silently, or reject with ERR_USE_AFTER_CLOSE ("readline
 * was closed"; a latent crash in the pre-0.0.3 wizard, reproduced under PTY).
 * Both failures disappear when the dialog owns the terminal directly: one
 * raw-mode reader with explicit echo/backspace/Ctrl+C handling, identical for
 * every prompt. This is the same posture as production prompt libraries
 * (Inquirer, gh's survey): they drive the tty themselves.
 *
 * Surfaces (the Hermes-agent onboarding patterns, adapted to unown):
 *   ask        — line input with a default (blank = default; never dead-ends)
 *   askSecret  — masked key entry: raw mode, per-char "•" echo, backspace,
 *                Ctrl+C cancels; a non-TTY caller gets a visible plain ask
 *                with a warning (never a silent dead prompt)
 *   choose     — numbered choice list; blank = default index
 *   note       — informational line
 *
 * The dialog is injectable: `createTerminalDialog()` is the production
 * implementation; tests pass an object with scripted queues.
 */

/** Answer to an existing-secret question: keep / replace / clear / none. */
export type ExistingKeyChoice = "keep" | "replace" | "clear" | "none";

export interface SetupDialog {
        /** Ask a free-text question. Blank answer falls back to `fallback` ("" allowed). */
        ask(question: string, fallback?: string): Promise<string>;
        /** Ask for a secret. Echo is masked. Blank = "" (keyless). */
        askSecret(question: string, hint?: string): Promise<string>;
        /** Numbered choice. Returns the chosen index; blank/invalid = `defaultIndex`. */
        choose(question: string, options: string[], defaultIndex?: number): Promise<number>;
        /** Informational output (no prompt). */
        note(text: string): void;
}

/**
 * Masked display for an existing secret: first 8 chars + ellipsis.
 * (Hermes main_provider_setup: `key[:8]...` — enough to recognize, never
 * enough to use.)
 */
export function maskKey(key: string): string {
        const trimmed = key.trim();
        if (!trimmed) return "";
        return `${trimmed.slice(0, 8)}…`;
}

/** Sentinel returned by askSecret on Ctrl+C. */
export const SECRET_CANCEL = "\u0003";

// ---------------------------------------------------------------------------
// The terminal-owned reader
// ---------------------------------------------------------------------------

interface ReadOpts {
        /** Mask the echo (secrets). */
        masked?: boolean;
        /** Called with each accepted character (already echoed). */
}

/**
 * Read one line from a TTY stdin, owning the terminal state:
 * raw mode ON for the duration, echo handled here (visible char or "•"),
 * backspace/Delete erases, Ctrl+U clears, Enter (\r/\n) finishes, Ctrl+C
 * cancels (returns SECRET_CANCEL), Ctrl+D on an empty line cancels too.
 * The terminal is ALWAYS restored before returning — a wedged raw-mode
 * terminal is the worst outcome a prompt can have.
 */
function readTerminalLine(opts: ReadOpts = {}): Promise<string> {
        return new Promise<string>((resolve) => {
                const stdin = process.stdin;
                if (!stdin.isTTY) {
                        // Should not happen (the wizard is TTY-gated); be safe anyway.
                        resolve("");
                        return;
                }
                let value = "";
                // Keep-alive: a pending prompt MUST hold the event loop open for as
                // long as the user needs. Bun can drain the loop while a stdin read is
                // pending in a large import graph (reproduced: the wizard silently
                // exit(0)s mid-question, and the pre-0.0.3 readline wizard crashed the
                // same way). A 1s interval costs nothing and is ALWAYS cleared.
                const keepAlive = setInterval(() => {}, 1000);
                const restore = () => {
                        clearInterval(keepAlive);
                        try {
                                stdin.setRawMode(false);
                        } catch {
                                /* already restored */
                        }
                        stdin.resume();
                        stdin.off("data", onData);
                };
                const finish = () => {
                        restore();
                        process.stdout.write("\n");
                        resolve(value);
                };
                const cancel = () => {
                        restore();
                        process.stdout.write("^C\n");
                        resolve(SECRET_CANCEL);
                };
                const eraseOne = () => {
                        if (value.length > 0) {
                                value = value.slice(0, -1);
                                process.stdout.write("\b \b");
                        }
                };
                const onData = (chunk: Buffer) => {
                        for (const byte of chunk) {
                                if (byte === 0x03) {
                                        cancel();
                                        return;
                                }
                                if (byte === 0x04) {
                                        // Ctrl+D: EOF — cancel on empty, finish otherwise
                                        if (value.length === 0) {
                                                cancel();
                                                return;
                                        }
                                        finish();
                                        return;
                                }
                                if (byte === 0x0d || byte === 0x0a) {
                                        finish();
                                        return;
                                }
                                if (byte === 0x7f || byte === 0x08) {
                                        eraseOne();
                                        continue;
                                }
                                if (byte === 0x15) {
                                        while (value.length > 0) eraseOne();
                                        continue;
                                }
                                if (byte === 0x17) {
                                        // Ctrl+W: erase one word
                                        let erased = false;
                                        while (value.length > 0 && /\s/.test(value[value.length - 1] ?? "")) {
                                                eraseOne();
                                                erased = true;
                                        }
                                        while (value.length > 0 && !/\s/.test(value[value.length - 1] ?? "")) {
                                                eraseOne();
                                                erased = true;
                                        }
                                        if (erased) process.stdout.write(" ");
                                        continue;
                                }
                                if (byte < 0x20) continue; // other control bytes: ignore
                                const ch = String.fromCharCode(byte);
                                value += ch;
                                process.stdout.write(opts.masked ? "•" : ch);
                        }
                };
                stdin.setRawMode(true);
                stdin.resume();
                stdin.on("data", onData);
                // Safety net: if stdin ends (EOF) while reading, resolve what we have.
                stdin.once("end", () => {
                        restore();
                        resolve(value);
                });
        });
}

/** Production dialog: owns the terminal for every prompt. */
export function createTerminalDialog(): SetupDialog {
        return {
                async ask(question: string, fallback?: string): Promise<string> {
                        const suffix = fallback !== undefined ? ` [${fallback || "none"}]: ` : ": ";
                        process.stdout.write(`${question}${suffix}`);
                        const line = await readTerminalLine();
                        if (line === SECRET_CANCEL) return fallback ?? "";
                        const answer = line.trim();
                        return answer || (fallback ?? "");
                },

                async askSecret(question: string, hint?: string): Promise<string> {
                        const prompt = hint ? `${question} (${hint})` : question;
                        process.stdout.write(`${prompt}: `);
                        return await readTerminalLine({ masked: true });
                },

                async choose(question: string, options: string[], defaultIndex = 0): Promise<number> {
                        for (let i = 0; i < options.length; i++) {
                                process.stdout.write(`  ${i + 1}) ${options[i]}\n`);
                        }
                        const suffix = ` [${defaultIndex + 1}]: `;
                        process.stdout.write(`${question}${suffix}`);
                        const line = await readTerminalLine();
                        if (line === SECRET_CANCEL) return defaultIndex;
                        const answer = line.trim();
                        const idx = Number.parseInt(answer, 10);
                        if (Number.isInteger(idx) && idx >= 1 && idx <= options.length) return idx - 1;
                        return defaultIndex;
                },

                note(text: string): void {
                        process.stdout.write(`${text}\n`);
                },
        };
}

/**
 * Compatibility alias: the wizard used to build this from a readline
 * interface. The rl parameter is ignored (the dialog owns the terminal);
 * the signature stays so call sites and tests keep compiling.
 */
export function createReadlineDialog(_rl: unknown): SetupDialog {
        return createTerminalDialog();
}
