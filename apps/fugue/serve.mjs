#!/usr/bin/env bun
/**
 * Fugue — transpiling dev/test server (ticket F-4, the PWA shell).
 *
 * The ostinato/bolero `serve.mjs` port, trimmed: serves
 * apps/fugue/ as the document root — plain static files, .ts modules
 * transpiled on the fly (Bun.Transpiler, loader "tsx"), extensionless
 * import resolution (<path>.ts then <path>.js). The FUGUE_PORT env
 * var picks the port (default 4015 — the PLAN §5 ops contract; the
 * capture-usage lane takes 4016).
 *
 * `GET /health` answers `{ "ok": true, "port": <PORT> }` — the cheap
 * liveness probe the e2e webServer asserts on before launching specs.
 *
 * The F-7 chunk 3 server-edge routes (plain JS, no new deps):
 *   - GET /skills-staged: a READ-ONLY view of the repo's
 *     `.unown/skills-staged/` queue (each dir + its SKILL.md's first
 *     heading title). No write/delete/move endpoints: staging ->
 *     promotion stays a human action (the 2026-10-22 hardening law).
 *   - GET /manual-notes: the current `## Manual notes` section body
 *     from `.unown/memory/project.md` (the engine renderer's
 *     boundary; the honest empty state when absent).
 *   - PUT /manual-notes: splices ONLY that section into the file
 *     (every other line preserved byte-for-byte; atomic temp +
 *     rename within the same dir; bodies over 20000 chars are
 *     rejected outright with 400). In-app edits are the human's
 *     edits — the app never writes through an agent session.
 *
 * V-28 ISOLATION LAW: a route that can write a real file resolves its
 * target from the FUGUE_NOTES_ROOT env var (default: the repo root,
 * so the live lane is unchanged) — the test lane ALWAYS overrides it.
 *
 * Runs under `bun` only (Bun.Transpiler is bun-only). ES2020+ plain
 * JS, no TypeScript syntax. Dev/test server: no caching headers, no
 * auth, bound to 127.0.0.1.
 */
import { readFile, writeFile, readdir, rename, unlink } from "node:fs/promises";
import { resolve, dirname, join, extname } from "node:path";
// The shared section logic — the SAME module the UI + the tests drive
// (zero-dep: bun's native TS import; no transpile-eval hack lane):
//   the extract/splice boundary + the cap-law guard live in ONE place
//   so the server edge can never drift from the tested semantics.
import {
  extractManualNotes,
  spliceManualNotes,
  putRejectReason,
  MANUAL_NOTES_CAP,
} from "./src/ui/manual-notes-core.ts";

const ROOT = resolve(import.meta.dirname);
const PORT = Number(process.env.FUGUE_PORT ?? 4015);

// V-28 ISOLATION LAW: a route that can write a real file resolves its
// target from the FUGUE_NOTES_ROOT env var (default: the repo root —
// the LIVE lane keeps working unchanged; the TEST lane always
// overrides it with its own temp fixture dir, so no test-server boot
// can write a real file).
const FUGUE_NOTES_ROOT = resolve(process.env.FUGUE_NOTES_ROOT ?? resolve(ROOT, "..", ".."));
const SKILLS_STAGED_DIR = join(FUGUE_NOTES_ROOT, ".unown", "skills-staged");
const PROJECT_MD_PATH = join(FUGUE_NOTES_ROOT, ".unown", "memory", "project.md");
// The 4096 cap now comes from the shared module (single source of
// truth with the cap meter + the over-marker view model).
void MANUAL_NOTES_CAP;

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const transpiler = new Bun.Transpiler({ loader: "tsx" });

