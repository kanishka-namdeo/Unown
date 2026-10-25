/**
 * mem0 raw extraction probe — drives ONE platform.add() with a complex
 * note (the exact shape the live benchmark failed on) and dumps the raw
 * upstream response + what the SDK parsed.
 *
 * Usage: bun scripts-dev/mem0-raw-probe.ts
 */
import { rmSync, mkdirSync } from "node:fs";

rmSync("/tmp/mem0-probe", { recursive: true, force: true });
mkdirSync("/tmp/mem0-probe/db", { recursive: true });
mkdirSync("/tmp/mem0-probe/data", { recursive: true });

process.env.PI_SELFLEARNING_DB = "/tmp/mem0-probe/db/selflearning.db";
process.env.PI_SELFLEARNING_DATA = "/tmp/mem0-probe/data";
process.env.PI_BRIDGE_URL = "http://127.0.0.1:3031/v1";
process.env.PI_MODEL_ID = "agnes-3.0-flash";
process.env.PI_PROVIDER = "zai-bridge";

const memzero = await import("../pi-repo/packages/self-learning/src/memzero.ts");
const platform = await memzero.getMemoryPlatform();

// Tap the governed LLM to capture the RAW extraction request/response.
// Handle: platform.memory.llm (public-field injection per buildMem0Platform).
const mem = (platform as any).memory;
const llm = mem?.llm;
let rawDump: string[] = [];
if (llm) {
  const origGen = llm.generateResponse.bind(llm);
  llm.generateResponse = async (m: any, rf?: any, tools?: any) => {
    const res = await origGen(m, rf, tools);
    const sys = m?.find?.((x: any) => x?.role === "system") ?? m?.[0];
    const user = m?.find?.((x: any) => x?.role === "user") ?? m?.[1];
    const out = typeof res === "string" ? res : (res?.content ?? JSON.stringify(res));
    rawDump.push(
      `>>> SYSTEM (first 500): ${String(sys?.content ?? "")}\n` +
        `>>> USER (first 300): ${String(user?.content ?? "")}\n` +
        `>>> RESPONSE_FORMAT: ${JSON.stringify(rf)?.slice(0, 200)}\n` +
        `<<< RAW (first 1500):\n${String(out).slice(0, 1500)}`
    );
    return res;
  };
} else {
  console.log("[probe] no llm handle — platform keys:", Object.keys(platform as any), "memory keys:", mem ? Object.keys(mem) : null);
}

const NOTE = `Terminal session outcome in /home/z/my-project/bench-workspace/taskserver:
Final outcome: Done. All 44 tests pass, and the command works end to end.

**Changes:**

1. **src/csv.ts** (new) — RFC-4180 CSV module matching the existing formatter pattern (format-table.ts style: pure, exported function taking Note[]):
   - quoteCsvField(value) — quotes a field when it contains commas/quotes/newlines and doubles embedded "
   - formatNotesCsv(notes) — header id,title,status,createdAt plus one row per note; notes have no status field so status is exported as "open"
2. **src/cli.ts** — added export case mirroring the table pattern: clippad export --csv returns formatNotesCsv(notebook.all()); without --csv it prints usage.
3. **tests/csv.test.ts** (new) — unit tests for the escaping: plain fields unquoted, commas forced, quotes doubled, combined, newlines preserved.

Session metadata (counts, duration and session id only — data, not knowledge): 2 prompt(s), 20 tool call(s) (bash, read, grep, write, edit), 2 min, session 0a8efeb0.`;

const scope = memzero.projectScope("probe-complex");
const events = await platform.add([{ role: "user", content: NOTE }], scope, { kind: "terminal-note" });
console.log(`[probe] events extracted: ${events.length}`);
for (const e of events as any[]) console.log("  -", e?.text?.slice(0, 100));
console.log("[probe] raw LLM traffic (" + rawDump.length + " calls):");
for (const d of rawDump) console.log(d + "\n" + "=".repeat(70));
