// Unit tests for src/tasks.ts — the verify-script sha256 tamper gate
// (buildVerify) plus the seeded task-suite store functions.
//
// Task ref: engine unit tests, module 3/4 (verify-script sha256 tamper gate,
// buildVerify). buildVerify embeds the sha256 of the task's verifyTestFile and
// a runtime check that exits 1 ("TEST FILES WERE MODIFIED") on any hash/missing
// mismatch before the test file is imported.
//
// This file imports ./_env.ts FIRST: tasks.ts eagerly opens the engine's
// SQLite store via src/store.ts at module load — the shared _env redirect
// (co-owned with the parallel b-suite) puts the db under /tmp/engine-tests-b
// and this file's verify-script sandboxes under /tmp/engine-tests-tasks; the
// live engine state is never touched.
//
// The gate is exercised both as a pure string builder (hash pinning) and
// end-to-end: generated verify scripts are written into
// /tmp/engine-tests-tasks/ and executed with the bun binary (process.execPath)
// in pristine / tampered / missing / failing sandbox dirs.
//
// QUIRK/BUG comments pin current behavior; the module is NOT modified.

import "./_env.ts";
import { TEST_TMP } from "./_env.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATA_DIR, store } from "../src/store.ts";
import { TASK_DEFS, buildVerify, getTask, listTasks, seedTasks, type TaskDef } from "../src/tasks.ts";

const FIXTURE_ROOT = join(tmpdir(), "engine-tests-tasks");

const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

const LIB = "export const f = () => 1;\n";
const TEST = `import assert from "node:assert/strict";
import { f } from "./lib.js";
assert.equal(f(), 1);
console.log("lib tests passed");
`;

const makeTask = (): TaskDef => ({
        id: "t-lib",
        name: "Lib",
        description: "unit-test fixture task",
        category: "unit",
        difficulty: 1,
        prompt: "fix lib.js",
        files: { "lib.js": LIB, "lib.test.mjs": TEST },
        verifyTestFile: "lib.test.mjs",
});

/** Seed a sandbox dir with the task files + generated verify script; returns cwd. */
function makeSandbox(caseName: string, opts: { tamperTest?: boolean; omitTest?: boolean; tamperLib?: boolean; failingTest?: boolean }): string {
        const dir = join(FIXTURE_ROOT, caseName);
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        // What the sandbox actually contains on disk...
        const testOnDisk = opts.tamperTest
                ? `${TEST}// tampered: agent edited the test file\n`
                : opts.failingTest
                        ? TEST.replace("assert.equal(f(), 1);", "assert.equal(f(), 2);")
                        : TEST;
        // ...and what the task pins: pristine content normally; for the
        // failing-test case the failing content IS the seeded contract, so the
        // integrity gate passes and the failure surfaces via the imported
        // assertion (not via the tamper branch).
        const task = makeTask();
        if (opts.failingTest) task.files = { "lib.js": LIB, "lib.test.mjs": testOnDisk };
        writeFileSync(join(dir, "lib.js"), opts.tamperLib ? `${LIB}// tampered comment\n` : LIB);
        if (!opts.omitTest) writeFileSync(join(dir, "lib.test.mjs"), testOnDisk);
        writeFileSync(join(dir, "verify.mjs"), buildVerify(task));
        return dir;
}

/** Execute verify.mjs with the bun binary in the sandbox cwd. */
function runVerify(dir: string) {
        return spawnSync(process.execPath, ["verify.mjs"], { cwd: dir, encoding: "utf8" });
}

beforeAll(() => {
        rmSync(FIXTURE_ROOT, { recursive: true, force: true });
        store.run(`DELETE FROM tasks`);
        seedTasks();
});

afterAll(() => {
        rmSync(FIXTURE_ROOT, { recursive: true, force: true });
        store.run(`DELETE FROM tasks`);
        // NOTE: the shared /tmp/engine-tests-b root (db + memory fixtures) is
        // co-owned with the parallel b-suite via test/_env.ts and is
        // deliberately NOT removed here — this file cleans only its exclusive
        // fixtures and rows.
});

test("env redirect is active (never touch the live engine db)", () => {
        // Tripwire: if this fails, ./_env.ts was not the first import and the tests
        // would be running against the live engine store — abort loudly instead.
        const DATA_REAL = existsSync(DATA_DIR) ? realpathSync(DATA_DIR) : DATA_DIR; // realpath when it exists (macOS /var -> /private); lexical before first mkdir
        expect(DATA_REAL.startsWith(TEST_TMP)).toBe(true);
        expect(DATA_DIR).toContain("/data");
});

