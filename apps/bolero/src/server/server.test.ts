/**
 * Bolero server unit lane (PLAN S-3 acceptance, deterministic):
 *
 * - ingest accept: a valid report stores exactly one row + the
 *   artifact file under data/artifacts/ (content-addressed)
 * - reject paths: a foreign schema (E-13), a dotted-path breach,
 *   an unknown watchId (E-09)
 * - duplicate watch names (E-04)
 * - the /health endpoint shape (E-11 — reads synchronously)
 * - canonical round-trip: a stored report parses back through
 *   io.ts byte-stable
 *
 * In-memory DB (`:memory:`) + a temp artifact dir — no real
 * network, no port bind, no filesystem outside the test dir.
 */
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, listWatches, getWatch, insertWatch } from "./store.js";
import { handleRequest } from "./ingest.js";
import { makeInflight, makePhaseHandle, type InflightTracker, type PhaseHandle } from "./http.js";
import { toCanonicalJson, parseReport } from "../domain/io.js";

// --- test fixtures ---------------------------------------------------------

const SHA = "a".repeat(64); // a valid 64-hex digest

function validWatch(name: string, id: number): Record<string, unknown> {
  return {
    schema: "bolero.v1",
    watch: {
      id,
      name,
      steps: [{ id: 1, kind: "goto", selector: "https://example.com" }],
      baseUrl: "https://example.com",
    },
  };
}

function validReport(watchId: number, opts: { withArtifact?: boolean } = {}): Record<string, unknown> {
  const artifacts = opts.withArtifact
    ? [{ name: `1_r1_sha256:${SHA}.png`, sha256: SHA, ext: "png" as const }]
    : [];
  return {
    schema: "bolero.v1",
    report: {
      watchId,
      recipeVersion: 1,
      status: "ok",
      startedAt: "2026-11-07T09:00:00Z",
      finishedAt: "2026-11-07T09:00:05Z",
      committedPrefix: 1,
      artifacts,
    },
  };
}

// --- test harness ----------------------------------------------------------

function makeHarness() {
  const db = openStore(":memory:");
  const artifactsDir = mkdtempSync(join(tmpdir(), "bolero-test-"));
  const inflight: InflightTracker = makeInflight();
  const phaseHandle: PhaseHandle = makePhaseHandle("ready");
  const ctx = { store: db, artifactsDir, inflight, phaseHandle };
  return { db, artifactsDir, inflight, phaseHandle, ctx, cleanup() { db.close(); rmSync(artifactsDir, { recursive: true, force: true }); } };
}

