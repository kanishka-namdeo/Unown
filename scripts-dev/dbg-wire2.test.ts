import { beforeAll, afterAll, test } from "bun:test";
import { startMockBridge, type MockBridge } from "../pi-repo/packages/self-learning/test/cli/helpers.ts";
let bridge: MockBridge;
beforeAll(() => { bridge = startMockBridge({ label: "wire2" }); });
afterAll(() => bridge?.close());
test("health + models from parent", async () => {
        const h = await fetch(`${bridge.url}/v1/health`);
        console.log("HEALTH:", h.status, (await h.text()).slice(0, 80));
        const m = await fetch(`${bridge.url}/v1/models`);
        console.log("MODELS:", m.status, (await m.text()).slice(0, 80));
}, 15000);
