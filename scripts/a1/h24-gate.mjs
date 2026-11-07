#!/usr/bin/env node
/**
 * h24-gate — the H-24 promotion gate: the paired A/B on a DELIBERATE
 * wire change (the registry row's pre-registered gate design).
 *
 *   LANE STALE  — the canned-fixture contract lane
 *                 (apps/fugue/src/adapter/contract.test.ts): it asserts
 *                 hand-canned fixtures against the pins and NEVER
 *                 touches the wire — a wire change is INVISIBLE to it.
 *                 Expected verdict on a mutated engine: GREEN
 *                 (the false confidence the V-24 class lives on).
 *
 *   LANE REFRESHED — scripts/a1/fixture-refresh.mjs pointed at the
 *                 MUTATED stub engine (the recording regenerates from
 *                 the changed wire), then the refreshed lane
 *                 (fixtures-live.test.ts, FIXTURES_LIVE_PATH override)
 *                 asserts the RECORDED bodies. Expected verdict: RED
 *                 at the mutated field's dotted path.
 *
 * The DELTA (stale GREEN + refreshed RED on the same deliberate wire
 * change) is the false-confidence delta, directly measured — the
 * number the H-24 promotion stands on.
 *
 * The mutation (pre-registered, the MCP guide's "quiet change" class):
 * the stub renames the live notes row's `content` field to `note_body`
 * — a schema-validation pin on `content` would catch it, but a stale
 * fixture lane never sees the wire at all.
 *
 * Usage: node scripts/a1/h24-gate.mjs [--stub-port 4131] [--out FILE]
 * Exit: 0 the gate ran and the delta was measured (either direction —
 *       the receipt records the truth; promotion judges it) · 1 harness
 *       error.
 */
import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..", "..");
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const STUB_PORT = Number(flag("stub-port", "4131"));
const OUT = flag("out", null);

// — load the committed recording (the stub serves ITS bodies, mutated) —
const genText = readFileSync(
  join(REPO, "apps/fugue/src/adapter/fixtures-live.gen.ts"), "utf8",
);
const m = genText.match(/export const FIXTURES_LIVE = ([\s\S]*?) as const;/);
if (!m) throw new Error("h24-gate: cannot parse fixtures-live.gen.ts");
const REC = JSON.parse(m[1]);

// The deliberate wire change: rename notes[].content -> note_body.
function mutateNotes(body) {
  if (!body || !Array.isArray(body.notes)) return body;
  return {
    ...body,
    notes: body.notes.map((n) => {
      const { content, ...rest } = n;
      void content;
      return { ...rest, note_body: "renamed by the h24-gate mutation" };
    }),
  };
}

const routes = new Map([
  ["/api/overview", REC.endpoints.overview.body],
  ["/api/automations", REC.endpoints.automations.body],
  ["/api/runs?limit=5", REC.endpoints["runs"].body],
  ["/api/dreams?limit=5", REC.endpoints.dreams.body],
  ["/api/notes?limit=5", mutateNotes(REC.endpoints.notes.body)],
  ["/api/memory", REC.endpoints.memory.body],
  ["/api/memory/health", REC.endpoints["memory-health"].body],
  ["/api/automations/spend", REC.endpoints.spend.body],
]);

const stubSrc = `
const REC = ${JSON.stringify({
  create: REC.endpoints["create-automation"].body,
  routes: Object.fromEntries(routes),
})};
const server = Bun.serve({
  port: ${STUB_PORT},
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname + url.search;
    if (req.method === "GET" && REC.routes[path]) {
      return Response.json(REC.routes[path]);
    }
    if (req.method === "GET" && path.startsWith("/api/automations/") && path.endsWith("/runs")) {
      return Response.json({ runs: [] });
    }
    if (req.method === "POST" && path === "/api/automations") {
      const body = await req.json();
      const row = { ...REC.create.automation, id: "gate-marker-" + Date.now().toString(36), title: body.title ?? "gate marker" };
      return Response.json({ automation: row });
    }
    if (req.method === "DELETE") return Response.json({ ok: true });
    return new Response("not found", { status: 404 });
  },
});
console.log("h24-gate stub up on " + server.port);
`;

