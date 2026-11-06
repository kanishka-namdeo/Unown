/**
 * Bolero server storage — bun:sqlite over `data/bolero.db` (PLAN S-3,
 * ops contract §5).
 *
 * Two tables:
 *   watches(id PK, name UNIQUE, specJson canonical TEXT, createdIso)
 *   runs(id PK, watchId, reportJson canonical TEXT, receivedIso)
 *
 * Content-addressed artifacts live on the filesystem under
 * `data/artifacts/` — the file name IS the sha256 (per the frozen
 * artifact grammar `<watchId>_r<runSeq>_sha256:<64hex>.<ext>`), so a
 * row keeps only the ref and large bytes never bloat the DB.
 */
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type WatchRow = {
  id: number;
  name: string;
  specJson: string;
  createdIso: string;
};

export type RunRow = {
  id: number;
  watchId: number;
  reportJson: string;
  receivedIso: string;
};

/**
 * Open the bolero SQLite store. `dbPath` defaults to the app data dir;
 * tests pass a temp-dir path for determinism. Creates the schema if
 * absent.
 */
export function openStore(dbPath: string = join(import.meta.dir, "../../data/bolero.db")): Database {
  // `:memory:` is the test lane — skip the fs scaffolding.
  if (dbPath === ":memory:") {
    const db = new Database(dbPath, { create: true });
    applySchema(db);
    return db;
  }
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { create: true });
  applySchema(db);
  return db;
}

function applySchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS watches (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      specJson TEXT NOT NULL,
      createdIso TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY,
      watchId INTEGER NOT NULL,
      reportJson TEXT NOT NULL,
      receivedIso TEXT NOT NULL,
      FOREIGN KEY (watchId) REFERENCES watches(id)
    );
  `);
}

/** Registry reads. */
export function listWatches(db: Database): WatchRow[] {
  return db
    .query<[], WatchRow>("SELECT id, name, specJson, createdIso FROM watches ORDER BY id")
    .all() as WatchRow[];
}

export function getWatch(db: Database, id: number): WatchRow | null {
  const row = db
    .query<[number], WatchRow>("SELECT id, name, specJson, createdIso FROM watches WHERE id = ?")
    .get(id) as WatchRow | undefined;
  return row ?? null;
}

export function watchNames(db: Database): string[] {
  const rows = db.query<[], { name: string }>("SELECT name FROM watches").all();
  return rows.map((r) => r.name);
}

export function insertWatch(
  db: Database,
  watch: Omit<WatchRow, "id">,
  id?: number,
): WatchRow {
  // Explicit id when supplied (the test lane pins it); otherwise the
  // sqlite auto-assigned PK (max+1 — the ids.ts law at the DB layer).
  if (id !== undefined) {
    db.query("INSERT INTO watches (id, name, specJson, createdIso) VALUES (?, ?, ?, ?)").run(
      id,
      watch.name,
      watch.specJson,
      watch.createdIso,
    );
    return { id, ...watch };
  }
  // name is UNIQUE in the schema; a duplicate throws (E-04 reject).
  db.query("INSERT INTO watches (name, specJson, createdIso) VALUES (?, ?, ?)").run(
    watch.name,
    watch.specJson,
    watch.createdIso,
  );
  const row = db.query<[number], { id: number }>("SELECT id FROM watches WHERE name = ?").get(watch.name);
  return { id: row.id, name: watch.name, specJson: watch.specJson, createdIso: watch.createdIso };
}

/** Run reads. */
export function insertRun(db: Database, run: Omit<RunRow, "id">): RunRow {
  db.query("INSERT INTO runs (watchId, reportJson, receivedIso) VALUES (?, ?, ?)").run(
    run.watchId,
    run.reportJson,
    run.receivedIso,
  );
  const row = db.query<[string], { id: number }>(
    "SELECT id FROM runs WHERE reportJson = ? AND watchId = ?",
  ).get(run.reportJson, run.watchId);
  const id = row.id;
  return { id, watchId: run.watchId, reportJson: run.reportJson, receivedIso: run.receivedIso };
}

/**
 * The watch's latest run status — `null` when the watch has no runs
 * yet (the registry endpoint reports each watch's freshest state).
 */
export function latestRunStatus(db: Database, watchId: number): string | null {
  const row = db
    .query<[number], { status: string }>(
      `SELECT json_extract(reportJson, '$.report.status') AS status
       FROM runs WHERE watchId = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(watchId) as { status: string | null } | undefined;
  return row?.status ?? null;
}

export function listRuns(db: Database, watchId: number): RunRow[] {
  return db
    .query<[number], RunRow>("SELECT id, watchId, reportJson, receivedIso FROM runs WHERE watchId = ? ORDER BY id")
    .all(watchId) as RunRow[];
}

/**
 * Persist one artifact under `artifactsDir` using its content-addressed
 * name. The name already embeds the digest (the frozen grammar), so the
 * file name IS the sha256 — writing twice with the same bytes is a
 * no-op, never a clobber.
 */
export function writeArtifact(artifactsDir: string, name: string, bytes: Uint8Array): string {
  mkdirSync(artifactsDir, { recursive: true });
  const path = join(artifactsDir, name);
  writeFileSync(path, bytes);
  return name;
}
