/**
 * Bolero server — GET /api/artifacts/:name route seam (ticket S-5,
 * the ONLY allowed src/server change). Serves the content-addressed
 * artifact bytes (a run report's referenced screenshot or log file)
 * under the `/api/artifacts/` prefix so the dashboard's img can pull
 * it same-origin through the serve.mjs proxy.
 *
 * The route regex accepts `[A-Za-z0-9_.:-]+` only — no slash, no
 * traversal. A traversal-shaped name (e.g. `..%2Fetc%2Fpasswd`) is
 * a 404 json, never a 500. The store's `readArtifact` helper is
 * beside `writeArtifact` in store.ts.
 */
import { readArtifact } from "./store.js";
import type { RequestDeps } from "./ingest.js";

/** The artifact-route name constraint (no slash, no traversal). */
const ARTIFACT_NAME_RE = /^[A-Za-z0-9_.:-]+$/;

const ARTIFACT_CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".json": "application/json",
  ".log": "text/plain",
};

/**
 * GET /api/artifacts/:name — the route seam. Reads the artifact from
 * the configured artifacts dir under its content-addressed name; on
 * a miss (file not present, name rejected) returns 404 json. The
 * caller wires this into `handleRequest` via a single dispatch line.
 */
export function handleGetArtifact(req: Request, ctx: Pick<RequestDeps, "artifactsDir">): Response {
  const url = new URL(req.url);
  const match = url.pathname.match(/^\/api\/artifacts\/([^/]+)$/);
  if (!match) {
    return json404("artifact name is empty");
  }
  let raw = match[1];
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    // Malformed percent-encoding (e.g. /api/artifacts/%ZZ) — a
    // malformed client input is a contract error (4xx), never a 5xx.
    return json404(`artifact name ${JSON.stringify(raw)} has malformed percent-encoding`);
  }
  if (!ARTIFACT_NAME_RE.test(name)) {
    // No slash, no traversal — a traversal-shaped name (anything
    // with a path separator after decoding) is a 404, never a 500.
    return json404(`artifact name ${JSON.stringify(name)} contains a path separator`);
  }
  const buf = readArtifact(ctx.artifactsDir, name);
  if (buf === null) {
    return json404(`artifact ${JSON.stringify(name)} not found`);
  }
  const ext = name.slice(name.lastIndexOf(".")) || "";
  const type = ARTIFACT_CONTENT_TYPES[ext] ?? "application/octet-stream";
  return new Response(buf, {
    status: 200,
    headers: { "content-type": type, "content-length": String(buf.byteLength) },
  });
}

function json404(reason: string): Response {
  return new Response(JSON.stringify({ reason }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
}
