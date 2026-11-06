/**
 * Bolero ingest + registry handlers (PLAN S-3, the V-41 law).
 *
 * `handleRequest` is a single Bun.serve `fetch` dispatcher:
 *   POST /api/runs       — STRICT-validate through the shared
 *                          `assertReport` (never re-declared here;
 *                          the domain owns the grammar), then persist
 *                          the row + artifact bytes.
 *   POST /api/watches    — validate through `assertWatch`; duplicate
 *                          names rejected (E-04).
 *   GET  /api/watches     — the registry, each watch with its latest
 *                           run status.
 *   GET  /api/watches/:id — one watch + its run history.
 *   GET  /health          — the cheap lifecycle probe (§5, E-11):
 *                           reads phase + in-flight count, never
 *                           blocks on queued jobs.
 *
 * A validation breach answers `422 { reason: "<dotted path>: <detail>" }`
 * and stores NOTHING (the dry-run law — never a partial row).
 *
 * Artifact bytes: the report body may carry an optional sideband
 * field `__artifactBytes__` — a `Record<artifactName, base64>` map.
 * The server validates the report through `assertReport` on the
 * report half ONLY (the sideband is unknown-to-the-grammar), writes
 * each referenced artifact under `data/artifacts/` by its
 * content-addressed name, and stores the CANONICAL report JSON
 * (sideband stripped) in the DB row. The sideband never enters the
 * DB, so large bytes never bloat it (the PLAN §1 storage law).
 */
import { Database } from "bun:sqlite";
import { nextCollectionId } from "../domain/ids.js";
import {
  checkSchemaGate,
  parseReport,
  parseWatch,
  toCanonicalJson,
} from "../domain/io.js";
import { SCHEMA_VERSION } from "../domain/sets.js";
import type { RunReport, WatchSpec } from "../domain/types.js";
import { writeArtifact, readArtifact, type RunRow, type WatchRow } from "./store.js";
import { handleGetArtifact } from "./artifact-route.js";
import type { InflightTracker, PhaseHandle } from "./http.js";

export type RequestDeps = {
  store: Database;
  artifactsDir: string;
  inflight: InflightTracker;
  phaseHandle: PhaseHandle;
};

export type WatchEntry = WatchRow & { lastStatus: string | null };

/**
 * Handle a single request. `/health` reads the tracker synchronously
 * (E-11 — never blocks on queued jobs); ingest handlers bracket their
 * work with `inflight.begin()/end()` so health reports the live count.
 */
export async function handleRequest(req: Request, ctx: RequestDeps): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/health") {
    return json(healthJson(ctx));
  }

  if (req.method === "POST" && pathname === "/api/watches") {
    return ingestWatch(req, ctx);
  }
  if (req.method === "POST" && pathname === "/api/runs") {
    return ingestRun(req, ctx);
  }
  if (req.method === "GET" && pathname === "/api/watches") {
    return listWatches(ctx);
  }
  if (req.method === "GET" && /^\/api\/watches\/\d+$/.test(pathname)) {
    const id = Number(pathname.split("/").pop());
    return getWatch(ctx, id);
  }
  if (req.method === "GET" && /^\/api\/artifacts\/[^/]+$/.test(pathname)) {
    return handleGetArtifact(req, ctx);
  }
  return notFound();
}

// ---------------------------------------------------------------------------
// /health
// ---------------------------------------------------------------------------

function healthJson(ctx: RequestDeps): Record<string, unknown> {
  return {
    phase: ctx.phaseHandle.current(),
    pid: process.pid,
    version: SCHEMA_VERSION,
    queue: ctx.inflight.inFlight(),
  };
}

// ---------------------------------------------------------------------------
// POST /api/watches — registry writes (E-04 duplicate-name reject)
// ---------------------------------------------------------------------------

async function ingestWatch(req: Request, ctx: RequestDeps): Promise<Response> {
  ctx.inflight.begin();
  try {
    if (ctx.phaseHandle.current() === "draining") {
      return conflict("server is draining; refuse new watches");
    }

    const raw = await req.text();
    let watch: WatchSpec;
    try {
      // `parseWatch` = JSON.parse → schema gate (E-13) → assertWatch
      // (dotted-path throws). One shared code path, the V-41 law.
      watch = parseWatch(raw);
    } catch (e) {
      return unprocessable(dottedReason(e));
    }

    const specJson = toCanonicalJson(watch);
    try {
      const row = insertWatchRow(ctx.store, {
        name: watch.watch.name,
        specJson,
        createdIso: new Date().toISOString(),
      }, watch.watch.id);
      return json({ ok: true, watch: row }, 201);
    } catch (e) {
      // The UNIQUE name constraint is the authoritative E-04 gate.
      if (isUniqueViolation(e)) {
        return unprocessable(
          `watch.name "${watch.watch.name}" already exists (E-04 duplicate-name reject)`,
        );
      }
      throw e;
    }
  } finally {
    ctx.inflight.end();
  }
}