const stubDir = mkdtempSync(join(tmpdir(), "h24-gate-"));
const stubFile = join(stubDir, "stub.ts");
writeFileSync(stubFile, stubSrc);

const bun = process.env.BUN_BIN ?? "bun";
const stub = spawn(bun, [stubFile], { stdio: ["ignore", "pipe", "pipe"] });
let stubLog = "";
stub.stdout.on("data", (d) => (stubLog += d.toString()));
stub.stderr.on("data", (d) => (stubLog += d.toString()));

function run(cmd, opts = {}) {
  return new Promise((res) => {
    const p = spawn(cmd[0], cmd.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: opts.cwd ?? REPO,
      env: { ...process.env, ...(opts.env ?? {}) },
    });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("close", (code) => res({ code, out, err }));
  });
}

async function main() {
  // Wait for the stub.
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > 15_000) throw new Error(`h24-gate: stub did not come up\n${stubLog}`);
    try {
      const r = await fetch(`http://127.0.0.1:${STUB_PORT}/api/overview`);
      if (r.ok) break;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 300));
  }

  const receipt = {
    gate: "H-24 — the paired A/B on a deliberate wire change",
    mutation: "the stub renames notes[].content -> note_body (the quiet-change class)",
    stub: `http://127.0.0.1:${STUB_PORT}`,
    ranAt: new Date().toISOString(),
  };

  // LANE STALE: the canned contract lane — the wire change is invisible.
  const stale = await run([bun, "test", "src/adapter/contract.test.ts"],
    { cwd: join(REPO, "apps/fugue") });
  receipt.laneStale = {
    cmd: "cd apps/fugue && bun test src/adapter/contract.test.ts",
    exit: stale.code,
    verdict: stale.code === 0 ? "GREEN (wire-blind — the false confidence)" : "UNEXPECTED RED",
    tail: stale.out.trim().split("\n").slice(-4).join("\n"),
  };

  // LANE REFRESHED: record from the mutated stub, then run the lane.
  const mutatedGen = join(stubDir, "fixtures-mutated.gen.ts");
  const refresh = await run([process.execPath, join(REPO, "scripts/a1/fixture-refresh.mjs"),
    "--engine", `http://127.0.0.1:${STUB_PORT}`, "--out", mutatedGen], { env: { UNOWN_HOME: "/nonexistent" } });
  receipt.refreshRun = {
    exit: refresh.code,
    tail: refresh.out.trim().split("\n").slice(-3).join("\n"),
  };
  if (refresh.code !== 0) {
    receipt.laneRefreshed = { verdict: "REFRESH FAILED", err: refresh.err.slice(0, 500) };
  } else {
    const refreshed = await run(
      [bun, "test", "src/adapter/fixtures-live.test.ts"],
      {
        cwd: join(REPO, "apps/fugue"),
        env: { FIXTURES_LIVE_PATH: mutatedGen },
      },
    );
    const driftMsg = (refreshed.err + refreshed.out).match(/EngineDrift: [^\n]+/)?.[0] ?? null;
    receipt.laneRefreshed = {
      cmd: "cd apps/fugue && FIXTURES_LIVE_PATH=<mutated recording> bun test src/adapter/fixtures-live.test.ts",
      exit: refreshed.code,
      verdict: refreshed.code !== 0 ? "RED (the drift caught at the pin)" : "GREEN (the mutation NOT caught — gate FAILED)",
      driftMessage: driftMsg,
      tail: (refreshed.err + refreshed.out).trim().split("\n").slice(-4).join("\n"),
    };
  }

  receipt.delta =
    receipt.laneStale.verdict.startsWith("GREEN") && receipt.laneRefreshed.verdict.startsWith("RED")
      ? "MEASURED — the false-confidence delta: the stale lane stays green on a wire change the refreshed lane catches at "
        + (receipt.laneRefreshed.driftMessage ?? "the pin")
      : "NOT MEASURED — investigate (the gate expects stale GREEN + refreshed RED)";

  stub.kill("SIGTERM");
  const text = JSON.stringify(receipt, null, 2);
  if (OUT) writeFileSync(OUT, text);
  console.log(text);
  process.exit(0);
}

main().catch((e) => {
  stub.kill("SIGTERM");
  console.error(`h24-gate: ERROR — ${String(e)}`);
  process.exit(1);
});
