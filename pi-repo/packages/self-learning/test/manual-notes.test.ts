// Integration tests for the Manual notes preservation lane (2026-10-22) —
// the honest hand-edit contract for project memory:
//
//   1. renderProjectMemoryMarkdown re-appends the previous file's
//      "## Manual notes" section VERBATIM (dreams never rewrite user bullets);
//   2. the section is extracted heading-to-next-heading / to the footer;
//   3. importLegacyMarkdown skips seed-instructional bullets (scaffolding
//      copy is not a learned rule);
//   4. isPristineSeedProjectMemory still recognizes both seed generations;
//   5. END TO END: a hand-added Manual notes bullet survives a real
//      runProjectDream while the platform learning around it re-renders.
import "./_env.ts";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { runProjectDream } from "../src/dream.ts";
import { extractManualNotesSection, importLegacyMarkdown, renderProjectMemoryMarkdown } from "../src/memzero.ts";
import { ingestTerminalNote } from "../src/notes.ts";
import { store } from "../src/store.ts";
import { initProjectMemory, isPristineSeedProjectMemory, projectMemoryPath, PROJECT_SEED } from "../src/term.ts";
import { makeFakePlatform } from "./_fake-platform.ts";

const SCRATCH = join(tmpdir(), "engine-tests-manual-notes");

const STUB_PORT = 3066;
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

const noReconcile = async () => ({ ops: [] });

// ------------------------------------------------------------- the extractor

describe("extractManualNotesSection", () => {
        test("extracts heading to EOF when nothing follows", () => {
                const out = extractManualNotesSection("# Project Memory\n\n## Workflow\n- rule\n\n## Manual notes\n- keep me\n");
                expect(out).toContain("## Manual notes");
                expect(out).toContain("- keep me");
                expect(out).not.toContain("Workflow");
        });
        test("stops at the next ## heading", () => {
                const out = extractManualNotesSection(
                        "## Manual notes\n- keep me\n\n## Facts\n- platform fact\n",
                );
                expect(out).toContain("- keep me");
                expect(out).not.toContain("platform fact");
        });
        test("stops at the render footer comment", () => {
                const out = extractManualNotesSection(
                        "## Manual notes\n- keep me\n\n<!-- unown: rendered 3/3 memories via Mem0 (backend: lexical) -->\n",
                );
                expect(out).toContain("- keep me");
                expect(out).not.toContain("unown: rendered");
        });
        test("no section in the source -> empty string", () => {
                expect(extractManualNotesSection("# Project Memory\n\n## Workflow\n- rule\n")).toBe("");
                expect(extractManualNotesSection("")).toBe("");
        });
});

// ----------------------------------------------------------------- the render

describe("renderProjectMemoryMarkdown — manual-notes preservation", () => {
        const MEM = [
                { id: "m1", text: "run tests with bun test", metadata: { kind: "legacy" } },
        ] as const;

        test("the previous file's Manual notes survive the re-render VERBATIM", () => {
                const previous = `# Project Memory\n\n## Manual notes\n- always run the formatter before committing\n- the staging DB is shared — never truncate it\n`;
                const out = renderProjectMemoryMarkdown([...MEM], { preserveManualNotesFrom: previous });
                expect(out).toContain("## Manual notes");
                expect(out).toContain("- always run the formatter before committing");
                expect(out).toContain("- the staging DB is shared — never truncate it");
                expect(out).toContain("run tests with bun test"); // platform memories render too
        });

        test("a dream CHAIN carries manual notes forward (render output feeds the next render)", () => {
                const manual = `## Manual notes\n- hand rule alpha\n`;
                const first = renderProjectMemoryMarkdown([...MEM], { preserveManualNotesFrom: manual });
                const second = renderProjectMemoryMarkdown([...MEM], { preserveManualNotesFrom: first });
                expect(second).toContain("- hand rule alpha");
                // and the chain does not DUPLICATE the section
                expect(second.split("## Manual notes").length - 1).toBe(1);
        });

        test("no Manual notes in the previous file -> none in the output (clean projects unaffected)", () => {
                const out = renderProjectMemoryMarkdown([...MEM], {
                        preserveManualNotesFrom: "# Project Memory\n\n## Workflow\n- rule\n",
                });
                expect(out).not.toContain("## Manual notes");
        });
});

// ------------------------------------------------- the import + pristine pins

describe("importLegacyMarkdown — instructional bullets stay out", () => {
        test("seed scaffolding copy is not imported as a memory", async () => {
                const platform = makeFakePlatform();
                const seeded = PROJECT_SEED.replace(
                        "(empty — AutoDream fills this from session notes)",
                        "- learned rule from the swap boundary",
                );
                const n = await importLegacyMarkdown(seeded, { agentId: "project:mn-test" }, { platform });
                // only the real bullet imports; the seed's own instructional bullets do not
                expect(n).toBe(1);
                const all = await platform.getAll({ agentId: "project:mn-test" });
                expect(all.map((m) => m.text)).toEqual(["learned rule from the swap boundary"]);
        });
});

describe("isPristineSeedProjectMemory — both seed generations", () => {
        test("the CURRENT seed is pristine", () => {
                expect(isPristineSeedProjectMemory(PROJECT_SEED)).toBe(true);
        });
        test("the OLD seed (pre-manual-notes copy) is still pristine via the marker fallback", () => {
                const oldSeed = `# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
(empty — AutoDream fills this from session notes)

## Known pitfalls
(empty)
`;
                expect(isPristineSeedProjectMemory(oldSeed)).toBe(true);
        });
        test("seed + one real Manual notes bullet is NOT pristine (real content exists)", () => {
                const withContent = PROJECT_SEED.replace(
                        "- Your own durable rules. AutoDream preserves this section verbatim — one\n  bullet per rule; everything outside it is re-rendered.",
                        "- Your own durable rules. AutoDream preserves this section verbatim — one\n  bullet per rule; everything outside it is re-rendered.\n- my real hand-written rule",
                );
                expect(isPristineSeedProjectMemory(withContent)).toBe(false);
        });
});

// ------------------------------------------------------------- end to end

describe("runProjectDream — the hand-edit lane survives a real dream", () => {
        test("a hand-added Manual notes bullet survives; platform learning re-renders around it", async () => {
                const project = join(SCRATCH, "hand-edit-project");
                mkdirSync(project, { recursive: true });
                initProjectMemory(project);

                // The user hand-adds a durable rule into the Manual notes section.
                const memPath = projectMemoryPath(project);
                const seeded = readFileSync(memPath, "utf8");
                writeFileSync(
                        memPath,
                        seeded.replace(
                                "- Your own durable rules. AutoDream preserves this section verbatim — one\n  bullet per rule; everything outside it is re-rendered.",
                                "- Your own durable rules. AutoDream preserves this section verbatim — one\n  bullet per rule; everything outside it is re-rendered.\n- the deploy script needs DB=migrate on the staging host",
                        ),
                        "utf8",
                );

                const platform = makeFakePlatform();
                ingestTerminalNote("Terminal session outcome: learned that bun test runs the suite fastest here.", project);
                const results = await runProjectDream({ platform, reconcileLlmFn: noReconcile });

                expect(results[0]?.status).toBe("done");
                const after = readFileSync(memPath, "utf8");
                // the hand-written rule SURVIVED the dream
                expect(after).toContain("- the deploy script needs DB=migrate on the staging host");
                // the platform learning rendered too
                expect(after).toContain("bun test runs the suite fastest");
                // exactly one Manual notes section (no duplication)
                expect(after.split("## Manual notes").length - 1).toBe(1);
        });
});
