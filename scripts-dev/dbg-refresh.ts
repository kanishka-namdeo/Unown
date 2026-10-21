// Debug: replicate the failing test flow end-to-end (add --all-models, then refresh)
import { startMockBridge } from "../pi-repo/packages/self-learning/test/cli/helpers.ts";
import { runUnown } from "../pi-repo/packages/self-learning/test/cli/helpers.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const bridge = startMockBridge({ label: "dbg2" });
const root = "/tmp/dbg2-root";
const opts = { bridge, root };
const add = await runUnown(["providers", "add", "--provider", "openai", "--base-url", `${bridge.url}/v1`, "--api-key", "sk-1", "--model", "kimi-k2.5", "--all-models"], opts);
console.log("ADD rc:", add.exitCode);
console.log("ADD stdout:", add.stdout);
console.log("models.json:", readFileSync(join(root, "home", "agent", "models.json"), "utf8").slice(0, 400));
const again = await runUnown(["providers", "refresh", "openai"], opts);
console.log("REFRESH rc:", again.exitCode);
console.log("REFRESH stdout:", again.stdout);
bridge?.close();
process.exit(0);
