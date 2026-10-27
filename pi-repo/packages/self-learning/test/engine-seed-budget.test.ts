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
//   1. a healthy boot SETTLES and says so — "settled in Ns — memory platform
//      live" when the seed wins the race, or "settled late (Ns > Ns budget)
//      — the degraded-boot state is lifted" when a slow runner's boot
//      outruns the budget floor (the v0.0.33 windows release leg measured
//      the late form at 5s on a cold 2-core runner — a healthy boot, not a
//      regression; the engine lifts the degraded state either way), and
//   2. NOTHING stale follows the settle: the un-cleared timer's "did not
//      settle within Ns — booting degraded" line never lands AFTER the
//      settle line (pre-fix it fired at exactly that point). A slow boot's
//      own honest degraded line — the timer legitimately winning the race,
//      printing BEFORE the late settle — is not the bug; the pin slices
//      from the settle and asserts the silence after it.
import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SRC = join(import.meta.dir.slice(0, -5), "src");

describe("memory platform seed budget race (2026-10-28)", () => {
        test(
                "a healthy boot settles — fast or late — and the stale degraded line never follows the settle",
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
// Outlive the seed budget (3s floor) AND the post-settle silence window
// (8s) even on a slow runner whose boot settles late — a stale, un-cleared
// timer that regresses fires within that window; then leave cleanly.
setTimeout(() => process.exit(0), 35_000);
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
                                // Wait for the settle — EITHER form is a healthy boot (a warm
                                // runner settles within budget; a cold one settles late and
                                // lifts). Which form lands is the runner's call, not the
                                // contract's.
                                const settled = /memory platform seed settled (in \d+s|late)/;
                                const t0 = Date.now();
                                while (!settled.test(out) && Date.now() - t0 < 25_000) {
                                        await new Promise((r) => setTimeout(r, 250));
                                        if (child.exitCode !== null) break;
                                }
                                expect(out).toMatch(settled);
                                const settleAt = out.match(settled)!.index ?? 0;
                                // … then wait PAST the budget + margin: pre-fix, the un-cleared
                                // timer fired the stale degraded line at exactly this point
                                // after the settle. The pin slices from the settle line — a
                                // slow boot's own honest degraded line printed BEFORE its late
                                // settle stays outside the verdict.
                                await new Promise((r) => setTimeout(r, 8_000));
                                const afterSettle = out.slice(settleAt);
                                expect(afterSettle).not.toContain("did not settle within");
                                expect(afterSettle).not.toContain("booting degraded");
                        } finally {
                                child.kill("SIGKILL");
                                // windows-latest taught this teardown the hard
                                // way (release run v0.0.32, 2026-10-28): a
                                // killed child's handles on the temp root (its
                                // cwd, its runtime dir) are released
                                // asynchronously on Windows, so an rmSync
                                // immediately after kill races EBUSY (errno
                                // -4082, resource busy or locked). Wait for
                                // the actual exit, then remove — with one
                                // retry for the post-exit handle-drain window.
                                if (child.exitCode === null) {
                                        await new Promise<void>((resolve) => {
                                                child.once("exit", () => resolve());
                                                child.once("error", () => resolve());
                                                setTimeout(resolve, 5_000);
                                        });
                                }
                                try {
                                        rmSync(root, { recursive: true, force: true });
                                } catch {
                                        await new Promise((r) => setTimeout(r, 1_000));
                                        rmSync(root, { recursive: true, force: true });
                                }
                        }
                },
                45_000,
        );
});