// ---------------------------------------------------------------------------
// buildVerify — pure string builder (hash pinning)
// ---------------------------------------------------------------------------

describe("buildVerify: sha256 pinning", () => {
        test("pins the exact sha256 of the seeded verifyTestFile content", () => {
                const out = buildVerify(makeTask());
                const line = `  "lib.test.mjs": ${JSON.stringify(sha256(TEST))}`;
                expect(out).toContain(line);
        });

        test("the pinned hash is the sha256 of the exact seeded bytes", () => {
                // Independent recomputation (node:crypto in this file) — not a fixture.
                const task = makeTask();
                task.files = { "lib.js": "const x = 1;\n", "lib.test.mjs": "console.log(2);\n" };
                const out = buildVerify(task);
                expect(out).toContain(`"lib.test.mjs": ${JSON.stringify(sha256("console.log(2);\n"))}`);
        });

        test("empty test-file content pins the sha256 of the empty string", () => {
                const task = makeTask();
                task.files = { "lib.test.mjs": "" };
                const out = buildVerify(task);
                expect(out).toContain(`"lib.test.mjs": ${JSON.stringify(sha256(""))}`);
        });

        test("BUG (tasks.ts:64): only verifyTestFile is pinned — sibling source files are NOT integrity-checked", () => {
                // The `[task.verifyTestFile, ...(task.files.__integrity ? [] : [])]`
                // spread is dead code (both branches are empty), so extra files never
                // join the hash map: an agent can rewrite lib.js freely as far as the
                // integrity gate is concerned (only the functional test would notice).
                const out = buildVerify(makeTask());
                expect(out).not.toContain(`"lib.js": ${JSON.stringify(sha256(LIB))}`);
                expect(out).not.toContain('"lib.js"');
        });

        test("BUG (tasks.ts:65): verifyTestFile missing from files throws an opaque TypeError", () => {
                // buildVerify does sha256(task.files[f]) with f === verifyTestFile — an
                // unknown key yields undefined and createHash().update(undefined) throws
                // a raw TypeError instead of a validation error.
                const task = makeTask();
                task.files = { "lib.js": LIB };
                expect(() => buildVerify(task)).toThrow();
        });

        test("deterministic: identical task -> byte-identical verify script", () => {
                expect(buildVerify(makeTask())).toBe(buildVerify(makeTask()));
        });
});

describe("buildVerify: script structure", () => {
        const out = buildVerify(makeTask());

        test("starts with the node:crypto/node:fs imports", () => {
                expect(out.startsWith(`import { createHash } from "node:crypto";\nimport { readFileSync } from "node:fs";\n`)).toBe(true);
        });

        test("runs the test file via a dynamic import of ./<verifyTestFile>", () => {
                expect(out).toContain(`await import("./lib.test.mjs");`);
        });

        test("emits the tamper verdict + VERIFY_RESULT line and exits 1 on mismatch", () => {
                expect(out).toContain(`console.log("TEST FILES WERE MODIFIED — this is forbidden: " + tampered.join(", "));`);
                expect(out).toContain(
                        `console.log("VERIFY_RESULT: " + JSON.stringify({ passed: false, summary: "test tampering detected: " + tampered.join(", ") }));`,
                );
                expect(out).toContain("process.exit(1);");
        });

        test("emits the passing VERIFY_RESULT line after the test import", () => {
                expect(out.indexOf(`await import("./lib.test.mjs");`)).toBeLessThan(
                        out.indexOf(`console.log("VERIFY_RESULT: " + JSON.stringify({ passed: true, summary: "all tests passed" }));`),
                );
        });
});

// ---------------------------------------------------------------------------
// End-to-end: execute the generated gate in /tmp sandboxes
// ---------------------------------------------------------------------------

