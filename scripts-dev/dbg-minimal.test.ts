import { beforeAll, describe, expect, test } from "bun:test";
import { startMockBridge, runUnown, type MockBridge } from "../pi-repo/packages/self-learning/test/cli/helpers.ts";

let bridge: MockBridge;
beforeAll(() => { bridge = startMockBridge({ label: "dbg-min" }); });

describe("minimal repro", () => {
        test("add --all-models imports", async () => {
                const root = "/tmp/dbgmin-root";
                const opts = { bridge, root };
                const add = await runUnown(["providers", "add", "--provider", "openai", "--base-url", `${bridge.url}/v1`, "--api-key", "sk-1", "--model", "kimi-k2.5", "--all-models"], opts);
                console.log("ADD:", add.stdout.replace(/\n/g, " | ").slice(0, 200));
                expect(add.stdout).toContain("imported 1 more model: mock-kimi");
        }, 60000);
});
