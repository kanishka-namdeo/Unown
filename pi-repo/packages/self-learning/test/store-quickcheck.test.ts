/**
 * Unit tests for the M6 DB integrity gate — Store.quickCheck() (PRAGMA
 * quick_check) and server.ts's boot-time refusal on a damaged DB.
 *
 * quickCheck is the fast O(N) pass sqlite.org recommends for routine boot
 * validation (it skips integrity_check's index↔table cross-checks). The
 * engine runs it at startServer() so a damaged DB fails FAST with the repair
 * hint instead of corrupting writes mid-dream.
 *
 * Corruption recipe (deliberately structural, not cosmetic): SQLite has no
 * page checksums, so flipping payload bytes is often INVISIBLE to quick_check
 * — the detectable damage is a broken page-type byte. The fixture grows the
 * notes table across many pages, then overwrites the first byte of a deep
 * data page with 0x42: page 1 (sqlite_master) and the constructor-touched
 * pages stay valid, so `new Store(...)` succeeds and quick_check is the thing
 * that reports the damage.
 *
 * The boot-gate tests run in fresh bun subprocesses (the detachment.test.ts
 * pattern) with their own PI_SELFLEARNING_DB/PI_SELFLEARNING_DATA redirects —
 * the suite's redirected store is shared and module-loaded, so an in-process
 * redirect is impossible.
 */
import "./_env.ts"; // MUST be the first import
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.ts";

const PKG_ROOT = join(import.meta.dir, "..");
const ROOT = mkdtempSync(join(tmpdir(), "unown-quickcheck-"));

afterAll(() => {
        rmSync(ROOT, { recursive: true, force: true });
});

/** A healthy DB with the notes table spread across many pages. */
function buildPopulatedDb(path: string): void {
        for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
        const s = new Store(path);
        for (let i = 0; i < 300; i++) {
                s.run(`INSERT INTO notes (id, run_id, content, created_at, kind) VALUES (?, NULL, ?, ?, 'benchmark')`, [
                        `qc-${i}`,
                        `${"x".repeat(1_200)} row ${i}`,
                        Date.now() + i,
                ]);
        }
        s.close(); // last connection: WAL checkpointed into the main file
}

/** Overwrite the page-TYPE byte of a deep b-tree page with garbage. */
function corruptPageTypeByte(path: string, pageIdx: number): void {
        const fd = openSync(path, "r+");
        try {
                const buf = Buffer.from([0x42]);
                writeSync(fd, buf, 0, 1, pageIdx * 4_096);
        } finally {
                closeSync(fd);
        }
}

describe("Store.quickCheck (M6)", () => {
        test("a healthy DB reports ok", () => {
                const path = join(ROOT, "healthy.db");
                buildPopulatedDb(path);
                const s = new Store(path);
                expect(s.quickCheck()).toBe("ok");
                // still ok through the shared-instance shape (the engine's lazy singleton)
                const again = new Store(path);
                expect(again.quickCheck()).toBe("ok");
                s.close();
                again.close();
        });

        test("a structurally damaged DB reports the failure (never a silent ok)", () => {
                const path = join(ROOT, "damaged.db");
                buildPopulatedDb(path);
                corruptPageTypeByte(path, 3); // deep notes data page — schema/migrate pages stay valid
                const s = new Store(path); // must still OPEN (that is the point of the gate)
                const qc = s.quickCheck();
                expect(qc).not.toBe("ok");
                expect(/malformed|in database main/.test(qc)).toBe(true);
                s.close();
        });
});

// ---------------------------------------------------------------------------
// The boot gate — a fresh process boots startServer() against either DB.
// ---------------------------------------------------------------------------

function bootGateProbe(dbPath: string): { code: number; stdout: string; stderr: string } {
        const root = mkdtempSync(join(tmpdir(), "unown-gate-"));
        const script = `
const { startServer } = await import(${JSON.stringify(join(PKG_ROOT, "src/server.ts"))});
const server = startServer(0);
console.log("BOOT_RESULT=" + (server === null ? "refused" : "booted"));
if (server) server.stop(true);
process.exit(0);
`;
        const probePath = join(root, "probe.ts");
        writeFileSync(probePath, script);
        const env: NodeJS.ProcessEnv = {
                ...process.env, // suite defaults: dead bridge/engine URLs, spawn guard, unlimited budgets
                PI_SELFLEARNING_DB: dbPath,
                PI_SELFLEARNING_DATA: join(root, "data"),
                UNOWN_HOME: join(root, "unown-home"),
        };
        const res = spawnSync(process.execPath, [probePath], { env, encoding: "utf8", timeout: 60_000 });
        rmSync(root, { recursive: true, force: true });
        return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe("boot-time integrity gate (server.ts, fresh process)", () => {
        test("a damaged DB is refused at boot with the repair hint — not booted into mid-dream corruption", () => {
                const path = join(ROOT, "gate-damaged.db");
                buildPopulatedDb(path);
                corruptPageTypeByte(path, 3);
                const r = bootGateProbe(path);
                expect(r.code).toBe(0);
                expect(r.stdout).toContain("BOOT_RESULT=refused");
                expect(r.stderr).toContain("integrity check failed");
                expect(r.stderr).toContain("unown engine repair");
        }, 15_000);

        test("a healthy DB boots normally (the gate does not over-block)", () => {
                const path = join(ROOT, "gate-healthy.db");
                buildPopulatedDb(path);
                const r = bootGateProbe(path);
                expect(r.code).toBe(0);
                expect(r.stdout).toContain("BOOT_RESULT=booted");
        }, 15_000);
});
