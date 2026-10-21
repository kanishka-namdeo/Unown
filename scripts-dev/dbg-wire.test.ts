import { beforeAll, afterAll, test } from "bun:test";
import { startMockBridge, type MockBridge } from "../pi-repo/packages/self-learning/test/cli/helpers.ts";
import { execSync } from "node:child_process";

let bridge: MockBridge;
beforeAll(() => { bridge = startMockBridge({ label: "wire" }); });
afterAll(() => bridge?.close());

test("what does /v1/models actually return", async () => {
        // from the PARENT (happy-dom patched fetch/Response)
        const parentRes = await fetch(`${bridge.url}/v1/models`);
        const parentBody = await parentRes.text();
        console.log("PARENT status:", parentRes.status, "body:", parentBody.slice(0, 120));
        // from a REAL client (curl, no DOM globals)
        const out = execSync(`curl -s -i -m 3 ${bridge.url}/v1/models`).toString();
        console.log("CURL:", out.slice(0, 200).replace(/\r/g, ""));
}, 15000);
