#!/usr/bin/env node
/**
 * fixture-refresh — the H-24 live-traffic fixture refresh (operator lane).
 *
 * The V-15 law mechanized: the engine-contract fixtures REGENERATE from
 * recorded live engine responses — the fixture files become DERIVED
 * artifacts (provenance + timestamp), never hand-canned fictions (the
 * V-24 class: four fictions in one ticket, each caught only by ~590
 * turns of live-lane grind).
 *
 * What it does (the record mode on the H-23 instrument family):
 *
 * - HARD-FAILS when the engine is down or rejects the bearer (never a
 *   silent skip — the probe-live law).
 * - Creates a MARKER automation (title FIXTURE_REFRESH_<stamp>) so the
 *   automations list captures a REAL row shape even on a fresh engine,
 *   then sweeps every read-only endpoint the fugue adapter consumes:
 *     GET /api/overview            (phase/pid/version lane)
 *     GET /api/automations         (the marker row, engine-native snake_case)
 *     GET /api/runs?limit=5        (real global run rows: baseline/learning kinds)
 *     GET /api/dreams?limit=5      (the dream journal rows)
 *     GET /api/notes?limit=5       (the session-note rows)
 *     GET /api/memory              (the tier array)
 *     GET /api/memory/health       (health + platform objects)
 *     GET /api/automations/spend   (the spend report)
 *     GET /api/automations/<id>/runs  (the marker's scoped runs — the {runs:[]} wrapper)
 * - Also captures the WRITE-path shapes: the POST create response and
 *   the DELETE response (the fixture server replays these).
 * - ALWAYS cleans up (DELETE the marker — the probe law).
 * - Emits the recording as a committed-by-default TS module with
 *   provenance (capturedAt, engine version, marker title, tree).
 *
 * The emitted file is consumed by apps/fugue/src/adapter/
 * fixtures-live.test.ts (the refreshed-fixture lane): every recorded
 * body runs through assertContract — pin-vs-live drift REDDENS with
 * the dotted path. Refresh-then-build: run this at every
 * fixture-consuming ticket's open (the H-24 SHOULD law).
 *
 * Usage: node scripts/a1/fixture-refresh.mjs [--engine http://127.0.0.1:3030]
 *        [--out apps/fugue/src/adapter/fixtures-live.gen.ts] [--no-marker]
 * Env: FUGUE_ENGINE_TOKEN or UNOWN_HOME (engine.token discovery).
 * Exit: 0 refreshed · 1 harness error (engine down, sweep failure,
 *       cleanup failure — each named).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..", "..");
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const ENGINE_URL = flag("engine", "http://127.0.0.1:3030").replace(/\/$/, "");
const OUT = resolve(REPO, flag("out", "apps/fugue/src/adapter/fixtures-live.gen.ts"));
const NO_MARKER = args.includes("--no-marker");

const STAMP = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const MARKER_TITLE = `FIXTURE_REFRESH_${STAMP}`;

function token() {
  const env = process.env.FUGUE_ENGINE_TOKEN?.trim();
  if (env) return env;
  const home = process.env.UNOWN_HOME?.trim();
  if (home) {
    try {
      const t = readFileSync(join(home, "engine.token"), "utf8").trim();
      if (t) return t;
    } catch { /* fallthrough */ }
  }
  // The repo-local engine's token (the dispatch home default).
  try {
    return readFileSync(join(REPO, "data", "self-learning", "engine.token"), "utf8").trim();
  } catch { /* fallthrough */ }
  throw new Error("fixture-refresh: no engine token (set FUGUE_ENGINE_TOKEN or UNOWN_HOME)");
}

async function engineFetch(tok, path, init = {}) {
  const res = await fetch(`${ENGINE_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${tok}`, ...(init.headers ?? {}) },
  });
  const body = await res.text();
  return { status: res.status, ok: res.ok, body, json: safeJson(body) };
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

