/**
 * Print mode (single-shot): Send prompts, output result, exit.
 *
 * Used for:
 * - `pi -p "prompt"` - text output
 * - `pi --mode json "prompt"` - JSON event stream
 */

import type { AssistantMessage, ImageContent } from "@earendil-works/pi-ai";
import type { AgentSessionRuntime } from "../core/agent-session-runtime.ts";
import { flushRawStdout, waitForRawStdoutBackpressure, writeRawStdout } from "../core/output-guard.ts";
import { killTrackedDetachedChildren } from "../utils/shell.ts";
import { toJsonEvent } from "./json-event.ts";

/**
 * Options for print mode.
 */
export interface PrintModeOptions {
        /** Output mode: "text" for final response only, "json" for all events */
        mode: "text" | "json";
        /** Array of additional prompts to send after initialMessage */
        messages?: string[];
        /** First message to send (may contain @file content) */
        initialMessage?: string;
        /** Images to attach to the initial message */
        initialImages?: ImageContent[];
        /** Skip the runtime dispose in the finally block (the CALLER disposes).
        *  Unown's terminal auto-compact (LR-2, 2026-10-27) runs a compaction
        *  that outlives the aborted agent loop; disposing here would cancel
        *  it mid-summarization (session.dispose() aborts in-flight
        *  compaction) before the caller can submit its continuation round.
        *  Backwards-compatible: unset = today's dispose-on-exit behavior. */
        keepRuntimeAlive?: boolean;
}

/**
 * Run in print (single-shot) mode.
 * Sends prompts to the agent and outputs the result.
 */
export async function runPrintMode(runtimeHost: AgentSessionRuntime, options: PrintModeOptions): Promise<number> {
        const { mode, messages = [], initialMessage, initialImages } = options;
        let exitCode = 0;
        let session = runtimeHost.session;
        let unsubscribe: (() => void) | undefined;
        let unsubscribeBackpressure: (() => void) | undefined;
        let disposed = false;
        const signalCleanupHandlers: Array<() => void> = [];

        const disposeRuntime = async (): Promise<void> => {
                if (disposed) return;
                disposed = true;
                unsubscribe?.();
                unsubscribeBackpressure?.();
                await runtimeHost.dispose();
        };

        const registerSignalHandlers = (): void => {
                // SIGINT is deliberately included (2026-10-22 M2): Ctrl-C on a
                // one-shot run deserves the same graceful dispose as SIGTERM —
                // the session_shutdown note path runs, tracked children die, and
                // the conventional 130 exit code is preserved. Without it only
                // the child reaper's hard exit-130 answered Ctrl-C.
                const signals: NodeJS.Signals[] = ["SIGTERM"];
                if (process.platform !== "win32") {
                        signals.push("SIGHUP", "SIGINT");
                }

                for (const signal of signals) {
                        const handler = () => {
                                killTrackedDetachedChildren();
                                void disposeRuntime().finally(() => {
                                        process.exit(signal === "SIGHUP" ? 129 : signal === "SIGINT" ? 130 : 143);
                                });
                        };
                        process.on(signal, handler);
                        signalCleanupHandlers.push(() => process.off(signal, handler));
                }
        };

        registerSignalHandlers();

        runtimeHost.setRebindSession(async () => {
                await rebindSession();
        });

        const rebindSession = async (): Promise<void> => {
                session = runtimeHost.session;
                await session.bindExtensions({
                        mode: mode === "json" ? "json" : "print",
                        commandContextActions: {
                                waitForIdle: () => session.waitForIdle(),
                                newSession: async (newSessionOptions) => runtimeHost.newSession(newSessionOptions),
                                fork: async (entryId, forkOptions) => {
                                        const result = await runtimeHost.fork(entryId, forkOptions);
                                        return { cancelled: result.cancelled };
                                },
                                navigateTree: async (targetId, navigateOptions) => {
                                        const result = await session.navigateTree(targetId, {
                                                summarize: navigateOptions?.summarize,
                                                customInstructions: navigateOptions?.customInstructions,
                                                replaceInstructions: navigateOptions?.replaceInstructions,
                                                label: navigateOptions?.label,
                                        });
                                        return { cancelled: result.cancelled };
                                },
                                switchSession: async (sessionPath, switchOptions) => {
                                        return runtimeHost.switchSession(sessionPath, switchOptions);
                                },
                                reload: async () => {
                                        await session.reload();
                                },
                        },
                        onError: (err) => {
                                console.error(`Extension error (${err.extensionPath}): ${err.error}`);
                        },
                });

                unsubscribe?.();
                unsubscribeBackpressure?.();
                unsubscribe = session.subscribe((event) => {
                        if (mode === "json") {
                                writeRawStdout(`${JSON.stringify(toJsonEvent(event))}\n`);
                        }
                });
                unsubscribeBackpressure =
                        mode === "json"
                                ? session.agent.subscribe(async () => {
                                                await waitForRawStdoutBackpressure();
                                        })
                                : undefined;
        };

        try {
                if (mode === "json") {
                        const header = session.sessionManager.getHeader();
                        if (header) {
                                writeRawStdout(`${JSON.stringify(header)}\n`);
                        }
                }

                await rebindSession();

                if (initialMessage) {
                        await session.prompt(initialMessage, { images: initialImages });
                }

                for (const message of messages) {
                        await session.prompt(message);
                }

                if (mode === "text") {
                        const state = session.state;
                        const lastMessage = state.messages[state.messages.length - 1];

                        if (lastMessage?.role === "assistant") {
                                const assistantMsg = lastMessage as AssistantMessage;
                                if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
                                        console.error(assistantMsg.errorMessage || `Request ${assistantMsg.stopReason}`);
                                        exitCode = 1;
                                } else {
                                        for (const content of assistantMsg.content) {
                                                if (content.type === "text") {
                                                        writeRawStdout(`${content.text}\n`);
                                                }
                                        }
                                }
                        }
                }

                return exitCode;
        } catch (error: unknown) {
                console.error(error instanceof Error ? error.message : String(error));
                return 1;
        } finally {
                for (const cleanup of signalCleanupHandlers) {
                        cleanup();
                }
                if (!options.keepRuntimeAlive) {
                        await disposeRuntime();
                }
                await flushRawStdout();
        }
}
