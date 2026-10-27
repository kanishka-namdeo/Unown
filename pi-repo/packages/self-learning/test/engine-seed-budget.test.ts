// engine-seed-budget.test.ts — the seed race's timer contract (2026-10-28
// live round). The boot race between seedMemoryIfEmpty() and the
// PI_ENGINE_SEED_BUDGET_MS timer used to leave the timer UN-CLEARED when the
// seed won it: a seed that settled in 1.4s still printed "did not settle
// within 30s — booting degraded" thirty seconds later, sending a real
// operator chasing a degradation that did not exist (the platform was live).
//
// The contract pinned here, in a fresh subprocess (same determinism argument
// as engine-health's phase probe — bun test runs files in one process, and
// any earlier suite that booted startServer would race this one):
//   1. a seed that settles WITHIN budget prints the positive
//      "settled in Ns — memory platform live" line, and
//   2. it NEVER prints the stale "did not settle within Ns" line, even after
//      the budget has elapsed past it (the un-cleared timer fired at exactly
//      that moment pre-fix).
//
// The slow-seed branch (a genuine >budget seed prints the degraded line and
// the late-settlement lift when it lands) is not puppeteered here: making the
// platform init deterministically slow needs a controllable hang the engine
// does not expose; that branch's behavior is unchanged by the fix (the timer
// still fires when it legitimately wins the race).
import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SRC = join(import.meta.dir.slice(0, -5), "src");

describe("memory platform seed budget race (2026-10-28)", () => {
        test(
                "a fast seed prints the positive settle line and never the stale degraded line",
                async () => {
                        const root = mkdtempSync(join(tmpdir(), "unown-seed-"));
                        const dataDir = join(root, "data");
                        mkdirSync(dataDir, { recursive: true });
                        // An ephemeral port slot away from the live engine (:3030) and the
                        // bridge (:3031); collisions with siblings are still possible in a
                        // parallel suite, so scan a small range deterministically per run.
                        const port = 31_090 + Math.floor(Math.random() * 90);
                        const script = `import { startServer } from ${JSON.stringify(join(SRC, "index.ts"))};
const server = await startServer(${port});
if (!server) process.exit(3);
// Outlive the seed budget (3s floor) long enough for a stale, un-cleared
// timer to fire if the fix regressed — then leave cleanly.
setTimeout(() => process.exit(0), 12_000);
`;
                        const probePath = join(root, "probe.ts");
                        writeFileSync(probePath, script);

                        const child = spawn(process.execPath, [probePath], {
                                encoding: "utf8",
                                env: {
                                        ...process.env,
                                        // Fresh redirect roots: the probe must seed an EMPTY
                                        // platform (the full seed path, not the already-seeded
                                        // early-out).
                                        PI_SELFLEARNING_DATA: dataDir,
                                        UNOWN_HOME: join(root, "unown-home"),
                                        UNOWN_RUNTIME_DIR: join(root, "run"),
                                        PI_AGENT_PORT: String(port),
                                        // The floor-clamped minimum budget: 3000 is the
                                        // documented floor, so this stays at it.
                                        PI_ENGINE_SEED_BUDGET_MS: "3000",
                                        // Deterministic, native-free embedder: the platform
                                        // init is fast and offline (no local-ml lane, no
                                        // bridge round-trip in the seed — infer:false).
                                        PI_MEM0_EMBEDDER: "lexical",
                                        // A dead bridge proves the seed has no hidden LLM
                                        // dependency; background router jobs that DO reach
                                        // for it just log errors harmlessly.
                                        PI_BRIDGE_URL: "http://127.0.0.1:9/v1",
                                },
                        });
                        let out = "";
                        child.stdout.on("data", (d) => (out += d));
                        child.stderr.on("data", (d) => (out += d));
                        try {
                                // Wait for the positive line (the seed settles fast) …
                                const t0 = Date.now();
                                while (!out.includes("memory platform seed settled in") && Date.now() - t0 < 20_000) {
                                        await new Promise((r) => setTimeout(r, 250));
                                        if (child.exitCode !== null) break;
                                }
                                expect(out).toContain("memory platform seed settled in");
                                // … then wait PAST the budget + margin: the un-cleared timer
                                // fired at exactly this point pre-fix.
                                await new Promise((r) => setTimeout(r, 8_000));
                                expect(out).not.toContain("did not settle within");
                                expect(out).not.toContain("booting degraded");
                        } finally {
                                child.kill("SIGKILL");
                                rmSync(root, { recursive: true, force: true });
                        }
                },
                40_000,
        );
});
