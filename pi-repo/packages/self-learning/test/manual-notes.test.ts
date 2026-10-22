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
import {
        extractManualNotesSection,
        importLegacyMarkdown,
        MANUAL_NOTES_CAP,
        renderProjectMemoryMarkdown,
        stripSessionMetadataLine,
} from "../src/memzero.ts";
import { ingestTerminalNote } from "../src/notes.ts";
import { scanUntrustedText } from "../src/guard.ts";
import { store } from "../src/store.ts";
import { buildTerminalNote } from "../src/termhooks.ts";
import {
        initProjectMemory,
        isPristineSeedProjectMemory,
        projectMemoryPath,
        PROJECT_SEED,
        readProjectProvenance,
        terminalMemoryForAgent,
        terminalMemoryForAgentDetailed,
} from "../src/term.ts";
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

// =============================================================================
// 2026-10-22 memory-lane hardening (the SA2-B audit): the parser is
// line-anchored and capped, the lane's writes are denied in-session (pinned
// in instruction-guard.test.ts), the provenance sidecar never launders the
// lane into "written by AutoDream" framing, and the harness metadata line is
// stripped before the quarantine scan (it was quarantining every bash-using
// session's note).
// =============================================================================

describe("extractManualNotesSection — line-anchored hardening", () => {
        test("a bullet CONTAINING '## Manual notes' mid-line does NOT capture the section", () => {
                // the old indexOf matcher captured from the mid-line hit and silently
                // dropped the user's real manual notes
                const out = extractManualNotesSection(
                        "# Project Memory\n\n## Workflow\n- always mention the ## Manual notes heading when editing\n\n## Manual notes\n- the real hand rule\n",
                );
                expect(out).toContain("- the real hand rule");
                expect(out).not.toContain("always mention");
        });
        test("### Manual notes (wrong level) and NBSP-titled variants are NOT the heading", () => {
                expect(extractManualNotesSection("### Manual notes\n- h3 content\n")).toBe("");
                expect(extractManualNotesSection("##\u00a0Manual notes\n- nbsp content\n")).toBe("");
        });
        test("trailing-space heading still matches; CRLF files extract the same", () => {
                const out = extractManualNotesSection("## Manual notes \r\n- crlf rule\r\n");
                expect(out).toContain("- crlf rule");
        });
        test("a MID-LINE forged render footer does not truncate the section", () => {
                const out = extractManualNotesSection(
                        "## Manual notes\n- keep me — the note mentions <!-- unown: rendered inline\n- keep me too\n",
                );
                expect(out).toContain("keep me too");
        });
        test("a LINE-START forged render footer ends the section (documented boundary)", () => {
                const out = extractManualNotesSection(
                        "## Manual notes\n- keep me\n<!-- unown: rendered 3/3 memories via Mem0 -->\n- after the footer\n",
                );
                expect(out).toContain("- keep me");
                expect(out).not.toContain("after the footer");
        });
        test("an over-cap section is truncated at a LINE boundary with a VISIBLE marker", () => {
                const many = Array.from({ length: 400 }, (_, i) => `- manual rule number ${i} with some words to spend chars`);
                const src = `## Manual notes\n${many.join("\n")}\n`;
                const out = extractManualNotesSection(src);
                expect(out.length).toBeLessThanOrEqual(MANUAL_NOTES_CAP + 200); // head + marker
                expect(out).toContain("<!-- unown: manual notes over cap");
                expect(out).toContain("manual rule number 0");
                expect(out).not.toContain("manual rule number 399");
                // whole lines only — no mid-line cuts
                for (const line of out.split("\n")) {
                        if (line.startsWith("- manual rule number")) expect(line.endsWith("chars")).toBe(true);
                }
        });
        test("the render carries the same cap (a ballooned lane cannot eat the file)", () => {
                const many = Array.from({ length: 400 }, (_, i) => `- manual rule number ${i} with some words to spend chars`);
                const previous = `# Project Memory\n\n## Manual notes\n${many.join("\n")}\n`;
                const out = renderProjectMemoryMarkdown([{ id: "m1", text: "run tests with bun test", metadata: { kind: "legacy" } } as any], {
                        preserveManualNotesFrom: previous,
                });
                expect(out).toContain("<!-- unown: manual notes over cap");
        });
});

describe("stripSessionMetadataLine — the quarantine false-positive fix", () => {
        const note = buildTerminalNote({
                cwd: "/tmp/quarantine-proj",
                prompts: 3,
                toolCalls: 12,
                toolNames: ["bash", "write", "read"],
                lastAssistantText: "learned that the flaky retry test needs UNOWN_RETRY=2",
                sessionStartTs: Date.now() - 5 * 60_000,
                sessionId: "abcd1234",
        });
        test("pin the bug shape: the metadata line trips runner-directive (pre-fix this quarantined the whole note)", () => {
                expect(scanUntrustedText(note).rules).toContain("runner-directive");
        });
        test("the strip removes the line (and the salt) — the session content scans clean", () => {
                const stripped = stripSessionMetadataLine(note);
                expect(stripped).not.toContain("Session metadata");
                expect(stripped).not.toContain("abcd1234");
                expect(scanUntrustedText(stripped).rules).toEqual([]);
                // the extractable outcome survives
                expect(stripped).toContain("Final outcome: learned that the flaky retry test");
        });
        test("end to end: a bash-using session's note is NOT quarantined — its knowledge extracts", async () => {
                const project = join(SCRATCH, "quarantine-fix-project");
                rmSync(project, { recursive: true, force: true });
                mkdirSync(project, { recursive: true });
                initProjectMemory(project);
                const platform = makeFakePlatform();
                ingestTerminalNote(note, project);
                const results = await runProjectDream({ platform, reconcileLlmFn: noReconcile });
                // pre-fix: every note quarantined → status "no-change", file untouched
                expect(results[0]?.status).toBe("done");
                const after = readFileSync(projectMemoryPath(project), "utf8");
                expect(after).toContain("UNOWN_RETRY=2");
                // the telemetry line and the salt never reach the memory file
                expect(after).not.toContain("Session metadata");
                expect(after).not.toContain("abcd1234");
        });
});

