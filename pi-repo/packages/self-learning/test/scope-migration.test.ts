// Integration tests for the composite-slug scope migration — the data path
// of project-identity.ts (2026-10-22 shared-memory consistency work).
//
// Pinned here:
//   MIGRATE-LEGACY-SCOPE (memzero.ts):
//     1. a legacy scope's memories are copied VERBATIM into the composite
//        scope, per-kind metadata preserved (harness/seed keep their kind);
//     2. idempotent — a non-empty destination is a no-op;
//     3. an empty source is a no-op;
//     4. the legacy scope itself is left intact (audit surface).
//
//   RUN-PROJECT-DREAM WIRING (dream.ts):
//     5. a project with an established LEGACY scope dreams under its composite
//        key: the old memories carry over, the new note's memory joins them,
//        the version row lands under the composite tier key, and the legacy
//        tier key is untouched;
//     6. the project's memory FILE (the terminal source of truth) reflects the
//        merged scope after the dream.
//
//   THE COLLISION STORY END-TO-END:
//     7. two same-named projects with different git remotes dream into
//        SEPARATE scopes — one project's conventions never appear in the
//        other's memory file (the pre-composite leak, pinned as fixed).
//
// Env: like dream-guard.test.ts — PI_DREAM_GATE=0, a stub llm-bridge for the
// skills/harness paths, the FAKE memory platform (no real mem0/LLM).
import "./_env.ts";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { runProjectDream } from "../src/dream.ts";
import { migrateLegacyScope, projectScope } from "../src/memzero.ts";
import { ingestTerminalNote, slugifyProject } from "../src/notes.ts";
import { basenameSlug } from "../src/project-identity.ts";
import { store } from "../src/store.ts";
import { initProjectMemory, projectMemoryPath } from "../src/term.ts";
import { makeFakePlatform, type FakePlatform } from "./_fake-platform.ts";

const SCRATCH = join(tmpdir(), "engine-tests-scope-migration");

const STUB_PORT = 3065;
const STUB_SCRIPT = `
import { serve } from "bun";
const server = serve({
  port: ${STUB_PORT},
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (url.pathname === "/v1/chat/completions") {
      return Response.json({
        choices: [{ message: { role: "assistant", content: JSON.stringify({ skills: [] }) } }],
      });
    }
    return new Response("not found", { status: 404 });
  },
});
console.log("STUB_READY");
`;

let savedGate: string | undefined;
let savedBridgeUrl: string | undefined;
let stubProc: ReturnType<typeof spawn> | null = null;

beforeAll(async () => {
        savedGate = process.env.PI_DREAM_GATE;
        savedBridgeUrl = process.env.PI_BRIDGE_URL;
        mkdirSync(SCRATCH, { recursive: true });
        const stubPath = join(SCRATCH, "bridge-stub.ts");
        writeFileSync(stubPath, STUB_SCRIPT);
        stubProc = spawn(process.execPath, [stubPath], { stdio: ["ignore", "pipe", "ignore"] });
        await new Promise<void>((resolve) => {
                const deadline = Date.now() + 10_000;
                const poll = () => {
                        if (Date.now() > deadline) return resolve();
                        fetch(`http://127.0.0.1:${STUB_PORT}/health`).then(() => resolve()).catch(() => setTimeout(poll, 100));
                };
                poll();
        });
        process.env.PI_BRIDGE_URL = `http://127.0.0.1:${STUB_PORT}`;
        process.env.PI_DREAM_GATE = "0";
        store.run(`DELETE FROM memory_versions WHERE tier LIKE 'project:%'`);
        store.run(`DELETE FROM dreams`);
        store.run(`DELETE FROM notes`);
});