async function main() {
  const tok = token();

  // The hard-fail law: never a silent skip on a dead engine.
  const probe = await engineFetch(tok, "/api/overview");
  if (!probe.ok) throw new Error(`fixture-refresh: engine probe failed (HTTP ${probe.status}) — is the stack up?`);
  const engineVersion = probe.json?.agent?.layer ?? null;
  const tree = (() => {
    try { return execSync("git rev-parse --short HEAD", { cwd: REPO }).toString().trim(); }
    catch { return null; }
  })();

  const endpoints = {};
  const capture = async (name, path, init) => {
    const r = await engineFetch(tok, path, init);
    if (!r.ok && r.status !== 404) {
      throw new Error(`fixture-refresh: ${name} (${path}) -> HTTP ${r.status}: ${r.body.slice(0, 200)}`);
    }
    endpoints[name] = {
      route: path,
      status: r.status,
      body: r.json !== null ? r.json : { raw: r.body },
    };
    return r;
  };

  let markerId = null;
  let createResponse = null;
  try {
    // The marker: guarantees a real automation row shape on any engine.
    if (!NO_MARKER) {
      createResponse = await engineFetch(tok, "/api/automations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: MARKER_TITLE,
          prompt: "Reply with exactly: OK (fixture-refresh marker; safe to delete)",
          mode: "read-only",
          every: "1d",
        }),
      });
      if (!createResponse.ok) {
        throw new Error(`fixture-refresh: marker create failed (HTTP ${createResponse.status}): ${createResponse.body.slice(0, 300)}`);
      }
      markerId = createResponse.json?.automation?.id ?? null;
      if (markerId == null) throw new Error("fixture-refresh: marker create returned no automation.id");
      endpoints["create-automation"] = {
        route: "POST /api/automations",
        status: createResponse.status,
        body: createResponse.json,
      };
    }

    await capture("overview", "/api/overview");
    await capture("automations", "/api/automations");
    await capture("runs", "/api/runs?limit=5");
    await capture("dreams", "/api/dreams?limit=5");
    await capture("notes", "/api/notes?limit=5");
    await capture("memory", "/api/memory");
    await capture("memory-health", "/api/memory/health");
    await capture("spend", "/api/automations/spend");
    if (markerId != null) {
      await capture("automation-runs", `/api/automations/${encodeURIComponent(String(markerId))}/runs`);
    }
  } finally {
    // The cleanup law (the probe precedent): ALWAYS delete the marker.
    if (markerId != null) {
      const del = await engineFetch(
        tok, `/api/automations/${encodeURIComponent(String(markerId))}`, { method: "DELETE" },
      );
      endpoints["delete-automation"] = {
        route: "DELETE /api/automations/:id",
        status: del.status,
        body: safeJson(del.body) ?? { raw: del.body },
      };
      if (!del.ok) {
        // Cleanup failure is a named error, never silent — the marker
        // row would pollute the NEXT recording's automations list.
        console.error(`fixture-refresh: CLEANUP FAILED for marker ${markerId} (HTTP ${del.status}) — delete it manually before the next refresh`);
        process.exitCode = 1;
      }
    }
  }

  const recording = {
    captured: true,
    provenance: {
      capturedAt: new Date().toISOString(),
      engineUrl: ENGINE_URL,
      engineVersion,
      tree,
      markerTitle: NO_MARKER ? null : MARKER_TITLE,
      tool: "scripts/a1/fixture-refresh.mjs (H-24)",
      law: "the V-15 refresh: fixtures are DERIVED from the live wire, never hand-canned (the V-24 cure)",
    },
    endpoints,
  };

  const body = `/* eslint-disable */
/**
 * fixtures-live.gen.ts — the H-24 LIVE-WIRE RECORDING (GENERATED —
 * never hand-edit; regenerate with scripts/a1/fixture-refresh.mjs).
 *
 * Captured: ${recording.provenance.capturedAt}
 * Engine:   ${ENGINE_URL} (${engineVersion ?? "version unknown"})
 * Tree:     ${tree ?? "unknown"}
 * Marker:   ${NO_MARKER ? "(none — --no-marker sweep)" : MARKER_TITLE}
 *
 * Every body below is a VERBATIM response from the live engine on the
 * routes the fugue adapter consumes. apps/fugue/src/adapter/
 * fixtures-live.test.ts runs each body through assertContract —
 * pin-vs-live drift REDDENS at the dotted path (the V-24 fiction class
 * cannot fossilize: the recording's source IS the live wire).
 */
export const FIXTURES_LIVE = ${JSON.stringify(recording, null, 2)} as const;
`;

  writeFileSync(OUT, body);

  // The summary (the operator's refresh receipt, stdout).
  const rows = Object.entries(endpoints).map(([k, v]) => {
    const size = JSON.stringify(v.body ?? {}).length;
    return `  ${k.padEnd(22)} ${String(v.status).padEnd(4)} ${String(size).padStart(7)} B  ${v.route}`;
  });
  console.log(`fixture-refresh: captured ${Object.keys(endpoints).length} endpoints from ${ENGINE_URL} (${engineVersion})`);
  console.log(rows.join("\n"));
  console.log(`fixture-refresh: marker ${markerId != null ? `${markerId} created + deleted (cleanup OK)` : "skipped (--no-marker)"}`);
  console.log(`fixture-refresh: recording -> ${OUT.replace(REPO + "/", "")}`);
  console.log(`fixture-refresh: next: cd apps/fugue && bun test src/adapter/fixtures-live.test.ts (the refreshed lane)`);
}

main().catch((e) => {
  console.error(`fixture-refresh: ERROR — ${String(e)}`);
  process.exit(1);
});