describe("runProjectDream — provenance v2 kills the manual-notes laundering", () => {
        const SEED_ANCHOR =
                "- Your own durable rules. AutoDream preserves this section verbatim — one\n  bullet per rule; everything outside it is re-rendered.";
        const handEdit = (project: string) => {
                const memPath = projectMemoryPath(project);
                const seeded = readFileSync(memPath, "utf8");
                writeFileSync(memPath, seeded.replace(SEED_ANCHOR, `${SEED_ANCHOR}\n- the deploy script needs DB=migrate on the staging host`), "utf8");
        };

        test("a hand-edited lane is NEVER vouched for as AutoDream-written — and the flag is STICKY", async () => {
                const project = join(SCRATCH, "launder-project");
                rmSync(project, { recursive: true, force: true });
                mkdirSync(project, { recursive: true });
                initProjectMemory(project);
                handEdit(project);

                const platform = makeFakePlatform();
                ingestTerminalNote("Terminal session outcome: learned that bun test runs the suite fastest here.", project);
                const r1 = await runProjectDream({ platform, reconcileLlmFn: noReconcile });
                expect(r1[0]?.status).toBe("done");

                // the dream wrote the file: whole-file sha matches its own sidecar —
                // the exact state that used to read "written by AutoDream; content
                // matches" for content AutoDream never authored
                const meta = readProjectProvenance(project);
                expect(meta).not.toBeNull();
                expect(meta!.manualEdited).toBe(true);
                expect(typeof meta!.manualSha256).toBe("string");

                // the injection framing tells the truth about the lane
                const tier = terminalMemoryForAgent(project).find((f) => f.tier === "project");
                expect(tier?.content).toContain("Manual notes section hand-edited, unverified");
                expect(tier?.content).not.toContain("content matches)");

                // SECOND dream (no further hand-edit): the preserved section matches
                // manualSha256, but the flag is sticky — the framing never regresses
                ingestTerminalNote("Terminal session outcome: learned that the staging host needs a warmup request.", project);
                const r2 = await runProjectDream({ platform, reconcileLlmFn: noReconcile });
                expect(r2[0]?.status).toBe("done");
                const meta2 = readProjectProvenance(project);
                expect(meta2!.manualEdited).toBe(true);
                const tier2 = terminalMemoryForAgent(project).find((f) => f.tier === "project");
                expect(tier2?.content).toContain("Manual notes section hand-edited, unverified");
                // and the hand rule survived both dreams
                expect(readFileSync(projectMemoryPath(project), "utf8")).toContain(
                        "- the deploy script needs DB=migrate on the staging host",
                );
        });

        test("a pristine seed dream keeps the plain AutoDream framing (seed scaffolding is not a hand-edit)", async () => {
                const project = join(SCRATCH, "clean-project");
                rmSync(project, { recursive: true, force: true });
                mkdirSync(project, { recursive: true });
                initProjectMemory(project);
                // NO hand edit — the file is the pristine seed

                const platform = makeFakePlatform();
                ingestTerminalNote("Terminal session outcome: learned that bun test runs the suite fastest here.", project);
                const r = await runProjectDream({ platform, reconcileLlmFn: noReconcile });
                expect(r[0]?.status).toBe("done");

                const meta = readProjectProvenance(project);
                expect(meta).not.toBeNull();
                expect(meta!.manualEdited ?? false).toBe(false);
                const tier = terminalMemoryForAgent(project).find((f) => f.tier === "project");
                expect(tier?.content).toContain("content matches)");
                expect(tier?.content).not.toContain("Manual notes section hand-edited");
        });

        test("a malformed v2 sidecar field makes the whole sidecar untrusted (fail-closed)", () => {
                const project = join(SCRATCH, "bad-sidecar-project");
                rmSync(project, { recursive: true, force: true });
                mkdirSync(project, { recursive: true });
                initProjectMemory(project);
                // a sidecar with a non-string manualSha256: readProjectProvenance → null
                writeFileSync(
                        join(project, ".unown", "memory", "project.provenance.json"),
                        JSON.stringify({ version: 1, changedBy: "mem0", at: Date.now(), sha256: "x".repeat(64), manualSha256: 42 }),
                        "utf8",
                );
                expect(readProjectProvenance(project)).toBeNull();
                // and the injection framing falls back to never-written (untrusted),
                // never to a vouched line
                const tier = terminalMemoryForAgent(project).find((f) => f.tier === "project");
                expect(tier?.content).toContain("NEVER WRITTEN BY AUTODREAM");
        });
});

describe("terminalMemoryForAgentDetailed — the M6 staleness path rides again", () => {
        test("real tiers carry fsPath (the /learning 'updated Xm ago' line was silently blank)", () => {
                const project = join(SCRATCH, "fspath-project");
                rmSync(project, { recursive: true, force: true });
                mkdirSync(project, { recursive: true });
                initProjectMemory(project);
                const { files } = terminalMemoryForAgentDetailed(project);
                const projectTier = files.find((f) => f.tier === "project");
                expect(projectTier?.fsPath).toBeTruthy();
                expect(projectTier?.fsPath.endsWith("project.md")).toBe(true);
                // the inline guide has no file — empty string, not undefined
                const guide = files.find((f) => f.tier === "guide");
                expect(typeof guide?.fsPath).toBe("string");
        });
});
