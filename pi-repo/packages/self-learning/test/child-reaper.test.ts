/**
 * child-reaper.test.ts — the last-resort child hygiene module.
 *
 * H1 hardening (research R-a, M-13/W-01): LSP/MCP server children must not be
 * orphaned when the agent dies via signal or abrupt exit. These tests pin the
 * registry semantics and the synchronous reap path.
 *
 * NOTE on the exit-path test: `process.emit("exit")` fires the once-handler
 * exactly like a real exit would (same event name, synchronous dispatch), so
 * reapNow() runs and the registered child receives SIGTERM+SIGKILL — without
 * ending the test process.
 */
import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
        childReaperInstalled,
        installChildReaper,
        registerChild,
        trackedChildrenCount,
        unregisterChild,
} from "../src/child-reaper.ts";

/** Spawn a shell-free long-lived child (bun running a 60 s no-op timer). */
function spawnSitter() {
        return spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
                stdio: ["ignore", "ignore", "ignore"],
        });
}

type DeadCheck = { exitCode: number | null; killed: boolean; signalCode?: string | null };

function waitForExit(child: DeadCheck, ms = 5000): Promise<void> {
        const deadline = Date.now() + ms;
        return new Promise((resolve, reject) => {
                const tick = () => {
                        if (child.exitCode !== null || child.signalCode) return resolve();
                        if (Date.now() > deadline) return reject(new Error("child did not exit in time"));
                        setTimeout(tick, 25);
                };
                tick();
        });
}

describe("child-reaper (H1)", () => {
        test("registerChild tracks a live child and auto-removes it when it exits naturally", async () => {
                const child = spawnSitter();
                const before = trackedChildrenCount();
                registerChild(child);
                expect(trackedChildrenCount()).toBe(before + 1);

                child.kill("SIGKILL");
                await waitForExit(child);
                // auto-unregister on the exit event (listener-attached)
                await new Promise((r) => setTimeout(r, 50));
                expect(trackedChildrenCount()).toBe(before);
        });

        test("registerChild ignores null and already-dead children", async () => {
                const dead = spawn(process.execPath, ["-e", ""]);
                await waitForExit(dead);
                const before = trackedChildrenCount();
                registerChild(null as any);
                registerChild(dead);
                expect(trackedChildrenCount()).toBe(before);
        });

        test("unregisterChild removes a child from tracking", async () => {
                const child = spawnSitter();
                registerChild(child);
                const tracked = trackedChildrenCount();
                unregisterChild(child);
                expect(trackedChildrenCount()).toBe(tracked - 1);
                child.kill("SIGKILL");
                await waitForExit(child);
        });

        test("installChildReaper is idempotent", () => {
                installChildReaper();
                installChildReaper();
                expect(childReaperInstalled()).toBe(true);
        });

        test("the exit path reaps registered children (SIGTERM+SIGKILL, synchronously)", async () => {
                installChildReaper();
                const child = spawnSitter();
                registerChild(child);
                expect(trackedChildrenCount()).toBeGreaterThan(0);

                // Fire the real once("exit") handler — synchronous reap path.
                process.emit("exit");
                await waitForExit(child, 2000);
                expect(child.signalCode ?? (child.exitCode !== null ? "exit" : null)).not.toBeNull();
        });
});
