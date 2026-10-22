/**
 * better-sqlite3 → {bun,node}:sqlite shim (Unown).
 *
 * WHY: mem0ai (the memory platform behind the self-learning engine) persists
 * its vector store and history through `better-sqlite3`, whose native binding
 * uses V8 APIs directly and therefore cannot load under Bun
 * (https://github.com/oven-sh/bun/issues/4290 — ERR_DLOPEN_FAILED). The Unown
 * engine is a Bun daemon, so the dependency is resolved to THIS shim via the
 * pi-repo root `overrides` field. Under Node the same shim speaks
 * `node:sqlite` (DatabaseSync), so the package works under both runtimes.
 *
 * SCOPE: exactly the API surface mem0ai@3.x uses —
 *   new Database(path)
 *   db.exec(sql)                        — one or more statements, no results
 *   db.prepare(sql) -> stmt             — stmt.all(...params) / .get(...params) / .run(...params)
 *   db.transaction(fn) -> wrappedFn     — BEGIN/COMMIT/ROLLBACK around fn
 *   db.close()
 * Anything beyond that surface is intentionally absent: this shim exists for
 * one consumer. If mem0ai grows a new better-sqlite3 call, this file grows a
 * matching method (and a test in self-learning/test/shim-sqlite.test.ts).
 *
 * Both drivers' BLOB semantics match what mem0 expects: Uint8Array in (Buffer
 * is a Uint8Array subclass), Uint8Array out — mem0 wraps the result in a
 * Float32Array view via .buffer/.byteOffset/.byteLength, which works for both
 * drivers' returned Uint8Array.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const isBun = typeof globalThis.Bun !== "undefined";

let Native = null;
let nativeName = "none";
if (isBun) {
        // Bun builtins are requireable synchronously; `import "bun:sqlite"` would
        // break under Node, and the shim must be loadable by BOTH runtimes.
        Native = require("bun:sqlite").Database;
        nativeName = "bun:sqlite";
} else {
        // node:sqlite (Node >= 22.5): DatabaseSync. Same positional-bind model.
        Native = require("node:sqlite").DatabaseSync;
        nativeName = "node:sqlite";
}

/**
 * The Bun driver provides exec/prepare/transaction/close natively, and
 * node:sqlite's DatabaseSync.exec maps to sqlite3_exec which handles
 * multi-statement strings natively (verified on Node 24; sqlite3_exec
 * semantics are stable across the supported range). The earlier defensive
 * per-statement split is REMOVED: it corrupted any SQL with a semicolon
 * inside a string literal, while mem0's own exec calls are single-statement
 * DDL only (CREATE/DROP TABLE) — pass-through is both simpler and safer.
 * The behavioral divergences that DO need patching: {bun,node}:sqlite return
 * NULL from .get() on no rows (better-sqlite3: undefined) and node:sqlite
 * requires the options object in the constructor (bun: optional, empty
 * object rejected) — both pinned by test/shim-sqlite.test.ts and the node
 * cross-runtime check (test/shim-sqlite.node-check.mjs).
 */
export default class Database extends Native {
        constructor(path, options) {
                // node:sqlite's DatabaseSync REQUIRES an options object (TypeError on
                // undefined); bun:sqlite REJECTS an empty options object ("bad
                // parameter") while accepting none. mem0 constructs with the path
                // only — give each driver the shape it accepts.
                if (nativeName === "node:sqlite") super(path, options ?? {});
                else super(path, options);
        }

        /** Prepared statement with better-sqlite3's .get() no-row semantics. */
        prepare(sql) {
                const stmt = super.prepare(sql);
                const nativeGet = stmt.get.bind(stmt);
                stmt.get = (...params) => {
                        const row = nativeGet(...params);
                        return row === null ? undefined : row;
                };
                return stmt;
        }

        /** sqlite3_exec semantics (single- or multi-statement, no rows). */
        exec(sql) {
                return super.exec(sql);
        }

        /**
         * Transaction wrapper (better-sqlite3 semantics: synchronous fn, automatic
         * BEGIN/COMMIT/ROLLBACK). Bun implements this natively; Node gets the
         * manual implementation. Nested transactions are NOT supported — mem0
         * never nests them.
         */
        transaction(fn) {
                if (nativeName === "bun:sqlite") return super.transaction(fn);
                return (...args) => {
                        super.exec("BEGIN");
                        try {
                                const out = fn(...args);
                                super.exec("COMMIT");
                                return out;
                        } catch (err) {
                                try {
                                        super.exec("ROLLBACK");
                                } catch {
                                        /* already rolled back by the driver */
                                }
                                throw err;
                        }
                };
        }

        close(...args) {
                // better-sqlite3's close() is idempotent (no-op when already closed)
                // and bun matches; node:sqlite throws ERR_INVALID_STATE — mem0 closes
                // defensively on teardown paths, so the shim must swallow that one.
                if (nativeName === "node:sqlite") {
                        try {
                                return super.close(...args);
                        } catch (err) {
                                if (err?.code === "ERR_INVALID_STATE") return; // already closed — the no-op
                                throw err;
                        }
                }
                return super.close(...args);
        }
}

/** Which native driver backed this build (diagnostics). */
export const driver = nativeName;
