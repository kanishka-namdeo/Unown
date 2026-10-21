// Hold a write transaction on the engine DB for N seconds (simulates engine
// mid-dream / mid-cycle write activity without burning LLM tokens).
import { Database } from "bun:sqlite";
const secs = Number(process.argv[2] ?? 60);
const db = new Database("/home/z/my-project/unown/db/selflearning.db");
db.exec("PRAGMA busy_timeout = 5000");
db.exec("BEGIN IMMEDIATE");
console.log(`[db-busy] holding write txn for ${secs}s (pid ${process.pid})`);
// keep the txn alive but do something tiny
db.run("INSERT INTO hook_log (run_id, hook, allowed, level, detail, ts) VALUES (?, 'BusySim', 1, 'log', 'simulated busy', ?)", ["sim-" + Date.now(), Date.now()]);
await new Promise((r) => setTimeout(r, secs * 1000));
db.exec("COMMIT");
db.close();
console.log("[db-busy] released");