async function post(ctx: Parameters<typeof handleRequest>[1], path: string, body: unknown) {
  const res = await handleRequest(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx,
  );
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

async function get(ctx: Parameters<typeof handleRequest>[1], path: string) {
  const res = await handleRequest(new Request(`http://localhost${path}`), ctx);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

// --- ingest accept path ----------------------------------------------------

test("ingest accept: a valid report stores exactly one row + the artifact file", async () => {
  const h = makeHarness();
  try {
    // register the watch
    const watchRes = await post(h.ctx, "/api/watches", validWatch("login-watch", 1));
    expect(watchRes.status).toBe(201);
    expect(watchRes.body.watch).toHaveProperty("id", 1);

    // ingest a valid report carrying one content-addressed artifact
    const b64 = Buffer.from("fake-png-bytes").toString("base64");
    const report = validReport(1, { withArtifact: true });
    const res = await post(h.ctx, "/api/runs", {
      ...report,
      __artifactBytes__: { [`1_r1_sha256:${SHA}.png`]: b64 },
    });
    expect(res.status).toBe(201);
    expect(res.body.watchId).toBe(1);

    // exactly one runs row for this watch
    const watches = listWatches(h.db);
    expect(watches.length).toBe(1);
    const status = h.db
      .query<[number], { s: string }>(
        "SELECT json_extract(reportJson, '$.report.status') AS s FROM runs WHERE watchId = ?",
      )
      .get(1);
    expect(status.s).toBe("ok");

    // the artifact file exists under its content-addressed name, with the bytes
    const artifactPath = join(h.artifactsDir, `1_r1_sha256:${SHA}.png`);
    expect(existsSync(artifactPath)).toBe(true);
    expect(readFileSync(artifactPath, "utf8")).toBe("fake-png-bytes");

    // the sideband never lands in the DB row (large bytes never bloat it)
    const row = h.db.query<[number], { reportJson: string }>("SELECT reportJson FROM runs WHERE watchId = ?").get(1);
    expect(row.reportJson).not.toContain("__artifactBytes__");
  } finally {
    h.cleanup();
  }
});

// --- reject paths ----------------------------------------------------------

test("reject: a foreign schema is refused (E-13), stores nothing", async () => {
  const h = makeHarness();
  try {
    await post(h.ctx, "/api/watches", validWatch("w", 1));
    const foreign = { ...validReport(1), schema: "bolero.v99" };
    const res = await post(h.ctx, "/api/runs", foreign);
    expect(res.status).toBe(422);
    expect(String(res.body.reason)).toContain("bolero.v99");
    expect(String(res.body.reason)).toContain("bolero.v1");

    // store NOTHING: no runs row
    const rows = h.db.query<[number], { n: number }>("SELECT COUNT(*) AS n FROM runs WHERE watchId = ?").get(1);
    expect(rows.n).toBe(0);
  } finally {
    h.cleanup();
  }
});

test("reject: a dotted-path breach is a 422 carrying the dotted path", async () => {
  const h = makeHarness();
  try {
    await post(h.ctx, "/api/watches", validWatch("w", 1));
    const bad = validReport(1);
    (bad.report as Record<string, unknown>).status = "mystery";
    const res = await post(h.ctx, "/api/runs", bad);
    expect(res.status).toBe(422);
    expect(String(res.body.reason)).toContain("report.status");
    expect(String(res.body.reason)).toContain("not in the closed RunStatus set");

    const rows = h.db.query<[number], { n: number }>("SELECT COUNT(*) AS n FROM runs WHERE watchId = ?").get(1);
    expect(rows.n).toBe(0);
  } finally {
    h.cleanup();
  }
});

test("reject: an unknown watchId is a 422, never a 500 (E-09)", async () => {
  const h = makeHarness();
  try {
    const wRes = await post(h.ctx, "/api/watches", validWatch("w", 1));
    const watchId = (wRes.body.watch as { id: number }).id; // auto-assigned PK
    expect(watchId).toBe(1);
    const res = await post(h.ctx, "/api/runs", validReport(999));
    expect(res.status).toBe(422);
    expect(String(res.body.reason)).toContain("E-09");
    expect(String(res.body.reason)).toContain("999");

    const rows = h.db.query<[], { n: number }>("SELECT COUNT(*) AS n FROM runs").all();
    expect(rows[0].n).toBe(0);
  } finally {
    h.cleanup();
  }
});

// --- duplicate watch names (E-04) -----------------------------------------

test("reject: duplicate watch names (E-04)", async () => {
  const h = makeHarness();
  try {
    const first = await post(h.ctx, "/api/watches", validWatch("same-name", 1));
    expect(first.status).toBe(201);

    const dup = await post(h.ctx, "/api/watches", validWatch("same-name", 2));
    expect(dup.status).toBe(422);
    expect(String(dup.body.reason)).toContain("E-04");
    expect(String(dup.body.reason)).toContain("same-name");

    // exactly one watch with that name
    const rows = listWatches(h.db).filter((w) => w.name === "same-name");
    expect(rows.length).toBe(1);
  } finally {
    h.cleanup();
  }
});

test("reject: a malformed watch-spec body is a 422 (no partial row)", async () => {
  const h = makeHarness();
  try {
    // a watch body that passes the schema gate but breaches assertWatch
    const bad = validWatch("bad", 1);
    (bad.watch as Record<string, unknown>).baseUrl = ""; // must be non-empty
    const res = await post(h.ctx, "/api/watches", bad);
    expect(res.status).toBe(422);
    expect(String(res.body.reason)).toContain("watch.baseUrl");
    expect(listWatches(h.db).length).toBe(0);
  } finally {
    h.cleanup();
  }
});

// --- health endpoint shape --------------------------------------------------

test("GET /health: the ops-contract JSON shape (phase + pid + version + queue)", async () => {
  const h = makeHarness();
  try {
    const res = await get(h.ctx, "/health");
    expect(res.status).toBe(200);
    expect(res.body.phase).toBe("ready");
    expect(res.body.pid).toBe(process.pid);
    expect(res.body.version).toBe("bolero.v1");
    expect(res.body.queue).toBe(0);
  } finally {
    h.cleanup();
  }
});

test("GET /health: never blocks on in-flight jobs (E-11 load signal)", async () => {
  const h = makeHarness();
  try {
    // simulate an in-flight ingest
    h.inflight.begin();
    h.inflight.begin();
    const res = await get(h.ctx, "/health");
    expect(res.body.phase).toBe("ready");
    expect(res.body.queue).toBe(2);
    h.inflight.end();
    h.inflight.end();
  } finally {
    h.cleanup();
  }
});

// --- registry reads ---------------------------------------------------------

test("GET /api/watches returns the registry with each watch's latest run status", async () => {
  const h = makeHarness();
  try {
    const w1 = await post(h.ctx, "/api/watches", validWatch("watch-a", 1));
    expect(w1.status).toBe(201);
    await post(h.ctx, "/api/watches", validWatch("watch-b", 2));

    // a run for watch 1
    await post(h.ctx, "/api/runs", validReport(1));

    const res = await get(h.ctx, "/api/watches");
    expect(res.status).toBe(200);
    const watches = res.body.watches as Array<Record<string, unknown>>;
    expect(watches.length).toBe(2);
    expect(watches[0]).toMatchObject({ id: 1, name: "watch-a", lastStatus: "ok" });
    expect(watches[1]).toMatchObject({ id: 2, name: "watch-b", lastStatus: null });
  } finally {
    h.cleanup();
  }
});

test("GET /api/watches/:id returns one watch + its run history; unknown → 404", async () => {
  const h = makeHarness();
  try {
    const wRes = await post(h.ctx, "/api/watches", validWatch("solo", 1));
    const watchId = (wRes.body.watch as { id: number }).id;
    const runRes = await post(h.ctx, "/api/runs", validReport(watchId));
    expect(runRes.status).toBe(201);

    const res = await get(h.ctx, `/api/watches/${watchId}`);
    expect(res.status).toBe(200);
    expect(res.body.watch).toMatchObject({ id: watchId, name: "solo", lastStatus: "ok" });
    expect((res.body.runs as unknown[]).length).toBe(1);

    // an unknown id is a 404 (never a 500)
    const missing = await get(h.ctx, "/api/watches/999999");
    expect(missing.status).toBe(404);
  } finally {
    h.cleanup();
  }
});

// --- canonical round-trip ----------------------------------------------------

test("canonical round-trip: a stored report parses back through io.ts, byte-stable", async () => {
  const h = makeHarness();
  try {
    await post(h.ctx, "/api/watches", validWatch("rt", 1));
    const b64 = Buffer.from("rt-bytes").toString("base64");
    await post(h.ctx, "/api/runs", {
      ...validReport(1, { withArtifact: true }),
      __artifactBytes__: { [`1_r1_sha256:${SHA}.png`]: b64 },
    });

    const row = h.db
      .query<[number], { reportJson: string }>("SELECT reportJson FROM runs WHERE watchId = ?")
      .get(1);
    const stored = row.reportJson;

    // byte-stable: re-canonicalizing the re-parsed report reproduces it
    const reparsed = parseReport(stored);
    const reCanonical = toCanonicalJson(reparsed);
    expect(reCanonical).toBe(stored);

    // and the round-tripped report is still a valid RunReport
    expect(reparsed.report.watchId).toBe(1);
    expect(reparsed.report.status).toBe("ok");
    expect(reparsed.report.artifacts[0].sha256).toBe(SHA);
  } finally {
    h.cleanup();
  }
});
