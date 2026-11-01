import { afterEach, describe, expect, test, vi } from "vitest";
import type { SessionManager } from "../../../src/core/session-manager.ts";
import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";

// Regression for https://github.com/earendil-works/pi/issues/5724
//
// `proper-lockfile` installs `signal-exit`, whose signal listener re-sends
// SIGTERM/SIGHUP when it observes no other process listeners during the same
// signal dispatch. InteractiveMode must therefore keep its signal handlers
// registered until async terminal cleanup has completed.

type ShutdownThis = {
        isShuttingDown: boolean;
        unregisterSignalHandlers: () => void;
        runtimeHost: { dispose: () => Promise<void> };
        ui: { terminal: { drainInput: (ms: number) => Promise<void> } };
        themeController: { disableAutoSync: () => void };
        stop: () => void;
        // The exit-resume round grew shutdown's surface: the resume hint now
        // rides the signal path too, and an in-flight turn is aborted and
        // awaited before dispose (the no-op mocks here keep this test's
        // ordering assertions about signal handler registration unchanged).
        sessionManager: SessionManager;
        options: { appName?: string; resumeCommand?: (sessionId: string) => string | undefined };
        printResumeHint: (this: ShutdownThis) => void;
        session: { abortActiveOperation: () => boolean; waitForIdle: () => Promise<void> };
};

type InteractiveModePrototypeWithShutdown = {
        shutdown(this: ShutdownThis, options?: { fromSignal?: boolean }): Promise<void>;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown;
const prototypePrintResumeHint = (interactiveModePrototype as { printResumeHint(this: never): void }).printResumeHint;

class ProcessExitError extends Error {}

function deferred(): { promise: Promise<void>; resolve: () => void } {
        let resolve: (() => void) | undefined;
        const promise = new Promise<void>((res) => {
                resolve = res;
        });
        return {
                promise,
                resolve: () => resolve?.(),
        };
}

async function callShutdown(context: ShutdownThis, options?: { fromSignal?: boolean }): Promise<void> {
        try {
                await (interactiveModePrototype as InteractiveModePrototypeWithShutdown).shutdown.call(context, options);
        } catch (error) {
                if (!(error instanceof ProcessExitError)) throw error;
        }
}

describe("InteractiveMode SIGTERM shutdown with signal-exit (#5724)", () => {
        afterEach(() => {
                vi.restoreAllMocks();
        });

        test("keeps signal handlers registered while signal-triggered cleanup is pending", async () => {
                vi.spyOn(process, "exit").mockImplementation((() => {
                        throw new ProcessExitError();
                }) as typeof process.exit);

                const order: string[] = [];
                const dispose = deferred();
                const context: ShutdownThis = {
                        isShuttingDown: false,
                        unregisterSignalHandlers: vi.fn(() => {
                                order.push("unregister");
                        }),
                        runtimeHost: {
                                dispose: vi.fn(() => {
                                        order.push("dispose");
                                        return dispose.promise;
                                }),
                        },
                        ui: {
                                terminal: {
                                        drainInput: vi.fn(async () => {
                                                order.push("drainInput");
                                        }),
                                },
                        },
                        themeController: { disableAutoSync: vi.fn() },
                        stop: vi.fn(() => {
                                order.push("stop");
                        }),
                        sessionManager: { isPersisted: () => false } as unknown as SessionManager,
                        options: {},
                        printResumeHint: prototypePrintResumeHint,
                        session: {
                                abortActiveOperation: vi.fn(() => false),
                                waitForIdle: vi.fn(() => Promise.resolve()),
                        },
                };

                const shutdownPromise = callShutdown(context, { fromSignal: true });
                await Promise.resolve();

                expect(order).toEqual(["dispose"]);
                expect(context.unregisterSignalHandlers).not.toHaveBeenCalled();

                dispose.resolve();
                await shutdownPromise;

                expect(order).toEqual(["dispose", "drainInput", "stop"]);
        });
});