async function tryFile(p) {
  try {
    const buf = await readFile(p);
    const type = MIME[extname(p)] ?? "application/octet-stream";
    const body = extname(p) === ".ts" ? transpiler.transformSync(buf.toString("utf8")) : buf;
    return new Response(body, {
      headers: extname(p) === ".ts" ? { "content-type": "text/javascript" } : { "content-type": type },
    });
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* F-7 chunk 3: the /skills-staged + /manual-notes routes              */
/* ------------------------------------------------------------------ */

async function handleSkillsStaged() {
  let entries;
  try {
    entries = await readdir(SKILLS_STAGED_DIR, { withFileTypes: true });
  } catch {
    // The dir doesn't exist (or is unreadable): the honest empty queue.
    return new Response(JSON.stringify({ staged: [] }), {
      headers: { "content-type": "application/json" },
    });
  }
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));
  const staged = [];
  for (const d of dirs) {
    let title = "";
    try {
      const content = await readFile(join(SKILLS_STAGED_DIR, d.name, "SKILL.md"), "utf8");
      // The first heading line: a line starting with '#' (exactly one
      // or more '#', then whitespace, then the title).
      for (const line of content.split("\n")) {
        const m = line.match(/^#+[ \t]+(.+?)[ \t]*$/);
        if (m) {
          title = m[1].trim();
          break;
        }
      }
    } catch {
      // No SKILL.md or unreadable: honest empty title (never a crash).
    }
    staged.push({ name: d.name, title });
  }
  staged.sort((a, b) => a.name.localeCompare(b.name));
  return new Response(JSON.stringify({ staged }), {
    headers: { "content-type": "application/json" },
  });
}

async function handleManualNotesRead() {
  let file;
  try {
    file = await readFile(PROJECT_MD_PATH, "utf8");
  } catch {
    // The file doesn't exist: the honest empty section (the PUT route
    // will append it at EOF on first save).
    return new Response(
      JSON.stringify({ section: "", chars: 0, cap: MANUAL_NOTES_CAP, path: ".unown/memory/project.md" }),
      { headers: { "content-type": "application/json" } },
    );
  }
  const { section } = extractManualNotes(file);
  return new Response(
    JSON.stringify({ section, chars: section.length, cap: MANUAL_NOTES_CAP, path: ".unown/memory/project.md" }),
    { headers: { "content-type": "application/json" } },
  );
}

async function handleManualNotesWrite(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const section = typeof body.section === "string" ? body.section : "";
  const reject = putRejectReason(section);
  if (reject !== null) {
    return new Response(JSON.stringify({ error: reject }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  let file;
  try {
    file = await readFile(PROJECT_MD_PATH, "utf8");
  } catch {
    file = "";
  }
  const newFile = spliceManualNotes(file, section);
  // Atomic write: temp file in the same dir, then rename.
  const dir = dirname(PROJECT_MD_PATH);
  const tmp = join(dir, `.project.md.tmp.${process.pid}.${Date.now()}`);
  try {
    await writeFile(tmp, newFile, "utf8");
    await rename(tmp, PROJECT_MD_PATH);
  } catch (e) {
    // Clean up the temp on failure (never leave a partial write).
    try {
      await unlink(tmp);
    } catch {
      /* ignore */
    }
    return new Response(JSON.stringify({ error: `write failed: ${e.message}` }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(
    JSON.stringify({ ok: true, chars: section.length, cap: MANUAL_NOTES_CAP, path: ".unown/memory/project.md" }),
    { headers: { "content-type": "application/json" } },
  );
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch: async (req) => {
    const url = new URL(req.url);
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const method = req.method;

    // The cheap liveness probe the e2e webServer waits on.
    if (path === "health") {
      return new Response(JSON.stringify({ ok: true, port: PORT }), {
        headers: { "content-type": "application/json" },
      });
    }

    // F-7 chunk 3: the skills-staged queue (READ-ONLY; no write
    // endpoints — promotion stays a human mv).
    if (path === "skills-staged" && method === "GET") {
      return handleSkillsStaged();
    }

    // F-7 chunk 3: the Manual-notes editor (the ONE hand-edit lane).
    if (path === "manual-notes" && method === "GET") {
      return handleManualNotesRead();
    }
    if (path === "manual-notes" && method === "PUT") {
      return handleManualNotesWrite(req);
    }

    let p = path === "" ? "index.html" : path;
    let res = await tryFile(resolve(ROOT, p));
    if (!res) res = await tryFile(resolve(ROOT, p + ".ts"));
    if (!res) res = await tryFile(resolve(ROOT, p + ".js"));
    if (!res && p.endsWith(".js")) res = await tryFile(resolve(ROOT, p.slice(0, -3) + ".ts"));
    return res ?? new Response("not found", { status: 404 });
  },
});

console.log(`[fugue] serving ${ROOT} at http://127.0.0.1:${PORT}`);
