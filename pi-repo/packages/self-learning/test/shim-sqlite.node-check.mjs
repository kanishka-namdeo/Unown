/**
 * shim-sqlite.node-check.mjs — cross-runtime duty: the better-sqlite3 shim's
 * node:sqlite driver path, exercised under plain Node (no bun:test).
 * Run: node pi-repo/packages/self-learning/test/shim-sqlite.node-check.mjs
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import DatabaseMod from "../../../shims/better-sqlite3/index.js";
const Database = DatabaseMod.default ?? DatabaseMod;

const assert = (cond, msg) => {
        if (!cond) throw new Error(`FAIL: ${msg}`);
        console.log(`ok - ${msg}`);
};

const dir = mkdtempSync(join(tmpdir(), "unown-shim-node-"));
const db = new Database(join(dir, "shim.db"));
try {
        db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT, n REAL)");
        db.exec("INSERT INTO t (v, n) VALUES ('a', 0.5); INSERT INTO t (v, n) VALUES ('b', 1.5);");
        assert(db.prepare("SELECT COUNT(*) AS c FROM t").get().c === 2, "multi-statement exec + count");

        db.prepare("INSERT INTO t (v, n) VALUES (?, ?)").run("hello", 1.5);
        const row = db.prepare("SELECT v, n FROM t WHERE id = ?").get(3);
        assert(row.v === "hello" && row.n === 1.5, "positional binds round-trip");

        assert(db.prepare("SELECT v FROM t WHERE id = ?").get(999) === undefined, "no-row .get() → undefined (better-sqlite3 semantics)");
        assert(JSON.stringify(db.prepare("SELECT MAX(id) AS m FROM t WHERE id = ?").get(999)) === '{"m":null}', "stored SQL NULL stays null");

        const ins = db.prepare("INSERT INTO t (v) VALUES (?)");
        db.transaction(() => {
                ins.run("tx1");
                ins.run("tx2");
        })();
        let threw = false;
        try {
                db.transaction(() => {
                        ins.run("tx3");
                        throw new Error("boom");
                })();
        } catch (e) {
                threw = String(e.message).includes("boom");
        }
        assert(threw, "transaction throws on fn error");
        assert(db.prepare("SELECT COUNT(*) AS c FROM t").get().c === 5, "rollback dropped tx3 (commits kept)");

        const f32 = new Float32Array([0.25, -0.5, 0.75, 1.0]);
        db.exec("CREATE TABLE vec (id INTEGER PRIMARY KEY, emb BLOB)");
        db.prepare("INSERT INTO vec (emb) VALUES (?)").run(new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength));
        const blob = db.prepare("SELECT emb FROM vec WHERE id = 1").get().emb;
        assert(blob instanceof Uint8Array && blob.byteLength === 16, "BLOB out is Uint8Array");
        const back = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
        assert(
                back.length === 4 && back[0] === 0.25 && back[3] === 1.0,
                "Float32Array view round-trips",
        );

        db.close();
        db.close();
        assert(true, "double close is safe");
} finally {
        try { db.close(); } catch {}
        rmSync(dir, { recursive: true, force: true });
}
console.log(`PASS — shim verified under node (driver: ${DatabaseMod.driver ?? "node:sqlite"})`);