describe("verify script execution (tamper gate)", () => {
        test("pristine sandbox: exit 0 and VERIFY_RESULT passed", () => {
                const dir = makeSandbox("pristine", {});
                const r = runVerify(dir);
                expect(r.status).toBe(0);
                expect(r.stdout).toContain(`VERIFY_RESULT: {"passed":true,"summary":"all tests passed"}`);
        });

        test("tampered test file: exit 1 with the tampering verdict", () => {
                const dir = makeSandbox("tampered-test", { tamperTest: true });
                const r = runVerify(dir);
                expect(r.status).toBe(1);
                expect(r.stdout).toContain("TEST FILES WERE MODIFIED — this is forbidden: lib.test.mjs");
                expect(r.stdout).toContain(`"summary":"test tampering detected: lib.test.mjs"`);
                // The pinned hash differs, so the test file itself never executes.
                expect(r.stdout).not.toContain("lib tests passed");
        });

        test("missing test file: reported as '(missing)'", () => {
                const dir = makeSandbox("missing-test", { omitTest: true });
                const r = runVerify(dir);
                expect(r.status).toBe(1);
                expect(r.stdout).toContain("TEST FILES WERE MODIFIED — this is forbidden: lib.test.mjs (missing)");
                expect(r.stdout).toContain(`"summary":"test tampering detected: lib.test.mjs (missing)"`);
        });

        test("BUG (tasks.ts:64): tampering with a non-verify file slips past the integrity gate", () => {
                // lib.js's comment was altered (hash changed) but lib.js is not pinned;
                // the gate exits 0 and reports "all tests passed".
                const dir = makeSandbox("tampered-lib", { tamperLib: true });
                const r = runVerify(dir);
                expect(r.status).toBe(0);
                expect(r.stdout).toContain(`VERIFY_RESULT: {"passed":true,"summary":"all tests passed"}`);
        });

        test("QUIRK: a failing test file produces NO VERIFY_RESULT line — only the exit code signals it", () => {
                // The script prints VERIFY_RESULT only on the success and tamper paths
                // (tasks.ts:88-90); a failing assertion throws during the dynamic import,
                // so callers must rely on the non-zero exit code for test failures.
                const dir = makeSandbox("failing-test", { failingTest: true });
                const r = runVerify(dir);
                expect(r.status).not.toBe(0);
                expect(r.stdout).not.toContain("VERIFY_RESULT");
        });
});

// ---------------------------------------------------------------------------
// Seeded suite store functions
// ---------------------------------------------------------------------------

describe("TASK_DEFS invariants", () => {
        test("six seed tasks ship with the benchmark suite", () => {
                expect(TASK_DEFS.map((d) => d.id)).toEqual([
                        "fix-fizzbuzz",
                        "fix-drop-right",
                        "impl-debounce",
                        "impl-map-limit",
                        // The SOTA round's port of a measured edit-bench failure
                        // (structural-swap-if-else-006): gives the harness a real
                        // capability gap instead of a saturated seed suite.
                        "swap-if-else-messages",
                        "fix-csv-parser",
                ]);
        });

        test("every def's verifyTestFile exists in files and its hash is pinned by buildVerify", () => {
                for (const def of TASK_DEFS) {
                        expect(def.files[def.verifyTestFile]).toBeDefined();
                        expect(buildVerify(def)).toContain(`${JSON.stringify(def.verifyTestFile)}: ${JSON.stringify(sha256(def.files[def.verifyTestFile]))}`);
                }
        });
});

describe("seedTasks / getTask / listTasks", () => {
        test("seedTasks inserts the six defs with buildVerify as the verify script", () => {
                const rows = store.query<{ id: string }>(`SELECT id FROM tasks ORDER BY id`);
                expect(rows).toHaveLength(6);
                const task = getTask("fix-fizzbuzz");
                expect(task?.prompt).toBe(TASK_DEFS[0]?.prompt);
                expect(task?.files).toEqual(TASK_DEFS[0]?.files); // files JSON round-trips
                expect(task?.verify).toBe(buildVerify(TASK_DEFS[0] as TaskDef));
        });

        test("getTask returns migration defaults for provenance columns", () => {
                // Columns added by the store migration: origin 'seed', status
                // 'regression' (seeded tasks behave as the regression suite).
                const task = getTask("fix-drop-right");
                expect(task?.origin).toBe("seed");
                expect(task?.status).toBe("regression");
        });

        test("getTask for an unknown id returns undefined", () => {
                expect(getTask("no-such-task")).toBeUndefined();
        });

        test("listTasks orders by difficulty asc, then id asc", () => {
                expect(listTasks().map((t: { id: string }) => t.id)).toEqual([
                        "fix-fizzbuzz", // difficulty 1
                        "fix-drop-right", // 2
                        "fix-csv-parser", // 3, id sorts before swap-if-else
                        "swap-if-else-messages", // 3 (the SOTA round's ported swap)
                        "impl-debounce", // 4, id sorts before map-limit
                        "impl-map-limit", // 4
                ]);
        });

        test("seedTasks is idempotent — re-seeding neither duplicates nor overwrites", () => {
                seedTasks();
                seedTasks();
                expect(store.query(`SELECT id FROM tasks`)).toHaveLength(6);
                expect(getTask("fix-fizzbuzz")?.verify).toBe(buildVerify(TASK_DEFS[0] as TaskDef));
        });
});