afterAll(() => {
        stubProc?.kill();
        if (savedGate === undefined) delete process.env.PI_DREAM_GATE;
        else process.env.PI_DREAM_GATE = savedGate;
        if (savedBridgeUrl === undefined) delete process.env.PI_BRIDGE_URL;
        else process.env.PI_BRIDGE_URL = savedBridgeUrl;
        rmSync(SCRATCH, { recursive: true, force: true });
        store.run(`DELETE FROM memory_versions WHERE tier LIKE 'project:%'`);
        store.run(`DELETE FROM dreams`);
        store.run(`DELETE FROM notes`);
});

beforeEach(() => {
        store.run(`DELETE FROM notes`);
        store.run(`DELETE FROM dreams`);
        store.run(`DELETE FROM memory_versions WHERE tier LIKE 'project:%'`);
});

/** A project directory with a git remote (stable composite slug). */
function makeProject(name: string, remote: string): string {
        const parent = join(SCRATCH, name);
        const dir = join(parent, "repo");
        mkdirSync(dir, { recursive: true });
        mkdirSync(join(dir, ".git"), { recursive: true });
        writeFileSync(
                join(dir, ".git", "config"),
                `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = ${remote}\n`,
                "utf8",
        );
        initProjectMemory(dir);
        return dir;
}

const noReconcile = async () => ({ ops: [] });

// --------------------------------------------------------------- the primitive

describe("migrateLegacyScope", () => {
        test("copies memories verbatim, per-kind, into the destination scope", async () => {
                const platform = makeFakePlatform();
                // legacy scope content: mixed kinds
                platform.seed([
                        { id: "l1", text: "run tests with bun test", metadata: { kind: "legacy", agent_id: "project:api" } },
                        { id: "l2", text: "verified fix: guard the write path", metadata: { kind: "harness", agent_id: "project:api" } },
                        { id: "l3", text: "starter rule", metadata: { kind: "seed", agent_id: "project:api" } },
                ]);
                const from = projectScope("api");
                const to = projectScope("api-3f9c21d");
                const n = await migrateLegacyScope(from, to, { platform });
                expect(n).toBe(3);
                const copied = await platform.getAll(to);
                expect(copied.map((m) => m.text).sort()).toEqual(
                        ["run tests with bun test", "verified fix: guard the write path", "starter rule"].sort(),
                );
                // kinds preserved (harness/seed keep render-cap immunity)
                const kinds = new Set(copied.map((m) => m.metadata?.kind));
                expect(kinds.has("harness")).toBe(true);
                expect(kinds.has("seed")).toBe(true);
                expect(kinds.has("legacy")).toBe(true);
                // the adds were verbatim (infer: false)
                for (const c of platform.calls.filter((x) => x.op === "add")) expect(c.infer).toBe(false);
        });

        test("idempotent: a non-empty destination is a no-op", async () => {
                const platform = makeFakePlatform();
                platform.seed([{ id: "l1", text: "old rule", metadata: { kind: "legacy", agent_id: "project:api" } }]);
                platform.seed([{ id: "n1", text: "already here", metadata: { kind: "terminal-note", agent_id: "project:api-3f9c21d" } }]);
                const n = await migrateLegacyScope(projectScope("api"), projectScope("api-3f9c21d"), { platform });
                expect(n).toBe(0);
                expect(platform.calls.filter((x) => x.op === "add")).toHaveLength(0);
        });

        test("an empty source is a no-op", async () => {
                const platform = makeFakePlatform();
                const n = await migrateLegacyScope(projectScope("ghost"), projectScope("ghost-abc123"), { platform });
                expect(n).toBe(0);
                expect(platform.calls.filter((x) => x.op === "add")).toHaveLength(0);
        });

        test("the legacy scope is left intact (audit surface)", async () => {
                const platform = makeFakePlatform();
                platform.seed([{ id: "l1", text: "old rule", metadata: { kind: "legacy", agent_id: "project:api" } }]);
                await migrateLegacyScope(projectScope("api"), projectScope("api-3f9c21d"), { platform });
                const legacy = await platform.getAll(projectScope("api"));
                expect(legacy).toHaveLength(1);
                expect(legacy[0]?.text).toBe("old rule");
        });
});