function insertWatchRow(
  db: Database,
  w: { name: string; specJson: string; createdIso: string },
  id?: number,
): WatchRow {
  // Explicit id when supplied (the ids.ts deterministic law — the spec
  // declares its own id); otherwise the sqlite auto-assigned PK
  // (max+1 — fresh starts at 1 and matches the spec value).
  if (id !== undefined) {
    db.query("INSERT INTO watches (id, name, specJson, createdIso) VALUES (?, ?, ?, ?)").run(
      id,
      w.name,
      w.specJson,
      w.createdIso,
    );
    return { id, name: w.name, specJson: w.specJson, createdIso: w.createdIso };
  }
  db.query("INSERT INTO watches (name, specJson, createdIso) VALUES (?, ?, ?)").run(
    w.name,
    w.specJson,
    w.createdIso,
  );
  const row = db
    .query<[string], { id: number; specJson: string; createdIso: string }>(
      "SELECT id, specJson, createdIso FROM watches WHERE name = ?",
    )
    .get(w.name);
  return {
    id: row.id,
    name: w.name,
    specJson: row.specJson,
    createdIso: row.createdIso,
  };
}

function isUniqueViolation(e: unknown): boolean {
  // bun:sqlite throws a plain Error for constraint breaches — classify
  // by the SQLite constraint message (bun's error has no .code).
  return e instanceof Error && e.message.includes("UNIQUE constraint failed");
}

// ---------------------------------------------------------------------------
// POST /api/runs — STRICT report ingest (the V-41 law)
// ---------------------------------------------------------------------------

/**
 * The optional sideband a runner may attach to a report body:
 * `__artifactBytes__` — artifact name → base64-encoded bytes. Stripped
 * before validation and before storage; only the canonical report
 * (grammar fields ONLY) lands in the DB.
 */
const ARTIFACT_BYTES_KEY = "__artifactBytes__";

async function ingestRun(req: Request, ctx: RequestDeps): Promise<Response> {
  ctx.inflight.begin();
  try {
    if (ctx.phaseHandle.current() === "draining") {
      return conflict("server is draining; refuse new runs");
    }

    const raw = await req.text();

    // Split the sideband out BEFORE the grammar sees it: the schema
    // gate + assertReport run on the report object with the sideband
    // field absent (a re-declared grammar field would be a V-41
    // breach — the domain stays the single declaration site).
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return unprocessable("body is not valid JSON");
    }
    const artifactBytes = body[ARTIFACT_BYTES_KEY] as Record<string, string> | undefined;
    if (artifactBytes !== undefined) {
      delete body[ARTIFACT_BYTES_KEY];
    }
    const reportRaw = JSON.stringify(body);

    // E-13 foreign/future schema → 422 dry-run reason, store NOTHING.
    let report: RunReport;
    try {
      report = parseReport(reportRaw);
    } catch (e) {
      return unprocessable(dottedReason(e));
    }

    // E-09: the report's watchId must resolve in the registry — a
    // contract error (422), never a 500.
    // Note: bun:sqlite `.get()` returns `null` on no rows (not `undefined`)
    // — check for `null` explicitly.
    const watchRow = ctx.store
      .query<[number], { id: number }>("SELECT id FROM watches WHERE id = ?")
      .get(report.report.watchId);
    if (watchRow === null) {
      return unprocessable(
        `report.watchId ${report.report.watchId} does not resolve in the registry (E-09 invalid-reference reject)`,
      );
    }

    // E-07: cap total ingest bytes — reject, never truncate-and-store.
    const sidebandBytes =
      artifactBytes !== undefined ? JSON.stringify(artifactBytes).length : 0;
    if (reportRaw.length + sidebandBytes > MAX_INGEST_BYTES) {
      return new Response(
        JSON.stringify({
          reason: `report exceeds the ${MAX_INGEST_BYTES}-byte ingest cap (E-07 oversized reject)`,
        }),
        { status: 413, headers: { "content-type": "application/json" } },
      );
    }

    // Persist the canonical row. Run ids follow the ids.ts
    // deterministic law (max+1 over the taken set — never the sqlite
    // rowid): the operator pins the run id as the spec-declared value,
    // not a DB-internal sequence.
    const takenRunIds = ctx.store
      .query<[], { id: number }>("SELECT id FROM runs")
      .all() as { id: number }[];
    const runId = nextCollectionId(takenRunIds);
    const reportJson = toCanonicalJson(report);
    const runRow = insertRunRow(ctx.store, {
      id: runId,
      watchId: report.report.watchId,
      reportJson,
      receivedIso: new Date().toISOString(),
    });

    // Write each referenced artifact under its content-addressed name
    // (the name IS the sha256 — same bytes always map to the same
    // file, so a crash between row-commit and file-write can only
    // leave an orphan, never a clobber; boot recovery discards it).
    if (artifactBytes !== undefined) {
      for (const artifact of report.report.artifacts) {
        const b64 = artifactBytes[artifact.name];
        if (b64 === undefined) continue; // ref without bytes: row still stored
        writeArtifact(ctx.artifactsDir, artifact.name, Buffer.from(b64, "base64"));
      }
    }

    return json(
      { ok: true, runId: runRow.id, watchId: report.report.watchId },
      201,
    );
  } finally {
    ctx.inflight.end();
  }
}

