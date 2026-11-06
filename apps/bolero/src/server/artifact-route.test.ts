/**
 * Bolero server — the GET /api/artifacts route seam unit test
 * (ticket S-5, the only allowed src/server change).
 *
 * Three assertions:
 *   1. a seeded artifact's bytes are served with the right
 *      content-type (the .png → image/png rule)
 *   2. a missing name → 404 json
 *   3. a traversal-shaped name is rejected (404 json, not 500)
 *
 * In-memory DB + a temp artifact dir — no real network, no port bind,
 * no filesystem outside the test dir.
 */
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./store.js";
import { handleRequest } from "./ingest.js";
import { makeInflight, makePhaseHandle, type InflightTracker, type PhaseHandle } from "./http.js";

function makeHarness() {
  const db = openStore(":memory:");
  const artifactsDir = mkdtempSync(join(tmpdir(), "bolero-art-test-"));
  const inflight: InflightTracker = makeInflight();
  const phaseHandle: PhaseHandle = makePhaseHandle("ready");
  const ctx = { store: db, artifactsDir, inflight, phaseHandle };
  return {
    db,
    artifactsDir,
    inflight,
    phaseHandle,
    ctx,
    cleanup() {
      db.close();
      rmSync(artifactsDir, { recursive: true, force: true });
    },
  };
}

async function getArtifact(ctx: Parameters<typeof handleRequest>[1], name: string) {
  const res = await handleRequest(new Request(`http://localhost/api/artifacts/${name}`), ctx);
  return res;
}

test("GET /api/artifacts serves seeded bytes with the right content-type", async () => {
  const h = makeHarness();
  try {
    // Seed a PNG artifact under its content-addressed name.
    const name = "1_r1_sha256:" + "a".repeat(64) + ".png";
    writeFileSync(join(h.artifactsDir, name), "png-bytes");

    const res = await getArtifact(h.ctx, name);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-length")).toBe("9");
    expect(await res.text()).toBe("png-bytes");
  } finally {
    h.cleanup();
  }
});

test("GET /api/artifacts: a missing name is a 404 json, never a 500", async () => {
  const h = makeHarness();
  try {
    const res = await getArtifact(h.ctx, "does-not-exist.png");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/json");
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toContain("does-not-exist.png");
  } finally {
    h.cleanup();
  }
});

test("GET /api/artifacts: a traversal-shaped name is a 404 json", async () => {
  const h = makeHarness();
  try {
    // The route regex accepts [A-Za-z0-9_.:-]+ only — a name with a
    // slash (post-decode) is rejected before any fs access happens.
    const res = await getArtifact(h.ctx, "..%2F..%2Fetc%2Fpasswd");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/json");
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBeDefined();
  } finally {
    h.cleanup();
  }
});

test("GET /api/artifacts: a malformed percent-encoding is a 404 json, never a 500", async () => {
  const h = makeHarness();
  try {
    // %ZZ is an invalid escape — decodeURIComponent throws; the
    // taxonomy law says a malformed client input is a 4xx, not 5xx.
    const res = await getArtifact(h.ctx, "%ZZ");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/json");
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toContain("malformed percent-encoding");
  } finally {
    h.cleanup();
  }
});