// ------------------------------------------------------- the dream wiring

describe("runProjectDream — composite-scope migration", () => {
        test("an established legacy scope carries into the composite scope at the next dream", async () => {
                const project = makeProject("established", "https://github.com/owner/established.git");
                const slug = slugifyProject(project);
                expect(slug).not.toBe(basenameSlug(project)); // composite, not legacy

                // Pre-state: memories live under the LEGACY scope only (an install
                // that dreamed before the composite key existed). The legacy key was
                // the LOCAL DIRECTORY basename — "repo" here, which is deliberately
                // different from the remote's repo name to pin that distinction.
                const platform = makeFakePlatform();
                platform.seed([
                        { id: "l1", text: "columns are 1-based in the CSV parser", metadata: { kind: "legacy", agent_id: `project:${basenameSlug(project)}` } },
                ]);

                ingestTerminalNote("Terminal session outcome: pinned the flaky parser test by forcing column offsets.", project);
                const results = await runProjectDream({ platform, reconcileLlmFn: noReconcile });

                expect(results).toHaveLength(1);
                expect(results[0]?.status).toBe("done");

                // The composite scope now holds BOTH the migrated legacy memory and
                // the new terminal note's memory.
                const composite = await platform.getAll(projectScope(slug));
                const texts = composite.map((m) => m.text).join("\n");
                expect(texts).toContain("columns are 1-based in the CSV parser");
                expect(texts).toContain("flaky parser test");

                // The version row landed under the composite tier key; the legacy
                // tier key (the local-dir basename) was never written.
                const compositeRow = store.get<any>(
                        `SELECT changed_by FROM memory_versions WHERE tier = ? ORDER BY version DESC LIMIT 1`,
                        [`project:${slug}`],
                );
                expect(compositeRow?.changed_by).toBe("mem0");
                const legacyRows = store.query<any>(`SELECT * FROM memory_versions WHERE tier = ?`, [
                        `project:${basenameSlug(project)}`,
                ]);
                expect(legacyRows).toHaveLength(0);

                // The project's memory FILE reflects the merged scope.
                const file = readFileSync(projectMemoryPath(project), "utf8");
                expect(file).toContain("columns are 1-based in the CSV parser");
        });

        test("REGRESSION: two same-named projects with different remotes never share a scope", async () => {
                const work = makeProject("api-work", "https://github.com/work/api.git");
                const personal = makeProject("api-personal", "https://github.com/personal/api.git");
                // both directories are literally named "repo" — the legacy basename key
                expect(basenameSlug(work)).toBe(basenameSlug(personal));
                expect(slugifyProject(work)).not.toBe(slugifyProject(personal));

                const platform = makeFakePlatform();
                ingestTerminalNote("Terminal session outcome: work-api uses column-offset conventions, pinned in tests.", work);
                ingestTerminalNote("Terminal session outcome: personal-api stores markdown notes with daily journals.", personal);

                const results = await runProjectDream({ platform, reconcileLlmFn: noReconcile });
                expect(results).toHaveLength(2);

                const workFile = readFileSync(projectMemoryPath(work), "utf8");
                const personalFile = readFileSync(projectMemoryPath(personal), "utf8");

                // Each project's memory holds its OWN session's learning...
                expect(workFile).toContain("column-offset conventions");
                expect(personalFile).toContain("daily journals");
                // ...and NEVER the other's (the pre-composite leak).
                expect(workFile).not.toContain("daily journals");
                expect(personalFile).not.toContain("column-offset conventions");

                // Two distinct scopes in the platform, one per project.
                const workScope = await platform.getAll(projectScope(slugifyProject(work)));
                const personalScope = await platform.getAll(projectScope(slugifyProject(personal)));
                expect(workScope.every((m) => !m.text.includes("daily journals"))).toBe(true);
                expect(personalScope.every((m) => !m.text.includes("column-offset conventions"))).toBe(true);
        });
});
