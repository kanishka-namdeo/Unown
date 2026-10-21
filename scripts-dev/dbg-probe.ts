// Debug: why does probeOpenAiEndpoint return no models against the test mock bridge?
import { startMockBridge } from "../pi-repo/packages/self-learning/test/cli/helpers.ts";
import { probeOpenAiEndpoint } from "../pi-repo/packages/self-learning/src/probe.ts";

const bridge = startMockBridge({ label: "dbg" });
console.log("bridge url:", bridge.url);
const res = await fetch(`${bridge.url}/v1/models`);
console.log("raw /v1/models status:", res.status, "body:", (await res.text()).slice(0, 200));
const probe = await probeOpenAiEndpoint(`${bridge.url}/v1`, "sk-1", 4000);
console.log("probe:", JSON.stringify(probe));
bridge?.close();
process.exit(0);
