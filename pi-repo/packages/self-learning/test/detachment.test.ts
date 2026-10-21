/**
 * Detachment contract tests (M2, docs/detached-engine-architecture.md):
 *
 *   The terminal agent's import graph must never open the engine's SQLite
 *   database. Before M2, `store.ts` ran `new Store()` at module scope and the
 *   terminal chain reached it through termhooks→hooks and tools→llm — every
 *   `unown` boot opened db/selflearning.db (3 fds) and ran schema DDL + a
 *   memory_versions dedup DELETE against the engine's data.
 *
 * The assertion must run in a FRESH PROCESS: the test suite itself redirects
 * and opens the store, so in-process imports prove nothing. Each case spawns
 * `bun` with a unique PI_SELFLEARNING_DB and checks both the storeOpened()
 * probe and that no database file materialized.
 *
 * Every probe test carries an explicit 120s timeout (the cli.ts one already
 * did): each spawns a fresh `bun` boot against a possibly-cold transpile
 * cache, which on CI's 2-vCPU runners can take seconds — a truly hung probe
 * should surface via the spawnSync 60s kill + the exit-code assert below,
 * not as a bare runner timeout. (The RUNTIME contract test's original CI
 * timeout had a second, sharper cause on top of boot cost — see that test's
 * comment: chat()'s transient-retry backoff ladder against a dead port,
 * which only trips on bun versions whose fetch error says "fetch failed".)
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const PKG_ROOT = join(import.meta.dir, "..");

function probeTerminalChain(modules: string[]): { opened: boolean; dbExists: boolean; stderr: string; code: number } {
        const root = join(tmpdir(), `unown-detach-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        mkdirSync(root, { recursive: true });
        const dbPath = join(root, "engine.db");
        // Import the terminal-side modules, then read the probe. The store module
        // itself is imported too — importing it is LEGAL (it exports BRIDGE_URL and
        // the lazy proxy); OPENING it is not.
        const script = `
import { storeOpened } from ${JSON.stringify(join(PKG_ROOT, "src/store.ts"))};
${modules.map((m) => `await import(${JSON.stringify(join(PKG_ROOT, "src", m))});`).join("\n")}
console.log("STORE_OPENED=" + storeOpened());
`;
        const probePath = join(root, "probe.ts");
        require("node:fs").writeFileSync(probePath, script);
        const res = spawnSync(process.execPath, [probePath], {
                env: {
                        ...process.env,
                        PI_SELFLEARNING_DB: dbPath,
                        PI_SELFLEARNING_DATA: join(root, "data"),
                        PI_BRIDGE_URL: "http://127.0.0.1:9",
                        UNOWN_HOME: join(root, "unown-home"),
                        NO_UPDATE_NOTIFIER: "1",
                },
                encoding: "utf8",
                timeout: 60_000,
        });
        const out = res.stdout ?? "";
        const stderr = res.stderr ?? "";
        const opened = /STORE_OPENED=true/.test(out);
        const dbExists = existsSync(dbPath) || existsSync(dbPath + "-wal") || existsSync(dbPath + "-shm");
        rmSync(root, { recursive: true, force: true });
        return { opened, dbExists, stderr, code: res.status ?? -1 };
}

describe("terminal-agent detachment (M2)", () => {
        test("termhooks (guardrail hooks) imports without opening the engine DB", () => {
                const r = probeTerminalChain(["termhooks.ts"]);
                expect(r.code).toBe(0);
                expect(r.opened).toBe(false);
                expect(r.dbExists).toBe(false);
        }, 120_000);

        test("term.ts (memory + note delivery) imports without opening the engine DB", () => {
                const r = probeTerminalChain(["term.ts"]);
                expect(r.code).toBe(0);
                expect(r.opened).toBe(false);
                expect(r.dbExists).toBe(false);
        }, 120_000);

        test("llm.ts (bridge client) imports without opening the engine DB", () => {
                const r = probeTerminalChain(["llm.ts"]);
                expect(r.code).toBe(0);
                expect(r.opened).toBe(false);
                expect(r.dbExists).toBe(false);
        }, 120_000);

        test("bash-policy.ts is the pure policy seam (no store, no bus, no DB)", () => {
                const r = probeTerminalChain(["bash-policy.ts"]);
                expect(r.code).toBe(0);
                expect(r.opened).toBe(false);
                expect(r.dbExists).toBe(false);
        }, 120_000);

        test("providers-command.ts (the /providers slash command) imports without opening the engine DB", () => {
                // R2's purity contract: the in-chat provider manager is a
                // terminal surface only — registry + dialogs, never the store.
                const r = probeTerminalChain(["providers-command.ts"]);
                expect(r.code).toBe(0);
                expect(r.opened).toBe(false);
                expect(r.dbExists).toBe(false);
        }, 120_000);

        test("hooks.ts (ENGINE side) still opens the store on first logHook — the engine keeps its DB", () => {
                // The engine-side module must keep working: logHook writes hook_log.
                // This case imports hooks.ts and CALLS a store method through it,
                // proving the lazy proxy opens exactly when the engine uses it.
                const root = join(tmpdir(), `unown-engine-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
                mkdirSync(root, { recursive: true });
                const dbPath = join(root, "engine.db");
                const script = `
import { logHook } from ${JSON.stringify(join(PKG_ROOT, "src/hooks.ts"))};
import { storeOpened } from ${JSON.stringify(join(PKG_ROOT, "src/store.ts"))};
logHook("probe-run", "SessionStart", null, "allow", "detachment probe");
console.log("STORE_OPENED=" + storeOpened());
`;
                const probePath = join(root, "probe.ts");
                require("node:fs").writeFileSync(probePath, script);
                const res = spawnSync(process.execPath, [probePath], {
                        env: {
                                ...process.env,
                                PI_SELFLEARNING_DB: dbPath,
                                PI_SELFLEARNING_DATA: join(root, "data"),
                                PI_BRIDGE_URL: "http://127.0.0.1:9",
                                UNOWN_HOME: join(root, "unown-home"),
                                NO_UPDATE_NOTIFIER: "1",
                        },
                        encoding: "utf8",
                        timeout: 60_000,
                });
                expect(res.status).toBe(0);
                expect(/STORE_OPENED=true/.test(res.stdout ?? "")).toBe(true);
                expect(existsSync(dbPath)).toBe(true);
                rmSync(root, { recursive: true, force: true });
        }, 120_000);

        test("the full CLI entry chain (cli.ts) imports without opening the engine DB", () => {
                // cli.ts is the heaviest terminal import (pi runtime, tools, addons).
                // Importing it — without running a session — must still not open the DB.
                const r = probeTerminalChain(["cli.ts"]);
                expect(r.code).toBe(0);
                expect(r.opened).toBe(false);
                expect(r.dbExists).toBe(false);
        }, 120_000);

        test("RUNTIME contract: an LLM call from a CLI process never opens the engine DB", () => {
                // The summary-context subagent brief (tools.ts → llm.chat) was the one
                // RUNTIME path that could drag the store into the terminal process via
                // the governor's ledger hooks (found by the cross-platform review).
                // A real chat() attempt must leave the DB untouched: the governor is
                // inert outside the engine process.
                //
                // The bridge is a local 503 responder, NOT the historical dead port:
                // bun's connection-refused error MESSAGE differs by version ("Unable
                // to connect…" on 1.3.x, Node-style "fetch failed" on 1.4.x — the CI
                // packageManager), and only the "fetch failed" wording matches
                // chat()'s transient-retry regex, whose 2s+4s backoff ladder (~6s
                // total) blew the old 5s default timeout on every leg of the CI
                // matrix (RUNTIME was the sole detachment failure — the pure-import
                // probes never call chat()). A 503 fails chat() in ONE attempt on
                // every bun version: the contract under test is WHAT the attempt
                // touches, not how the bridge fails — the ledger/breaker hooks fire
                // on the same governed catch path either way.
                const root = join(tmpdir(), `unown-runtime-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
                mkdirSync(root, { recursive: true });
                const dbPath = join(root, "engine.db");
                const script = `
import { chat } from ${JSON.stringify(join(PKG_ROOT, "src/llm.ts"))};
import { storeOpened } from ${JSON.stringify(join(PKG_ROOT, "src/store.ts"))};
const sick = Bun.serve({ port: 0, fetch: () => new Response("down", { status: 503 }) });
process.env.PI_BRIDGE_URL = \`http://127.0.0.1:\${sick.port}\`; // bridgeUrl() reads env at call time
try {
        await chat([{ role: "user", content: "hi" }], { timeoutMs: 1000 });
} catch {
        /* expected — the bridge is down; the point is what the attempt touched */
} finally {
        sick.stop(true);
}
console.log("STORE_OPENED=" + storeOpened());
`;
                const probePath = join(root, "probe.ts");
                require("node:fs").writeFileSync(probePath, script);
                const res = spawnSync(process.execPath, [probePath], {
                        env: {
                                ...process.env,
                                PI_SELFLEARNING_DB: dbPath,
                                PI_SELFLEARNING_DATA: join(root, "data"),
                                PI_BRIDGE_URL: "http://127.0.0.1:9",
                                UNOWN_HOME: join(root, "unown-home"),
                                NO_UPDATE_NOTIFIER: "1",
                        },
                        encoding: "utf8",
                        timeout: 60_000,
                });
                expect(res.status).toBe(0);
                expect(/STORE_OPENED=false/.test(res.stdout ?? "")).toBe(true);
                expect(existsSync(dbPath)).toBe(false);
                rmSync(root, { recursive: true, force: true });
        }, 120_000);
});
