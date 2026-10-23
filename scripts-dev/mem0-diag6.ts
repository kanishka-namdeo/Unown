/**
 * Diagnostic 6: fresh store, sequence-numbered LLM calls, and the raw
 * memory.add() return values — pin down exactly where events are lost.
 */
import { rmSync, mkdirSync } from "node:fs";
rmSync("/tmp/mem0-diag6", { recursive: true, force: true });
mkdirSync("/tmp/mem0-diag6/db", { recursive: true });
mkdirSync("/tmp/mem0-diag6/data", { recursive: true });

process.env.PI_SELFLEARNING_DB = "/tmp/mem0-diag6/db/selflearning.db";
process.env.PI_SELFLEARNING_DATA = "/tmp/mem0-diag6/data";
process.env.PI_BRIDGE_URL = "http://127.0.0.1:3031/v1";
process.env.PI_MODEL_ID = "agnes-3.0-flash";
process.env.PI_PROVIDER = "zai-bridge";

const memzero = await import("../pi-repo/packages/self-learning/src/memzero.ts");

// Patch GovernedLlm to log every call's response with a sequence number
const GL = (memzero as any).GovernedLlm;
const origGen = GL.prototype.generateResponse;
let seq = 0;
GL.prototype.generateResponse = async function (messages: any, responseFormat: any, tools: any) {
  const n = ++seq;
  const out = await origGen.call(this, messages, responseFormat, tools);
  const parsedMsgs = Array.isArray(messages) ? messages : [messages];
  const userMsg = parsedMsgs.find((m: any) => m?.role === "user")?.content ?? "";
  const newMsgs = userMsg.split("## New Messages")[1]?.split("## Observation")[0] ?? "";
  const existing = userMsg.split("## Existing Memories")[1]?.split("## New Messages")[0] ?? "";
  console.log(`[call#${n}] existing=${existing.trim().slice(0, 60)} | new=${newMsgs.trim().slice(0, 80).replace(/\n/g, " ⏎ ")}`);
  console.log(`[call#${n}] RESPONSE: ${JSON.stringify(out).slice(0, 300)}`);
  return out;
};

const FLAKY = `watch out: bun test on this repo is flaky under parallel runners - use bun test --runInBand when results look wrong`;

const platform = await memzero.getMemoryPlatform();
console.log("[diag] platform ready — fresh store");

const scope = memzero.projectScope("diag6-arr");
const events = await platform.add([{ role: "user", content: FLAKY }], scope, { kind: "terminal-note" });
console.log("\n[diag] FINAL platform.add events:", JSON.stringify(events, null, 2));

const all = await platform.getAll(scope);
console.log("[diag] store now holds:", all.length, "memories:");
for (const m of all) console.log("   -", m.text.slice(0, 110));