// ---------------------------------------------------------------------------
// GET /api/watches — registry + each watch's latest run status
// ---------------------------------------------------------------------------

function listWatches(ctx: RequestDeps): Response {
  const rows = ctx.store
    .query<[], { id: number; name: string; specJson: string; createdIso: string }>(
      "SELECT id, name, specJson, createdIso FROM watches ORDER BY id",
    )
    .all() as { id: number; name: string; specJson: string; createdIso: string }[];

  const watches: WatchEntry[] = rows.map((row) => {
    const last = ctx.store
      .query<[number], { lastStatus: string | null }>(
        `SELECT json_extract(reportJson, '$.report.status') AS lastStatus
         FROM runs WHERE watchId = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(row.id) as { lastStatus: string | null } | undefined;
    return {
      id: row.id,
      name: row.name,
      specJson: row.specJson,
      createdIso: row.createdIso,
      lastStatus: last?.lastStatus ?? null,
    };
  });

  return json({ watches });
}

function getWatch(ctx: RequestDeps, id: number): Response {
  const row = ctx.store
    .query<[number], { id: number; name: string; specJson: string; createdIso: string }>(
      "SELECT id, name, specJson, createdIso FROM watches WHERE id = ?",
    )
    .get(id);
  if (row === null) {
    return notFound();
  }

  const runs = ctx.store
    .query<[number], { id: number; reportJson: string; receivedIso: string }>(
      "SELECT id, reportJson, receivedIso FROM runs WHERE watchId = ? ORDER BY id",
    )
    .all(id) as { id: number; reportJson: string; receivedIso: string }[];

  const lastStatus =
    runs.length > 0
      ? ((JSON.parse(runs[runs.length - 1].reportJson) as unknown as RunReport).report.status)
      : null;

  return json({
    watch: { ...row, lastStatus },
    runs: runs.map((r) => ({
      id: r.id,
      receivedIso: r.receivedIso,
      report: JSON.parse(r.reportJson) as RunReport,
    })),
  });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * The 422 reason. `DomainInvariantError` messages already carry the
 * exact dotted path of the breach (e.g. `report.status not in the
 * closed RunStatus set`) — the V-41 law made executable; the body
 * surfaces that string verbatim.
 */
function dottedReason(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function insertRunRow(
  db: Database,
  r: { id: number; watchId: number; reportJson: string; receivedIso: string },
): RunRow {
  // Explicit id (the ids.ts deterministic law — the caller computes it
  // via nextCollectionId over the taken set, never the sqlite rowid).
  db.query("INSERT INTO runs (id, watchId, reportJson, receivedIso) VALUES (?, ?, ?, ?)").run(
    r.id,
    r.watchId,
    r.reportJson,
    r.receivedIso,
  );
  return {
    id: r.id,
    watchId: r.watchId,
    reportJson: r.reportJson,
    receivedIso: r.receivedIso,
  };
}

/** E-07 cap: total ingest bytes (report + sideband), rejected whole. */
const MAX_INGEST_BYTES = 10 * 1024 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function unprocessable(reason: string): Response {
  return json({ reason }, 422);
}

function conflict(reason: string): Response {
  return json({ reason }, 409);
}

function notFound(): Response {
  return json({ reason: "not found" }, 404);
}
