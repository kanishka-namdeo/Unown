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
        });

        test("term.ts (memory + note delivery) imports without opening the engine DB", () => {
                const r = probeTerminalChain(["term.ts"]);
                expect(r.code).toBe(0);
                expect(r.opened).toBe(false);
                expect(r.dbExists).toBe(false);
        });

        test("llm.ts (bridge client) imports without opening the engine DB", () => {
                const r = probeTerminalChain(["llm.ts"]);
                expect(r.code).toBe(0);
                expect(r.opened).toBe(false);
                expect(r.dbExists).toBe(false);
        });

        test("bash-policy.ts is the pure policy seam (no store, no bus, no DB)", () => {
                const r = probeTerminalChain(["bash-policy.ts"]);
                expect(r.code).toBe(0);
                expect(r.opened).toBe(false);
                expect(r.dbExists).toBe(false);
        });

        test("providers-command.ts (the /providers slash command) imports without opening the engine DB", () => {
                // R2's purity contract: the in-chat provider manager is a
                // terminal surface only — registry + dialogs, never the store.
                const r = probeTerminalChain(["providers-command.ts"]);
                expect(r.code).toBe(0);
                expect(r.opened).toBe(false);
                expect(r.dbExists).toBe(false);
        });

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
        });

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
                // A real chat() attempt — failing against the dead bridge — must leave
                // the DB untouched: the governor is inert outside the engine process.
                const root = join(tmpdir(), `unown-runtime-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
                mkdirSync(root, { recursive: true });
                const dbPath = join(root, "engine.db");
                const script = `
import { chat } from ${JSON.stringify(join(PKG_ROOT, "src/llm.ts"))};
import { storeOpened } from ${JSON.stringify(join(PKG_ROOT, "src/store.ts"))};
try {
        await chat([{ role: "user", content: "hi" }], { timeoutMs: 1000 });
} catch {
        /* expected — dead bridge; the point is what the attempt touched */
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
        });
});
