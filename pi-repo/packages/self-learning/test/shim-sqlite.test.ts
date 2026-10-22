/**
 * shim-sqlite.test.ts — pins the better-sqlite3 → {bun,node}:sqlite shim.
 *
 * pi-repo/shims/better-sqlite3 is resolved in via the pi-repo root package.json
 * `overrides` (mem0ai's vector store + history store `require("better-sqlite3")`,
 * whose native binding is V8-API-based and cannot load under Bun). The shim's
 * header promises "a test here for every surface it grows" — this is that
 * test, pinning exactly the calls mem0ai@3.x's dist makes (enumerated from
 * node_modules/mem0ai/dist/oss/index.js): new Database(path), exec, prepare,
 * all/get/run, transaction, close, and the Uint8Array BLOB round-trip mem0's
 * Float32Array view depends on.
 *
 * It runs under BOTH runtimes the engine supports: bun (bun:sqlite driver)
 * and node ≥22.5 (node:sqlite driver) — the shim picks at load time.
 */
import { describe, expect, test } from "bun:test";
// 2026-10-22 windows fix: recursive rmSync cleanups now retry (maxRetries:
// 10, retryDelay: 100ms) — right after db.close()/winner.kill("SIGKILL") the OS
// can still hold handles (EBUSY), which failed the windows CI leg while the
// assertions themselves were green.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

describe("better-sqlite3 shim (the mem0 driver under Bun)", () => {
        function freshDb(): { db: InstanceType<typeof Database>; dir: string } {
                const dir = mkdtempSync(join(tmpdir(), "unown-shim-"));
                return { db: new Database(join(dir, "shim.db")), dir };
        }

        test("constructs, exec()es DDL, and close() is idempotent-ish", () => {
                const { db, dir } = freshDb();
                try {
                        db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
                        db.exec("INSERT INTO t (v) VALUES ('a'); INSERT INTO t (v) VALUES ('b');");
                } finally {
                        db.close();
                        db.close(); // double close must not throw (mem0 calls close defensively)
                        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
                }
        });

        test("prepare/all/get/run round-trip with positional binds", () => {
                const { db, dir } = freshDb();
                try {
                        db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT, n REAL)");
                        const ins = db.prepare("INSERT INTO t (v, n) VALUES (?, ?)");
                        expect(ins.run("hello", 1.5).changes).toBe(1);

                        const all = db.prepare("SELECT id, v, n FROM t ORDER BY id").all() as Array<{
                                id: number;
                                v: string;
                                n: number;
                        }>;
                        expect(all).toHaveLength(1);
                        expect(all[0]!.v).toBe("hello");
                        expect(all[0]!.n).toBe(1.5);

                        const one = db.prepare("SELECT v FROM t WHERE id = ?").get(1) as { v: string };
                        expect(one.v).toBe("hello");
                        // better-sqlite3 semantics: NO row → undefined (bun/node:sqlite
                        // return null there — the shim normalizes); a stored SQL NULL
                        // stays null.
                        expect(db.prepare("SELECT v FROM t WHERE id = ?").get(999)).toBeUndefined();
                        expect(db.prepare("SELECT MAX(id) AS m FROM t WHERE id = ?").get(999)).toEqual({ m: null });

                        const upd = db.prepare("UPDATE t SET v = ? WHERE id = ?");
                        const r = upd.run("world", 1);
                        expect(r.changes).toBe(1);
                } finally {
                        db.close();
                        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
                }
        });

        test("transaction(fn) commits on success and rolls back on throw", () => {
                const { db, dir } = freshDb();
                try {
                        db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
                        const ins = db.prepare("INSERT INTO t (v) VALUES (?)");
                        db.transaction(() => {
                                ins.run("a");
                                ins.run("b");
                        })();
                        expect(db.prepare("SELECT COUNT(*) AS c FROM t").get()!.c).toBe(2);

                        expect(() =>
                                db.transaction(() => {
                                        ins.run("c");
                                        throw new Error("boom");
                                })(),
                        ).toThrow("boom");
                        // rolled back: still 2, the third insert never landed
                        expect(db.prepare("SELECT COUNT(*) AS c FROM t").get()!.c).toBe(2);
                } finally {
                        db.close();
                        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
                }
        });

        test("BLOB round-trip: Uint8Array in, Uint8Array out (mem0's Float32Array view)", () => {
                // mem0 stores embeddings as BLOB and reads them back through
                // new Float32Array(row.buffer, row.byteOffset, row.byteLength / 4)
                // — the driver must hand back a Uint8Array (buffer+byteOffset+byteLength
                // intact), never a plain Array or a string.
                const { db, dir } = freshDb();
                try {
                        db.exec("CREATE TABLE vec (id INTEGER PRIMARY KEY, emb BLOB)");
                        const floats = new Float32Array([0.25, -0.5, 0.75, 1.0]);
                        const bytes = new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength);
                        db.prepare("INSERT INTO vec (emb) VALUES (?)").run(bytes);

                        const row = db.prepare("SELECT emb FROM vec WHERE id = 1").get() as { emb: Uint8Array };
                        expect(row.emb).toBeInstanceOf(Uint8Array);
                        expect(row.emb.byteLength).toBe(16);
                        const back = new Float32Array(row.emb.buffer, row.emb.byteOffset, row.emb.byteLength / 4);
                        expect(Array.from(back)).toEqual([0.25, -0.5, 0.75, 1.0]);
                } finally {
                        db.close();
                        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
                }
        });

        test("the runtime the shim picked is reported and loadable", () => {
                // The shim exports nothing beyond Database by design; the nativeName
                // choice is observable through behavior — bun and node:sqlite both
                // pass the tests above. This test pins the load itself: importing
                // the shim must work under the CURRENT runtime without throwing.
                expect(typeof Database).toBe("function");
                const { db, dir } = freshDb();
                try {
                        db.exec("SELECT 1");
                } finally {
                        db.close();
                        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
                }
        });
});
